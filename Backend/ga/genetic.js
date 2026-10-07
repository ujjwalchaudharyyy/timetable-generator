// genetic.js — GA Engine (improved convergence, smarter init, frequent progress)

const { calculateFitness }                                                        = require('./fitness');
const { tournamentSelection, classBlockCrossover, dayBlockCrossover, applyMutation } = require('./operators');

function createSeededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function buildInstitutionData(data) {
  const teacherSubjectMap     = {};
  const teacherMaxLectures    = {};
  const teacherMaxConsecutive = {};
  const teacherPrefersMorning = {};
  const classStudentCount     = {};
  const roomCapacity          = {};
  const roomTypeMap           = {};
  const curriculum            = {};
  const subjectRoomType       = {};
  const unavailableMap        = {};

  const periodsPerDay = (data.institution || {}).periods_per_day || 8;

  for (const t of (data.teachers || [])) {
    teacherSubjectMap[t.id]     = [];
    teacherMaxLectures[t.id]    = t.max_lectures_per_week    || 30;
    teacherMaxConsecutive[t.id] = t.max_consecutive_lectures || 3;
    teacherPrefersMorning[t.id] = !!t.prefers_morning;
    unavailableMap[t.id]        = new Set();
  }
  for (const ts of (data.teacherSubjects || [])) {
    if (!teacherSubjectMap[ts.teacher_id]) teacherSubjectMap[ts.teacher_id] = [];
    teacherSubjectMap[ts.teacher_id].push(ts.subject_id);
  }
  for (const e of (data.teacherUnavailable || [])) {
    if (!unavailableMap[e.teacher_id]) unavailableMap[e.teacher_id] = new Set();
    unavailableMap[e.teacher_id].add(`${e.day}-${e.period}`);
  }
  for (const c of (data.classes || [])) {
    classStudentCount[c.id] = c.student_count || 30;
    curriculum[c.id]        = [];
  }
  for (const r of (data.rooms || [])) {
    roomCapacity[r.id] = r.capacity || 50;
    roomTypeMap[r.id]  = r.type     || 'classroom';
  }
  for (const s of (data.subjects || [])) {
    subjectRoomType[s.id] = s.requires_room_type || 'classroom';
  }
  for (const e of (data.curriculum || [])) {
    if (!curriculum[e.class_id]) curriculum[e.class_id] = [];
    curriculum[e.class_id].push({ subject_id: e.subject_id, teacher_id: e.teacher_id, min_per_week: e.min_per_week || 1 });
  }

  return {
    teacherSubjectMap, teacherMaxLectures, teacherMaxConsecutive, teacherPrefersMorning,
    classStudentCount, roomCapacity, roomTypeMap, curriculum, subjectRoomType,
    unavailableMap, periodsPerDay,
  };
}

function buildRoomsByType(data) {
  const byType = {};
  for (const r of (data.rooms || [])) {
    const t = r.type || 'classroom';
    if (!byType[t]) byType[t] = [];
    byType[t].push(r);
  }
  const map = {};
  for (const s of (data.subjects || [])) {
    const needed = s.requires_room_type || 'classroom';
    map[s.id] = byType[needed] || data.rooms || [];
  }
  return map;
}

