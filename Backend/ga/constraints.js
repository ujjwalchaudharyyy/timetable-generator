// constraints.js — Constraint checks with graduated penalties for smooth GA convergence

const PENALTY = {
  H1:  200, H2:  200, H3:  200, H4:  200, H5:  200,
  H6:  100, HU:  150,
  S1:   10,  // missing lectures — kept firm
  S2:    5,  // teacher over max (soft)
  S3:    3,  // teacher consecutive
  S4:    2,  // same subject twice in a day
  S5:    4,  // class gap (boosted — compact days)
  S6:    1,  // teacher gap
  S7:    8,  // wrong room type
  S8:    2,  // morning-pref teacher in afternoon
  S9:    5,  // lecture in second half when first half free (boosted)
};

function buildIndexes(chromosome) {
  const teacherSchedule = {};
  const roomSchedule    = {};
  const classSchedule   = {};
  for (const gene of chromosome) {
    if (!gene) continue;
    if (!teacherSchedule[gene.teacher_id]) teacherSchedule[gene.teacher_id] = [];
    if (!roomSchedule[gene.room_id])       roomSchedule[gene.room_id]       = [];
    if (!classSchedule[gene.class_id])     classSchedule[gene.class_id]     = [];
    teacherSchedule[gene.teacher_id].push({ day: gene.day, period: gene.period, class_id: gene.class_id, subject_id: gene.subject_id });
    roomSchedule[gene.room_id].push({ day: gene.day, period: gene.period, class_id: gene.class_id });
    classSchedule[gene.class_id].push({ day: gene.day, period: gene.period, subject_id: gene.subject_id, teacher_id: gene.teacher_id, room_id: gene.room_id });
  }
  return { teacherSchedule, roomSchedule, classSchedule };
}

function checkH1(teacherSchedule) {
  let c = 0;
  for (const slots of Object.values(teacherSchedule)) {
    const seen = new Set();
    for (const s of slots) { const k=`${s.day}-${s.period}`; if(seen.has(k))c++; else seen.add(k); }
  }
  return c;
}
function checkH2(classSchedule) {
  let c = 0;
  for (const slots of Object.values(classSchedule)) {
    const m = {};
    for (const s of slots) { const k=`${s.day}-${s.period}`; if(!m[k])m[k]=[]; m[k].push(s.subject_id); }
    for (const subjs of Object.values(m)) {
      const cnt = {}; for(const s of subjs)cnt[s]=(cnt[s]||0)+1;
      for(const n of Object.values(cnt)) if(n>1)c+=n-1;
    }
  }
  return c;
}
function checkH3(roomSchedule) {
  let c = 0;
  for (const slots of Object.values(roomSchedule)) {
    const seen = new Set();
    for (const s of slots) { const k=`${s.day}-${s.period}`; if(seen.has(k))c++; else seen.add(k); }
  }
  return c;
}
function checkH4(classSchedule) {
  let c = 0;
  for (const slots of Object.values(classSchedule)) {
    const m = {};
    for (const s of slots) { const k=`${s.day}-${s.period}`; if(!m[k])m[k]=new Set(); m[k].add(s.subject_id); }
    for (const ss of Object.values(m)) if(ss.size>1) c+=ss.size-1;
  }
  return c;
}
function checkH5(chromosome, teacherSubjectMap) {
  let c = 0;
  for (const g of chromosome) {
    if (!g) continue;
    const a = teacherSubjectMap[g.teacher_id] || [];
    if (!a.includes(g.subject_id)) c++;
  }
  return c;
}
function checkH6(chromosome, classStudentCount, roomCapacity) {
  let c = 0;
  for (const g of chromosome) {
    if (!g) continue;
    if ((classStudentCount[g.class_id]||0) > (roomCapacity[g.room_id]||999)) c++;
  }
  return c;
}
function checkHU(chromosome, unavailableMap) {
  let c = 0;
  for (const g of chromosome) {
    if (!g) continue;
    const u = unavailableMap[g.teacher_id];
    if (u && u.has(`${g.day}-${g.period}`)) c++;
  }
  return c;
}
function checkS1(classSchedule, curriculum) {
  let c = 0;
  for (const [cid, slots] of Object.entries(classSchedule)) {
    const cnt = {};
    for (const s of slots) cnt[s.subject_id]=(cnt[s.subject_id]||0)+1;
    for (const e of (curriculum[cid]||[])) {
      const actual = cnt[e.subject_id]||0;
      if (actual<e.min_per_week) c+=e.min_per_week-actual;
    }
  }
  return c;
}
function checkS2(teacherSchedule, teacherMaxLectures) {
  let c = 0;
  for (const [tid, slots] of Object.entries(teacherSchedule)) {
    const max = teacherMaxLectures[tid]||20;
    if (slots.length>max) c+=slots.length-max;
  }
  return c;
}
function checkS3(teacherSchedule, teacherMaxConsecutive) {
  let c = 0;
  for (const [tid, slots] of Object.entries(teacherSchedule)) {
    const mc = teacherMaxConsecutive[tid]||3;
    const byDay = {};
    for (const s of slots) { if(!byDay[s.day])byDay[s.day]=[]; byDay[s.day].push(s.period); }
    for (const p of Object.values(byDay)) {
      p.sort((a,b)=>a-b);
      let run=1;
      for(let i=1;i<p.length;i++){if(p[i]===p[i-1]+1){run++;if(run>mc)c++;}else run=1;}
    }
  }
  return c;
}
function checkS4(classSchedule) {
  let c = 0;
  for (const slots of Object.values(classSchedule)) {
    const byDay = {};
    for (const s of slots) { if(!byDay[s.day])byDay[s.day]={}; byDay[s.day][s.subject_id]=(byDay[s.day][s.subject_id]||0)+1; }
    for (const d of Object.values(byDay)) for(const n of Object.values(d)) if(n>1)c+=n-1;
  }
  return c;
}

