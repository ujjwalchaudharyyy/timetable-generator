// generate.js — ChronoGen Generate Page
// Fully rewritten: live SSE chart, stagnation markers, smooth animations, correct data flow

// ══════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════
let chart        = null;
let isRunning    = false;
let startTime    = null;
let eventSource  = null;
let timerHandle  = null;

// Full generation log — accumulated from SSE, rendered in one shot per tick
let fullLog      = [];       // [{generation, allTimeBest, best, mean, worst}]
let allTimeBest  = 0;        // tracked locally so chart never goes down
let lastRenderLen = 0;       // avoid redundant chart.update() calls
let stagnationGens = [];     // generation numbers where stagnation was detected
let firstValidGen  = -1;

const MAX_CHART_POINTS = 600;   // downsample beyond this to keep chart smooth

// ══════════════════════════════════════════════════
//  CHART INIT
// ══════════════════════════════════════════════════
function initChart() {
  const ctx = document.getElementById('fitChart').getContext('2d');

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'All-Time Best',
          data: [],
          borderColor: '#a78bfa',
          backgroundColor: (ctx) => {
            const { chart } = ctx;
            const { ctx: c, chartArea } = chart;
            if (!chartArea) return 'rgba(167,139,250,0.06)';
            const grad = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            grad.addColorStop(0,   'rgba(167,139,250,0.18)');
            grad.addColorStop(0.6, 'rgba(167,139,250,0.04)');
            grad.addColorStop(1,   'rgba(167,139,250,0)');
            return grad;
          },
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.4,
          fill: true,
          order: 1,
        },
        {
          label: 'Gen Best',
          data: [],
          borderColor: '#60a5fa',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.4,
          borderDash: [4, 3],
          order: 2,
        },
        {
          label: 'Mean',
          data: [],
          borderColor: '#34d399',
          borderWidth: 1.2,
          pointRadius: 0,
          tension: 0.4,
          borderDash: [5, 5],
          order: 3,
        },
        {
          label: 'Worst',
          data: [],
          borderColor: '#374151',
          borderWidth: 1,
          pointRadius: 0,
          tension: 0.3,
          order: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Smooth progressive animation:
      //   duration:0 for x-axis extension (new points appear instantly)
      //   The overall curve is smooth because tension:0.4 is set on datasets
      animation: {
        duration: 300,
        easing: 'easeOutCubic',
        // Only animate on complete — not on every incremental update
        onProgress: null,
      },
      transitions: {
        active: { animation: { duration: 150 } },
      },
      transitions: {
        active: { animation: { duration: 150 } }
      },
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,20,35,0.95)',
          borderColor: 'rgba(167,139,250,0.25)',
          borderWidth: 1,
          titleColor: '#d1d5db',
          bodyColor: '#9ca3af',
          padding: 10,
          callbacks: {
            title: (items) => `Generation ${items[0].label}`,
            label: (ctx) => ` ${ctx.dataset.label}: ${Number(ctx.parsed.y).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Generation', color: '#6b7280', font: { size: 11, family: 'Inter' } },
          ticks: {
            color: '#6b7280',
            maxTicksLimit: 10,
            font: { size: 10, family: 'Inter' },
          },
          grid: { color: 'rgba(255,255,255,0.03)' },
        },
        y: {
          title: { display: true, text: 'Fitness Score', color: '#6b7280', font: { size: 11, family: 'Inter' } },
          ticks: {
            color: '#6b7280',
            font: { size: 10, family: 'Inter' },
            callback: (v) => v.toLocaleString(),
          },
          grid: { color: 'rgba(255,255,255,0.04)' },
          min: undefined,   // auto-min so small rises are visible
          max: 10000,
          suggestedMin: 5000,  // chart starts near realistic GA scores
          suggestedMax: 10000,
        },
      },
    },

    plugins: [
      // ── Stagnation vertical line markers ──────────────────────
      {
        id: 'stagnationMarkers',
        afterDraw(chart) {
          if (!stagnationGens.length) return;
          const { ctx, scales: { x, y }, data } = chart;
          const labels = data.labels;
          if (!labels || !labels.length) return;

          ctx.save();
          ctx.strokeStyle = 'rgba(251,191,36,0.35)';
          ctx.lineWidth   = 1;
          ctx.setLineDash([3, 4]);
          ctx.font = '9px Inter, sans-serif';
          ctx.fillStyle = 'rgba(251,191,36,0.5)';

          for (const gen of stagnationGens) {
            const idx = labels.findIndex(l => Number(l) >= gen);
            if (idx < 0) continue;
            const xPx = x.getPixelForValue(idx);
            ctx.beginPath();
            ctx.moveTo(xPx, y.top);
            ctx.lineTo(xPx, y.bottom);
            ctx.stroke();
          }
          ctx.restore();
        },
      },

      // ── "First valid" dot annotation ───────────────────────────
      {
        id: 'firstValidMarker',
        afterDraw(chart) {
          if (firstValidGen < 0) return;
          const { ctx, scales: { x, y }, data } = chart;
          const labels = data.labels;
          if (!labels || !labels.length) return;

          const idx = labels.findIndex(l => Number(l) >= firstValidGen);
          if (idx < 0) return;

          const xPx = x.getPixelForValue(idx);
          const ds0 = chart.data.datasets[0].data;
          const val = ds0[idx] ?? ds0[ds0.length - 1];
          if (!val) return;
          const yPx = y.getPixelForValue(val);

          ctx.save();
          // Outer glow ring
          ctx.beginPath();
          ctx.arc(xPx, yPx, 7, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(52,211,153,0.2)';
          ctx.fill();
          // Inner dot
          ctx.beginPath();
          ctx.arc(xPx, yPx, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#34d399';
          ctx.fill();
          ctx.restore();
        },
      },
    ],
  });
}

// ══════════════════════════════════════════════════
//  CHART UPDATE — called on every SSE tick
// ══════════════════════════════════════════════════
function renderChart() {
  if (!chart || !fullLog.length) return;
  if (fullLog.length === lastRenderLen) return;   // nothing new
  lastRenderLen = fullLog.length;

  let points = fullLog;

  // Downsample only when log is large — always include last point
  if (points.length > MAX_CHART_POINTS) {
    const step   = Math.ceil(points.length / MAX_CHART_POINTS);
    const sparse = points.filter((_, i) => i % step === 0);
    const last   = points[points.length - 1];
    if (sparse[sparse.length - 1] !== last) sparse.push(last);
    points = sparse;
  }

  chart.data.labels           = points.map(p => p.generation);
  chart.data.datasets[0].data = points.map(p => p.allTimeBest);
  chart.data.datasets[1].data = points.map(p => p.best);
  chart.data.datasets[2].data = points.map(p => p.mean);
  chart.data.datasets[3].data = points.map(p => p.worst);
  // Use 'none' during live updates (fast, no re-animation of existing points)
  // The rising curve effect comes from increasing data values, not animation
  chart.update('none');
}

// ══════════════════════════════════════════════════
//  START GA
// ══════════════════════════════════════════════════
async function startGA() {
  if (isRunning) return;

  const config = {
    population_size: +document.getElementById('cfg-pop').value   || 100,
    max_generations: +document.getElementById('cfg-gen').value   || 300,
    crossover_rate:  +document.getElementById('cfg-cross').value || 0.85,
    mutation_rate:   +document.getElementById('cfg-mut').value   || 0.02,
    tournament_size: +document.getElementById('cfg-tour').value  || 5,
    elitism_count:   +document.getElementById('cfg-elite').value || 2,
    random_seed:     +document.getElementById('cfg-seed').value  || 42,
  };

  resetUI();
  isRunning  = true;
  startTime  = Date.now();
  setStatus('running', 'Initialising population…');
  setButtons(true);

  // Elapsed timer — updates independently of SSE
  timerHandle = setInterval(() => {
    if (startTime) {
      const sec = Math.round((Date.now() - startTime) / 1000);
      document.getElementById('timeLabel').textContent = sec + 's elapsed';
    }
  }, 1000);

  try {
    const res    = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const result = await res.json();

    if (!result.success) {
      const msg = result.validationErrors?.length
        ? result.validationErrors.join(' | ')
        : result.error || 'Could not start GA.';
      finishWithError(msg);
      return;
    }

    connectSSE(result.sessionId);
  } catch (err) {
    finishWithError('Server error: ' + err.message);
  }
}

// ══════════════════════════════════════════════════
//  SSE CONNECTION
// ══════════════════════════════════════════════════
function connectSSE(sessionId) {
  // Guard: close any lingering connection
  if (eventSource) { try { eventSource.close(); } catch(_){} }

  eventSource = new EventSource('/api/generate/progress/' + sessionId);

  eventSource.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch(_) { return; }

    if      (msg.type === 'progress') onProgress(msg);
    else if (msg.type === 'complete') onComplete(msg);
    else if (msg.type === 'error')    finishWithError(msg.message);
  };

  eventSource.onerror = (e) => {
    // Only error out if we're still supposed to be running
    if (isRunning) {
      finishWithError('Connection to server lost. The result may still be processing.');
    }
    try { eventSource.close(); } catch(_) {}
  };
}

// ══════════════════════════════════════════════════
//  PROGRESS HANDLER
// ══════════════════════════════════════════════════
function onProgress(msg) {
  // Server sends a downsampled snapshot of all generations so far.
  // We replace fullLog with this snapshot — it always grows in length,
  // so the chart shows a rightward-extending rising curve naturally.
  // We overwrite rather than append to avoid duplicates, since the server sends
  // the entire accumulated log in each progress event.
  if (msg.generationLog && msg.generationLog.length > 0) {
    // Server log may have allTimeBest already clamped — trust it.
    // But also ensure monotonic all-time-best in case of any server quirk.
    let runningBest = 0;
    fullLog = msg.generationLog.map(entry => {
      runningBest = Math.max(runningBest, entry.best ?? 0, entry.allTimeBest ?? 0);
      return {
        generation:  entry.generation,
        allTimeBest: runningBest,
        best:        entry.best  ?? 0,
        mean:        entry.mean  ?? 0,
        worst:       entry.worst ?? 0,
      };
    });
  }

  // ── Update local all-time best (monotonic — never goes down)
  const incoming = Math.round(msg.bestFitness ?? 0);
  if (incoming > allTimeBest) allTimeBest = incoming;

  // ── UI updates
  const pct = msg.progress ?? 0;
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressPct').textContent  = pct + '%';
  document.getElementById('genLabel').textContent     = 'Generation ' + (msg.generation ?? 0);

  animateMetric('metBest', allTimeBest);
  animateMetric('metMean', Math.round(msg.meanFitness ?? 0));

  const valid = msg.isValid ?? false;
  document.getElementById('metValid').textContent = valid ? '✅ Yes' : '❌ Not yet';
  document.getElementById('metValid').className   = valid
    ? 'text-2xl font-bold text-emerald-400 metric-num'
    : 'text-2xl font-bold text-red-400 metric-num';

  if (valid && firstValidGen < 0) {
    firstValidGen = msg.generation;
    showFirstValid(firstValidGen);
  }

  setStatus('running',
    `Gen ${msg.generation} · Best: ${allTimeBest.toLocaleString()} · ${valid ? '✅ Valid!' : 'Optimising…'}`
  );

  // ── Detect stagnation locally (all-time best flat for 40 gens)
  if (fullLog.length >= 40) {
    const cur  = fullLog[fullLog.length - 1];
    const prev = fullLog[fullLog.length - 40];
    if (cur.allTimeBest === prev.allTimeBest) {
      const g = cur.generation;
      if (!stagnationGens.includes(g) && g % 40 === 0) {
        stagnationGens.push(g);
        flashStagnation(g);
      }
    }
  }

  // ── Render chart
  renderChart();
}

// ══════════════════════════════════════════════════
//  COMPLETION HANDLER
// ══════════════════════════════════════════════════
function onComplete(msg) {
  isRunning = false;
  clearInterval(timerHandle);
  try { eventSource.close(); } catch(_) {}

  const fitness = Math.round(msg.fitness ?? 0);
  if (fitness > allTimeBest) allTimeBest = fitness;

  // Fill final log if server sends it
  if (msg.generationLog?.length > 0) {
    let runningBest = 0;
    fullLog = msg.generationLog.map(entry => {
      runningBest = Math.max(runningBest, entry.best ?? 0, entry.allTimeBest ?? 0);
      return {
        generation:  entry.generation,
        allTimeBest: runningBest,
        best:        entry.best  ?? 0,
        mean:        entry.mean  ?? 0,
        worst:       entry.worst ?? 0,
      };
    });
    lastRenderLen = 0;   // force re-render with final data
    renderChart();
  }

  document.getElementById('progressBar').style.width = '100%';
  document.getElementById('progressBar').classList.add('done');
  document.getElementById('progressPct').textContent  = '100%';
  document.getElementById('genLabel').textContent     = 'Generation ' + (msg.bestGeneration ?? '—');

  animateMetric('metBest', allTimeBest);
  const valid = msg.isValid ?? false;
  document.getElementById('metValid').textContent = valid ? '✅ Yes' : '❌ No';
  document.getElementById('metValid').className   = valid
    ? 'text-2xl font-bold text-emerald-400 metric-num'
    : 'text-2xl font-bold text-red-400 metric-num';

  if (valid) {
    setStatus('success',
      `✅ Done! Valid timetable at generation ${msg.bestGeneration}. Fitness: ${fitness.toLocaleString()} / 10,000`
    );
    document.getElementById('cardBest').classList.add('valid-glow');
  } else {
    setStatus('warn',
      `⚠️ Finished. Best fitness: ${fitness.toLocaleString()} / 10,000. Try more generations.`
    );
  }

  if ((msg.firstValidGeneration ?? -1) >= 0) {
    firstValidGen = msg.firstValidGeneration;
    showFirstValid(firstValidGen);
    renderChart();   // re-render to show dot
  }

  document.getElementById('pngBtn').disabled = false;
  if (msg.violations) showViolations(msg.violations);
  setButtons(false);
}

// ══════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════
function showFirstValid(gen) {
  const note = document.getElementById('firstValidNote');
  document.getElementById('firstValidText').textContent =
    `First fully valid timetable found at generation ${gen}`;
  note.classList.remove('hidden');
}

function flashStagnation(gen) {
  const badge = document.getElementById('stagnationBadge');
  document.getElementById('stagnationText').textContent =
    `⚡ Stagnation at gen ${gen} — boosting mutation & diversifying population`;
  badge.classList.remove('hidden');
  setTimeout(() => badge.classList.add('hidden'), 5000);
}

// Animate metric number display (simple — avoids janky transitions)
let metricValues = { metBest: 0, metMean: 0 };
function animateMetric(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = metricValues[id] || 0;
  if (current === target) return;
  metricValues[id] = target;
  el.textContent = target.toLocaleString();
}

function finishWithError(msg) {
  isRunning = false;
  clearInterval(timerHandle);
  if (eventSource) { try { eventSource.close(); } catch(_){} }
  setStatus('error', msg);
  setButtons(false);
}

// ══════════════════════════════════════════════════
//  VIOLATION PANEL
// ══════════════════════════════════════════════════
function showViolations(violations) {
  const grid = document.getElementById('violationGrid');

  const hardKeys = ['H1','H2','H3','H4','H5','H6','HU'];
  const softKeys = ['S1','S2','S3','S4','S5','S6','S7','S8','S9'];
  const descriptions = {
    H1:'Teacher double-booked', H2:'Class double-booked', H3:'Room double-booked',
    H4:'Two subjects same slot', H5:'Teacher unqualified', H6:'Room too small', HU:'Unavailable slot',
    S1:'Too few lectures', S2:'Teacher overloaded', S3:'Back-to-back excess',
    S4:'Subject repeated/day', S5:'Class gap', S6:'Teacher gap',
    S7:'Wrong room type', S8:'Pref ignored', S9:'Late when morning free',
  };

  grid.innerHTML = [...hardKeys, ...softKeys].map(key => {
    const count  = violations[key] || 0;
    const isHard = hardKeys.includes(key);
    const ok     = count === 0;
    const bg     = ok ? 'bg-gray-800/60' : (isHard ? 'bg-red-900/25' : 'bg-amber-900/20');
    const border = ok ? 'border-white/5'  : (isHard ? 'border-red-700/40' : 'border-amber-700/40');
    const numCol = ok ? 'text-emerald-400' : (isHard ? 'text-red-400' : 'text-amber-400');
    const keyCol = isHard ? 'text-red-300/80' : 'text-amber-300/80';
    return `<div class="${bg} rounded-lg p-2 text-center border ${border}" title="${descriptions[key]}">
      <div class="font-mono font-bold text-[10px] ${keyCol}">${key}</div>
      <div class="text-lg font-bold ${numCol} mt-0.5 tabular-nums">${count}</div>
      <div class="text-gray-600 text-[9px] leading-tight mt-0.5">${ok ? '✓' : descriptions[key]}</div>
    </div>`;
  }).join('');

  document.getElementById('violationPanel').classList.remove('hidden');
}

// ══════════════════════════════════════════════════
//  STOP / SAVE
// ══════════════════════════════════════════════════
function stopGA() {
  if (eventSource) { try { eventSource.close(); } catch(_){} }
  isRunning = false;
  clearInterval(timerHandle);
  setStatus('warn', 'Stopped by user. Best solution found so far has been saved.');
  setButtons(false);
  document.getElementById('pngBtn').disabled = false;
  document.getElementById('progressBar').classList.add('done');
}

function saveChartPNG() {
  const canvas = document.getElementById('fitChart');
  // Render on white bg for clean export
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width  = canvas.width;
  exportCanvas.height = canvas.height;
  const ec = exportCanvas.getContext('2d');
  ec.fillStyle = '#0f1420';
  ec.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  ec.drawImage(canvas, 0, 0);
  const link = document.createElement('a');
  link.download = 'chronogen_fitness_' + Date.now() + '.png';
  link.href     = exportCanvas.toDataURL('image/png');
  link.click();
}

// ══════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════
function resetUI() {
  // Reset chart
  fullLog      = [];
  allTimeBest  = 0;
  lastRenderLen = 0;
  stagnationGens.length = 0;
  firstValidGen = -1;
  metricValues  = { metBest: 0, metMean: 0 };

  if (chart) {
    chart.data.labels = [];
    chart.data.datasets.forEach(ds => { ds.data = []; });
    chart.update('none');
  }

  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('progressBar').classList.remove('done');
  document.getElementById('progressPct').textContent  = '0%';
  document.getElementById('genLabel').textContent     = 'Generation 0';
  document.getElementById('timeLabel').textContent    = '';
  document.getElementById('metBest').textContent      = '—';
  document.getElementById('metMean').textContent      = '—';
  document.getElementById('metValid').textContent     = '—';
  document.getElementById('metValid').className       = 'text-2xl font-bold text-sky-400 metric-num';
  document.getElementById('violationPanel').classList.add('hidden');
  document.getElementById('firstValidNote').classList.add('hidden');
  document.getElementById('stagnationBadge').classList.add('hidden');
  document.getElementById('cardBest').classList.remove('valid-glow', 'invalid-glow');
  document.getElementById('pngBtn').disabled = true;
}

function setButtons(running) {
  const startBtn = document.getElementById('startBtn');
  const stopBtn  = document.getElementById('stopBtn');
  startBtn.disabled = running;
  stopBtn.disabled  = !running;

  if (running) {
    startBtn.className = startBtn.className
      .replace('from-brand-500 to-brand-600', 'from-gray-700 to-gray-700')
      .replace('hover:from-brand-400 hover:to-brand-500', '');
    startBtn.classList.add('cursor-not-allowed', 'opacity-60');
    stopBtn.className = 'col-span-2 bg-red-900/30 text-red-300 border border-red-700/40 font-medium py-2.5 rounded-xl transition-all text-sm flex items-center justify-center gap-2 hover:bg-red-900/50 cursor-pointer';
  } else {
    startBtn.disabled = false;
    stopBtn.disabled  = true;
    startBtn.className = 'col-span-2 bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-400 hover:to-brand-500 active:scale-[0.98] text-white font-bold py-3.5 rounded-xl transition-all duration-200 text-base shadow-lg shadow-brand-500/30 flex items-center justify-center gap-2.5 border border-brand-400/20';
    stopBtn.className  = 'col-span-2 bg-gray-800/60 text-gray-500 cursor-not-allowed font-medium py-2.5 rounded-xl transition-all border border-gray-700/50 text-sm flex items-center justify-center gap-2';
  }
}

const STATUS_CFG = {
  running: { dot: 'bg-brand-400 animate-pulse pulse-ring text-brand-400', text: 'text-gray-300', bar: 'border-brand-500/20 bg-brand-500/5' },
  success: { dot: 'bg-emerald-400',  text: 'text-emerald-300', bar: 'border-emerald-500/20 bg-emerald-500/5' },
  warn:    { dot: 'bg-amber-400',    text: 'text-amber-300',   bar: 'border-amber-500/20  bg-amber-500/5'  },
  error:   { dot: 'bg-red-400',      text: 'text-red-300',     bar: 'border-red-500/20    bg-red-500/5'    },
  idle:    { dot: 'bg-gray-600',     text: 'text-gray-500',    bar: '' },
};

function setStatus(type, message) {
  const cfg  = STATUS_CFG[type] || STATUS_CFG.idle;
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const bar  = document.getElementById('statusBar');

  dot.className  = `w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot}`;
  text.className = `text-sm ${cfg.text}`;
  text.textContent = message;

  bar.className = `border rounded-xl px-4 py-3 flex items-center gap-3 transition-all duration-500 ${cfg.bar}`;
}

// ══════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════
initChart();
setStatus('idle', 'Ready to evolve. Click Start Evolution.');