// Improved greedy chromosome init — tracks all occupancy strictly
function createChromosome(data, institution, rng, roomsByType) {
  const daysPerWeek   = institution.days_per_week   || 5;
  const periodsPerDay = institution.periods_per_day || 8;
  const maxAttempts   = daysPerWeek * periodsPerDay * 4;
  const chromosome    = [];

  const teacherSlots = {}, classSlots = {}, roomSlots = {};
  const classStudentMap = {};
  for (const c of (data.classes || [])) classStudentMap[c.id] = c.student_count || 0;

  // Build all available slots list for fallback
  const allSlots = [];
  for (let d = 1; d <= daysPerWeek; d++) {
    for (let p = 1; p <= periodsPerDay; p++) {
      allSlots.push({ day: d, period: p });
    }
  }

  for (const [classId, subjects] of Object.entries(data.curriculumMap || {})) {
    if (!classSlots[classId]) classSlots[classId] = new Set();

    for (const entry of subjects) {
      if (!teacherSlots[entry.teacher_id]) teacherSlots[entry.teacher_id] = new Set();

      const studentCount = classStudentMap[classId] || 0;
      const allPool      = roomsByType[entry.subject_id] || data.rooms || [];
      let pool = allPool.filter(r => (r.capacity || 0) >= studentCount);
      if (!pool.length) pool = allPool;
      if (!pool.length) pool = data.rooms || [];

      for (let i = 0; i < entry.min_per_week; i++) {
        let day, period, slotKey, chosenRoom = null, placed = false;

        // Phase 1: Try random slots with full conflict checking
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          day    = ((rng() * daysPerWeek) | 0) + 1;
          period = ((rng() * periodsPerDay) | 0) + 1;
          slotKey = `${day}-${period}`;

          if (teacherSlots[entry.teacher_id].has(slotKey)) continue;
          if (classSlots[classId].has(slotKey))            continue;

          // Find a free room at this slot
          const startIdx = (rng() * pool.length) | 0;
          for (let ri = 0; ri < pool.length; ri++) {
            const r = pool[(startIdx + ri) % pool.length];
            if (!roomSlots[r.id]) roomSlots[r.id] = new Set();
            if (!roomSlots[r.id].has(slotKey)) { chosenRoom = r; break; }
          }
          if (chosenRoom) { placed = true; break; }
        }

        // Phase 2: If still not placed, systematically scan ALL slots
        if (!placed) {
          // Shuffle allSlots order for variety
          const shuffled = allSlots.map(s => s).sort(() => rng() - 0.5);
          for (const slot of shuffled) {
            slotKey = `${slot.day}-${slot.period}`;
            if (teacherSlots[entry.teacher_id].has(slotKey)) continue;
            if (classSlots[classId].has(slotKey)) continue;

            for (let ri = 0; ri < pool.length; ri++) {
              const r = pool[ri];
              if (!roomSlots[r.id]) roomSlots[r.id] = new Set();
              if (!roomSlots[r.id].has(slotKey)) { chosenRoom = r; break; }
            }
            if (chosenRoom) {
              day = slot.day;
              period = slot.period;
              placed = true;
              break;
            }
          }
        }

        // Phase 3: Last resort — place anyway but at least avoid class double-booking
        if (!placed || !chosenRoom) {
          for (const slot of allSlots) {
            slotKey = `${slot.day}-${slot.period}`;
            if (classSlots[classId].has(slotKey)) continue;
            day = slot.day;
            period = slot.period;
            chosenRoom = pool[(rng() * pool.length) | 0] || (data.rooms || [])[0];
            break;
          }
          if (!chosenRoom) {
            day       = ((rng() * daysPerWeek) | 0) + 1;
            period    = ((rng() * periodsPerDay) | 0) + 1;
            slotKey   = `${day}-${period}`;
            chosenRoom = pool[(rng() * pool.length) | 0] || (data.rooms || [])[0];
          }
        }

        slotKey = `${day}-${period}`;
        teacherSlots[entry.teacher_id].add(slotKey);
        classSlots[classId].add(slotKey);
        if (chosenRoom) {
          if (!roomSlots[chosenRoom.id]) roomSlots[chosenRoom.id] = new Set();
          roomSlots[chosenRoom.id].add(slotKey);
        }

        chromosome.push({
          class_id:   classId,
          subject_id: entry.subject_id,
          teacher_id: entry.teacher_id,
          room_id:    chosenRoom ? chosenRoom.id : (data.rooms?.[0]?.id || 'R101'),
          day, period,
        });
      }
    }
  }
  return chromosome;
}

function topN(scores, n) {
  const used = new Uint8Array(scores.length);
  const result = [];
  for (let k = 0; k < n && k < scores.length; k++) {
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < scores.length; i++) {
      if (!used[i] && scores[i] > bestScore) { bestScore = scores[i]; best = i; }
    }
    if (best >= 0) { result.push(best); used[best] = 1; }
  }
  return result;
}

