// operators.js — GA Operators (conflict-aware mutation + improved crossover)

function tournamentSelection(population, fitnessScores, tournamentSize, rng) {
  const len = population.length;
  const parents = new Array(2);
  for (let p = 0; p < 2; p++) {
    let bi = (rng() * len) | 0, bs = fitnessScores[bi];
    for (let k = 1; k < tournamentSize; k++) {
      const i = (rng() * len) | 0, s = fitnessScores[i];
      if (s > bs) { bs = s; bi = i; }
    }
    parents[p] = population[bi];
  }
  return parents;
}

// CLASS-BLOCK crossover: for each class, pick ALL its genes from either P1 or P2.
// Keeping a whole class's schedule together prevents teacher/room double-bookings.
function classBlockCrossover(p1, p2, rng) {
  if (!p1 || !p2) return [p1 || [], p2 || []];
  const a = {}, b = {};
  for (const g of p1) { if (!g) continue; if (!a[g.class_id]) a[g.class_id] = []; a[g.class_id].push(g); }
  for (const g of p2) { if (!g) continue; if (!b[g.class_id]) b[g.class_id] = []; b[g.class_id].push(g); }
  const allClasses = new Set([...Object.keys(a), ...Object.keys(b)]);
  const c1 = [], c2 = [];
  for (const cls of allClasses) {
    const ga = a[cls] || [], gb = b[cls] || [];
    if (rng() < 0.5) { for (const g of ga) c1.push({ ...g }); for (const g of gb) c2.push({ ...g }); }
    else { for (const g of gb) c1.push({ ...g }); for (const g of ga) c2.push({ ...g }); }
  }
  return [c1, c2];
}

// DAY-BLOCK crossover: swap days PER-CLASS so teacher stays consistent.
function dayBlockCrossover(p1, p2, daysPerWeek, rng) {
  if (!p1 || !p2) return [p1 || [], p2 || []];
  const a = {}, b = {};
  for (const g of p1) {
    if (!g) continue;
    if (!a[g.class_id]) a[g.class_id] = {};
    const d = Math.min(Math.max((g.day | 0) || 1, 1), daysPerWeek) - 1;
    if (!a[g.class_id][d]) a[g.class_id][d] = [];
    a[g.class_id][d].push(g);
  }
  for (const g of p2) {
    if (!g) continue;
    if (!b[g.class_id]) b[g.class_id] = {};
    const d = Math.min(Math.max((g.day | 0) || 1, 1), daysPerWeek) - 1;
    if (!b[g.class_id][d]) b[g.class_id][d] = [];
    b[g.class_id][d].push(g);
  }
  const allClasses = new Set([...Object.keys(a), ...Object.keys(b)]);
  const c1 = [], c2 = [];
  for (const cls of allClasses) {
    const ca = a[cls] || {}, cb = b[cls] || {};
    for (let d = 0; d < daysPerWeek; d++) {
      const ga = ca[d] || [], gb = cb[d] || [];
      if (rng() < 0.5) { for (const g of ga) c1.push({ ...g }); for (const g of gb) c2.push({ ...g }); }
      else { for (const g of gb) c1.push({ ...g }); for (const g of ga) c2.push({ ...g }); }
    }
  }
  return [c1, c2];
}

// ── Conflict-aware helper: build occupancy maps for the chromosome ──
function _buildOccupancy(r) {
  const teacherSlots = {};  // teacher_id -> Set of "day-period"
  const classSlots = {};    // class_id   -> Set of "day-period"
  const roomSlots = {};     // room_id    -> Set of "day-period"
  for (const g of r) {
    if (!g) continue;
    const key = `${g.day}-${g.period}`;
    if (!teacherSlots[g.teacher_id]) teacherSlots[g.teacher_id] = new Set();
    teacherSlots[g.teacher_id].add(key);
    if (!classSlots[g.class_id]) classSlots[g.class_id] = new Set();
    classSlots[g.class_id].add(key);
    if (!roomSlots[g.room_id]) roomSlots[g.room_id] = new Set();
    roomSlots[g.room_id].add(key);
  }
  return { teacherSlots, classSlots, roomSlots };
}

// Check if placing gene g at (day, period) would cause a conflict (ignoring gene at index skipIdx)
function _hasConflict(r, skipIdx, teacherId, classId, roomId, day, period) {
  const key = `${day}-${period}`;
  for (let k = 0; k < r.length; k++) {
    if (k === skipIdx || !r[k]) continue;
    const gk = `${r[k].day}-${r[k].period}`;
    if (gk !== key) continue;
    if (r[k].teacher_id === teacherId) return true;  // H1
    if (r[k].class_id === classId) return true;       // H2/H4
    if (r[k].room_id === roomId) return true;         // H3
  }
  return false;
}

// Swap slots WITHIN same class only — prevents cross-class conflicts
function _classInternalSwap(r, rng, i) {
  const cls = r[i].class_id;
  const idx = [];
  for (let k = 0; k < r.length; k++) if (r[k] && r[k].class_id === cls) idx.push(k);
  if (idx.length < 2) return;
  const j = idx[(rng() * idx.length) | 0];
  if (j === i) return;
  const g = r[i], h = r[j];
  const td = g.day, tp = g.period;
  g.day = h.day; g.period = h.period;
  h.day = td; h.period = tp;
}

