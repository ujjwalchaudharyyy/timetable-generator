// index.js — Modern Dashboard Scripts for ChronoGen
// Handles real-time telemetry, live stats, constraint tab switching, and interactive hero simulation

// ─────────────────────────────────────────────
// CONSTRAINT TABS SWITCHER
// ─────────────────────────────────────────────
function switchTab(type) {
  const tabHard = document.getElementById('tabHard');
  const tabSoft = document.getElementById('tabSoft');
  const gridHard = document.getElementById('gridHard');
  const gridSoft = document.getElementById('gridSoft');

  if (!tabHard || !tabSoft || !gridHard || !gridSoft) return;

  if (type === 'hard') {
    tabHard.classList.add('active');
    tabSoft.classList.remove('active');
    gridHard.style.display = 'grid';
    gridSoft.style.display = 'none';
  } else {
    tabSoft.classList.add('active');
    tabHard.classList.remove('active');
    gridHard.style.display = 'none';
    gridSoft.style.display = 'grid';
  }
}

// ─────────────────────────────────────────────
// ANIMATE NUMBERS UTILITY
// ─────────────────────────────────────────────
function animateValue(el, start, end, duration = 1200, suffix = '') {
  if (!el || isNaN(end)) return;
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const easeOutQuad = 1 - (1 - progress) * (1 - progress);
    const current = Math.floor(easeOutQuad * (end - start) + start);
    el.textContent = current.toLocaleString() + suffix;
    if (progress < 1) {
      window.requestAnimationFrame(step);
    } else {
      el.textContent = end.toLocaleString() + suffix;
    }
  };
  window.requestAnimationFrame(step);
}

// ─────────────────────────────────────────────
// FETCH LIVE DASHBOARD STATS
// ─────────────────────────────────────────────
async function loadStats() {
  const elClasses = document.getElementById('statClasses');
  const elTeachers = document.getElementById('statTeachers');
  const elRooms = document.getElementById('statRooms');
  const elFitness = document.getElementById('statFitness');

  try {
    const res = await fetch('/api/upload/data');
    if (res.ok) {
      const data = await res.json();
      if (elClasses && data.classes) animateValue(elClasses, 0, data.classes.length);
      if (elTeachers && data.teachers) animateValue(elTeachers, 0, data.teachers.length);
      if (elRooms && data.rooms) animateValue(elRooms, 0, data.rooms.length);
    } else {
      fallbackStats();
    }
  } catch (e) {
    fallbackStats();
  }

  try {
    const res = await fetch('/api/generate/timetable?session=latest');
    if (res.ok) {
      const data = await res.json();
      if (elFitness && data.genes && data.genes.length > 0 && data.genes[0].fitness_score != null) {
        const score = Math.round(data.genes[0].fitness_score);
        animateValue(elFitness, 5000, score);
      } else if (elFitness) {
        animateValue(elFitness, 0, 9870);
      }
    } else if (elFitness) {
      animateValue(elFitness, 0, 9870);
    }
  } catch (e) {
    if (elFitness) animateValue(elFitness, 0, 9870);
  }
}

function fallbackStats() {
  const elClasses = document.getElementById('statClasses');
  const elTeachers = document.getElementById('statTeachers');
  const elRooms = document.getElementById('statRooms');
  if (elClasses && elClasses.textContent === '—') animateValue(elClasses, 0, 3);
  if (elTeachers && elTeachers.textContent === '—') animateValue(elTeachers, 0, 6);
  if (elRooms && elRooms.textContent === '—') animateValue(elRooms, 0, 6);
}

// ─────────────────────────────────────────────
// HERO INTERACTIVE SIMULATION ENGINE
// ─────────────────────────────────────────────
function initHeroSimulator() {
  const genEl = document.getElementById('simGen');
  const fitEl = document.getElementById('simFit');
  const progressEl = document.getElementById('simProgress');
  const cells = document.querySelectorAll('.mini-cell');

  if (!genEl || !fitEl || !progressEl) return;

  let currentGen = 320;
  let currentFit = 9640;

  setInterval(() => {
    currentGen += Math.floor(Math.random() * 3) + 1;
    if (currentGen > 400) {
      currentGen = 320;
      currentFit = 9640;
    } else {
      currentFit = Math.min(9980, currentFit + Math.floor(Math.random() * 25));
    }

    genEl.textContent = `${currentGen} / 400`;
    fitEl.textContent = `${currentFit.toLocaleString()} pts`;
    progressEl.style.width = `${(currentGen / 400) * 100}%`;

    // Random slot highlight pulse
    if (cells.length > 0) {
      const randIdx = Math.floor(Math.random() * cells.length);
      cells.forEach((c, idx) => {
        if (idx === randIdx) {
          c.classList.add('active-slot');
        } else {
          c.classList.remove('active-slot');
        }
      });
    }
  }, 1800);
}

// ─────────────────────────────────────────────
// SCROLL TO TOP CONTROLLER
// ─────────────────────────────────────────────
function initScrollTop() {
  const btn = document.getElementById('scrollTopBtn');
  if (!btn) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 350) {
      btn.style.display = 'flex';
    } else {
      btn.style.display = 'none';
    }
  });

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ─────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  initHeroSimulator();
  initScrollTop();
});