// S5: gap in a class's day — heavily penalised to force compact schedules
function checkS5(classSchedule) {
  let c = 0;
  for (const slots of Object.values(classSchedule)) {
    const byDay = {};
    for (const s of slots) { if(!byDay[s.day])byDay[s.day]=new Set(); byDay[s.day].add(s.period); }
    for (const occ of Object.values(byDay)) {
      const p=[...occ].sort((a,b)=>a-b);
      if(p.length<2) continue;
      // gaps = (last - first + 1) - length
      c += (p[p.length-1] - p[0] + 1) - p.length;
    }
  }
  return c;
}

function checkS6(teacherSchedule) {
  let c = 0;
  for (const slots of Object.values(teacherSchedule)) {
    const byDay = {};
    for (const s of slots) { if(!byDay[s.day])byDay[s.day]=new Set(); byDay[s.day].add(s.period); }
    for (const occ of Object.values(byDay)) {
      const p=[...occ].sort((a,b)=>a-b);
      if(p.length<2) continue;
      c += (p[p.length-1]-p[0]+1) - p.length;
    }
  }
  return c;
}
function checkS7(chromosome, subjectRoomType, roomTypeMap) {
  let c = 0;
  for (const g of chromosome) {
    if(!g) continue;
    const req=subjectRoomType[g.subject_id], act=roomTypeMap[g.room_id];
    if(req&&act&&req!==act) c++;
  }
  return c;
}
function checkS8(chromosome, teacherPrefersMorning, periodsPerDay) {
  let c = 0;
  const as = Math.floor(periodsPerDay/2)+1;
  for (const g of chromosome) {
    if(!g) continue;
    if(teacherPrefersMorning[g.teacher_id]&&g.period>=as) c++;
  }
  return c;
}

// S9: class has lectures in second half when first-half slots still free
// Boosted penalty to strongly prefer compact morning-anchored schedules
function checkS9(classSchedule, periodsPerDay) {
  let c = 0;
  const mid = Math.ceil(periodsPerDay/2);
  for (const slots of Object.values(classSchedule)) {
    const byDay = {};
    for (const s of slots) { if(!byDay[s.day])byDay[s.day]=new Set(); byDay[s.day].add(s.period); }
    for (const occ of Object.values(byDay)) {
      const arr=[...occ];
      const fh=arr.filter(p=>p<=mid).length;
      const sh=arr.filter(p=>p>mid).length;
      const free=mid-fh;
      if(sh>0&&free>0) c+=Math.min(sh,free);
    }
  }
  return c;
}

function evaluateConstraints(chromosome, institutionData) {
  const { teacherSchedule, roomSchedule, classSchedule } = buildIndexes(chromosome);
  const {
    teacherSubjectMap, classStudentCount, roomCapacity, curriculum,
    teacherMaxLectures, teacherMaxConsecutive, subjectRoomType, roomTypeMap,
    unavailableMap, teacherPrefersMorning, periodsPerDay,
  } = institutionData;

  const violations = {
    H1: checkH1(teacherSchedule),
    H2: checkH2(classSchedule),
    H3: checkH3(roomSchedule),
    H4: checkH4(classSchedule),
    H5: checkH5(chromosome, teacherSubjectMap),
    H6: checkH6(chromosome, classStudentCount, roomCapacity),
    HU: checkHU(chromosome, unavailableMap||{}),
    S1: checkS1(classSchedule, curriculum),
    S2: checkS2(teacherSchedule, teacherMaxLectures),
    S3: checkS3(teacherSchedule, teacherMaxConsecutive),
    S4: checkS4(classSchedule),
    S5: checkS5(classSchedule),
    S6: checkS6(teacherSchedule),
    S7: checkS7(chromosome, subjectRoomType, roomTypeMap||{}),
    S8: checkS8(chromosome, teacherPrefersMorning||{}, periodsPerDay||8),
    S9: checkS9(classSchedule, periodsPerDay||8),
  };

  let totalPenalty = 0;
  for (const [k,v] of Object.entries(violations)) totalPenalty += (PENALTY[k]||1)*v;
  return { violations, totalPenalty };
}

module.exports = { evaluateConstraints, buildIndexes, PENALTY };
