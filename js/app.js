import { api, DEMO } from './api.js';
import { POSITIONS, FORMATIONS, MOTION_PLAYERS } from './formations.js';
import { Game } from './game.js';
import { startPreview } from './render.js';
import { sfx } from './sfx.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let me = null;
let questionsCache = null;
let game = null;

// ---------- utilities ----------
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
function handleErr(e) {
  console.error(e);
  if (e.auth) { api.clearToken(); me = null; show('auth'); toast('Please log in again.'); return; }
  toast(e.message || 'Something went wrong.');
}
function fillPositions(sel, { includeAll = false } = {}) {
  sel.innerHTML = (includeAll ? '<option value="">All positions</option>' : '<option value="" disabled selected>Choose…</option>')
    + POSITIONS.map(p => `<option>${p}</option>`).join('');
}

const screens = ['auth', 'home', 'howto', 'game', 'results', 'film', 'leaderboard', 'admin'];
function show(name) {
  screens.forEach(s => $('#screen-' + s).classList.toggle('hidden', s !== name));
  window.scrollTo(0, 0);
  if (name !== 'film') stopFilmPreview();
}

async function go(where) {
  sfx.unlock(); sfx.click();
  try {
    if (where === 'home') return renderHome();
    if (where === 'play') return startGame();
    if (where === 'film') return startFilm();
    if (where === 'leaderboard') return renderLeaderboard();
    if (where === 'admin') return renderAdmin();
    if (where === 'howto') return show('howto');
  } catch (e) { handleErr(e); }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]');
  if (b) { e.preventDefault(); go(b.dataset.go); }
});

// ---------- auth ----------
$$('.tab').forEach(t => t.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === t));
  $('#form-login').classList.toggle('hidden', t.dataset.tab !== 'login');
  $('#form-join').classList.toggle('hidden', t.dataset.tab !== 'join');
  $('#auth-error').textContent = '';
}));
$$('.pos-select').forEach(s => fillPositions(s));
$$('.pos-select-all').forEach(s => fillPositions(s, { includeAll: true }));

$('#form-login').addEventListener('submit', async e => {
  e.preventDefault(); sfx.unlock();
  const f = new FormData(e.target);
  const btn = e.target.querySelector('button'); btn.disabled = true;
  try { me = await api.login(f.get('name'), f.get('pin')); questionsCache = null; renderHome(); }
  catch (err) { $('#auth-error').textContent = err.message; }
  finally { btn.disabled = false; }
});
$('#form-join').addEventListener('submit', async e => {
  e.preventDefault(); sfx.unlock();
  const f = Object.fromEntries(new FormData(e.target));
  const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
  try { me = await api.register(f); questionsCache = null; renderHome(); toast(`Welcome, ${me.name}!`); }
  catch (err) { $('#auth-error').textContent = err.message; }
  finally { btn.disabled = false; }
});
$('#btn-logout').addEventListener('click', async () => { await api.logout(); me = null; questionsCache = null; show('auth'); });

// ---------- home ----------
async function loadQuestions(force = false) {
  if (!questionsCache || force) questionsCache = await api.questions();
  return questionsCache;
}
async function renderHome() {
  if (!me) me = await api.me();
  $('#home-name').textContent = me.name;
  $('#home-pos').textContent = me.position.toUpperCase();
  $('#btn-coach').classList.toggle('hidden', !me.is_admin);
  show('home');
  try {
    const qs = await loadQuestions(true);
    const team = qs.filter(q => q.kind === 'team').length;
    const seen = qs.filter(q => q.seen > 0).length;
    $('#home-stats').textContent = `${team} game-plan item${team === 1 ? '' : 's'} · ${seen}/${qs.length} studied`;
  } catch (e) { handleErr(e); }
}