// Room reassign — pick a valid room that isn't conflicting at this slot
function _roomReassign(r, roomsByType, rng, i) {
  const opts = roomsByType[r[i].subject_id];
  if (!opts || !opts.length) return;

  const key = `${r[i].day}-${r[i].period}`;
  // Collect rooms already occupied at this slot
  const occupied = new Set();
  for (let k = 0; k < r.length; k++) {
    if (k === i || !r[k]) continue;
    if (`${r[k].day}-${r[k].period}` === key) occupied.add(r[k].room_id);
  }

  // Prefer non-conflicting rooms
  const free = opts.filter(rm => !occupied.has(rm.id));
  if (free.length > 0) {
    r[i].room_id = free[(rng() * free.length) | 0].id;
  } else {
    r[i].room_id = opts[(rng() * opts.length) | 0].id;
  }
}

// Day move — try to move to a day that doesn't cause conflicts
function _dayMove(r, daysPerWeek, rng, i) {
  const g = r[i];
  const origDay = g.day;

  // Try up to 5 random days, prefer conflict-free
  for (let attempt = 0; attempt < 5; attempt++) {
    let nd = ((rng() * daysPerWeek) | 0) + 1;
    if (nd === origDay && daysPerWeek > 1) nd = (origDay % daysPerWeek) + 1;

    if (!_hasConflict(r, i, g.teacher_id, g.class_id, g.room_id, nd, g.period)) {
      g.day = nd;
      return;
    }
  }
  // Fallback: just move anyway (let fitness penalize)
  let nd = ((rng() * daysPerWeek) | 0) + 1;
  if (nd === origDay && daysPerWeek > 1) nd = (origDay % daysPerWeek) + 1;
  g.day = nd;
}

// Period shuffle — shuffle periods for one class on one day
function _periodShuffle(r, rng, i) {
  const cls = r[i].class_id, day = r[i].day;
  const idx = [];
  for (let k = 0; k < r.length; k++) if (r[k] && r[k].class_id === cls && r[k].day === day) idx.push(k);
  if (idx.length < 2) return;
  const p = idx.map(k => r[k].period);
  for (let k = p.length - 1; k > 0; k--) { const j = (rng() * (k + 1)) | 0; const t = p[k]; p[k] = p[j]; p[j] = t; }
  idx.forEach((k, n) => r[k].period = p[n]);
}

// Nudge period by ±1 — conflict-aware
function _periodNudge(r, periodsPerDay, rng, i) {
  const g = r[i];
  const delta = rng() < 0.5 ? -1 : 1;
  const newPeriod = Math.min(Math.max(g.period + delta, 1), periodsPerDay);
  if (newPeriod === g.period) return;

  if (!_hasConflict(r, i, g.teacher_id, g.class_id, g.room_id, g.day, newPeriod)) {
    g.period = newPeriod;
  }
}

// Conflict repair — find a gene causing a conflict and move it to a free slot
function _conflictRepair(r, daysPerWeek, periodsPerDay, rng, i) {
  const g = r[i];
  const key = `${g.day}-${g.period}`;

  // Check if this gene is actually in conflict
  let inConflict = false;
  for (let k = 0; k < r.length; k++) {
    if (k === i || !r[k]) continue;
    if (`${r[k].day}-${r[k].period}` !== key) continue;
    if (r[k].teacher_id === g.teacher_id || r[k].class_id === g.class_id || r[k].room_id === g.room_id) {
      inConflict = true;
      break;
    }
  }
  if (!inConflict) return; // nothing to repair

  // Try to find a conflict-free slot
  for (let attempt = 0; attempt < 15; attempt++) {
    const nd = ((rng() * daysPerWeek) | 0) + 1;
    const np = ((rng() * periodsPerDay) | 0) + 1;
    if (nd === g.day && np === g.period) continue;

    if (!_hasConflict(r, i, g.teacher_id, g.class_id, g.room_id, nd, np)) {
      g.day = nd;
      g.period = np;
      return;
    }
  }
}

function applyMutation(chromosome, mutationRate, daysPerWeek, periodsPerDay, roomsByType, rng) {
  const r = chromosome.map(g => ({ ...g }));
  for (let i = 0; i < r.length; i++) {
    if (rng() >= mutationRate) continue;
    switch ((rng() * 7) | 0) {
      case 0: _classInternalSwap(r, rng, i);                       break;
      case 1: _roomReassign(r, roomsByType, rng, i);               break;
      case 2: _dayMove(r, daysPerWeek, rng, i);                    break;
      case 3: _periodShuffle(r, rng, i);                           break;
      case 4: _periodNudge(r, periodsPerDay, rng, i);              break;
      case 5: _conflictRepair(r, daysPerWeek, periodsPerDay, rng, i); break;
      case 6: _classInternalSwap(r, rng, i);                       break;  // extra weight on safe swap
    }
  }
  return r;
}

module.exports = { tournamentSelection, classBlockCrossover, dayBlockCrossover, applyMutation };
