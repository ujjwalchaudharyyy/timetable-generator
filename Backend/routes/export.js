// export.js — Export the timetable in CSV, JSON, and HTML formats

require('dotenv').config();

const express = require('express');
const router  = express.Router();
const db      = require('../db');

const DAY_NAMES = ['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const DAY_SHORT = ['','Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

// Fetch full timetable with joined names
async function getTimetableData(sessionId) {
  const [genes] = await db.query(
    `SELECT tg.*,
            c.name     AS class_name,
            s.name     AS subject_name,
            t.name     AS teacher_name,
            r.name     AS room_name,
            r.type     AS room_type,
            r.capacity AS room_capacity
     FROM timetable_genes tg
     LEFT JOIN classes  c ON tg.class_id   = c.id
     LEFT JOIN subjects s ON tg.subject_id = s.id
     LEFT JOIN teachers t ON tg.teacher_id = t.id
     LEFT JOIN rooms    r ON tg.room_id    = r.id
     WHERE tg.session_id = ?
     ORDER BY tg.class_id, tg.day, tg.period`,
    [sessionId]
  );
  const [[institution]] = await db.query('SELECT * FROM institution WHERE id = 1');
  return { genes, institution };
}

// Compute period start times from institution settings
function computePeriodTimes(institution) {
  const startStr   = institution.day_start_time || '09:00';
  const dur        = parseInt(institution.period_duration_minutes) || 45;
  const periods    = parseInt(institution.periods_per_day)         || 8;
  const brkAfter   = parseInt(institution.break_after_period)      || 0;
  const brkDur     = parseInt(institution.break_duration_minutes)  || 15;
  const lunchAfter = parseInt(institution.lunch_break_after_period)|| 0;
  const lunchDur   = parseInt(institution.lunch_duration_minutes)  || 30;

  const [h0, m0] = startStr.split(':').map(Number);
  let mins = h0 * 60 + m0;
  const times = [];
  for (let p = 1; p <= periods; p++) {
    const start = toHHMM(mins);
    mins += dur;
    const end = toHHMM(mins);
    times.push({ period: p, start, end });
    if (brkAfter > 0 && p === brkAfter)     mins += brkDur;
    if (lunchAfter > 0 && p === lunchAfter) mins += lunchDur;
  }
  return times;
}

function toHHMM(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// ── CSV Export ────────────────────────────────────────────────
router.get('/csv', async (req, res) => {
  try {
    const { genes, institution } = await getTimetableData(req.query.session || 'latest');
    const times = computePeriodTimes(institution);

    const headers = ['Class','Subject','Teacher','Room','Day','Period','Start Time','End Time'];
    const rows    = genes.map(g => {
      const t = times.find(x => x.period === g.period);
      return [
        g.class_name   || g.class_id,
        g.subject_name || g.subject_id,
        g.teacher_name || g.teacher_id,
        g.room_name    || g.room_id,
        DAY_NAMES[g.day] || `Day ${g.day}`,
        g.period,
        t?.start || '',
        t?.end   || '',
      ];
    });

    let csv  = headers.join(',') + '\n';
    csv     += rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="chronogen_timetable.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── JSON Export ───────────────────────────────────────────────
router.get('/json', async (req, res) => {
  try {
    const data = await getTimetableData(req.query.session || 'latest');
    res.setHeader('Content-Disposition', 'attachment; filename="chronogen_timetable.json"');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HTML Export — clean, printable, self-contained ────────────
router.get('/html', async (req, res) => {
  try {
    const { genes, institution } = await getTimetableData(req.query.session || 'latest');

    if (!genes || genes.length === 0) {
      return res.status(404).send('<p>No timetable found. Please generate one first.</p>');
    }

    const daysPerWeek   = institution?.days_per_week   || 5;
    const periodsPerDay = institution?.periods_per_day || 8;
    const lunchAfter    = institution?.lunch_break_after_period || 0;
    const breakAfter    = institution?.break_after_period || 0;
    const instName      = institution?.name || 'ChronoGen';
    const fitnessScore  = genes[0]?.fitness_score ? Math.round(genes[0].fitness_score) : 0;
    const times         = computePeriodTimes(institution);

    // Subject colour map
    const subjectColors = {};
    let ci = 0;
    const palette = [
      ['#e8eeff','#3730a3'], ['#e8fff5','#065f46'], ['#fffbeb','#78350f'],
      ['#fdf4ff','#581c87'], ['#fff0f0','#991b1b'], ['#eff6ff','#1d4ed8'],
      ['#f0fdf4','#166534'], ['#fef3f2','#9a3412'], ['#f5f3ff','#4c1d95'],
      ['#ecfeff','#164e63'],
    ];
    function getSubjectColor(subjectId) {
      if (!subjectColors[subjectId]) subjectColors[subjectId] = palette[ci++ % palette.length];
      return subjectColors[subjectId];
    }

    // Build timetable grid HTML for one entity
    function buildGrid(title, genesByDay) {
      let html = `<div class="tt-section">
        <h3>${title}</h3>
        <div class="tt-wrap">
        <table>
          <thead><tr>
            <th>Period</th>`;

      for (let d = 1; d <= daysPerWeek; d++) {
        html += `<th>${DAY_SHORT[d] || 'D'+d}</th>`;
      }
      html += '</tr></thead><tbody>';

      for (let p = 1; p <= periodsPerDay; p++) {
        const t = times.find(x => x.period === p);

        // Break row
        if (breakAfter > 0 && p === breakAfter + 1 && breakAfter !== lunchAfter) {
          html += `<tr class="break-row"><td colspan="${daysPerWeek + 1}">☕ Short Break — ${institution.break_duration_minutes || 15} min</td></tr>`;
        }
        if (lunchAfter > 0 && p === lunchAfter + 1) {
          html += `<tr class="lunch-row"><td colspan="${daysPerWeek + 1}">🍽 Lunch — ${institution.lunch_duration_minutes || 30} min</td></tr>`;
        }

        html += `<tr><td class="period-col">
          <strong>P${p}</strong>
          ${t ? `<br><small>${t.start}</small><br><small>→ ${t.end}</small>` : ''}
        </td>`;

        for (let d = 1; d <= daysPerWeek; d++) {
          const gene = genesByDay[d]?.[p];
          if (gene) {
            const [bg, text] = getSubjectColor(gene.subject_id);
            html += `<td><div class="cell" style="background:${bg};color:${text}">
              <strong>${gene.subject_name || gene.subject_id}</strong>
              <span>${gene.teacher_name || gene.teacher_id}</span>
              <small>${gene.room_name || gene.room_id}</small>
            </div></td>`;
          } else {
            html += `<td class="empty-cell"></td>`;
          }
        }
        html += '</tr>';
      }
      html += '</tbody></table></div></div>';
      return html;
    }

    // Organise genes
    const byClass   = {};
    const byTeacher = {};
    const byRoom    = {};

    for (const g of genes) {
      if (!byClass[g.class_id])   byClass[g.class_id]   = { name: g.class_name   || g.class_id,   days: {} };
      if (!byTeacher[g.teacher_id]) byTeacher[g.teacher_id] = { name: g.teacher_name || g.teacher_id, days: {} };
      if (!byRoom[g.room_id])     byRoom[g.room_id]     = { name: g.room_name     || g.room_id,    days: {} };

      if (!byClass[g.class_id].days[g.day])     byClass[g.class_id].days[g.day]     = {};
      if (!byTeacher[g.teacher_id].days[g.day]) byTeacher[g.teacher_id].days[g.day] = {};
      if (!byRoom[g.room_id].days[g.day])       byRoom[g.room_id].days[g.day]       = {};

      byClass[g.class_id].days[g.day][g.period]     = g;
      byTeacher[g.teacher_id].days[g.day][g.period] = g;
      byRoom[g.room_id].days[g.day][g.period]       = g;
    }

    let classSections   = Object.values(byClass).map(d   => buildGrid('🎓 ' + d.name, d.days)).join('');
    let teacherSections = Object.values(byTeacher).map(d => buildGrid('👨‍🏫 ' + d.name, d.days)).join('');
    let roomSections    = Object.values(byRoom).map(d    => buildGrid('🏫 ' + d.name, d.days)).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${instName} — Timetable</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f8fafc; color: #1e293b; padding: 0; }

    /* Header */
    .header { background: linear-gradient(135deg, #1e293b 0%, #334155 100%); color: white; padding: 2rem; }
    .header h1 { font-size: 1.6rem; font-weight: 800; margin-bottom: 0.25rem; }
    .header p  { opacity: 0.65; font-size: 0.9rem; }
    .badges { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .badge { background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.15); padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; }

    /* Nav anchors */
    .nav { display: flex; flex-wrap: wrap; gap: 10px; padding: 1rem 2rem; background: white; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; z-index: 10; }
    .nav a { color: #4f46e5; text-decoration: none; font-size: 0.875rem; font-weight: 600; padding: 5px 12px; border: 1px solid #a5b4fc; border-radius: 6px; }
    .nav a:hover { background: #eef2ff; }

    /* Sections */
    .section { background: white; padding: 1.5rem 2rem; border-bottom: 3px solid #f1f5f9; }
    .section-title { font-size: 1.15rem; font-weight: 700; color: #1e293b; margin-bottom: 1.5rem; padding-bottom: 0.5rem; border-bottom: 2px solid #e2e8f0; }

    /* Timetable */
    .tt-section { margin-bottom: 2rem; }
    .tt-section h3 { font-size: 0.95rem; font-weight: 700; color: #334155; margin-bottom: 0.5rem; }
    .tt-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.78rem; min-width: 600px; }
    thead th { background: #1e293b; color: white; padding: 8px 6px; font-weight: 600; text-align: center; border: 1px solid #334155; }
    tbody td { border: 1px solid #e2e8f0; padding: 3px; vertical-align: top; }
    .period-col { background: #f8fafc; text-align: center; width: 72px; padding: 6px 4px; color: #475569; font-size: 0.75rem; }
    .period-col strong { display: block; font-size: 0.85rem; color: #1e293b; }
    .period-col small { color: #94a3b8; font-size: 0.68rem; }
    .cell { padding: 5px 6px; border-radius: 5px; line-height: 1.4; }
    .cell strong { display: block; font-size: 0.78rem; }
    .cell span   { display: block; font-size: 0.7rem;  opacity: 0.8; }
    .cell small  { display: block; font-size: 0.65rem; opacity: 0.65; }
    .empty-cell  { background: #fafafa; }
    .break-row td { background: #fffbeb; color: #92400e; font-size: 0.75rem; font-weight: 600; text-align: center; padding: 6px; border-top: 2px dashed #fcd34d; }
    .lunch-row td { background: #f0fdf4; color: #166534; font-size: 0.75rem; font-weight: 600; text-align: center; padding: 6px; border-top: 2px dashed #86efac; }
    tr:hover td:not(.period-col):not(.empty-cell) { background: #f8f7ff; }

    @media print {
      .nav { display: none; }
      body { background: white; }
      .section { page-break-inside: avoid; }
      .tt-section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>⚡ ${instName} — Generated Timetable</h1>
    <p>Generated by ChronoGen · ${new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
    <div class="badges">
      <span class="badge">📅 ${daysPerWeek} days/week</span>
      <span class="badge">⏰ ${periodsPerDay} periods/day</span>
      <span class="badge">⏱ ${institution.period_duration_minutes || 45} min/period</span>
      <span class="badge">🎓 ${Object.keys(byClass).length} classes</span>
      <span class="badge">👨‍🏫 ${Object.keys(byTeacher).length} teachers</span>
      <span class="badge">🏫 ${Object.keys(byRoom).length} rooms</span>
      <span class="badge">📋 ${genes.length} lectures</span>
      <span class="badge">🏆 Fitness: ${fitnessScore.toLocaleString()} / 10,000</span>
    </div>
  </div>

  <div class="nav">
    <a href="#classes">📚 Classes</a>
    <a href="#teachers">👨‍🏫 Teachers</a>
    <a href="#rooms">🏫 Rooms</a>
  </div>

  <div class="section" id="classes">
    <div class="section-title">📚 Class Timetables</div>
    ${classSections}
  </div>

  <div class="section" id="teachers">
    <div class="section-title">👨‍🏫 Teacher Schedules</div>
    ${teacherSections}
  </div>

  <div class="section" id="rooms">
    <div class="section-title">🏫 Room Occupancy</div>
    ${roomSections}
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="chronogen_timetable.html"');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