// ---------- game ----------
async function startGame() {
  const qs = await loadQuestions(true);
  if (!qs.length) return toast('No questions yet. Ask your coach to add some.');
  show('game');
  const el = {
    wrap: $('#canvas-wrap'), canvas: $('#field'), banner: $('#banner'),
    qcard: $('#qcard'), qkind: $('#q-kind'), qtimer: $('#q-timer'), qbar: $('#q-bar-fill'), qprompt: $('#q-prompt'), choices: $('#q-choices'),
    feedback: $('#feedback'), fbTitle: $('#fb-title'), fbAnswer: $('#fb-answer'), fbExpl: $('#fb-expl'), cont: $('#fb-continue'),
    dive: $('#btn-dive'), hint: $('#action-hint'), quit: $('#btn-quit'),
    hudDown: $('#hud-down'), hudSpot: $('#hud-spot'), hudQ: $('#hud-q'), hudScore: $('#hud-score'), hudOpp: $('#hud-opp'),
  };
  game?.stop();
  // let layout settle so the canvas gets its real size
  await new Promise(r => requestAnimationFrame(r));
  game = new Game({
    el, player: me, questions: qs,
    onEnd: res => finishGame(res),
    onQuit: async attempts => {
      game = null;
      if (attempts.length) api.submit('game', attempts).catch(() => {});
      questionsCache = null;
      renderHome();
    },
  });
  window.__game = game;
  game.start();
}

async function finishGame({ stats, attempts, missed }) {
  game = null;
  const s = stats;
  const pct = s.total ? Math.round(100 * s.correct / s.total) : 0;
  $('#final-score').textContent = s.score.toLocaleString();
  $('#final-grid').innerHTML = [
    [`${s.correct}/${s.total}`, `CORRECT (${pct}%)`],
    [s.stops, 'STOPS (OF 4)'],
    [s.opp, 'POINTS ALLOWED'],
    [s.tackles, 'TACKLES'],
    [s.tfl, 'TACKLES FOR LOSS'],
    [s.bestStreak, 'BEST STREAK'],
  ].map(([b, l]) => `<div class="stat"><b>${b}</b><span>${l}</span></div>`).join('');
  $('#study-panel').classList.toggle('hidden', !missed.length);
  $('#study-list').innerHTML = missed.map(q => `
    <div class="study-item">
      <div class="study-q">${esc(q.prompt)}</div>
      <div class="study-a">✔ ${esc(q.choices[q.answer])}</div>
      ${q.explanation ? `<div class="study-e">${esc(q.explanation)}</div>` : ''}
    </div>`).join('');
  $('#new-best').classList.add('hidden');
  show('results');
  try {
    const prevBest = (await api.leaderboard()).find(r => r.name === me.name)?.best ?? 0;
    const r = await api.submit('game', attempts, {
      score: s.score, correct: s.correct, total: s.total, stops: s.stops, points_allowed: s.opp,
    });
    if (s.score > prevBest && s.score === r.best) $('#new-best').classList.remove('hidden');
  } catch (e) { handleErr(e); }
  questionsCache = null;
}

