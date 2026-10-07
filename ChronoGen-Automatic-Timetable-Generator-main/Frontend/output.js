// output.js — Timetable viewer
// Features: class/teacher/room grids · period times · drag-and-drop with
//           conflict hints · constraint panel · utilisation charts ·
//           teacher substitution · attendance log · mobile card view · print

// ── State ─────────────────────────────────────────────────────
let allGenes    = [];
let institution = {};
let currentView = 'class';
let filterText  = '';
let dragGene    = null;  // gene currently being dragged

// Pre-built O(1) lookup maps for drag-drop conflict checks.
// Rebuilt whenever allGenes changes (load, reschedule, substitute).
let teacherSlotMap = {};  // "teacherId|day|period" → gene object
let classSlotMap   = {};  // "classId|day|period"   → gene object
let roomSlotMap    = {};  // "roomId|day|period"     → gene object

const DAY_NAMES = ['','Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DAY_FULL  = ['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

const PALETTE = [
  ['#818cf8','#818cf815'], ['#34d399','#34d39915'], ['#fb923c','#fb923c15'],
  ['#f472b6','#f472b615'], ['#38bdf8','#38bdf815'], ['#a78bfa','#a78bfa15'],
  ['#fbbf24','#fbbf2415'], ['#4ade80','#4ade8015'], ['#e879f9','#e879f915'],
  ['#2dd4bf','#2dd4bf15'],
];
const colorCache = {};
let colorIdx = 0;
function getColor(subjectId) {
  if (!colorCache[subjectId]) colorCache[subjectId] = PALETTE[colorIdx++ % PALETTE.length];
  return colorCache[subjectId];
}

// ── Build O(1) conflict index maps ────────────────────────────
// Call this whenever allGenes changes so drag-drop checks stay accurate.
// O(n) build, O(1) per lookup — much faster than allGenes.find() which is O(n).
function buildConflictMaps() {
  teacherSlotMap = {};
  classSlotMap   = {};
  roomSlotMap    = {};

  for (const g of allGenes) {
    const tKey = g.teacher_id + '|' + g.day + '|' + g.period;
    const cKey = g.class_id   + '|' + g.day + '|' + g.period;
    const rKey = g.room_id    + '|' + g.day + '|' + g.period;
    teacherSlotMap[tKey] = g;
    classSlotMap[cKey]   = g;
    roomSlotMap[rKey]    = g;
  }
}

// ── Period timing ─────────────────────────────────────────────
function getPeriodTimes() {
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
    const s = `${String(Math.floor(mins/60)%24).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
    mins += dur;
    const e = `${String(Math.floor(mins/60)%24).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
    times.push({ period: p, start: s, end: e });
    if (brkAfter > 0 && p === brkAfter)     mins += brkDur;
    if (lunchAfter > 0 && p === lunchAfter) mins += lunchDur;
  }
  return times;
}

// ── Load ──────────────────────────────────────────────────────
async function loadTimetable() {
  document.getElementById('ttContent').innerHTML = `
    <div class="flex items-center justify-center py-20 text-gray-600 gap-3">
      <div class="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
      <span>Loading timetable...</span>
    </div>`;
  try {
    const res  = await fetch('/api/generate/timetable');
    const data = await res.json();

    if (!data.genes || data.genes.length === 0) {
      document.getElementById('ttContent').innerHTML = `
        <div class="text-center py-20 text-gray-600">
          <i class="ri-calendar3-line text-5xl mb-4 block"></i>
          <p class="text-lg font-medium">No timetable yet</p>
          <p class="text-sm mt-1">Go to <a href="/generate" class="text-brand-400 hover:underline">Generate</a> first.</p>
        </div>`;
      return;
    }

    allGenes    = data.genes;
    institution = data.institution || {};
    buildConflictMaps();  // build O(1) lookup tables
    updateStats();
    renderCurrentView();
    loadViolationsAndCharts();
  } catch (err) {
    document.getElementById('ttContent').innerHTML = `
      <div class="text-center py-20 text-red-400">
        <i class="ri-error-warning-line text-4xl mb-3 block"></i>
        <p>Failed to load: ${err.message}</p>
      </div>`;
  }
}

// ── Stats ─────────────────────────────────────────────────────
function updateStats() {
  const fitness = allGenes[0]?.fitness_score
    ? Math.round(allGenes[0].fitness_score).toLocaleString() : '—';
  document.getElementById('st-fitness').textContent  = fitness;
  document.getElementById('st-classes').textContent  = new Set(allGenes.map(g => g.class_id)).size;
  document.getElementById('st-teachers').textContent = new Set(allGenes.map(g => g.teacher_id)).size;
  document.getElementById('st-rooms').textContent    = new Set(allGenes.map(g => g.room_id)).size;
  document.getElementById('st-lectures').textContent = allGenes.length;
  document.getElementById('subtitleLine').textContent =
    `${institution.name || 'Timetable'} · ${institution.days_per_week || 5} days · ${institution.periods_per_day || 8} periods`;
}

// ── View switching ────────────────────────────────────────────
function switchView(view) {
  currentView = view;
  ['class','teacher','room'].forEach(v => {
    const btn = document.getElementById('view-' + v + '-btn');
    if (v === view) { btn.classList.add('bg-gray-800','text-white'); btn.classList.remove('text-gray-400'); }
    else            { btn.classList.remove('bg-gray-800','text-white'); btn.classList.add('text-gray-400'); }
  });
  document.getElementById('filterInput').value = '';
  filterText = '';
  renderCurrentView();
}

function filterTimetable() {
  filterText = document.getElementById('filterInput').value.toLowerCase().trim();
  renderCurrentView();
}

function renderCurrentView() {
  if (currentView === 'class')   renderGrids('class',   g => g.class_id,   g => g.class_name   || g.class_id);
  if (currentView === 'teacher') renderGrids('teacher', g => g.teacher_id, g => g.teacher_name || g.teacher_id);
  if (currentView === 'room')    renderGrids('room',    g => g.room_id,    g => g.room_name    || g.room_id);
}

// ── Grid renderer ─────────────────────────────────────────────
function renderGrids(viewType, keyFn, nameFn) {
  const days    = parseInt(institution.days_per_week)   || 5;
  const periods = parseInt(institution.periods_per_day) || 8;
  const lunchP  = parseInt(institution.lunch_break_after_period) || 0;
  const breakP  = parseInt(institution.break_after_period) || 0;
  const times   = getPeriodTimes();

  const entities = {};
  for (const gene of allGenes) {
    const key  = keyFn(gene);
    const name = nameFn(gene);
    if (!entities[key]) entities[key] = { name, genes: [] };
    entities[key].genes.push(gene);
  }

  const filteredKeys = Object.keys(entities).filter(k => {
    if (!filterText) return true;
    return k.toLowerCase().includes(filterText) || entities[k].name.toLowerCase().includes(filterText);
  });

  document.getElementById('filterCount').textContent = filterText
    ? `${filteredKeys.length} of ${Object.keys(entities).length} shown` : '';

  if (filteredKeys.length === 0) {
    document.getElementById('ttContent').innerHTML =
      `<p class="text-gray-600 text-sm py-10 text-center">No results for "${filterText}"</p>`;
    return;
  }

  const isMobile = window.innerWidth < 768;

  const sections = filteredKeys.map(key =>
    isMobile
      ? buildMobileCards(entities[key].name, entities[key].genes, viewType)
      : buildGrid(entities[key].name, key, entities[key].genes, viewType, days, periods, lunchP, breakP, times)
  ).join('');

  document.getElementById('ttContent').innerHTML = `<div class="space-y-6">${sections}</div>`;

  // Attach drag listeners only on desktop
  if (!isMobile) attachDragListeners();
}

// ── Desktop grid ──────────────────────────────────────────────
function buildGrid(title, entityKey, genes, viewType, days, periods, lunchP, breakP, times) {
  const grid = {};
  for (const gene of genes) {
    if (!grid[gene.day]) grid[gene.day] = {};
    grid[gene.day][gene.period] = gene;
  }

  const occupied = genes.length;
  const total    = days * periods;
  const pct      = Math.round((occupied / total) * 100);

  let html = `
    <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div class="flex flex-wrap items-center justify-between px-5 py-4 border-b border-gray-800 gap-2">
        <h3 class="font-semibold text-white">${title}</h3>
        <div class="flex items-center gap-3 flex-wrap">
          <span class="text-xs text-gray-500">${occupied} lectures</span>
          <div class="flex items-center gap-1.5">
            <div class="w-16 bg-gray-800 rounded-full h-1.5">
              <div class="h-1.5 rounded-full bg-brand-500" style="width:${pct}%"></div>
            </div>
            <span class="text-xs text-gray-500">${pct}%</span>
          </div>
          ${viewType === 'teacher' ? `
            <button onclick="openAbsenceModal('${entityKey}', '${title.replace(/'/g,"\\'")}')"
              class="text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/50 px-2 py-1 rounded-lg transition-colors">
              <i class="ri-user-unfollow-line mr-1"></i>Mark Absent
            </button>` : ''}
        </div>
      </div>
      <div class="tt-scroll">
        <table class="w-full border-collapse text-xs">
          <thead>
            <tr class="bg-gray-800/60">
              <th class="px-2 py-2.5 text-left text-gray-500 font-medium w-20 border-r border-gray-800">Period</th>`;

  for (let d = 1; d <= days; d++) {
    html += `<th class="px-2 py-2.5 text-center text-gray-400 font-medium">${DAY_NAMES[d] || 'D'+d}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (let p = 1; p <= periods; p++) {
    const isLunchRow = lunchP > 0 && p === lunchP + 1;
    const isBreakRow = breakP > 0 && p === breakP + 1 && breakP !== lunchP;
    const timeInfo   = times[p - 1];

    if (isBreakRow) {
      html += `<tr class="bg-amber-900/10 border-t-2 border-amber-500/40">
        <td class="px-2 py-1.5 text-amber-500 text-xs font-medium border-r border-gray-800" colspan="${days + 1}">
          ☕ Short Break — ${institution.break_duration_minutes || 15} min
        </td></tr>`;
    }
    if (isLunchRow) {
      html += `<tr class="bg-emerald-900/10 border-t-2 border-emerald-500/40">
        <td class="px-2 py-1.5 text-emerald-500 text-xs font-medium border-r border-gray-800" colspan="${days + 1}">
          🍽 Lunch Break — ${institution.lunch_duration_minutes || 30} min
        </td></tr>`;
    }

    html += `<tr class="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors">
      <td class="px-2 py-1.5 text-center border-r border-gray-800">
        <div class="font-semibold text-gray-300">P${p}</div>
        ${timeInfo ? `<div class="text-gray-600 leading-tight">${timeInfo.start}</div><div class="text-gray-700 leading-tight">→${timeInfo.end}</div>` : ''}
      </td>`;

    for (let d = 1; d <= days; d++) {
      const gene = grid[d]?.[p];
      if (gene) {
        const [accent, bg] = getColor(gene.subject_id);
        const main  = gene.subject_name  || gene.subject_id;
        const line1 = viewType === 'class'
          ? (gene.teacher_name || gene.teacher_id)
          : (gene.class_name   || gene.class_id);
        const line2 = viewType === 'room'
          ? (gene.teacher_name || gene.teacher_id)
          : (gene.room_name    || gene.room_id);

        html += `<td class="px-1.5 py-1" data-day="${d}" data-period="${p}">
          <div class="tt-cell rounded-lg px-2 py-1.5 cursor-grab active:cursor-grabbing select-none"
               style="background:${bg}; border-left:3px solid ${accent};"
               draggable="true"
               data-gene-id="${gene.id}"
               data-day="${d}" data-period="${p}"
               data-class-id="${gene.class_id}"
               data-subject-id="${gene.subject_id}"
               data-teacher-id="${gene.teacher_id}"
               data-teacher-name="${(gene.teacher_name || gene.teacher_id).replace(/"/g,'')}"
               data-room-id="${gene.room_id}"
               title="${main} · ${line1} · ${line2}&#10;Drag to reschedule">
            <div class="font-semibold truncate" style="color:${accent};max-width:100px">${main}</div>
            <div class="text-gray-400 truncate" style="max-width:100px">${line1}</div>
            <div class="text-gray-500 truncate" style="max-width:100px">${line2}</div>
          </div>
        </td>`;
      } else {
        html += `<td class="px-1.5 py-1 drop-target-cell" data-day="${d}" data-period="${p}">
          <div class="drop-hint h-full min-h-[56px] rounded-lg border border-dashed border-transparent hover:border-gray-700 transition-all flex items-center justify-center text-gray-800 text-xs">+</div>
        </td>`;
      }
    }
    html += '</tr>';
  }

  html += '</tbody></table></div></div>';
  return html;
}

// ── Mobile card view ──────────────────────────────────────────
function buildMobileCards(title, genes, viewType) {
  const byDay = {};
  for (const gene of genes) {
    if (!byDay[gene.day]) byDay[gene.day] = [];
    byDay[gene.day].push(gene);
  }
  const days = parseInt(institution.days_per_week) || 5;

  let html = `<div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
    <div class="px-4 py-3 border-b border-gray-800 font-semibold text-white">${title}</div>`;

  for (let d = 1; d <= days; d++) {
    const dayGenes = (byDay[d] || []).sort((a, b) => a.period - b.period);
    if (dayGenes.length === 0) continue;
    html += `<div class="px-4 pt-3 pb-2">
      <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">${DAY_FULL[d] || 'Day ' + d}</div>
      <div class="space-y-2">`;
    for (const gene of dayGenes) {
      const [accent, bg] = getColor(gene.subject_id);
      const line1 = viewType === 'class' ? (gene.teacher_name || gene.teacher_id) : (gene.class_name || gene.class_id);
      html += `<div class="flex items-center gap-3 rounded-xl p-3" style="background:${bg};border-left:3px solid ${accent}">
        <span class="text-xs text-gray-500 w-6 text-center font-mono">P${gene.period}</span>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-sm truncate" style="color:${accent}">${gene.subject_name || gene.subject_id}</div>
          <div class="text-xs text-gray-400 truncate">${line1} · ${gene.room_name || gene.room_id}</div>
        </div>
      </div>`;
    }
    html += '</div></div>';
  }
  html += '</div>';
  return html;
}

// ── Drag-and-Drop ─────────────────────────────────────────────
// Uses event delegation on the container instead of per-element listeners.
// This avoids duplicate listener buildup each time the grid re-renders.
let dragListenersAttached = false;

function attachDragListeners() {
  if (dragListenersAttached) return;  // only attach once — use event delegation
  dragListenersAttached = true;

  const container = document.getElementById('ttContent');

  // ── dragstart — fired on draggable cells ──────────────────
  container.addEventListener('dragstart', e => {
    const cell = e.target.closest('[draggable="true"]');
    if (!cell) return;

    dragGene = {
      id:          cell.dataset.geneId,
      day:         parseInt(cell.dataset.day),
      period:      parseInt(cell.dataset.period),
      classId:     cell.dataset.classId,
      subjectId:   cell.dataset.subjectId,
      teacherId:   cell.dataset.teacherId,
      teacherName: cell.dataset.teacherName,
      roomId:      cell.dataset.roomId,
    };

    cell.style.opacity    = '0.4';
    e.dataTransfer.effectAllowed = 'move';

    // Show conflict hints on empty cells immediately
    // Use setTimeout(0) so the drag image renders first
    setTimeout(highlightValidDropZones, 0);
  });

  // ── dragend — fired when drag finishes (drop or cancel) ───
  container.addEventListener('dragend', e => {
    const cell = e.target.closest('[draggable="true"]');
    if (cell) cell.style.opacity = '1';
    dragGene = null;
    clearDropHighlights();
  });

  // ── dragover — fired on drop targets ─────────────────────
  container.addEventListener('dragover', e => {
    const td = e.target.closest('.drop-target-cell');
    if (!td) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Add a hover indicator (separate from the conflict colour hints)
    td.querySelector('.drop-hint')?.classList.add('!border-brand-500');
  });

  // ── dragleave — FIXED: only remove hover when leaving the cell
  //    Old bug: dragleave fires when cursor enters child elements (the inner div),
  //    causing the blue border to flicker constantly during hover.
  //    Fix: check relatedTarget — if it's still inside the td, ignore the event.
  container.addEventListener('dragleave', e => {
    const td = e.target.closest('.drop-target-cell');
    if (!td) return;
    // relatedTarget is where the cursor is going — if it's still inside td, ignore
    if (td.contains(e.relatedTarget)) return;
    td.querySelector('.drop-hint')?.classList.remove('!border-brand-500');
  });

  // ── drop — fired when gene is released on a target cell ───
  container.addEventListener('drop', async e => {
    const td = e.target.closest('.drop-target-cell');
    if (!td) return;
    e.preventDefault();
    td.querySelector('.drop-hint')?.classList.remove('!border-brand-500');

    if (!dragGene) return;

    const newDay    = parseInt(td.dataset.day);
    const newPeriod = parseInt(td.dataset.period);

    // Same slot — no-op
    if (newDay === dragGene.day && newPeriod === dragGene.period) {
      dragGene = null;
      clearDropHighlights();
      return;
    }

    // Capture and immediately clear dragGene to prevent double-fire
    const gene = { ...dragGene };
    dragGene = null;
    clearDropHighlights();

    await rescheduleGene(gene, newDay, newPeriod);
  });
}

// ── Highlight conflict/free status on all empty cells ─────────
// Called on dragstart — colours every drop zone before user moves the cursor.
// Uses O(1) map lookups instead of O(n) allGenes.find() per cell.
//
// FIXED: now checks ALL THREE hard constraints:
//   H1 — teacher already teaching at this slot
//   H2 — class already has a lecture at this slot
//   H3 — room already occupied at this slot     ← this was missing before
//
// A slot showing "✓ Free" is only truly free when all three pass.
function highlightValidDropZones() {
  if (!dragGene) return;

  document.querySelectorAll('.drop-target-cell').forEach(td => {
    const newDay    = parseInt(td.dataset.day);
    const newPeriod = parseInt(td.dataset.period);
    const hint      = td.querySelector('.drop-hint');
    if (!hint) return;

    // O(1) lookups using pre-built index maps
    const tKey = dragGene.teacherId + '|' + newDay + '|' + newPeriod;
    const cKey = dragGene.classId   + '|' + newDay + '|' + newPeriod;
    const rKey = dragGene.roomId    + '|' + newDay + '|' + newPeriod;

    const teacherConflict = teacherSlotMap[tKey];
    const classConflict   = classSlotMap[cKey];
    const roomConflict    = roomSlotMap[rKey];

    if (teacherConflict || classConflict || roomConflict) {
      // Red — conflict: explain which constraint is violated
      let reason, detail;
      if (teacherConflict) {
        reason = '🚫 Teacher busy';
        detail = `${dragGene.teacherName} is teaching ${teacherConflict.subject_name || teacherConflict.subject_id} here`;
      } else if (classConflict) {
        reason = '🚫 Class busy';
        detail = `This class already has ${classConflict.subject_name || classConflict.subject_id} here`;
      } else {
        reason = '🚫 Room taken';
        detail = `Room is occupied by ${roomConflict.class_name || roomConflict.class_id}`;
      }
      hint.classList.remove('bg-emerald-900/20','border-emerald-700/50','!text-emerald-500');
      hint.classList.add('bg-red-900/20','border-red-700/50','border-solid','!text-red-500');
      hint.textContent = reason;
      hint.title       = detail;
    } else {
      // Green — all three constraints pass: safe to drop
      hint.classList.remove('bg-red-900/20','border-red-700/50','!text-red-500');
      hint.classList.add('bg-emerald-900/20','border-emerald-700/50','border-solid','!text-emerald-500');
      hint.textContent = '✓ Free';
      hint.title       = 'No conflicts — safe to drop here';
    }
  });
}

// Reset all drop zone hints to their default state
function clearDropHighlights() {
  document.querySelectorAll('.drop-hint').forEach(h => {
    h.className = 'drop-hint h-full min-h-[56px] rounded-lg border border-dashed border-transparent hover:border-gray-700 transition-all flex items-center justify-center text-gray-800 text-xs';
    h.textContent = '+';
    h.title = '';
  });
}

// ── Reschedule a gene ─────────────────────────────────────────
async function rescheduleGene(gene, newDay, newPeriod) {
  // Local conflict check using O(1) maps — same logic as highlightValidDropZones
  // so the behaviour is consistent: if hint shows "Free", the drop should succeed.
  const tKey = gene.teacherId + '|' + newDay + '|' + newPeriod;
  const cKey = gene.classId   + '|' + newDay + '|' + newPeriod;
  const rKey = gene.roomId    + '|' + newDay + '|' + newPeriod;

  const teacherConflict = teacherSlotMap[tKey];
  const classConflict   = classSlotMap[cKey];
  const roomConflict    = roomSlotMap[rKey];

  if (teacherConflict || classConflict || roomConflict) {
    let msg;
    if (teacherConflict) {
      msg = `⚠️ ${gene.teacherName} is teaching ${teacherConflict.subject_name || teacherConflict.subject_id} at ${DAY_NAMES[newDay]} P${newPeriod}`;
    } else if (classConflict) {
      msg = `⚠️ This class already has ${classConflict.subject_name || classConflict.subject_id} at ${DAY_NAMES[newDay]} P${newPeriod}`;
    } else {
      msg = `⚠️ Room is already occupied at ${DAY_NAMES[newDay]} P${newPeriod}`;
    }
    showToast(msg, 'error');
    return;
  }

  try {
    const r = await fetch('/api/generate/reschedule', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ gene_id: gene.id, new_day: newDay, new_period: newPeriod }),
    });
    const result = await r.json();

    if (!result.success) {
      showToast('⚠️ ' + result.error, 'error');
      return;
    }

    // Update allGenes using strict string comparison on IDs
    const idx = allGenes.findIndex(g => String(g.id) === String(gene.id));
    if (idx !== -1) {
      allGenes[idx].day    = newDay;
      allGenes[idx].period = newPeriod;
    }

    // Rebuild conflict maps so next drag reflects the move immediately
    buildConflictMaps();

    showToast(`✅ Moved to ${DAY_NAMES[newDay]} P${newPeriod}`, 'success');

    // Re-render the grid — reset delegation flag so listeners re-attach
    dragListenersAttached = false;
    renderCurrentView();
    loadViolationsAndCharts();
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// ── Teacher Absence System ────────────────────────────────────
function openAbsenceModal(teacherId, teacherName) {
  const teacherGenes = allGenes.filter(g => g.teacher_id === teacherId);
  if (teacherGenes.length === 0) {
    showToast(`${teacherName} has no scheduled lectures.`);
    return;
  }

  document.getElementById('absenceModalTitle').textContent = `${teacherName} — Mark Absent`;

  const byDay = {};
  for (const g of teacherGenes) {
    if (!byDay[g.day]) byDay[g.day] = [];
    byDay[g.day].push(g);
  }

  const days = parseInt(institution.days_per_week) || 5;
  let html = `
    <div class="bg-amber-900/20 border border-amber-700/40 rounded-xl p-3 mb-4 text-sm text-amber-300">
      <i class="ri-information-line mr-1"></i>
      Marking <strong>${teacherName}</strong> absent for today will log this in the attendance record.
      Click any lecture below to assign a substitute teacher.
    </div>
    <div class="flex gap-2 mb-4">
      <button onclick="confirmMarkAbsent('${teacherId}', '${teacherName.replace(/'/g,"\\'")}')"
        class="flex-1 bg-red-700 hover:bg-red-600 text-white font-semibold py-2 rounded-xl text-sm transition-colors">
        <i class="ri-user-unfollow-line mr-1"></i> Confirm Absent Today
      </button>
      <button onclick="undoAbsent('${teacherId}', '${teacherName.replace(/'/g,"\\'")}')"
        class="px-4 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium py-2 rounded-xl text-sm transition-colors border border-gray-700"
        title="Undo if marked by mistake">
        <i class="ri-arrow-go-back-line"></i> Undo
      </button>
    </div>
    <p class="text-xs text-gray-500 mb-3 font-medium uppercase tracking-wide">Lectures this week — click to find substitute</p>
    <div class="space-y-4">`;

  for (let d = 1; d <= days; d++) {
    const lectures = (byDay[d] || []).sort((a, b) => a.period - b.period);
    if (lectures.length === 0) continue;
    html += `<div>
      <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">${DAY_FULL[d]}</div>
      <div class="space-y-2">`;
    for (const g of lectures) {
      const [accent] = getColor(g.subject_id);
      html += `<div class="flex items-center gap-3 rounded-xl p-3 cursor-pointer hover:bg-gray-800/50 transition-colors border border-gray-800"
                    style="border-left-color:${accent};border-left-width:3px"
                    onclick="findSubstitute(${g.id},'${teacherId}','${(g.subject_name||g.subject_id).replace(/'/g,"\\'")}',${d},${g.period},this)">
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-sm" style="color:${accent}">${g.subject_name || g.subject_id}</div>
          <div class="text-xs text-gray-500">${g.class_name || g.class_id} · ${g.room_name || g.room_id} · Period ${g.period}</div>
        </div>
        <span class="text-xs text-gray-600 sub-status shrink-0">Click to substitute →</span>
      </div>`;
    }
    html += '</div></div>';
  }
  html += '</div>';

  document.getElementById('absenceModalBody').innerHTML = html;
  document.getElementById('absenceModal').classList.remove('hidden');
  document.getElementById('absenceModal').classList.add('flex');
}

async function confirmMarkAbsent(teacherId, teacherName) {
  try {
    const r = await fetch('/api/generate/mark-absent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacher_id: teacherId }),
    });
    const result = await r.json();
    showToast(result.success ? `✅ ${teacherName} marked absent for today (${result.date}).` : 'ℹ️ ' + result.error);
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

async function undoAbsent(teacherId, teacherName) {
  try {
    const r = await fetch('/api/generate/undo-absent', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacher_id: teacherId }),
    });
    const result = await r.json();
    showToast(result.success ? `↩️ ${teacherName} absence undone.` : result.error);
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

async function findSubstitute(geneId, absentTeacherId, subjectName, day, period, rowEl) {
  const statusEl = rowEl.querySelector('.sub-status');
  statusEl.textContent = 'Searching...';

  try {
    const r = await fetch('/api/generate/substitute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gene_id: geneId, absent_teacher_id: absentTeacherId }),
    });
    const result = await r.json();

    if (!result.success) {
      statusEl.textContent = '❌ ' + result.error;
      statusEl.className   = 'text-xs text-red-400 sub-status shrink-0 max-w-[160px] text-right';
      return;
    }

    // Update local state with strict ID comparison
    const idx = allGenes.findIndex(g => String(g.id) === String(geneId));
    if (idx !== -1) {
      allGenes[idx].teacher_id   = result.substitute_id;
      allGenes[idx].teacher_name = result.substitute_name;
    }

    // Rebuild maps after teacher change
    buildConflictMaps();

    statusEl.textContent = `✅ ${result.substitute_name}`;
    statusEl.className   = 'text-xs text-emerald-400 sub-status shrink-0 font-semibold';
    rowEl.style.background = 'rgba(16,185,129,0.08)';

    if (result.all_available?.length > 1) {
      rowEl.title = `Also available: ${result.all_available.slice(1).map(t => t.name).join(', ')}`;
    }

    dragListenersAttached = false;
    renderCurrentView();
    loadViolationsAndCharts();
  } catch (err) {
    statusEl.textContent = 'Error';
    statusEl.className   = 'text-xs text-red-400 sub-status shrink-0';
  }
}

function closeAbsenceModal() {
  document.getElementById('absenceModal').classList.add('hidden');
  document.getElementById('absenceModal').classList.remove('flex');
}

// ── Attendance Log ────────────────────────────────────────────
let attendanceAllRecords = [];

async function loadAttendanceLog() {
  const panel = document.getElementById('attendancePanel');
  const isHidden = panel.classList.contains('hidden');
  if (!isHidden) { panel.classList.add('hidden'); return; }

  panel.classList.remove('hidden');
  document.getElementById('attendanceList').innerHTML =
    '<div class="flex items-center justify-center py-8 text-gray-600 gap-2"><div class="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div><span>Loading records...</span></div>';

  try {
    const res  = await fetch('/api/generate/attendance');
    const data = await res.json();
    attendanceAllRecords = data.records || [];
    renderAttendanceLog(attendanceAllRecords, data.summary || {});
  } catch (err) {
    document.getElementById('attendanceList').innerHTML =
      '<p class="text-red-400 text-sm px-4">Failed to load: ' + err.message + '</p>';
  }
}

function filterAttendance() {
  const name   = (document.getElementById('att-name')?.value || '').toLowerCase().trim();
  const from   = document.getElementById('att-from')?.value || '';
  const to     = document.getElementById('att-to')?.value   || '';
  const sortBy = document.getElementById('att-sort')?.value || 'date';

  let records = attendanceAllRecords.filter(rec => {
    if (name && !(rec.teacher_name || '').toLowerCase().includes(name)) return false;
    if (from && rec.absent_date < from) return false;
    if (to   && rec.absent_date > to)   return false;
    return true;
  });

  if (sortBy === 'name') {
    records.sort((a, b) => (a.teacher_name || '').localeCompare(b.teacher_name || ''));
  } else if (sortBy === 'most') {
    const counts = {};
    for (const r of records) counts[r.teacher_id] = (counts[r.teacher_id] || 0) + 1;
    records.sort((a, b) => (counts[b.teacher_id] || 0) - (counts[a.teacher_id] || 0));
  } else {
    records.sort((a, b) => b.absent_date.localeCompare(a.absent_date));
  }

  const summary = {};
  for (const r of records) {
    if (!summary[r.teacher_id]) summary[r.teacher_id] = { name: r.teacher_name || r.teacher_id, count: 0 };
    summary[r.teacher_id].count++;
  }

  renderAttendanceLog(records, summary);
}

function renderAttendanceLog(records, summary) {
  const list = document.getElementById('attendanceList');
  if (records.length === 0) {
    list.innerHTML = '<p class="text-gray-600 text-sm text-center py-8">No absence records found.</p>';
    return;
  }

  let html = '<div class="flex flex-wrap gap-2 mb-5">';
  for (const [, data] of Object.entries(summary)) {
    const colorClass = data.count >= 5 ? 'border-red-700/50 text-red-300' :
                       data.count >= 3 ? 'border-amber-700/50 text-amber-300' :
                                         'border-gray-700 text-gray-300';
    html += `<span class="bg-gray-800 text-xs px-3 py-1.5 rounded-full border ${colorClass} cursor-pointer hover:bg-gray-700 transition-colors"
                  onclick="filterByTeacher('${data.name}')">
      ${data.name} <span class="font-bold ml-1">${data.count}</span>
    </span>`;
  }
  html += '</div><div class="space-y-2">';
  for (const rec of records) {
    const dateObj = new Date(rec.absent_date + 'T00:00:00');
    const dateStr = dateObj.toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
    html += `<div class="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3 text-sm border border-gray-700/50">
      <div class="w-2 h-2 rounded-full bg-red-400 shrink-0"></div>
      <div class="flex-1 min-w-0">
        <span class="font-semibold text-white">${rec.teacher_name || rec.teacher_id}</span>
        <span class="text-gray-500 text-xs ml-2">${dateStr}</span>
      </div>
      ${rec.substitute_name
        ? `<span class="text-emerald-400 text-xs shrink-0">↪ ${rec.substitute_name}</span>`
        : '<span class="text-gray-600 text-xs shrink-0">No sub</span>'}
      ${rec.notes ? `<span class="text-gray-600 text-xs italic shrink-0 hidden sm:block">${rec.notes}</span>` : ''}
    </div>`;
  }
  html += `</div><p class="text-gray-600 text-xs mt-3 text-right">${records.length} record${records.length !== 1 ? 's' : ''}</p>`;
  list.innerHTML = html;
}

function filterByTeacher(name) {
  const el = document.getElementById('att-name');
  if (el) { el.value = name; filterAttendance(); }
}

// ── Violations & Charts ───────────────────────────────────────
async function loadViolationsAndCharts() {
  try {
    const r    = await fetch('/api/generate/violations');
    const data = await r.json();
    renderCharts(data.teacherStats, data.roomStats);
  } catch (e) {
    console.warn('Could not load charts:', e.message);
  }
}

function renderViolationPanel() {}  // kept as no-op — removed from UI

let teacherChart = null;
let roomChart    = null;

function renderCharts(teacherStats, roomStats) {
  if (!teacherStats || !roomStats) return;
  document.getElementById('chartsSection').classList.remove('hidden');

  const tCtx = document.getElementById('teacherChart').getContext('2d');
  if (teacherChart) teacherChart.destroy();
  teacherChart = new Chart(tCtx, {
    type: 'bar',
    data: {
      labels: teacherStats.map(t => t.name.split(' ').pop()),
      datasets: [
        {
          label: 'Assigned',
          data: teacherStats.map(t => t.used),
          backgroundColor: teacherStats.map(t =>
            t.used > t.max ? '#f87171' : t.used >= t.max * 0.85 ? '#fbbf24' : '#34d399'
          ),
          borderRadius: 5,
        },
        {
          label: 'Max',
          data: teacherStats.map(t => t.max),
          backgroundColor: 'transparent',
          borderColor: '#374151',
          borderWidth: 1.5,
          type: 'bar',
          borderRadius: 5,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      plugins: { legend: { labels: { color: '#9ca3af', font: { size: 10 } } } },
      scales: {
        x: { ticks: { color: '#6b7280', font: { size: 9 } }, grid: { display: false } },
        y: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true },
      },
    },
  });

  const rCtx = document.getElementById('roomChart').getContext('2d');
  if (roomChart) roomChart.destroy();
  const rPct = roomStats.map(r => Math.round((r.used / r.total) * 100));
  roomChart = new Chart(rCtx, {
    type: 'bar',
    data: {
      labels: roomStats.map(r => r.name.split(' ').slice(-2).join(' ')),
      datasets: [{
        label: 'Utilisation %',
        data: rPct,
        backgroundColor: rPct.map(p => p > 80 ? '#f87171' : p > 50 ? '#fbbf24' : '#60a5fa'),
        borderRadius: 5,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#6b7280', font: { size: 9 } }, grid: { display: false } },
        y: { ticks: { color: '#6b7280', font: { size: 10 }, callback: v => v + '%' },
             grid: { color: 'rgba(255,255,255,0.04)' }, max: 100, beginAtZero: true },
      },
    },
  });
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  const c = type === 'success'
    ? 'bg-emerald-900/90 text-emerald-300 border-emerald-700'
    : 'bg-red-900/90 text-red-300 border-red-700';
  t.className = `fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-xl border transition-all max-w-xs ${c}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ── Print ─────────────────────────────────────────────────────
function printTimetable() { window.print(); }

// ── Resize ────────────────────────────────────────────────────
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    dragListenersAttached = false;  // reset so listeners re-attach after resize
    renderCurrentView();
  }, 200);
});

// ── Boot ──────────────────────────────────────────────────────
loadTimetable();
