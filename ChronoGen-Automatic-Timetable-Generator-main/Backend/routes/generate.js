// routes/generate.js — GA run, SSE progress stream, timetable CRUD, attendance

require('dotenv').config();

const express    = require('express');
const router     = express.Router();
const db         = require('../db');
const { evolve } = require('../ga/genetic');

// In-memory session store for live SSE progress.
// Capped at 20 sessions to prevent memory leaks on long-running servers.
const sessions     = {};
const MAX_SESSIONS = 20;

function cleanupOldSessions() {
  const keys = Object.keys(sessions);
  if (keys.length >= MAX_SESSIONS) delete sessions[keys[0]];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}


// ── POST /api/generate — Kick off a GA run ───────────────────
router.post('/', async (req, res) => {
  try {
    const config = {
      population_size:           clamp(parseInt(req.body.population_size)  || 120, 10, 300),
      max_generations:           clamp(parseInt(req.body.max_generations)  || 400, 50, 1000),
      crossover_rate:            clamp(parseFloat(req.body.crossover_rate) || 0.88, 0.5, 0.99),
      mutation_rate:             clamp(parseFloat(req.body.mutation_rate)  || 0.03, 0.001, 0.3),
      tournament_size:           clamp(parseInt(req.body.tournament_size)  || 6, 2, 20),
      elitism_count:             clamp(parseInt(req.body.elitism_count)    || 4, 1, 10),
      stagnation_window:         30,
      stagnation_mutation_boost: 0.12,
      target_fitness:            9800,
      random_seed:               parseInt(req.body.random_seed) || 42,
    };

    // Load institution settings
    let institution;
    try {
      const [[row]] = await db.query('SELECT * FROM institution WHERE id=1');
      institution = row || { id: 1, name: 'College', days_per_week: 5, periods_per_day: 8 };
    } catch (dbErr) {
      return res.status(500).json({
        success: false,
        error: 'DB error: ' + dbErr.message + '. Run: mysql -u root -p < Database/schema.sql',
      });
    }

    const [teachers]           = await db.query('SELECT * FROM teachers WHERE institution_id=1');
    const [rooms]              = await db.query('SELECT * FROM rooms WHERE institution_id=1');
    const [subjects]           = await db.query('SELECT * FROM subjects WHERE institution_id=1');
    const [classes]            = await db.query('SELECT * FROM classes WHERE institution_id=1');
    const [curriculum]         = await db.query('SELECT * FROM curriculum');
    const [teacherSubjects]    = await db.query('SELECT * FROM teacher_subjects');
    const [teacherUnavailable] = await db.query('SELECT * FROM teacher_unavailable');

    if (!classes || classes.length === 0) {
      return res.status(400).json({ success: false, error: 'No classes found. Load demo data first.' });
    }
    if (!rooms || rooms.length === 0) {
      return res.status(400).json({ success: false, error: 'No rooms found. Load demo data first.' });
    }

    const data = { institution, teachers, rooms, subjects, classes, curriculum, teacherSubjects, teacherUnavailable };

    const validationErrors = validateData(data);
    if (validationErrors.length > 0) {
      return res.status(400).json({ success: false, error: 'Validation failed.', validationErrors });
    }

    // Create a session so the frontend can poll progress via SSE
    const sessionId = `run_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
    cleanupOldSessions();
    sessions[sessionId] = { progress: [], done: false, result: null, error: null };

    db.query(
      "INSERT INTO ga_runs (session_id, institution_id, population_size, max_generations, status) VALUES (?, 1, ?, ?, 'running')",
      [sessionId, config.population_size, config.max_generations]
    ).catch(e => console.warn('Could not save ga_run:', e.message));

    // Return the session ID immediately so the frontend can open the SSE stream
    res.json({ success: true, sessionId });

    // Run the GA in the background (non-blocking)
    evolve(data, config, (progress) => {
      sessions[sessionId].progress.push(progress);
    })
    .then(async (result) => {
      sessions[sessionId].done   = true;
      sessions[sessionId].result = result;

      // Persist the best chromosome to the DB
      try {
        await db.query('DELETE FROM timetable_genes WHERE session_id=?', [sessionId]);
        await db.query("DELETE FROM timetable_genes WHERE session_id='latest'");

        for (const gene of result.chromosome) {
          const values = [sessionId, gene.class_id, gene.subject_id, gene.teacher_id, gene.room_id, gene.day, gene.period, result.fitness];
          await db.query(
            'INSERT INTO timetable_genes (session_id,class_id,subject_id,teacher_id,room_id,day,period,fitness_score) VALUES (?,?,?,?,?,?,?,?)',
            values
          );
          // Also save under 'latest' so the output page always has something to show
          await db.query(
            "INSERT INTO timetable_genes (session_id,class_id,subject_id,teacher_id,room_id,day,period,fitness_score) VALUES ('latest',?,?,?,?,?,?,?)",
            values.slice(1)
          );
        }

        await db.query(
          "UPDATE ga_runs SET final_fitness=?, generations_run=?, status='completed' WHERE session_id=?",
          [result.fitness, result.generationLog.length, sessionId]
        );
      } catch (saveErr) {
        console.error('Error saving timetable:', saveErr.message);
      }
    })
    .catch((err) => {
      console.error('GA error:', err.message);
      sessions[sessionId].done  = true;
      sessions[sessionId].error = err.message;
      db.query("UPDATE ga_runs SET status='failed' WHERE session_id=?", [sessionId]).catch(() => {});
    });

  } catch (err) {
    console.error('Generate route error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── GET /api/generate/progress/:sid — SSE live stream ────────
router.get('/progress/:sid', (req, res) => {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const session = sessions[req.params.sid];
  if (!session) {
    res.write('data: ' + JSON.stringify({ type: 'error', message: 'Session not found' }) + '\n\n');
    return res.end();
  }

  let readIndex = 0;

  const interval = setInterval(() => {
    const s = sessions[req.params.sid];
    if (!s) { clearInterval(interval); return res.end(); }

    // Flush any buffered progress events
    while (readIndex < s.progress.length) {
      res.write('data: ' + JSON.stringify({ type: 'progress', ...s.progress[readIndex] }) + '\n\n');
      readIndex++;
    }

    if (s.done) {
      clearInterval(interval);
      // Final flush before sending the completion event
      while (readIndex < s.progress.length) {
        res.write('data: ' + JSON.stringify({ type: 'progress', ...s.progress[readIndex] }) + '\n\n');
        readIndex++;
      }
      if (s.error) {
        res.write('data: ' + JSON.stringify({ type: 'error', message: s.error }) + '\n\n');
      } else {
        res.write('data: ' + JSON.stringify({
          type:                 'complete',
          fitness:              s.result.fitness,
          isValid:              s.result.isValid,
          bestGeneration:       s.result.bestGeneration,
          firstValidGeneration: s.result.firstValidGeneration,
          generationLog:        s.result.generationLog,
          violations:           s.result.violations,
        }) + '\n\n');
      }
      res.end();
      // Keep session alive for 60s in case the frontend reconnects
      setTimeout(() => { delete sessions[req.params.sid]; }, 60000);
    }
  }, 200);

  req.on('close', () => clearInterval(interval));
});


// ── GET /api/generate/timetable — Fetch saved timetable ──────
router.get('/timetable', async (req, res) => {
  try {
    const sessionId = req.query.session || 'latest';

    const [genes] = await db.query(
      `SELECT tg.*,
              c.name AS class_name,
              s.name AS subject_name,
              t.name AS teacher_name,
              r.name AS room_name,
              r.type AS room_type
       FROM timetable_genes tg
       LEFT JOIN classes  c ON tg.class_id   = c.id
       LEFT JOIN subjects s ON tg.subject_id = s.id
       LEFT JOIN teachers t ON tg.teacher_id = t.id
       LEFT JOIN rooms    r ON tg.room_id    = r.id
       WHERE tg.session_id = ?
       ORDER BY tg.class_id, tg.day, tg.period`,
      [sessionId]
    );

    const [[institution]] = await db.query('SELECT * FROM institution WHERE id=1');
    res.json({ genes, institution });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── POST /api/generate/reschedule — Drag-drop move ───────────
// Updates by gene ID so each gene moves independently (no class collision).
router.post('/reschedule', async (req, res) => {
  try {
    const { gene_id, new_day, new_period } = req.body;

    if (!gene_id || !new_day || !new_period) {
      return res.status(400).json({ success: false, error: 'gene_id, new_day, new_period required.' });
    }

    const [[gene]] = await db.query('SELECT * FROM timetable_genes WHERE id=?', [gene_id]);
    if (!gene) return res.status(404).json({ success: false, error: 'Gene not found.' });

    // Hard constraint checks before moving
    const [[teacherConflict]] = await db.query(
      "SELECT id FROM timetable_genes WHERE session_id='latest' AND teacher_id=? AND day=? AND period=? AND id!=?",
      [gene.teacher_id, new_day, new_period, gene_id]
    );
    if (teacherConflict) {
      return res.status(409).json({ success: false, error: 'H1: Teacher already teaching at this slot.' });
    }

    const [[classConflict]] = await db.query(
      "SELECT id FROM timetable_genes WHERE session_id='latest' AND class_id=? AND day=? AND period=? AND id!=?",
      [gene.class_id, new_day, new_period, gene_id]
    );
    if (classConflict) {
      return res.status(409).json({ success: false, error: 'H2: Class already has a lecture at this slot.' });
    }

    const [[roomConflict]] = await db.query(
      "SELECT id FROM timetable_genes WHERE session_id='latest' AND room_id=? AND day=? AND period=? AND id!=?",
      [gene.room_id, new_day, new_period, gene_id]
    );
    if (roomConflict) {
      return res.status(409).json({ success: false, error: 'H3: Room already occupied at this slot.' });
    }

    await db.query('UPDATE timetable_genes SET day=?, period=? WHERE id=?', [new_day, new_period, gene_id]);
    res.json({ success: true, message: 'Rescheduled.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── POST /api/generate/substitute — Auto-assign substitute ───
router.post('/substitute', async (req, res) => {
  try {
    const { gene_id, absent_teacher_id } = req.body;

    if (!gene_id || !absent_teacher_id) {
      return res.status(400).json({ success: false, error: 'gene_id and absent_teacher_id are required.' });
    }

    const [[gene]] = await db.query('SELECT * FROM timetable_genes WHERE id=?', [gene_id]);
    if (!gene) return res.status(404).json({ success: false, error: 'Gene not found.' });

    const { subject_id, day, period } = gene;

    // All teachers qualified for this subject except the absent one
    const [qualified] = await db.query(
      `SELECT ts.teacher_id, t.name
       FROM teacher_subjects ts
       JOIN teachers t ON ts.teacher_id = t.id
       WHERE ts.subject_id = ? AND ts.teacher_id != ?`,
      [subject_id, absent_teacher_id]
    );

    if (qualified.length === 0) {
      return res.status(409).json({ success: false, error: 'No other teacher is qualified for this subject.' });
    }

    // Find who is already busy at this slot
    const [busyAtSlot]    = await db.query("SELECT DISTINCT teacher_id FROM timetable_genes WHERE session_id='latest' AND day=? AND period=?", [day, period]);
    const [unavailAtSlot] = await db.query('SELECT teacher_id FROM teacher_unavailable WHERE day=? AND period=?', [day, period]);
    const busySet = new Set([
      ...busyAtSlot.map(r => r.teacher_id),
      ...unavailAtSlot.map(r => r.teacher_id),
    ]);

    const available = qualified.filter(t => !busySet.has(t.teacher_id));

    if (available.length === 0) {
      return res.status(409).json({ success: false, error: 'All qualified teachers are busy at this slot.' });
    }

    // Pick the least-loaded available teacher
    const [allGenes] = await db.query("SELECT teacher_id FROM timetable_genes WHERE session_id='latest'");
    const lectureCounts = {};
    for (const g of allGenes) {
      lectureCounts[g.teacher_id] = (lectureCounts[g.teacher_id] || 0) + 1;
    }
    available.sort((a, b) => (lectureCounts[a.teacher_id] || 0) - (lectureCounts[b.teacher_id] || 0));

    const substitute = available[0];

    await db.query('UPDATE timetable_genes SET teacher_id=? WHERE id=?', [substitute.teacher_id, gene_id]);

    res.json({
      success:         true,
      substitute_id:   substitute.teacher_id,
      substitute_name: substitute.name,
      all_available:   available.map(t => ({ id: t.teacher_id, name: t.name })),
      message:         `${substitute.name} assigned as substitute.`,
    });
  } catch (err) {
    console.error('Substitute error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── POST /api/generate/mark-absent — Log teacher absence ─────
// BUG FIX: The original code used new Date().toISOString().split('T')[0]
// which returns UTC date. In IST (+05:30) this can give yesterday's date
// for times before 05:30 AM. Fixed to use local date from IST offset.
router.post('/mark-absent', async (req, res) => {
  try {
    const { teacher_id, substitute_id, notes } = req.body;

    if (!teacher_id) {
      return res.status(400).json({ success: false, error: 'teacher_id is required.' });
    }

    // Use local date (IST-aware) instead of raw UTC split
    const today = getLocalDateString();

    const [[existing]] = await db.query(
      'SELECT id FROM attendance_log WHERE teacher_id=? AND absent_date=?',
      [teacher_id, today]
    );
    if (existing) {
      return res.status(409).json({ success: false, error: 'Teacher already marked absent today.' });
    }

    await db.query(
      'INSERT INTO attendance_log (teacher_id, absent_date, substitute_id, notes) VALUES (?, ?, ?, ?)',
      [teacher_id, today, substitute_id || null, notes || null]
    );

    const [[teacher]] = await db.query('SELECT name FROM teachers WHERE id=?', [teacher_id]);

    res.json({
      success: true,
      message: `${teacher?.name || teacher_id} marked absent for ${today}.`,
      date:    today,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── DELETE /api/generate/undo-absent — Undo today's absence ──
router.delete('/undo-absent', async (req, res) => {
  try {
    const { teacher_id } = req.body;

    if (!teacher_id) {
      return res.status(400).json({ success: false, error: 'teacher_id is required.' });
    }

    const today = getLocalDateString();

    const [result] = await db.query(
      'DELETE FROM attendance_log WHERE teacher_id=? AND absent_date=?',
      [teacher_id, today]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'No absence record found for today.' });
    }

    res.json({ success: true, message: 'Absence undone.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── GET /api/generate/attendance — Attendance log ────────────
// BUG FIX: The original query returned rows but the absent_date was stored
// as a Date object by MySQL, not a plain string. When the frontend compared
// rec.absent_date to a filter string it always failed. Fixed by explicitly
// formatting absent_date as a DATE string in the SELECT.
router.get('/attendance', async (req, res) => {
  try {
    const { teacher_id, from, to } = req.query;

    let sql = `
      SELECT
        al.id,
        al.teacher_id,
        DATE_FORMAT(al.absent_date, '%Y-%m-%d') AS absent_date,
        al.substitute_id,
        al.notes,
        al.marked_at,
        t.name  AS teacher_name,
        s.name  AS substitute_name
      FROM attendance_log al
      LEFT JOIN teachers t ON al.teacher_id    = t.id
      LEFT JOIN teachers s ON al.substitute_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (teacher_id) { sql += ' AND al.teacher_id = ?';    params.push(teacher_id); }
    if (from)       { sql += ' AND al.absent_date >= ?';  params.push(from); }
    if (to)         { sql += ' AND al.absent_date <= ?';  params.push(to); }

    sql += ' ORDER BY al.absent_date DESC, t.name ASC';

    const [rows] = await db.query(sql, params);

    // Build per-teacher summary counts
    const summary = {};
    for (const row of rows) {
      if (!summary[row.teacher_id]) {
        summary[row.teacher_id] = { name: row.teacher_name, count: 0 };
      }
      summary[row.teacher_id].count++;
    }

    res.json({ records: rows, summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── GET /api/generate/violations — Re-check constraints ──────
router.get('/violations', async (req, res) => {
  try {
    const sessionId = req.query.session || 'latest';

    const [genes]              = await db.query('SELECT * FROM timetable_genes WHERE session_id=?', [sessionId]);
    const [teachers]           = await db.query('SELECT * FROM teachers WHERE institution_id=1');
    const [rooms]              = await db.query('SELECT * FROM rooms WHERE institution_id=1');
    const [subjects]           = await db.query('SELECT * FROM subjects WHERE institution_id=1');
    const [classes]            = await db.query('SELECT * FROM classes WHERE institution_id=1');
    const [curriculum]         = await db.query('SELECT * FROM curriculum');
    const [teacherSubjects]    = await db.query('SELECT * FROM teacher_subjects');
    const [teacherUnavailable] = await db.query('SELECT * FROM teacher_unavailable');
    const [[institution]]      = await db.query('SELECT * FROM institution WHERE id=1');

    if (!genes || genes.length === 0) {
      return res.json({ violations: {}, fitness: 0, isValid: false, teacherStats: [], roomStats: [] });
    }

    const { buildInstitutionData } = require('../ga/genetic');
    const { calculateFitness }     = require('../ga/fitness');

    const data = { institution, teachers, rooms, subjects, classes, curriculum, teacherSubjects, teacherUnavailable };
    const institutionData = buildInstitutionData(data);

    const chromosome = genes.map(g => ({
      class_id:   g.class_id,
      subject_id: g.subject_id,
      teacher_id: g.teacher_id,
      room_id:    g.room_id,
      day:        g.day,
      period:     g.period,
    }));

    const result = calculateFitness(chromosome, institutionData);

    // Teacher utilisation stats
    const teacherUtil = {};
    for (const g of genes) teacherUtil[g.teacher_id] = (teacherUtil[g.teacher_id] || 0) + 1;
    const teacherStats = teachers.map(t => ({
      id:   t.id,
      name: t.name,
      used: teacherUtil[t.id] || 0,
      max:  t.max_lectures_per_week || 20,
    }));

    // Room utilisation stats
    const roomUtil = {};
    for (const g of genes) roomUtil[g.room_id] = (roomUtil[g.room_id] || 0) + 1;
    const totalSlots = (institution.days_per_week || 5) * (institution.periods_per_day || 8);
    const roomStats = rooms.map(r => ({
      id:    r.id,
      name:  r.name,
      type:  r.type,
      used:  roomUtil[r.id] || 0,
      total: totalSlots,
    }));

    res.json({ violations: result.violations, fitness: result.score, isValid: result.isValid, teacherStats, roomStats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── Helpers ───────────────────────────────────────────────────

// Returns today's date as YYYY-MM-DD in local time (IST-safe).
// Bug in original: new Date().toISOString().split('T')[0] gives UTC date,
// which is wrong for Indian servers before 05:30 AM.
function getLocalDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function validateData(data) {
  const errors = [];
  const { institution, classes, curriculum, teachers, teacherSubjects, subjects, rooms } = data;

  const totalSlots = (institution?.days_per_week || 5) * (institution?.periods_per_day || 8);

  // Build teacher→subjects map
  const teacherSubjectMap = {};
  for (const ts of (teacherSubjects || [])) {
    if (!teacherSubjectMap[ts.teacher_id]) teacherSubjectMap[ts.teacher_id] = new Set();
    teacherSubjectMap[ts.teacher_id].add(ts.subject_id);
  }

  // Build teacher→max map
  const teacherMaxMap = {};
  for (const t of (teachers || [])) teacherMaxMap[t.id] = t.max_lectures_per_week || 20;

  // Group curriculum by class and by teacher
  const byClass   = {};
  const byTeacher = {};
  for (const e of (curriculum || [])) {
    if (!byClass[e.class_id])     byClass[e.class_id]     = [];
    if (!byTeacher[e.teacher_id]) byTeacher[e.teacher_id] = [];
    byClass[e.class_id].push(e);
    byTeacher[e.teacher_id].push(e);
  }

  // Check each class fits within the week
  for (const cls of (classes || [])) {
    const total = (byClass[cls.id] || []).reduce((sum, e) => sum + (e.min_per_week || 1), 0);
    if (total > totalSlots) {
      errors.push(`Class "${cls.name || cls.id}" needs ${total} lectures but only ${totalSlots} slots exist.`);
    }
  }

  // Check teachers are qualified
  for (const e of (curriculum || [])) {
    const allowed = teacherSubjectMap[e.teacher_id] || new Set();
    if (!allowed.has(e.subject_id)) {
      errors.push(`Teacher "${e.teacher_id}" is not qualified to teach "${e.subject_id}".`);
    }
  }

  // Check teacher workload is feasible
  for (const [tid, entries] of Object.entries(byTeacher)) {
    const total = entries.reduce((sum, e) => sum + (e.min_per_week || 1), 0);
    const max   = teacherMaxMap[tid] || 20;
    if (total > max) {
      errors.push(`Teacher "${tid}" assigned ${total} lectures but max is ${max}.`);
    }
  }

  // Check required room types exist
  const availableRoomTypes = new Set((rooms || []).map(r => r.type));
  for (const sub of (subjects || [])) {
    const needed = sub.requires_room_type || 'classroom';
    if (!availableRoomTypes.has(needed)) {
      errors.push(`Subject "${sub.name || sub.id}" needs a "${needed}" room but none exists.`);
    }
  }

  return errors;
}

module.exports = router;
