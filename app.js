const STORAGE_KEY = 'deadline-doctor-tasks-v1';

/** @type {Array<{id:string,title:string,deadline:string,hours:number,priority:string,done:boolean}>} */
let tasks = loadTasks();

function loadTasks(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  }catch(e){ return []; }
}
function saveTasks(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}
function uid(){ return Math.random().toString(36).slice(2,9); }

function daysUntil(dateStr){
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d - today) / 86400000);
}

function renderTasks(){
  const list = document.getElementById('taskList');
  const countEl = document.getElementById('taskCount');
  countEl.textContent = tasks.length ? `(${tasks.length})` : '';

  if(tasks.length === 0){
    list.innerHTML = `<p class="empty-state">No tasks admitted yet. Add one on the left — that's the invitation, not the problem.</p>`;
    updatePulse();
    return;
  }

  const sorted = [...tasks].sort((a,b) => daysUntil(a.deadline) - daysUntil(b.deadline));

  list.innerHTML = sorted.map(t => {
    const d = daysUntil(t.deadline);
    const dueText = d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? 'due today' : `due in ${d}d`;
    return `
      <div class="task-card ${t.done ? 'done' : ''}" data-id="${t.id}">
        <div class="task-main">
          <span class="task-title ${t.done ? 'done' : ''}">${escapeHtml(t.title)}</span>
          <span class="task-meta">
            <span class="tag ${t.priority}">${t.priority}</span>
            <span>${t.hours}h needed</span>
            <span>${dueText}</span>
          </span>
        </div>
        <div class="task-actions">
          <button data-action="done">${t.done ? 'reopen' : 'done'}</button>
          <button data-action="delete">remove</button>
        </div>
      </div>
    `;
  }).join('');

  updatePulse();
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

document.getElementById('taskList').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if(!btn) return;
  const card = btn.closest('.task-card');
  const id = card.dataset.id;
  const task = tasks.find(t => t.id === id);
  if(!task) return;

  if(btn.dataset.action === 'done'){
    task.done = !task.done;
  }else if(btn.dataset.action === 'delete'){
    tasks = tasks.filter(t => t.id !== id);
  }
  saveTasks();
  renderTasks();
});

document.getElementById('taskForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = document.getElementById('title').value.trim();
  const deadline = document.getElementById('deadline').value;
  const hours = parseFloat(document.getElementById('hours').value);
  const priority = document.getElementById('priority').value;
  if(!title || !deadline || !hours) return;

  tasks.push({ id: uid(), title, deadline, hours, priority, done:false });
  saveTasks();
  renderTasks();
  e.target.reset();
  document.getElementById('priority').value = 'medium';
});

/* ---------- the pulse line: a visual read of how overloaded things are ---------- */
function updatePulse(){
  const path = document.getElementById('pulsePath');
  const open = tasks.filter(t => !t.done);
  if(open.length === 0){
    path.setAttribute('points', '0,30 1200,30');
    return;
  }
  // rough overload score: hours needed per day remaining, averaged & spiked per task
  let points = ['0,30'];
  const n = 24;
  for(let i=0;i<=n;i++){
    const x = (i/n)*1200;
    let spike = 0;
    open.forEach(t => {
      const d = Math.max(daysUntil(t.deadline), 0.3);
      const load = t.hours / d; // hours/day this task alone demands
      const pos = i/n;
      const center = Math.min(1, 1/(d+1));
      const dist = Math.abs(pos-center);
      spike += Math.max(0, (load*10) * (1 - dist*3));
    });
    const y = 30 - Math.min(24, spike);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  path.setAttribute('points', points.join(' '));

  const totalLoad = open.reduce((s,t) => s + t.hours / Math.max(daysUntil(t.deadline),0.3), 0);
  path.style.stroke = totalLoad > 8 ? 'var(--red)' : totalLoad > 4 ? 'var(--amber)' : 'var(--pulse)';
}

/* ---------- AI diagnosis ---------- */
document.getElementById('diagnoseBtn').addEventListener('click', async () => {
  const resultEl = document.getElementById('diagnosisResult');
  const btn = document.getElementById('diagnoseBtn');
  const dailyHours = parseFloat(document.getElementById('dailyHours').value) || 3;
  const open = tasks.filter(t => !t.done);

  if(open.length === 0){
    resultEl.innerHTML = `<p class="empty-state">Admit at least one task first.</p>`;
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Diagnosing…';
  resultEl.innerHTML = `<p class="empty-state">Reading your chart…</p>`;

  try{
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        today: new Date().toISOString().slice(0,10),
        dailyHours,
        tasks: open.map(t => ({
          title: t.title, deadline: t.deadline, hours: t.hours, priority: t.priority
        }))
      })
    });

    if(!res.ok){
      const errText = await res.text();
      throw new Error(errText || `Server responded ${res.status}`);
    }

    const data = await res.json();
    renderDiagnosis(data);
  }catch(err){
    resultEl.innerHTML = `<p class="empty-state">Diagnosis failed: ${escapeHtml(err.message)}. Check that the server has an API key configured, then try again.</p>`;
  }finally{
    btn.disabled = false;
    btn.textContent = 'Run diagnosis';
  }
});

function renderDiagnosis(data){
  const resultEl = document.getElementById('diagnosisResult');
  const verdictClass = data.verdict === 'overloaded' ? 'overloaded' : 'ok';
  const verdictLabel = data.verdict === 'overloaded' ? 'OVERLOADED' : 'MANAGEABLE';

  let html = `
    <div class="plan-verdict ${verdictClass}">
      <strong>${verdictLabel}</strong> — ${escapeHtml(data.summary || '')}
    </div>
  `;

  (data.days || []).forEach(day => {
    html += `
      <div class="plan-day">
        <div class="plan-day-label">${escapeHtml(day.label)}</div>
        <div>${escapeHtml(day.plan)}</div>
      </div>
    `;
  });

  if(data.cuts && data.cuts.length){
    html += `<div class="plan-day" style="border-left-color:var(--red)">
      <div class="plan-day-label" style="color:var(--red)">If something has to go</div>
      <div>${escapeHtml(data.cuts.join(' · '))}</div>
    </div>`;
  }

  resultEl.innerHTML = html;
}

// init
document.getElementById('deadline').min = new Date().toISOString().slice(0,10);
renderTasks();
