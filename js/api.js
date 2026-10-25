import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { POSITIONS } from './formations.js';

export const DEMO = !SUPABASE_URL || !SUPABASE_KEY;
const TOKEN_KEY = 'rd_token';

function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} }

// ---------------- real backend ----------------
async function rpc(fn, args = {}) {
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_KEY}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error((data && (data.message || data.hint)) || `Request failed (${res.status})`);
    err.auth = data && (data.code === '28000');
    throw err;
  }
  return data;
}

// ---------------- demo backend (localStorage) ----------------
const DB_KEY = 'rd_demo_db';
let demoDb = null;
async function db() {
  if (demoDb) return demoDb;
  try { demoDb = JSON.parse(localStorage.getItem(DB_KEY) || 'null'); } catch { demoDb = null; }
  if (!demoDb) {
    const seed = await fetch('data/seed-questions.json').then(r => r.json());
    demoDb = {
      settings: { team_code: 'RAMS', coach_code: 'COACH1' },
      players: [], sessions: {}, attempts: [], games: [],
      questions: seed.map((q, i) => ({
        id: 'q' + (i + 1), positions: [], player_ids: [], scenario: null, active: true, expires_on: null,
        updated_at: new Date().toISOString(), ...q,
      })),
    };
    save();
  }
  return demoDb;
}
function save() { try { localStorage.setItem(DB_KEY, JSON.stringify(demoDb)); } catch {} }
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const pj = p => ({ id: p.id, name: p.name, position: p.position, is_admin: p.is_admin });
async function me(token) {
  const d = await db();
  const pid = d.sessions[token];
  const p = d.players.find(x => x.id === pid);
  if (!p) { const e = new Error('Session expired. Log in again.'); e.auth = true; throw e; }
  return p;
}
async function adminMe(token) { const p = await me(token); if (!p.is_admin) throw new Error('Coach access required.'); return p; }
function today() { return new Date().toISOString().slice(0, 10); }

