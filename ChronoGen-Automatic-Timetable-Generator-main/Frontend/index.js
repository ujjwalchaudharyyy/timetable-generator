// index.js --> Dashboard page scripts

// ─────────────────────────────────────────────
// SNOWFALL
// ─────────────────────────────────────────────
function initSnowfall() {
  const canvas = document.getElementById('snowCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const FLAKE_COUNT = 120;
  const flakes = Array.from({ length: FLAKE_COUNT }, () => ({
    x:       Math.random() * window.innerWidth,
    y:       Math.random() * window.innerHeight,
    r:       Math.random() * 3 + 1,
    speed:   Math.random() * 1.2 + 0.4,
    drift:   (Math.random() - 0.5) * 0.4,
    opacity: Math.random() * 0.5 + 0.2,
  }));

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';

    for (const f of flakes) {
      ctx.globalAlpha = f.opacity;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();

      f.y += f.speed;
      f.x += f.drift;

      if (f.y > canvas.height + 10) { f.y = -10; f.x = Math.random() * canvas.width; }
      if (f.x > canvas.width + 10)  f.x = -10;
      if (f.x < -10)                f.x = canvas.width + 10;
    }

    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  draw();
}

// ─────────────────────────────────────────────
// SCROLL-TO-TOP BUTTON (only if element exists)
// ─────────────────────────────────────────────
function initScrollTop() {
  const btn = document.getElementById('scrollTopBtn');
  if (!btn) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) {
      btn.classList.remove('hidden');
      btn.classList.add('flex');
    } else {
      btn.classList.add('hidden');
      btn.classList.remove('flex');
    }
  });

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ─────────────────────────────────────────────
// DASHBOARD STATS
// ─────────────────────────────────────────────
async function loadStats() {

  // Load class / teacher / room counts
  try {
    const res  = await fetch('/api/upload/data');
    const data = await res.json();
    document.getElementById('statClasses').textContent  = data.classes?.length  || '—';
    document.getElementById('statTeachers').textContent = data.teachers?.length || '—';
    document.getElementById('statRooms').textContent    = data.rooms?.length    || '—';
  } catch (err) {
    console.warn('Could not load stats:', err.message);
  }

  // Last fitness score — fetched from the saved 'latest' timetable in DB.
  // Shows the real score from the last completed run, or '—' if none yet.
  const fitnessEl = document.getElementById('statFitness');
  try {
    const res  = await fetch('/api/generate/timetable?session=latest');
    const data = await res.json();
    if (data.genes && data.genes.length > 0 && data.genes[0].fitness_score != null) {
      fitnessEl.textContent = Math.round(data.genes[0].fitness_score).toLocaleString();
    } else {
      fitnessEl.textContent = '—';
    }
  } catch (err) {
    fitnessEl.textContent = '—';
  }
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSnowfall();
  initScrollTop();
  loadStats();
});