// ---------- film room ----------
let film = { list: [], i: 0, filter: 'all', attempts: [], stopPreview: null, answered: false };
function stopFilmPreview() { film.stopPreview?.(); film.stopPreview = null; if (film.attempts.length) flushFilm(); }
function flushFilm() {
  const a = film.attempts; film.attempts = [];
  if (a.length) api.submit('practice', a).catch(() => {});
}
async function startFilm() {
  const qs = await loadQuestions(true);
  film.all = qs;
  show('film');
  setFilmFilter(film.filter);
}
function setFilmFilter(f) {
  film.filter = f;
  $$('#film-filter .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.f === f));
  let list = film.all;
  if (f === 'team') list = list.filter(q => q.kind === 'team');
  if (f === 'rule') list = list.filter(q => q.kind === 'rule');
  if (f === 'missed') list = list.filter(q => q.missed > 0);
  // misses and unseen first, then shuffle within
  list = [...list].sort(() => Math.random() - 0.5).sort((a, b) => (b.missed - b.seen * 0.1) - (a.missed - a.seen * 0.1));
  film.list = list; film.i = 0;
  renderFilmCard();
}
$$('#film-filter .seg-btn').forEach(b => b.addEventListener('click', () => { sfx.click(); setFilmFilter(b.dataset.f); }));
async function renderFilmCard() {
  film.stopPreview?.(); film.stopPreview = null;
  const q = film.list[film.i];
  const cv = $('#film-canvas');
  film.answered = false;
  $('#film-expl').classList.add('hidden');
  $('#film-next').disabled = true;
  if (!q) {
    $('#film-kind').textContent = '';
    $('#film-prompt').textContent = film.filter === 'missed' ? 'No misses. Nice work.' : 'Nothing here yet.';
    $('#film-choices').innerHTML = '';
    $('#film-count').textContent = '';
    cv.classList.add('hidden');
    return;
  }
  $('#film-kind').textContent = q.kind === 'team' ? '★ GAME PLAN' : '⚑ RULES · ' + (q.category || '').toUpperCase();
  $('#film-kind').className = 'q-kind' + (q.kind === 'team' ? ' team' : '');
  $('#film-prompt').textContent = q.prompt;
  $('#film-count').textContent = `${film.i + 1} / ${film.list.length}`;
  if (q.scenario?.formation) {
    cv.classList.remove('hidden');
    film.stopPreview = await startPreview(cv, q.scenario, { you: me.position, aspect: 0.62 });
  } else cv.classList.add('hidden');
  const order = q.choices.map((c, i) => i).sort(() => Math.random() - 0.5);
  $('#film-choices').innerHTML = order.map((ci, k) => `<button class="choice" data-ci="${ci}"><span class="k">${k + 1}</span>${esc(q.choices[ci])}</button>`).join('');
  $$('#film-choices .choice').forEach(b => b.addEventListener('click', () => {
    if (film.answered) return;
    film.answered = true;
    const ci = +b.dataset.ci, ok = ci === q.answer;
    ok ? sfx.correct() : sfx.wrong();
    film.attempts.push({ question_id: q.id, correct: ok, ms: 0 });
    q.seen++; if (!ok) q.missed++;
    $$('#film-choices .choice').forEach(x => {
      x.disabled = true;
      if (+x.dataset.ci === q.answer) x.classList.add('correct');
      else if (x === b) x.classList.add('wrong');
    });
    const ex = $('#film-expl');
    ex.textContent = (ok ? '✔ Correct. ' : '✘ ') + (q.explanation || '');
    ex.classList.remove('hidden');
    $('#film-next').disabled = false;
    if (film.attempts.length >= 10) flushFilm();
  }));
}
$('#film-next').addEventListener('click', () => {
  sfx.click();
  film.i++;
  if (film.i >= film.list.length) { flushFilm(); setFilmFilter(film.filter); toast('Reel done. Shuffled again.'); return; }
  renderFilmCard();
});

// ---------- leaderboard ----------
async function renderLeaderboard() {
  show('leaderboard');
  const el = $('#lb-list');
  el.innerHTML = '<div class="empty">LOADING…</div>';
  const rows = await api.leaderboard();
  el.innerHTML = rows.length ? rows.map((r, i) => `
    <div class="lb-row ${r.name === me.name ? 'me' : ''}">
      <div class="lb-rank">${i + 1}</div>
      <div class="lb-name">${esc(r.name)}<small>${esc(r.position)}</small></div>
      <div class="lb-score">${Number(r.best).toLocaleString()}<small>${r.accuracy ?? '–'}% · ${r.games} G</small></div>
    </div>`).join('') : '<div class="empty">No games yet. Be the first.</div>';
}

// ---------- coach panel ----------
let admin = { questions: [], players: [], tab: 'questions' };
async function renderAdmin() {
  if (!me?.is_admin) return toast('Coach access required.');
  show('admin');
  await loadAdmin();
  setAdminTab(admin.tab);
}
async function loadAdmin() {
  [admin.questions, admin.players] = await Promise.all([api.admin.questions(), api.admin.players()]);
}
function setAdminTab(t) {
  admin.tab = t;
  $$('#admin-tabs .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.t === t));
  ['questions', 'players', 'settings'].forEach(x => $('#admin-' + x).classList.toggle('hidden', x !== t));
  if (t === 'questions') renderQList();
  if (t === 'players') renderPList();
  if (t === 'settings') loadSettings();
}
$$('#admin-tabs .seg-btn').forEach(b => b.addEventListener('click', () => { sfx.click(); setAdminTab(b.dataset.t); }));
['#q-filter-kind', '#q-filter-pos', '#q-search'].forEach(s => $(s).addEventListener('input', renderQList));

function renderQList() {
  const kind = $('#q-filter-kind').value, pos = $('#q-filter-pos').value, s = $('#q-search').value.trim().toLowerCase();
  const list = admin.questions.filter(q => (!kind || q.kind === kind)
    && (!pos || !q.positions?.length || q.positions.includes(pos))
    && (!s || q.prompt.toLowerCase().includes(s) || (q.category || '').toLowerCase().includes(s)));
  const pname = id => admin.players.find(p => p.id === id)?.name || '?';
  $('#q-list').innerHTML = list.map(q => {
    const rate = q.attempts ? Math.round(100 * q.missed / q.attempts) : null;
    const who = q.player_ids?.length ? q.player_ids.map(pname).join(', ') : q.positions?.length ? q.positions.join(', ') : 'Whole defense';
    return `<div class="q-row ${q.active ? '' : 'inactive'}" data-id="${q.id}">
      <div class="q-main">
        <span class="q-kind ${q.kind === 'team' ? 'team' : ''}">${q.kind === 'team' ? '★ GAME PLAN' : '⚑ RULE'}</span>
        <span class="tag">${esc(q.category || '')}</span>
        ${q.scenario?.formation ? `<span class="tag">${esc(FORMATIONS[q.scenario.formation] || q.scenario.formation)}${q.scenario.motion ? ' · ' + esc(q.scenario.motion) + ' MOTION' : ''}</span>` : ''}
        ${!q.active ? '<span class="tag">OFF</span>' : ''}
        ${q.expires_on ? `<span class="tag">UNTIL ${esc(q.expires_on)}</span>` : ''}
        <div class="q-prompt">${esc(q.prompt)}</div>
        <div class="q-meta">✔ ${esc(q.choices[q.answer])} · ${esc(who)}</div>
        <div class="q-meta">${q.attempts ? `<span class="tag ${rate >= 40 ? 'miss-hi' : ''}">${rate}% MISSED</span> ${q.attempts} answers` : 'Not answered yet'}</div>
      </div>
      <div class="q-actions">
        <button class="btn btn-sm" data-act="edit">EDIT</button>
        <button class="btn btn-sm btn-ghost" data-act="del">DELETE</button>
      </div>
    </div>`;
  }).join('') || '<div class="empty">No items match.</div>';
  $$('#q-list .q-row').forEach(row => {
    const q = admin.questions.find(x => x.id === row.dataset.id);
    row.querySelector('[data-act=edit]').addEventListener('click', () => openEditor(q));
    row.querySelector('[data-act=del]').addEventListener('click', async () => {
      if (!confirm(`Delete this item?\n\n${q.prompt}`)) return;
      try { await api.admin.remove(q.id); await loadAdmin(); renderQList(); toast('Deleted.'); } catch (e) { handleErr(e); }
    });
  });
}

function renderPList() {
  const ps = admin.players;
  $('#p-list').innerHTML = ps.map(p => {
    const acc = p.answered ? Math.round(100 * p.correct / p.answered) : null;
    const tacc = p.team_answered ? Math.round(100 * p.team_correct / p.team_answered) : null;
    const seen = p.last_seen ? new Date(p.last_seen).toLocaleDateString() : '–';
    return `<div class="p-row" data-id="${p.id}">
      <div class="p-main">
        <div class="p-name">${esc(p.name)} ${p.is_admin ? '<span class="tag">COACH</span>' : ''}</div>
        <div class="p-stats">Game plan: <b>${tacc ?? '–'}%</b> (${p.team_answered}) · Overall: ${acc ?? "–"}% · ${p.games} games · best ${p.best ?? '–'} · last on ${seen}</div>
        ${p.misses?.length ? `<details class="p-misses"><summary>Top misses</summary><ul>${p.misses.map(m => `<li>${esc(m.prompt)} <b>×${m.n}</b></li>`).join('')}</ul></details>` : ''}
        <div class="p-controls">
          <select class="sm-select" data-act="pos">${POSITIONS.map(x => `<option ${x === p.position ? 'selected' : ''}>${x}</option>`).join('')}</select>
          <button class="btn btn-sm" data-act="pin">RESET PIN</button>
          <button class="btn btn-sm btn-ghost" data-act="coach">${p.is_admin ? 'REMOVE COACH' : 'MAKE COACH'}</button>
          ${p.id !== me.id ? '<button class="btn btn-sm btn-ghost" data-act="del">REMOVE</button>' : ''}
        </div>
      </div>
    </div>`;
  }).join('') || '<div class="empty">No players yet. Share the link and team code.</div>';
  $$('#p-list .p-row').forEach(row => {
    const p = admin.players.find(x => x.id === row.dataset.id);
    const act = async (fn, okMsg) => { try { await fn(); await loadAdmin(); renderPList(); toast(okMsg); } catch (e) { handleErr(e); } };
    row.querySelector('[data-act=pos]').addEventListener('change', e => act(() => api.admin.updatePlayer(p.id, { position: e.target.value }), `${p.name} → ${e.target.value}`));
    row.querySelector('[data-act=pin]').addEventListener('click', () => {
      const pin = prompt(`New PIN for ${p.name} (4-6 digits):`);
      if (pin) act(() => api.admin.updatePlayer(p.id, { pin }), `PIN reset for ${p.name}`);
    });
    row.querySelector('[data-act=coach]').addEventListener('click', () => act(() => api.admin.updatePlayer(p.id, { is_admin: !p.is_admin }), 'Updated.'));
    row.querySelector('[data-act=del]')?.addEventListener('click', () => {
      if (confirm(`Remove ${p.name} and all his stats?`)) act(() => api.admin.removePlayer(p.id), 'Removed.');
    });
  });
}

async function loadSettings() {
  try {
    const s = await api.admin.settings();
    const f = $('#form-settings');
    f.team_code.value = s.team_code || ''; f.coach_code.value = s.coach_code || '';
  } catch (e) { handleErr(e); }
}
$('#form-settings').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  try { await api.admin.settings(f.team_code.value, f.coach_code.value); $('#settings-ok').textContent = 'Saved.'; setTimeout(() => $('#settings-ok').textContent = '', 2000); }
  catch (err) { handleErr(err); }
});