const demo = {
  async fb_register({ p_name, p_position, p_pin, p_team_code, p_coach_code }) {
    const d = await db();
    const name = (p_name || '').trim();
    if ((p_team_code || '').trim().toUpperCase() !== d.settings.team_code.toUpperCase()) throw new Error('Wrong team code. Ask your coach.');
    if (name.length < 2) throw new Error('Name must be 2 to 40 characters.');
    if (!POSITIONS.includes(p_position)) throw new Error('Pick a position.');
    if (!/^[0-9]{4,6}$/.test(p_pin)) throw new Error('PIN must be 4 to 6 digits.');
    if (d.players.some(p => p.name.toLowerCase() === name.toLowerCase())) throw new Error('That name is taken. Add your last initial or jersey number.');
    let is_admin = false;
    if (p_coach_code && p_coach_code.trim()) {
      if (p_coach_code.trim() !== d.settings.coach_code) throw new Error('Wrong coach code.');
      is_admin = true;
    }
    const p = { id: uid(), name, position: p_position, pin: p_pin, is_admin, created_at: new Date().toISOString(), last_seen: new Date().toISOString() };
    d.players.push(p);
    const token = uid(); d.sessions[token] = p.id; save();
    return { token, player: pj(p) };
  },
  async fb_login({ p_name, p_pin }) {
    const d = await db();
    const p = d.players.find(x => x.name.toLowerCase() === (p_name || '').trim().toLowerCase());
    if (!p || p.pin !== p_pin) throw new Error('Name or PIN is wrong.');
    const token = uid(); d.sessions[token] = p.id; p.last_seen = new Date().toISOString(); save();
    return { token, player: pj(p) };
  },
  async fb_me({ p_token }) { return pj(await me(p_token)); },
  async fb_logout({ p_token }) { const d = await db(); delete d.sessions[p_token]; save(); },
  async fb_get_questions({ p_token }) {
    const d = await db(); const p = await me(p_token);
    return d.questions
      .filter(q => q.active && (!q.expires_on || q.expires_on >= today())
        && (!q.positions.length || q.positions.includes(p.position))
        && (!q.player_ids?.length || q.player_ids.includes(p.id)))
      .map(q => {
        const a = d.attempts.filter(x => x.player_id === p.id && x.question_id === q.id);
        return { ...q, seen: a.length, missed: a.filter(x => !x.correct).length };
      });
  },
  async fb_submit({ p_token, p_mode, p_attempts, p_game }) {
    const d = await db(); const p = await me(p_token);
    for (const a of p_attempts || []) d.attempts.push({ ...a, player_id: p.id, mode: p_mode, created_at: new Date().toISOString() });
    if (p_game) d.games.push({ ...p_game, player_id: p.id, created_at: new Date().toISOString() });
    save();
    return { best: Math.max(0, ...d.games.filter(g => g.player_id === p.id).map(g => g.score)) };
  },
  async fb_leaderboard({ p_token }) {
    const d = await db(); await me(p_token);
    return d.players.map(p => {
      const g = d.games.filter(x => x.player_id === p.id);
      const a = d.attempts.filter(x => x.player_id === p.id);
      return { name: p.name, position: p.position, best: Math.max(0, ...g.map(x => x.score)), games: g.length,
        accuracy: a.length ? Math.round(100 * a.filter(x => x.correct).length / a.length) : null };
    }).filter(r => r.games > 0).sort((a, b) => b.best - a.best);
  },
  async fb_admin_questions({ p_token }) {
    const d = await db(); await adminMe(p_token);
    return d.questions.map(q => {
      const a = d.attempts.filter(x => x.question_id === q.id);
      return { ...q, attempts: a.length, missed: a.filter(x => !x.correct).length };
    }).sort((a, b) => (a.kind === b.kind ? (b.updated_at || '').localeCompare(a.updated_at || '') : a.kind === 'team' ? -1 : 1));
  },
  async fb_admin_save_question({ p_token, p_q }) {
    const d = await db(); await adminMe(p_token);
    const q = { ...p_q, updated_at: new Date().toISOString() };
    if (!q.id) { q.id = uid(); d.questions.push(q); }
    else { const i = d.questions.findIndex(x => x.id === q.id); d.questions[i] = { ...d.questions[i], ...q }; }
    save(); return { id: q.id };
  },
  async fb_admin_delete_question({ p_token, p_id }) {
    const d = await db(); await adminMe(p_token);
    d.questions = d.questions.filter(q => q.id !== p_id); d.attempts = d.attempts.filter(a => a.question_id !== p_id); save();
  },
  async fb_admin_players({ p_token }) {
    const d = await db(); await adminMe(p_token);
    return d.players.map(p => {
      const a = d.attempts.filter(x => x.player_id === p.id);
      const team = a.filter(x => d.questions.find(q => q.id === x.question_id)?.kind === 'team');
      const g = d.games.filter(x => x.player_id === p.id);
      const missCount = {};
      for (const x of a.filter(x => !x.correct)) missCount[x.question_id] = (missCount[x.question_id] || 0) + 1;
      const misses = Object.entries(missCount).sort((x, y) => y[1] - x[1]).slice(0, 5)
        .map(([id, n]) => ({ prompt: d.questions.find(q => q.id === id)?.prompt || '?', n }));
      return { ...pj(p), last_seen: p.last_seen, games: g.length, best: g.length ? Math.max(...g.map(x => x.score)) : null,
        answered: a.length, correct: a.filter(x => x.correct).length,
        team_answered: team.length, team_correct: team.filter(x => x.correct).length, misses };
    }).sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));
  },
  async fb_admin_update_player({ p_token, p_id, p_position, p_is_admin, p_new_pin }) {
    const d = await db(); const m = await adminMe(p_token);
    const p = d.players.find(x => x.id === p_id);
    if (p_id === m.id && p_is_admin === false) throw new Error('You cannot remove your own coach access.');
    if (p_position) p.position = p_position;
    if (p_is_admin != null) p.is_admin = p_is_admin;
    if (p_new_pin) { if (!/^[0-9]{4,6}$/.test(p_new_pin)) throw new Error('PIN must be 4 to 6 digits.'); p.pin = p_new_pin; }
    save();
  },
  async fb_admin_delete_player({ p_token, p_id }) {
    const d = await db(); const m = await adminMe(p_token);
    if (p_id === m.id) throw new Error('You cannot delete yourself.');
    d.players = d.players.filter(p => p.id !== p_id); d.attempts = d.attempts.filter(a => a.player_id !== p_id);
    d.games = d.games.filter(g => g.player_id !== p_id); save();
  },
  async fb_admin_settings({ p_token, p_team_code, p_coach_code }) {
    const d = await db(); await adminMe(p_token);
    if (p_team_code && p_team_code.trim().length >= 4) d.settings.team_code = p_team_code.trim().toUpperCase();
    if (p_coach_code && p_coach_code.trim().length >= 6) d.settings.coach_code = p_coach_code.trim();
    save(); return { ...d.settings };
  },
};

const call = (fn, args) => (DEMO ? demo[fn](args) : rpc(fn, args));
const authed = (fn, args = {}) => call(fn, { p_token: getToken(), ...args });

export const api = {
  hasToken: () => !!getToken(),
  async register(f) {
    const r = await call('fb_register', { p_name: f.name, p_position: f.position, p_pin: f.pin, p_team_code: f.team_code, p_coach_code: f.coach_code || null });
    setToken(r.token); return r.player;
  },
  async login(name, pin) { const r = await call('fb_login', { p_name: name, p_pin: pin }); setToken(r.token); return r.player; },
  async logout() { try { await authed('fb_logout'); } catch {} setToken(null); },
  me: () => authed('fb_me'),
  questions: () => authed('fb_get_questions'),
  submit: (mode, attempts, game = null) => authed('fb_submit', { p_mode: mode, p_attempts: attempts, p_game: game }),
  leaderboard: () => authed('fb_leaderboard'),
  admin: {
    questions: () => authed('fb_admin_questions'),
    save: q => authed('fb_admin_save_question', { p_q: q }),
    remove: id => authed('fb_admin_delete_question', { p_id: id }),
    players: () => authed('fb_admin_players'),
    updatePlayer: (id, ch) => authed('fb_admin_update_player', { p_id: id, p_position: ch.position ?? null, p_is_admin: ch.is_admin ?? null, p_new_pin: ch.pin ?? null }),
    removePlayer: id => authed('fb_admin_delete_player', { p_id: id }),
    settings: (team, coach) => authed('fb_admin_settings', { p_team_code: team ?? null, p_coach_code: coach ?? null }),
  },
  clearToken: () => setToken(null),
};