async function evolve(data, config = {}, progressCallback = null) {
  const {
    population_size           = 120,
    max_generations           = 400,
    crossover_rate            = 0.88,
    mutation_rate             = 0.03,    // slightly higher default for faster exploration
    tournament_size           = 6,
    elitism_count             = 4,
    stagnation_window         = 30,     // detect stagnation faster
    stagnation_mutation_boost = 0.12,
    target_fitness            = 9800,
    random_seed               = 42,
  } = config;

  const rng           = createSeededRng(random_seed);
  const institution   = data.institution || { days_per_week: 5, periods_per_day: 8 };
  const daysPerWeek   = institution.days_per_week   || 5;
  const periodsPerDay = institution.periods_per_day || 8;

  const institutionData = buildInstitutionData(data);

  data.curriculumMap = {};
  for (const e of (data.curriculum || [])) {
    if (!data.curriculumMap[e.class_id]) data.curriculumMap[e.class_id] = [];
    data.curriculumMap[e.class_id].push({ subject_id: e.subject_id, teacher_id: e.teacher_id, min_per_week: e.min_per_week || 1 });
  }
  data.subjectRoomTypeMap = {};
  for (const s of (data.subjects || [])) data.subjectRoomTypeMap[s.id] = s.requires_room_type || 'classroom';

  const roomsByType = buildRoomsByType(data);

  let population = new Array(population_size);
  for (let i = 0; i < population_size; i++) {
    population[i] = createChromosome(data, institution, rng, roomsByType);
  }

  let bestChromosome = null, bestFitness = -1, bestIsValid = false;
  let bestViolations = {}, bestGeneration = 0, firstValidGeneration = -1;
  let stagnationCount = 0, currentMutationRate = mutation_rate;
  let boostLevel = 0;
  const generationLog = [];

  const fitnessScores  = new Float64Array(population_size);
  const fitnessResults = new Array(population_size);

  for (let gen = 0; gen < max_generations; gen++) {
    let genBest = -1, genBestIdx = 0, sum = 0, worst = Infinity;

    for (let i = 0; i < population_size; i++) {
      const r = calculateFitness(population[i], institutionData);
      fitnessResults[i] = r;
      fitnessScores[i]  = r.score;
      if (r.score > genBest) { genBest = r.score; genBestIdx = i; }
      if (r.score < worst)   worst = r.score;
      sum += r.score;
    }
    const mean = sum / population_size;

    if (genBest > bestFitness) {
      bestFitness    = genBest;
      bestChromosome = population[genBestIdx].map(g => ({...g}));
      bestIsValid    = fitnessResults[genBestIdx].isValid;
      bestViolations = fitnessResults[genBestIdx].violations;
      bestGeneration = gen;
      stagnationCount     = 0;
      currentMutationRate = mutation_rate;
      boostLevel          = 0;
    } else {
      stagnationCount++;
    }

    if (firstValidGeneration === -1 && fitnessResults[genBestIdx].isValid) firstValidGeneration = gen;

    generationLog.push({
      generation: gen,
      best: Math.round(genBest),
      allTimeBest: Math.round(bestFitness),
      mean: Math.round(mean),
      worst: Math.round(worst),
    });

    // Send progress every 2 generations for smoother live chart updates
    if (progressCallback && gen % 2 === 0) {
      progressCallback({
        generation: gen, bestFitness, genBestFitness: genBest, meanFitness: mean, worstFitness: worst,
        totalGenerations: max_generations, progress: Math.round((gen / max_generations) * 100),
        isValid: bestIsValid, violations: bestViolations, generationLog,
      });
    }

    if (bestFitness >= target_fitness) break;

    // ── STAGNATION HANDLING ────────────────────────────────────────
    if (stagnationCount > 0 && stagnationCount % stagnation_window === 0) {
      boostLevel++;
      if (boostLevel === 1) {
        currentMutationRate = stagnation_mutation_boost;
      } else if (boostLevel === 2) {
        currentMutationRate = Math.min(stagnation_mutation_boost * 1.5, 0.25);
      } else {
        // Inject fresh chromosomes into bottom 30% of population
        currentMutationRate = Math.min(stagnation_mutation_boost * 2, 0.35);
        const injectionCount = Math.floor(population_size * 0.30);
        const sortedIdx = Array.from({length: population_size}, (_, i) => i)
          .sort((a, b) => fitnessScores[a] - fitnessScores[b]);  // worst first
        for (let k = 0; k < injectionCount; k++) {
          population[sortedIdx[k]] = createChromosome(data, institution, rng, roomsByType);
        }
        boostLevel = 1;  // reset boost level after injection
      }
    }
    // ──────────────────────────────────────────────────────────────

    // Build next generation
    const next = new Array(population_size);
    let ni = 0;

    // Elitism: always carry over top-E solutions unchanged
    for (const ei of topN(Array.from(fitnessScores), Math.min(elitism_count, population_size))) {
      next[ni++] = population[ei].map(g => ({...g}));
    }

    while (ni < population_size) {
      const [p1, p2] = tournamentSelection(population, fitnessScores, tournament_size, rng);
      let c1, c2;

      if (rng() < crossover_rate) {
        if (boostLevel <= 1) {
          [c1, c2] = classBlockCrossover(p1, p2, rng);
        } else {
          [c1, c2] = rng() < 0.6
            ? classBlockCrossover(p1, p2, rng)
            : dayBlockCrossover(p1, p2, daysPerWeek, rng);
        }
      } else {
        c1 = p1.map(g => ({...g}));
        c2 = p2.map(g => ({...g}));
      }

      c1 = applyMutation(c1, currentMutationRate, daysPerWeek, periodsPerDay, roomsByType, rng);
      c2 = applyMutation(c2, currentMutationRate, daysPerWeek, periodsPerDay, roomsByType, rng);
      next[ni++] = c1;
      if (ni < population_size) next[ni++] = c2;
    }

    population = next;
    // Yield to event loop every 3 generations for responsiveness
    if (gen % 3 === 0) await new Promise(r => setImmediate(r));
  }

  // Send final progress
  if (progressCallback) {
    progressCallback({
      generation: generationLog.length - 1, bestFitness,
      genBestFitness: bestFitness, meanFitness: bestFitness,
      worstFitness: 0,
      totalGenerations: max_generations, progress: 100,
      isValid: bestIsValid, violations: bestViolations, generationLog,
    });
  }

  if (!bestChromosome || !bestChromosome.length) {
    bestChromosome = (population[0] || []).map(g => ({...g}));
  }

  const cleanedChromosome = bestChromosome
    .filter(g => g)
    .map(g => ({
      class_id:   g.class_id   ?? null,
      subject_id: g.subject_id ?? null,
      teacher_id: g.teacher_id ?? null,
      room_id:    g.room_id    ?? null,
      day:        g.day        ?? 1,
      period:     g.period     ?? 1,
    }));

  const finalResult = calculateFitness(cleanedChromosome, institutionData);
  return {
    chromosome: cleanedChromosome,
    fitness: finalResult.score,
    isValid: finalResult.isValid,
    violations: finalResult.violations,
    bestGeneration,
    firstValidGeneration,
    generationLog,
    institution,
  };
}

module.exports = { evolve, buildInstitutionData, createChromosome };


