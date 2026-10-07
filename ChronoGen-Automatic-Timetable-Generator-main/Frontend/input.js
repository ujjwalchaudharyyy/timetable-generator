// input.js — Input Data page scripts


// Toast Notification
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const icon  = document.getElementById('toastIcon');
  const msg   = document.getElementById('toastMsg');

  icon.className = type === 'success'
    ? 'ri-checkbox-circle-fill text-emerald-400 text-lg'
    : 'ri-error-warning-fill text-red-400 text-lg';

  msg.textContent    = message;
  toast.className    = toast.className.replace('hidden', '').trim();
  toast.style.display = 'flex';

  setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

// Tab Switching
function switchTab(name) {
  // Hide all panes
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
  // Reset all tab buttons
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.remove('bg-gray-800', 'text-white');
    b.classList.add('text-gray-400');
  });

  // Show selected pane
  document.getElementById('pane-' + name).classList.remove('hidden');
  // Highlight selected tab button
  const btn = document.getElementById('tab-' + name);
  btn.classList.add('bg-gray-800', 'text-white');
  btn.classList.remove('text-gray-400');

  // Load data if switching to review
  if (name === 'review') loadReview();
}

// API Helper
async function post(url, body) {
  const res  = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function syncDashboardStats() {
  try {
    const res = await fetch('/api/upload/data');
    const data = await res.json();
    localStorage.setItem('tt_classes', String(data.classes?.length || 0));
    localStorage.setItem('tt_teachers', String(data.teachers?.length || 0));
    localStorage.setItem('tt_rooms', String(data.rooms?.length || 0));
  } catch (err) {
    console.warn('Could not sync dashboard counts:', err.message);
  }

  try {
    const res = await fetch('/api/generate/timetable?session=latest');
    const data = await res.json();
    const fitness = data.genes && data.genes.length > 0 && data.genes[0].fitness_score != null
      ? Math.round(data.genes[0].fitness_score).toLocaleString()
      : '—';
    localStorage.setItem('tt_fitness', fitness);
  } catch (err) {
    localStorage.setItem('tt_fitness', '—');
  }
}

// Institution Settings
async function loadInstitutionSettings() {
  try {
    const res  = await fetch('/api/upload/institution');
    const data = await res.json();
    if (data.name)                    document.getElementById('inst-name').value     = data.name;
    if (data.days_per_week)           document.getElementById('inst-days').value     = data.days_per_week;
    if (data.periods_per_day)         document.getElementById('inst-periods').value  = data.periods_per_day;
    if (data.period_duration_minutes) document.getElementById('inst-duration').value = data.period_duration_minutes;
    if (data.lunch_break_after_period !== undefined) document.getElementById('inst-lunch').value = data.lunch_break_after_period;
  } catch (err) {
    console.warn('Could not load institution settings');
  }
}

async function saveInstitution() {
  const result = await post('/api/upload/institution', {
    name:                     document.getElementById('inst-name').value,
    days_per_week:            document.getElementById('inst-days').value,
    periods_per_day:          document.getElementById('inst-periods').value,
    period_duration_minutes:  document.getElementById('inst-duration').value,
    lunch_break_after_period: document.getElementById('inst-lunch').value,
  });
  if (result.success) {
    showToast(result.message);
    syncDashboardStats();
  }
  else showToast(result.error, 'error');
}

// Add Teacher
async function addTeacher() {
  const result = await post('/api/upload/teacher', {
    id:                      document.getElementById('t-id').value.trim(),
    name:                    document.getElementById('t-name').value.trim(),
    max_lectures_per_week:   document.getElementById('t-max').value,
    max_consecutive_lectures: document.getElementById('t-consec').value,
    prefers_morning:         document.getElementById('t-morning').checked,
    subjects:                document.getElementById('t-subjects').value.trim(),
  });
  if (result.success) {
    showToast(result.message);
    // Clear form
    ['t-id', 't-name', 't-subjects'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('t-morning').checked = false;
    loadList('teachers', 't-list', 't-count', 't-empty', renderTeacher);
    syncDashboardStats();
  } else {
    showToast(result.error, 'error');
  }
}

// Add Room 
async function addRoom() {
  const result = await post('/api/upload/room', {
    id:       document.getElementById('r-id').value.trim(),
    name:     document.getElementById('r-name').value.trim(),
    capacity: document.getElementById('r-cap').value,
    type:     document.getElementById('r-type').value,
  });
  if (result.success) {
    showToast(result.message);
    ['r-id', 'r-name'].forEach(id => document.getElementById(id).value = '');
    loadList('rooms', 'r-list', 'r-count', 'r-empty', renderRoom);
    syncDashboardStats();
  } else {
    showToast(result.error, 'error');
  }
}

// Add Subject
async function addSubject() {
  const result = await post('/api/upload/subject', {
    id:                   document.getElementById('s-id').value.trim(),
    name:                 document.getElementById('s-name').value.trim(),
    min_lectures_per_week: document.getElementById('s-min').value,
    requires_room_type:   document.getElementById('s-room').value,
  });
  if (result.success) {
    showToast(result.message);
    ['s-id', 's-name'].forEach(id => document.getElementById(id).value = '');
    loadList('subjects', 's-list', 's-count', 's-empty', renderSubject);
    syncDashboardStats();
  } else {
    showToast(result.error, 'error');
  }
}

// Add Class
async function addClass() {
  const result = await post('/api/upload/class', {
    id:            document.getElementById('c-id').value.trim(),
    name:          document.getElementById('c-name').value.trim(),
    student_count: document.getElementById('c-count').value,
  });
  if (result.success) {
    showToast(result.message);
    ['c-id', 'c-name'].forEach(id => document.getElementById(id).value = '');
    loadList('classes', 'c-list', 'c-count-label', 'c-empty', renderClass);
    syncDashboardStats();
  } else {
    showToast(result.error, 'error');
  }
}

// Add Curriculum Entry
async function addCurriculum() {
  const result = await post('/api/upload/curriculum-entry', {
    class_id:    document.getElementById('cur-class').value.trim(),
    subject_id:  document.getElementById('cur-subject').value.trim(),
    teacher_id:  document.getElementById('cur-teacher').value.trim(),
    min_per_week: document.getElementById('cur-min').value,
  });
  if (result.success) {
    showToast(result.message);
    ['cur-class', 'cur-subject', 'cur-teacher'].forEach(id => document.getElementById(id).value = '');
    loadCurriculumList();
    syncDashboardStats();
  } else {
    showToast(result.error, 'error');
  }
}

//  Upload CSV 
async function uploadCSV(type, inputId) {
  const fileInput = document.getElementById(inputId);
  if (!fileInput.files || fileInput.files.length === 0) {
    return showToast('Please choose a CSV file first.', 'error');
  }
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  try {
    const res    = await fetch('/api/upload/' + type, { method: 'POST', body: formData });
    const result = await res.json();
    if (result.success) {
      showToast(result.message);
      fileInput.value = '';
      refreshCurrentTab();
      syncDashboardStats();
    } else {
      showToast(result.error, 'error');
    }
  } catch (err) {
    showToast('Upload failed: ' + err.message, 'error');
  }
}

//  Load Demo Data 
async function loadDemo() {
  showToast('Loading demo data...');
  try {
    const res    = await fetch('/api/upload/demo', { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      showToast(result.message);
      refreshCurrentTab();
      syncDashboardStats();
    } else {
      showToast(result.error, 'error');
    }
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

//  Clear All Data
async function clearAll() {
  if (!confirm('Are you sure? This will delete ALL data including any generated timetables.')) return;
  try {
    const res    = await fetch('/api/upload/clear', { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      showToast(result.message);
      refreshAllTabs(); // reload every tab so cleared data disappears instantly
      syncDashboardStats();
    } else {
      showToast(result.error, 'error');
    }
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

// Refresh ALL tabs at once — used after clear so every list empties immediately
function refreshAllTabs() {
  loadList('teachers',  't-list',  't-count',       't-empty',   renderTeacher);
  loadList('rooms',     'r-list',  'r-count',       'r-empty',   renderRoom);
  loadList('subjects',  's-list',  's-count',       's-empty',   renderSubject);
  loadList('classes',   'c-list',  'c-count-label', 'c-empty',   renderClass);
  loadCurriculumList();
  loadReview();
}

// List Loaders

// Generic list loader: fetches /api/upload/data and renders a section
async function loadList(key, listId, countId, emptyId, renderFn) {
  try {
    const res  = await fetch('/api/upload/data');
    const data = await res.json();
    const items = data[key] || [];

    const list  = document.getElementById(listId);
    const empty = document.getElementById(emptyId);
    const count = document.getElementById(countId);

    if (count) count.textContent = items.length ? `(${items.length})` : '';

    if (items.length === 0) {
      list.innerHTML = '';
      if (empty) empty.style.display = 'block';
    } else {
      if (empty) empty.style.display = 'none';
      list.innerHTML = items.map(renderFn).join('');
    }
  } catch (err) {
    console.error('loadList error:', err);
  }
}

async function loadCurriculumList() {
  try {
    const res  = await fetch('/api/upload/data');
    const data = await res.json();
    const items = data.curriculum || [];

    const list  = document.getElementById('cur-list');
    const empty = document.getElementById('cur-empty');
    const count = document.getElementById('cur-count');

    if (count) count.textContent = items.length ? `(${items.length})` : '';

    if (items.length === 0) {
      list.innerHTML = '';
      if (empty) empty.style.display = 'block';
    } else {
      if (empty) empty.style.display = 'none';
      list.innerHTML = items.map(entry =>
        `<div class="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2 text-sm">
          <span class="font-mono text-brand-400">${entry.class_id}</span>
          <span class="text-gray-500">→</span>
          <span class="text-emerald-400">${entry.subject_id}</span>
          <span class="text-gray-500">→</span>
          <span class="text-sky-400">${entry.teacher_id}</span>
          <span class="ml-auto text-gray-500">${entry.min_per_week}×/wk</span>
        </div>`
      ).join('');
    }
  } catch (err) {
    console.error('loadCurriculumList error:', err);
  }
}

// Render helpers
function renderTeacher(t) {
  return `<div class="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2 text-sm">
    <span class="font-mono text-brand-400 w-8">${t.id}</span>
    <span class="text-gray-200 flex-1">${t.name}</span>
    <span class="text-gray-500 text-xs">${t.max_lectures_per_week} lec/wk</span>
    ${t.prefers_morning ? '<span class="text-amber-400 text-xs">🌅 morning</span>' : ''}
  </div>`;
}

function renderRoom(r) {
  const typeColor = { classroom: 'text-sky-400', lab: 'text-emerald-400', gym: 'text-orange-400', lecture_hall: 'text-purple-400', seminar_room: 'text-pink-400' };
  return `<div class="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2 text-sm">
    <span class="font-mono text-brand-400 w-12">${r.id}</span>
    <span class="text-gray-200 flex-1">${r.name}</span>
    <span class="${typeColor[r.type] || 'text-gray-400'} text-xs">${r.type}</span>
    <span class="text-gray-500 text-xs">cap ${r.capacity}</span>
  </div>`;
}

function renderSubject(s) {
  return `<div class="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2 text-sm">
    <span class="font-mono text-brand-400 w-14">${s.id}</span>
    <span class="text-gray-200 flex-1">${s.name}</span>
    <span class="text-gray-500 text-xs">${s.requires_room_type}</span>
    <span class="text-gray-500 text-xs">${s.min_lectures_per_week}×/wk</span>
  </div>`;
}

function renderClass(c) {
  return `<div class="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2 text-sm">
    <span class="font-mono text-brand-400 w-14">${c.id}</span>
    <span class="text-gray-200 flex-1">${c.name}</span>
    <span class="text-gray-500 text-xs">${c.student_count} students</span>
  </div>`;
}

//  Review Tab 
async function loadReview() {
  try {
    const res  = await fetch('/api/upload/data');
    const data = await res.json();

    document.getElementById('rev-teachers').textContent = data.teachers?.length || 0;
    document.getElementById('rev-rooms').textContent    = data.rooms?.length    || 0;
    document.getElementById('rev-subjects').textContent = data.subjects?.length || 0;
    document.getElementById('rev-classes').textContent  = data.classes?.length  || 0;

    // Build a readable summary
    let html = '';

    if (data.classes && data.classes.length > 0) {
      html += '<p class="font-medium text-gray-300 mb-2">Classes & Curriculum:</p>';
      html += '<div class="space-y-1">';
      for (const cls of data.classes) {
        const entries = (data.curriculum || []).filter(e => e.class_id === cls.id);
        const totalLectures = entries.reduce((sum, e) => sum + (e.min_per_week || 1), 0);
        html += `<div class="bg-gray-800 rounded-lg px-3 py-2 text-xs text-gray-400">
          <span class="text-brand-400 font-medium">${cls.name}</span> — 
          ${entries.length} subjects, ${totalLectures} lectures/week, ${cls.student_count} students
        </div>`;
      }
      html += '</div>';
    } else {
      html = '<p class="text-gray-600">No data loaded yet. Click "Load Demo Data" to get started.</p>';
    }

    if (data.teacherUnavailable && data.teacherUnavailable.length > 0) {
      html += `<p class="font-medium text-gray-300 mt-4 mb-2">Teacher Unavailability: ${data.teacherUnavailable.length} entries</p>`;
    }

    document.getElementById('rev-details').innerHTML = html;
  } catch (err) {
    document.getElementById('rev-details').textContent = 'Error loading data: ' + err.message;
  }
}

// Refresh which tab list is currently visible
function refreshCurrentTab() {
  const active = document.querySelector('.tab-pane:not(.hidden)');
  if (!active) return;
  const id = active.id;
  if (id === 'pane-teachers')   loadList('teachers', 't-list', 't-count', 't-empty', renderTeacher);
  if (id === 'pane-rooms')      loadList('rooms', 'r-list', 'r-count', 'r-empty', renderRoom);
  if (id === 'pane-subjects')   loadList('subjects', 's-list', 's-count', 's-empty', renderSubject);
  if (id === 'pane-classes')    loadList('classes', 'c-list', 'c-count-label', 'c-empty', renderClass);
  if (id === 'pane-curriculum') loadCurriculumList();
  if (id === 'pane-review')     loadReview();
}

// Initialise
loadInstitutionSettings();
loadList('teachers',  't-list',  't-count',       't-empty',   renderTeacher);
loadList('rooms',     'r-list',  'r-count',        'r-empty',   renderRoom);
loadList('subjects',  's-list',  's-count',        's-empty',   renderSubject);
loadList('classes',   'c-list',  'c-count-label',  'c-empty',   renderClass);
loadCurriculumList();
syncDashboardStats();
