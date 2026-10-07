// routes/upload.js — Data input endpoints
// Handles institution settings, manual entity creation,
// bulk CSV imports, demo data loading, and data clearing.

require('dotenv').config();

const express   = require('express');
const router    = express.Router();
const multer    = require('multer');
const { parse } = require('csv-parse/sync');
const path      = require('path');
const fs        = require('fs');
const db        = require('../db');

const upload = multer({ dest: path.join(__dirname, '../../uploads/') });

// Delete a temp file after we've finished processing a CSV upload
function deleteTempFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

// Clamp a number between min and max
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Parse a CSV file into an array of row objects
function parseCSV(filePath) {
  return parse(fs.readFileSync(filePath, 'utf8'), {
    columns:          true,
    skip_empty_lines: true,
    trim:             true,
  });
}


// ── Institution Settings ─────────────────────────────────────

router.post('/institution', async (req, res) => {
  try {
    const {
      name, days_per_week, periods_per_day, period_duration_minutes,
      day_start_time, break_after_period, break_duration_minutes,
      lunch_break_after_period, lunch_duration_minutes,
    } = req.body;

    await db.query(
      `UPDATE institution SET
         name = ?, days_per_week = ?, periods_per_day = ?,
         period_duration_minutes = ?, day_start_time = ?,
         break_after_period = ?, break_duration_minutes = ?,
         lunch_break_after_period = ?, lunch_duration_minutes = ?
       WHERE id = 1`,
      [
        name || 'Demo College',
        clamp(parseInt(days_per_week)   || 5, 1, 7),
        clamp(parseInt(periods_per_day) || 8, 1, 12),
        parseInt(period_duration_minutes)  || 45,
        day_start_time || '09:00',
        parseInt(break_after_period)       || 0,
        parseInt(break_duration_minutes)   || 15,
        parseInt(lunch_break_after_period) || 0,
        parseInt(lunch_duration_minutes)   || 30,
      ]
    );

    res.json({ success: true, message: 'Institution settings saved!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/institution', async (req, res) => {
  try {
    const [[row]] = await db.query('SELECT * FROM institution WHERE id = 1');
    res.json(row || {});
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── Manual Entity Creation ────────────────────────────────────

router.post('/teacher', async (req, res) => {
  try {
    const { id, name, max_lectures_per_week, max_consecutive_lectures, prefers_morning, subjects } = req.body;

    if (!id || !name) {
      return res.status(400).json({ success: false, error: 'ID and Name are required.' });
    }

    await db.query(
      `INSERT INTO teachers (id, name, max_lectures_per_week, max_consecutive_lectures, prefers_morning, institution_id)
       VALUES (?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         max_lectures_per_week = VALUES(max_lectures_per_week)`,
      [id, name, parseInt(max_lectures_per_week) || 20, parseInt(max_consecutive_lectures) || 3, prefers_morning ? 1 : 0]
    );

    // Add subject assignments if provided (comma-separated IDs)
    if (subjects) {
      for (const sid of subjects.split(',').map(s => s.trim()).filter(Boolean)) {
        await db.query(
          'INSERT IGNORE INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)',
          [id, sid]
        );
      }
    }

    res.json({ success: true, message: `Teacher "${name}" saved!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/room', async (req, res) => {
  try {
    const { id, name, capacity, type } = req.body;

    if (!id || !name) {
      return res.status(400).json({ success: false, error: 'ID and Name are required.' });
    }

    await db.query(
      `INSERT INTO rooms (id, name, capacity, type, institution_id)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name), capacity = VALUES(capacity), type = VALUES(type)`,
      [id, name, parseInt(capacity) || 40, type || 'classroom']
    );

    res.json({ success: true, message: `Room "${name}" saved!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/subject', async (req, res) => {
  try {
    const { id, name, requires_room_type, min_lectures_per_week } = req.body;

    if (!id || !name) {
      return res.status(400).json({ success: false, error: 'ID and Name are required.' });
    }

    await db.query(
      `INSERT INTO subjects (id, name, requires_room_type, min_lectures_per_week, institution_id)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         requires_room_type = VALUES(requires_room_type),
         min_lectures_per_week = VALUES(min_lectures_per_week)`,
      [id, name, requires_room_type || 'classroom', parseInt(min_lectures_per_week) || 1]
    );

    res.json({ success: true, message: `Subject "${name}" saved!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/class', async (req, res) => {
  try {
    const { id, name, student_count } = req.body;

    if (!id || !name) {
      return res.status(400).json({ success: false, error: 'ID and Name are required.' });
    }

    await db.query(
      `INSERT INTO classes (id, name, student_count, institution_id)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name), student_count = VALUES(student_count)`,
      [id, name, parseInt(student_count) || 30]
    );

    res.json({ success: true, message: `Class "${name}" saved!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/curriculum-entry', async (req, res) => {
  try {
    const { class_id, subject_id, teacher_id, min_per_week } = req.body;

    if (!class_id || !subject_id || !teacher_id) {
      return res.status(400).json({ success: false, error: 'class_id, subject_id, and teacher_id are required.' });
    }

    await db.query(
      'INSERT INTO curriculum (class_id, subject_id, teacher_id, min_per_week) VALUES (?, ?, ?, ?)',
      [class_id, subject_id, teacher_id, parseInt(min_per_week) || 1]
    );

    res.json({ success: true, message: 'Curriculum entry added!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── CSV Bulk Imports ──────────────────────────────────────────

router.post('/teachers', upload.single('file'), async (req, res) => {
  try {
    const rows = parseCSV(req.file.path);
    let count = 0;

    for (const row of rows) {
      const id   = row.id   || row.ID;
      const name = row.name || row.Name;
      if (!id || !name) continue;

      await db.query(
        `INSERT INTO teachers (id, name, max_lectures_per_week, max_consecutive_lectures, prefers_morning, institution_id)
         VALUES (?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [id, name, parseInt(row.max_lectures_per_week) || 20, parseInt(row.max_consecutive) || 3, row.prefers_morning === 'true' ? 1 : 0]
      );

      for (const sid of (row.subjects || '').split(',').map(s => s.trim()).filter(Boolean)) {
        await db.query('INSERT IGNORE INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)', [id, sid]);
      }

      count++;
    }

    deleteTempFile(req.file?.path);
    res.json({ success: true, message: `${count} teachers imported.` });
  } catch (err) {
    deleteTempFile(req.file?.path);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/rooms', upload.single('file'), async (req, res) => {
  try {
    const rows = parseCSV(req.file.path);
    let count = 0;

    for (const row of rows) {
      if (!row.id) continue;
      await db.query(
        `INSERT INTO rooms (id, name, capacity, type, institution_id)
         VALUES (?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE name = VALUES(name), capacity = VALUES(capacity), type = VALUES(type)`,
        [row.id, row.name || row.id, parseInt(row.capacity) || 40, row.type || 'classroom']
      );
      count++;
    }

    deleteTempFile(req.file?.path);
    res.json({ success: true, message: `${count} rooms imported.` });
  } catch (err) {
    deleteTempFile(req.file?.path);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/subjects', upload.single('file'), async (req, res) => {
  try {
    const rows = parseCSV(req.file.path);
    let count = 0;

    for (const row of rows) {
      if (!row.id || !row.name) continue;
      await db.query(
        `INSERT INTO subjects (id, name, requires_room_type, min_lectures_per_week, institution_id)
         VALUES (?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [row.id, row.name, row.requires_room_type || 'classroom', parseInt(row.min_lectures_per_week) || 1]
      );
      count++;
    }

    deleteTempFile(req.file?.path);
    res.json({ success: true, message: `${count} subjects imported.` });
  } catch (err) {
    deleteTempFile(req.file?.path);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/classes', upload.single('file'), async (req, res) => {
  try {
    const rows = parseCSV(req.file.path);
    let count = 0;

    for (const row of rows) {
      if (!row.id) continue;
      await db.query(
        `INSERT INTO classes (id, name, student_count, institution_id)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE name = VALUES(name), student_count = VALUES(student_count)`,
        [row.id, row.name || row.id, parseInt(row.student_count) || 30]
      );
      count++;
    }

    deleteTempFile(req.file?.path);
    res.json({ success: true, message: `${count} classes imported.` });
  } catch (err) {
    deleteTempFile(req.file?.path);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/curriculum', upload.single('file'), async (req, res) => {
  try {
    const rows = parseCSV(req.file.path);
    let count = 0;

    for (const row of rows) {
      const classId   = row.class_id   || row.class;
      const subjectId = row.subject_id || row.subject;
      const teacherId = row.teacher_id || row.teacher;
      if (!classId || !subjectId || !teacherId) continue;

      await db.query(
        'INSERT INTO curriculum (class_id, subject_id, teacher_id, min_per_week) VALUES (?, ?, ?, ?)',
        [classId, subjectId, teacherId, parseInt(row.min_per_week) || 1]
      );
      count++;
    }

    deleteTempFile(req.file?.path);
    res.json({ success: true, message: `${count} curriculum entries imported.` });
  } catch (err) {
    deleteTempFile(req.file?.path);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── Demo Data ─────────────────────────────────────────────────
// Loads a realistic university dataset:
//   20 classes · 20 teachers · 8 subjects · 20 rooms
//   5 days/week · 8 periods/day

router.post('/demo', async (req, res) => {
  try {
    await clearAllData();

    // Institution
    await db.query("UPDATE institution SET name='Graphic Era Hill University' WHERE id=1");
    await db.query("UPDATE institution SET days_per_week=5, periods_per_day=8, period_duration_minutes=50 WHERE id=1");
    await db.query("UPDATE institution SET day_start_time='09:00', break_after_period=4, break_duration_minutes=15 WHERE id=1").catch(() => {});
    await db.query("UPDATE institution SET lunch_break_after_period=6, lunch_duration_minutes=30 WHERE id=1").catch(() => {});

    // Rooms (all labs ≥44 seats so the largest class of 42 fits)
    const rooms = [
      ['R101','Classroom 101',46,'classroom'], ['R102','Classroom 102',44,'classroom'],
      ['R103','Classroom 103',42,'classroom'], ['R104','Classroom 104',40,'classroom'],
      ['R105','Classroom 105',38,'classroom'], ['R106','Classroom 106',36,'classroom'],
      ['R107','Classroom 107',34,'classroom'],
      ['LH1', 'Lecture Hall 1',110,'lecture_hall'], ['LH2','Lecture Hall 2',90,'lecture_hall'],
      ['CSLAB1','CS Lab 1',44,'lab'], ['CSLAB2','CS Lab 2',44,'lab'],
      ['PHYSLAB','Physics Lab',44,'lab'], ['CHEMLAB','Chem Lab',44,'lab'],
      ['DSLAB','DS/DBMS Lab',44,'lab'], ['OSLAB','OS Lab',44,'lab'],
      ['BIOLAB','Bio Lab',40,'lab'], ['ELAB','Electronics Lab',44,'lab'],
      ['SEM1','Seminar Room 1',24,'seminar_room'], ['SEM2','Seminar Room 2',24,'seminar_room'],
      ['GYM','Sports Complex',80,'gym'],
    ];
    for (const [id, name, cap, type] of rooms) {
      await db.query('INSERT INTO rooms (id,name,capacity,type,institution_id) VALUES (?,?,?,?,1)', [id, name, cap, type]);
    }

    // Subjects
    const subjects = [
      ['MATH','Mathematics',         'classroom', 4],
      ['PHY', 'Physics',             'lab',       3],
      ['ENG', 'English',             'classroom', 3],
      ['CS',  'Computer Science',    'lab',       4],
      ['DS',  'Data Structures',     'lab',       3],
      ['DBMS','Database Management', 'lab',       3],
      ['OS',  'Operating Systems',   'lab',       3],
      ['PE',  'Physical Education',  'gym',       2],
    ];
    for (const [id, name, roomType, min] of subjects) {
      await db.query(
        'INSERT INTO subjects (id,name,requires_room_type,min_lectures_per_week,institution_id) VALUES (?,?,?,?,1)',
        [id, name, roomType, min]
      );
    }

    // Teachers (max_lectures_per_week set to actual load + 2 buffer)
    const teachers = [
      ['T01','Dr. R.K. Sharma',    14,3,1], ['T02','Prof. A.K. Gupta',  14,3,1],
      ['T03','Ms. Neha Joshi',     14,3,1], ['T04','Mr. Rajesh Verma',  14,3,1],
      ['T05','Dr. Priya Mehta',     8,3,1], ['T06','Prof. Suresh Nair',  8,3,1],
      ['T07','Prof. A. Rajan',     17,3,1], ['T08','Ms. Divya Nair',    17,3,1],
      ['T09','Ms. Ritu Kapoor',    17,3,1], ['T10','Mr. Arun Kumar',    17,3,0],
      ['T11','Dr. Sunita Anand',   26,3,1], ['T12','Dr. Mohan Gupta',   26,3,1],
      ['T13','Prof. Sanjay Bhat',  23,3,1], ['T14','Mr. Rohit Shah',    23,3,1],
      ['T15','Ms. Kavita Singh',   17,3,1], ['T16','Mr. Siddharth Nair',17,3,0],
      ['T17','Prof. Ramesh Pillai',11,3,1], ['T18','Ms. Shreya Menon',  11,3,1],
      ['T19','Mr. Ajay Thakur',    10,2,1], ['T20','Ms. Geeta Pillai',  10,2,1],
    ];
    for (const [id, name, maxLec, maxConsec, morn] of teachers) {
      await db.query(
        `INSERT INTO teachers (id,name,max_lectures_per_week,max_consecutive_lectures,prefers_morning,institution_id)
         VALUES (?,?,?,?,?,1)
         ON DUPLICATE KEY UPDATE name=VALUES(name), max_lectures_per_week=VALUES(max_lectures_per_week),
           max_consecutive_lectures=VALUES(max_consecutive_lectures), prefers_morning=VALUES(prefers_morning)`,
        [id, name, maxLec, maxConsec, morn]
      );
    }

    // Teacher → Subject assignments
    const teacherSubjects = [
      ['T01','MATH'],['T02','MATH'],['T03','MATH'],['T04','MATH'],
      ['T05','PHY'], ['T06','PHY'],
      ['T07','ENG'], ['T08','ENG'], ['T09','ENG'], ['T10','ENG'],
      ['T11','CS'],  ['T12','CS'],
      ['T13','DS'],  ['T14','DS'],
      ['T15','DBMS'],['T16','DBMS'],
      ['T17','OS'],  ['T18','OS'],
      ['T19','PE'],  ['T20','PE'],
    ];
    for (const [tid, sid] of teacherSubjects) {
      await db.query('INSERT IGNORE INTO teacher_subjects (teacher_id,subject_id) VALUES (?,?)', [tid, sid]);
    }

    // Teacher unavailability windows
    const unavailable = [
      ['T01',1,1],['T01',1,2],
      ['T07',5,7],['T07',5,8],
      ['T19',1,1],['T19',2,1],['T19',3,1],['T19',4,1],['T19',5,1],
      ['T20',1,1],['T20',2,1],['T20',3,1],['T20',4,1],['T20',5,1],
    ];
    for (const [tid, d, p] of unavailable) {
      await db.query('INSERT IGNORE INTO teacher_unavailable (teacher_id,day,period) VALUES (?,?,?)', [tid, d, p]);
    }

    // Classes (all ≤42 students to fit in any lab)
    const classes = [
      ['CSE_1A','CSE Sem-1 A',42],['CSE_1B','CSE Sem-1 B',40],
      ['CSE_3A','CSE Sem-3 A',40],['CSE_3B','CSE Sem-3 B',38],
      ['CSE_5A','CSE Sem-5 A',36],['CSE_5B','CSE Sem-5 B',34],
      ['CSE_7A','CSE Sem-7 A',34],['CSE_7B','CSE Sem-7 B',32],
      ['ECE_1A','ECE Sem-1 A',40],['ECE_1B','ECE Sem-1 B',38],
      ['ECE_3A','ECE Sem-3 A',38],['ECE_3B','ECE Sem-3 B',36],
      ['IT_1A', 'IT  Sem-1 A',40],['IT_1B', 'IT  Sem-1 B',38],
      ['IT_3A', 'IT  Sem-3 A',36],['IT_3B', 'IT  Sem-3 B',34],
      ['BCA_1A','BCA Sem-1 A',38],['BCA_1B','BCA Sem-1 B',36],
      ['BCA_3A','BCA Sem-3 A',34],['BCA_3B','BCA Sem-3 B',32],
    ];
    for (const [id, name, cnt] of classes) {
      await db.query('INSERT INTO classes (id,name,student_count,institution_id) VALUES (?,?,?,1)', [id, name, cnt]);
    }

    // Curriculum — [class, subject, teacher, min/week]
    // Total per class ≤ 40 slots (5d × 8p); each teacher's total ≤ their max above.
    const curriculum = [
      // CSE Sem-1  (4+4+3+3+2 = 16)
      ['CSE_1A','MATH','T01',4],['CSE_1A','CS','T11',4],['CSE_1A','ENG','T07',3],['CSE_1A','DS','T13',3],['CSE_1A','PE','T19',2],
      ['CSE_1B','MATH','T02',4],['CSE_1B','CS','T12',4],['CSE_1B','ENG','T08',3],['CSE_1B','DS','T14',3],['CSE_1B','PE','T20',2],
      // CSE Sem-3  (4+4+3+3+3 = 17)
      ['CSE_3A','MATH','T01',4],['CSE_3A','CS','T11',4],['CSE_3A','DBMS','T15',3],['CSE_3A','DS','T13',3],['CSE_3A','ENG','T09',3],
      ['CSE_3B','MATH','T02',4],['CSE_3B','CS','T12',4],['CSE_3B','DBMS','T16',3],['CSE_3B','DS','T14',3],['CSE_3B','ENG','T10',3],
      // CSE Sem-5  (4+3+3+3 = 13)
      ['CSE_5A','OS','T17',4],['CSE_5A','DBMS','T15',3],['CSE_5A','DS','T13',3],['CSE_5A','ENG','T07',3],
      ['CSE_5B','OS','T18',4],['CSE_5B','DBMS','T16',3],['CSE_5B','DS','T14',3],['CSE_5B','ENG','T08',3],
      // CSE Sem-7  (4+3+3 = 10)
      ['CSE_7A','OS','T17',4],['CSE_7A','DBMS','T15',3],['CSE_7A','ENG','T09',3],
      ['CSE_7B','OS','T18',4],['CSE_7B','DBMS','T16',3],['CSE_7B','ENG','T10',3],
      // ECE Sem-1  (4+3+3+3+2 = 15)
      ['ECE_1A','MATH','T03',4],['ECE_1A','PHY','T05',3],['ECE_1A','ENG','T07',3],['ECE_1A','DS','T13',3],['ECE_1A','PE','T19',2],
      ['ECE_1B','MATH','T04',4],['ECE_1B','PHY','T06',3],['ECE_1B','ENG','T08',3],['ECE_1B','DS','T14',3],['ECE_1B','PE','T20',2],
      // ECE Sem-3  (4+3+3+2 = 12)
      ['ECE_3A','MATH','T03',4],['ECE_3A','PHY','T05',3],['ECE_3A','ENG','T09',3],['ECE_3A','PE','T19',2],
      ['ECE_3B','MATH','T04',4],['ECE_3B','PHY','T06',3],['ECE_3B','ENG','T10',3],['ECE_3B','PE','T20',2],
      // IT Sem-1   (4+4+3+3+2 = 16)
      ['IT_1A','MATH','T01',4],['IT_1A','CS','T11',4],['IT_1A','ENG','T08',3],['IT_1A','DS','T13',3],['IT_1A','PE','T19',2],
      ['IT_1B','MATH','T02',4],['IT_1B','CS','T12',4],['IT_1B','ENG','T07',3],['IT_1B','DS','T14',3],['IT_1B','PE','T20',2],
      // IT Sem-3   (4+3+3+3 = 13)
      ['IT_3A','CS','T11',4],['IT_3A','DBMS','T15',3],['IT_3A','DS','T13',3],['IT_3A','ENG','T09',3],
      ['IT_3B','CS','T12',4],['IT_3B','DBMS','T16',3],['IT_3B','DS','T14',3],['IT_3B','ENG','T10',3],
      // BCA Sem-1  (4+4+3+3+2 = 16)
      ['BCA_1A','MATH','T03',4],['BCA_1A','CS','T11',4],['BCA_1A','ENG','T07',3],['BCA_1A','DS','T13',3],['BCA_1A','PE','T19',2],
      ['BCA_1B','MATH','T04',4],['BCA_1B','CS','T12',4],['BCA_1B','ENG','T08',3],['BCA_1B','DS','T14',3],['BCA_1B','PE','T20',2],
      // BCA Sem-3  (4+3+3 = 10)
      ['BCA_3A','CS','T11',4],['BCA_3A','DBMS','T15',3],['BCA_3A','ENG','T09',3],
      ['BCA_3B','CS','T12',4],['BCA_3B','DBMS','T16',3],['BCA_3B','ENG','T10',3],
    ];
    for (const [cls, sub, tch, min] of curriculum) {
      await db.query('INSERT INTO curriculum (class_id,subject_id,teacher_id,min_per_week) VALUES (?,?,?,?)', [cls, sub, tch, min]);
    }

    res.json({
      success: true,
      message: '✅ Demo data loaded! 20 classes · 20 teachers · 8 subjects · 20 rooms',
    });
  } catch (err) {
    console.error('Demo load error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── Fetch All Data ────────────────────────────────────────────

router.get('/data', async (req, res) => {
  try {
    const [teachers]           = await db.query('SELECT * FROM teachers WHERE institution_id=1');
    const [rooms]              = await db.query('SELECT * FROM rooms WHERE institution_id=1');
    const [subjects]           = await db.query('SELECT * FROM subjects WHERE institution_id=1');
    const [classes]            = await db.query('SELECT * FROM classes WHERE institution_id=1');
    const [curriculum]         = await db.query('SELECT * FROM curriculum');
    const [teacherSubjects]    = await db.query('SELECT * FROM teacher_subjects');
    const [teacherUnavailable] = await db.query('SELECT * FROM teacher_unavailable');
    const [[institution]]      = await db.query('SELECT * FROM institution WHERE id=1');

    res.json({ teachers, rooms, subjects, classes, curriculum, teacherSubjects, teacherUnavailable, institution });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── Clear All Data ────────────────────────────────────────────

router.delete('/clear', async (req, res) => {
  try {
    await clearAllData();
    res.json({ success: true, message: 'All data cleared.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── Helper: wipe all rows in dependency order ─────────────────

async function clearAllData() {
  await db.query('DELETE FROM timetable_genes');
  await db.query('DELETE FROM ga_runs');
  await db.query('DELETE FROM attendance_log');
  await db.query('DELETE FROM curriculum');
  await db.query('DELETE FROM teacher_unavailable');
  await db.query('DELETE FROM teacher_subjects');
  await db.query('DELETE FROM classes');
  await db.query('DELETE FROM teachers');
  await db.query('DELETE FROM subjects');
  await db.query('DELETE FROM rooms');
}

module.exports = router;