// ---------- question editor ----------
let editing = null, stopEdPreview = null;
$('#ed-formation').innerHTML = '<option value="">None</option>' + Object.entries(FORMATIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
$('#ed-motion').innerHTML = '<option value="">No motion</option>' + MOTION_PLAYERS.map(m => `<option>${m}</option>`).join('');
$('#ed-pos').innerHTML = POSITIONS.map(p => `<label><input type="checkbox" value="${p}"> ${p}</label>`).join('');
$('#ed-allpos').addEventListener('change', e => $$('#ed-pos input').forEach(i => { i.checked = false; i.disabled = e.target.checked; }));
$('#q-new').addEventListener('click', () => openEditor(null));
$('#ed-cancel').addEventListener('click', closeEditor);
['#ed-formation', '#ed-strength', '#ed-motion'].forEach(s => $(s).addEventListener('change', refreshPreview));

function choiceRows(choices, answer) {
  const n = Math.max(4, choices.length);
  $('#ed-choices').innerHTML = Array.from({ length: n }, (_, i) => `
    <div class="choice-ed">
      <input type="radio" name="answer" value="${i}" ${i === answer ? 'checked' : ''} aria-label="Correct answer">
      <span class="lbl">${i === 0 ? 'ANSWER ●' : 'CHOICE ' + (i + 1)}</span>
      <input class="ch" value="${esc(choices[i] || '')}" placeholder="${i < 2 ? 'Required' : 'Optional'}" maxlength="80">
    </div>`).join('');
  $$('#ed-choices input[type=radio]').forEach(r => r.addEventListener('change', () => {
    $$('#ed-choices .lbl').forEach((l, i) => { l.textContent = (+r.value === i) ? 'ANSWER ●' : 'CHOICE ' + (i + 1); });
  }));
  $$('#ed-choices .lbl').forEach((l, i) => { l.textContent = i === answer ? 'ANSWER ●' : 'CHOICE ' + (i + 1); });
}

function openEditor(q) {
  editing = q;
  const f = $('#form-q');
  f.reset();
  $('#ed-title').textContent = q ? 'EDIT ITEM' : 'NEW GAME PLAN ITEM';
  $('#ed-error').textContent = '';
  f.kind.value = q?.kind || 'team';
  f.category.value = q?.category || '';
  f.prompt.value = q?.prompt || '';
  f.explanation.value = q?.explanation || '';
  f.active.checked = q ? q.active : true;
  f.expires_on.value = q?.expires_on || '';
  choiceRows(q?.choices || [], q?.answer ?? 0);
  const pos = q?.positions || [];
  $('#ed-allpos').checked = !pos.length;
  $$('#ed-pos input').forEach(i => { i.checked = pos.includes(i.value); i.disabled = !pos.length; });
  const pids = q?.player_ids || [];
  $('#ed-players').innerHTML = admin.players.map(p => `<label><input type="checkbox" value="${p.id}" ${pids.includes(p.id) ? 'checked' : ''}> ${esc(p.name)} <small>(${esc(p.position)})</small></label>`).join('') || '<span class="q-meta">No players yet.</span>';
  $('.ed-players-d').open = pids.length > 0;
  $('#ed-formation').value = q?.scenario?.formation || '';
  $('#ed-strength').value = q?.scenario?.strength || 'right';
  $('#ed-motion').value = q?.scenario?.motion || '';
  $('#cat-list').innerHTML = [...new Set(admin.questions.map(x => x.category).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('');
  $('#editor').classList.remove('hidden');
  refreshPreview();
}
function closeEditor() { $('#editor').classList.add('hidden'); stopEdPreview?.(); stopEdPreview = null; }
async function refreshPreview() {
  stopEdPreview?.(); stopEdPreview = null;
  const formation = $('#ed-formation').value;
  const cv = $('#ed-preview');
  cv.classList.toggle('hidden', !formation);
  if (!formation) return;
  stopEdPreview = await startPreview(cv, { formation, strength: $('#ed-strength').value, motion: $('#ed-motion').value || null }, { aspect: 9 / 16 });
}

$('#form-q').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const raw = $$('#ed-choices .choice-ed').map(r => ({ text: r.querySelector('.ch').value.trim(), checked: r.querySelector('input[type=radio]').checked }));
  const kept = raw.filter(c => c.text);
  const ansIdx = kept.findIndex(c => c.checked);
  const err = m => { $('#ed-error').textContent = m; };
  if (!f.prompt.value.trim()) return err('Write the question.');
  if (kept.length < 2) return err('Give at least 2 choices.');
  if (ansIdx < 0) return err('Mark which choice is correct (the round button).');
  const formation = $('#ed-formation').value;
  const payload = {
    id: editing?.id || null,
    kind: f.kind.value,
    category: f.category.value.trim() || (f.kind.value === 'team' ? 'Game Plan' : 'General'),
    prompt: f.prompt.value.trim(),
    choices: kept.map(c => c.text),
    answer: ansIdx,
    explanation: f.explanation.value.trim(),
    positions: $('#ed-allpos').checked ? [] : $$('#ed-pos input:checked').map(i => i.value),
    player_ids: $$('#ed-players input:checked').map(i => i.value),
    scenario: formation ? { formation, strength: $('#ed-strength').value, motion: $('#ed-motion').value || null } : null,
    active: f.active.checked,
    expires_on: f.expires_on.value || null,
  };
  if (!$('#ed-allpos').checked && !payload.positions.length && !payload.player_ids.length) return err('Pick at least one position, or check "Whole defense".');
  try {
    await api.admin.save(payload);
    closeEditor();
    await loadAdmin(); renderQList();
    questionsCache = null;
    toast('Saved. Players see it on their next play.');
  } catch (e2) { err(e2.message); }
});

// ---------- boot ----------
(async function boot() {
  if (DEMO) $('#demo-note').classList.remove('hidden');
  if (api.hasToken()) {
    try { me = await api.me(); return renderHome(); } catch { api.clearToken(); }
  }
  show('auth');
})();
