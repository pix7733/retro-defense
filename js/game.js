import { Renderer, HALF_W } from './render.js';
import { offenseLayout, defenseLayout, motionTarget, FORMATIONS } from './formations.js';
import { sfx } from './sfx.js';

const DRIVES = 4;
const Q_TIME = 15;          // seconds on the play clock to answer
const FG_RANGE = 65;        // inside the defense's 35 they kick a field goal
const MAX_PLAY_TIME = 14;
const PRESNAP_SCALE = 5.6;  // px per yard before the snap (shows ~43 yards across)

const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ord = n => ['1ST', '2ND', '3RD', '4TH'][n - 1] || `${n}TH`;
const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Game {
  constructor({ el, player, questions, onEnd, onQuit }) {
    this.el = el;
    this.player = player;
    this.pool = questions.filter(q => Array.isArray(q.choices) && q.choices.length >= 2);
    this.onEnd = onEnd;
    this.onQuit = onQuit;
    this.r = new Renderer(el.canvas, { width: 240, scale: PRESNAP_SCALE });
    this.cam = { x: 0, y: 30 };
    this.deck = [];
    this.lastQ = null;
    this.stats = { score: 0, correct: 0, total: 0, stops: 0, opp: 0, streak: 0, bestStreak: 0, tackles: 0, tfl: 0, turnovers: 0 };
    this.attempts = [];
    this.missed = new Map();
    this.state = 'idle';
    this.t = 0;
    this.keys = {};
    this.pointer = null;
    this._bind();
  }

  // ---------- lifecycle ----------
  start() {
    this.drive = 0;
    this.running = true;
    this.last = performance.now();
    const loop = now => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.t += dt;
      this.update(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.nextDrive();
  }
  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearInterval(this.qTimer);
    clearTimeout(this.autoSnap);
    this._unbind();
    this.hide(this.el.qcard, this.el.feedback, this.el.banner, this.el.dive, this.el.hint);
  }

  // ---------- input ----------
  _bind() {
    const c = this.el.wrap;
    this.h = {
      down: e => { if (this.state !== 'action') return; this.pointer = { id: e.pointerId, cx: e.clientX, cy: e.clientY }; const now = performance.now(); if (now - (this.lastTap || 0) < 260) this.dive(); this.lastTap = now; },
      move: e => { if (this.pointer && this.pointer.id === e.pointerId) { this.pointer.cx = e.clientX; this.pointer.cy = e.clientY; } },
      up: e => { if (this.pointer && this.pointer.id === e.pointerId) this.pointer = null; },
      kd: e => {
        this.keys[e.key] = true;
        if (e.key === ' ' && this.state === 'action') { e.preventDefault(); this.dive(); }
        if (this.state === 'question' && /^[1-4]$/.test(e.key)) { const b = this.el.choices.children[+e.key - 1]; if (b) b.click(); }
        if (this.state === 'feedback' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.snap(); }
      },
      ku: e => { this.keys[e.key] = false; },
      resize: () => this.r.resize(),
      dive: e => { e.preventDefault(); e.stopPropagation(); this.dive(); },
      cont: () => this.snap(),
      quit: () => this.quit(),
    };
    c.addEventListener('pointerdown', this.h.down);
    window.addEventListener('pointermove', this.h.move);
    window.addEventListener('pointerup', this.h.up);
    window.addEventListener('pointercancel', this.h.up);
    window.addEventListener('keydown', this.h.kd);
    window.addEventListener('keyup', this.h.ku);
    window.addEventListener('resize', this.h.resize);
    this.el.dive.addEventListener('pointerdown', this.h.dive);
    this.el.cont.addEventListener('click', this.h.cont);
    this.el.quit.addEventListener('click', this.h.quit);
  }
  _unbind() {
    const c = this.el.wrap;
    c.removeEventListener('pointerdown', this.h.down);
    window.removeEventListener('pointermove', this.h.move);
    window.removeEventListener('pointerup', this.h.up);
    window.removeEventListener('pointercancel', this.h.up);
    window.removeEventListener('keydown', this.h.kd);
    window.removeEventListener('keyup', this.h.ku);
    window.removeEventListener('resize', this.h.resize);
    this.el.dive.removeEventListener('pointerdown', this.h.dive);
    this.el.cont.removeEventListener('click', this.h.cont);
    this.el.quit.removeEventListener('click', this.h.quit);
  }
  quit() {
    if (this.state === 'over') return;
    this.stop();
    this.onQuit?.(this.attempts);
  }

  // ---------- helpers ----------
  show(...els) { els.forEach(e => e.classList.remove('hidden')); }
  hide(...els) { els.forEach(e => e.classList.add('hidden')); }
  banner(html, cls = '', ms = 1500) {
    const b = this.el.banner;
    b.className = 'banner ' + cls;
    b.innerHTML = html;
    void b.offsetWidth; // restart animation
    return new Promise(res => setTimeout(() => { b.classList.add('hidden'); res(); }, ms));
  }
  hud() {
    const goal = this.firstDown >= 100;
    this.el.hudDown.textContent = `${ord(this.down)} & ${goal ? 'GOAL' : Math.max(1, Math.round(this.firstDown - this.los))}`;
    const l = Math.round(this.los);
    this.el.hudSpot.textContent = l === 50 ? 'MIDFIELD' : l < 50 ? `OPP ${l}` : `OUR ${100 - l}`;
    this.el.hudQ.textContent = `DRIVE ${this.drive}/${DRIVES}`;
    this.el.hudScore.textContent = this.stats.score.toLocaleString();
    this.el.hudOpp.textContent = `OPP ${this.stats.opp}`;
  }

  // ---------- drives & downs ----------
  async nextDrive() {
    this.drive++;
    if (this.drive > DRIVES) return this.finish();
    this.los = 25;
    this.down = 1;
    this.firstDown = 35;
    this.hud();
    this.setupPlay(null);
    this.state = 'between';
    await this.banner(`DRIVE ${this.drive}<small>STOP THEM!</small>`, '', 1300);
    this.nextPlay();
  }

  pickQuestion() {
    if (!this.deck.length) this.deck = [...this.pool];
    const cands = this.deck.length > 1 ? this.deck.filter(q => q !== this.lastQ) : this.deck;
    const w = cands.map(q => 1 + (q.missed || 0) * 2 + (q.seen ? 0 : 1) + (q.kind === 'team' ? 2.5 : 0) + (this.missed.has(q.id) ? 3 : 0));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    let i = 0;
    for (; i < cands.length - 1; i++) { r -= w[i]; if (r <= 0) break; }
    const q = cands[i];
    this.deck.splice(this.deck.indexOf(q), 1);
    this.lastQ = q;
    return q;
  }

  nextPlay() {
    const q = this.pickQuestion();
    this.q = q;
    this.setupPlay(q.scenario || null);
    this.state = 'question';
    this.hud();
    this.askQuestion(q);
  }

  setupPlay(scenario) {
    const sc = scenario && scenario.formation ? scenario
      : { formation: pick(Object.keys(FORMATIONS)), strength: Math.random() < 0.5 ? 'left' : 'right', motion: null, random: true };
    this.scenario = sc;
    const los = this.los ?? 25;
    this.off = offenseLayout(sc.formation, sc.strength).map(p => ({ ...p, team: 'off', x0: p.x, y0: los - p.d, x: p.x, y: los - p.d, vx: 0, vy: 0 }));
    this.def = defenseLayout(this.off).map(p => ({ ...p, team: 'def', x: p.x, y: los + p.d, vx: 0, vy: 0 }));
    const myKey = this.player.position;
    this.me = this.def.find(p => p.id === myKey) || this.def.find(p => p.id === 'Mike');
    this.me.isMe = true;
    this.mover = sc.motion ? this.off.find(p => p.id === sc.motion) : null;
    this.moverTarget = this.mover ? motionTarget(this.mover) : null;
    this.presnapT = 0;
    this.carrier = null;
    this.result = null;
  }

  askQuestion(q) {
    const el = this.el;
    this.order = shuffle(q.choices.map((c, i) => i));
    el.qkind.textContent = q.kind === 'team' ? '★ GAME PLAN' : '⚑ RULES CHECK';
    el.qkind.className = 'q-kind' + (q.kind === 'team' ? ' team' : '');
    el.qprompt.textContent = q.prompt;
    el.choices.innerHTML = this.order.map((ci, k) =>
      `<button class="choice" data-ci="${ci}"><span class="k">${k + 1}</span>${esc(q.choices[ci])}</button>`).join('');
    [...el.choices.children].forEach(b => b.addEventListener('click', () => this.answer(+b.dataset.ci)));
    this.show(el.qcard);
    this.qStart = performance.now();
    const tick = () => {
      const left = Math.max(0, Q_TIME - (performance.now() - this.qStart) / 1000);
      el.qtimer.textContent = Math.ceil(left);
      el.qbar.style.width = (left / Q_TIME * 100) + '%';
      el.qbar.style.background = left < 4 ? 'var(--red)' : left < 8 ? 'var(--gold)' : 'var(--green)';
      if (left <= 0) this.answer(-1);
    };
    tick();
    clearInterval(this.qTimer);
    this.qTimer = setInterval(tick, 100);
  }

  answer(ci) {
    if (this.state !== 'question') return;
    clearInterval(this.qTimer);
    const q = this.q;
    const ms = Math.round(performance.now() - this.qStart);
    const ok = ci === q.answer;
    this.wasCorrect = ok;
    this.stats.total++;
    this.attempts.push({ question_id: q.id, correct: ok, ms });
    [...this.el.choices.children].forEach(b => {
      b.disabled = true;
      if (+b.dataset.ci === q.answer) b.classList.add('correct');
      else if (+b.dataset.ci === ci) b.classList.add('wrong');
    });
    let gained = 0;
    if (ok) {
      this.stats.correct++;
      this.stats.streak++;
      this.stats.bestStreak = Math.max(this.stats.bestStreak, this.stats.streak);
      const left = Math.max(0, Q_TIME - ms / 1000);
      gained = 100 + Math.round(50 * left / Q_TIME) + 25 * Math.min(this.stats.streak - 1, 8);
      this.stats.score += gained;
      sfx.correct();
    } else {
      this.stats.streak = 0;
      this.missed.set(q.id, q);
      sfx.wrong();
    }
    this.hud();
    this.state = 'feedback';
    setTimeout(() => this.showFeedback(ok, ci, gained), 450);
  }

  showFeedback(ok, ci, gained) {
    const el = this.el, q = this.q;
    this.hide(el.qcard);
    el.fbTitle.className = 'fb-title ' + (ok ? 'good' : 'bad');
    el.fbTitle.textContent = ok ? (this.stats.streak >= 3 ? `ON FIRE x${this.stats.streak}! +${gained}` : `GREAT READ! +${gained}`) : (ci === -1 ? 'TOO SLOW!' : 'WRONG READ!');
    el.fbAnswer.textContent = ok ? '' : `✔ ${q.choices[q.answer]}`;
    el.fbAnswer.classList.toggle('hidden', ok);
    el.fbExpl.textContent = q.explanation || '';
    el.fbExpl.classList.toggle('hidden', !q.explanation);
    el.cont.textContent = ok ? 'SNAP IT ▶' : 'GOT IT, SNAP ▶';
    this.show(el.feedback);
    clearTimeout(this.autoSnap);
    if (ok) this.autoSnap = setTimeout(() => this.snap(), q.explanation ? 2600 : 1200);
  }

  // ---------- the play ----------
  snap() {
    if (this.state !== 'feedback') return;
    clearTimeout(this.autoSnap);
    this.hide(this.el.feedback);
    sfx.hut();
    const ok = this.wasCorrect;
    const los = this.los;

    // motion is complete at the snap
    if (this.mover) { this.mover.x = this.moverTarget.x; this.mover.y = los - this.moverTarget.d; }

    this.mods = ok
      ? { carrier: rand(5.4, 5.9), me: 7.0, delay: 0, shed: 0.25 }
      : { carrier: rand(6.4, 6.9), me: 6.1, delay: 0.75, shed: 0.9 };

    // play call
    const jet = this.mover && this.mover.id !== 'RB' && Math.random() < 0.4;
    const carrier = jet ? this.mover : (this.off.find(p => p.id === 'RB') || this.off.find(p => p.role === 'rb'));
    this.carrier = carrier;
    carrier.hasBall = true;
    // Correct read: the ball comes your way and you're in the hole. Wrong read: it goes away from you.
    let gapX;
    if (jet) gapX = Math.sign(this.moverTarget.x - this.mover.x0 || 1) * 15;
    else if (ok) gapX = clamp(this.me.x + rand(-1.5, 1.5), -11, 11);
    else gapX = clamp(-Math.sign(this.me.x || 1) * rand(3, 10), -11, 11);
    this.gapX = gapX;
    carrier.phase = 'hole';
    this.playT = 0;
    this.jukeT = rand(0.6, 1.2);
    this.juke = 0;

    // blocking assignments: OL/TE take the nearest defenders; one blocker always hunts you
    const blockers = this.off.filter(p => p !== carrier && p.role !== 'qb');
    blockers.forEach(b => { b.engaged = null; b.used = false; });
    this.def.forEach(d => { d.engagedT = 0; d.by = null; d.delay = d.isMe ? this.mods.delay : rand(0.15, 0.45); });
    const myBlocker = blockers.filter(b => b.role !== 'wr' || this.me.role === 'db').sort((a, b) => dist(a, this.me) - dist(b, this.me))[0];
    blockers.forEach(b => { b.target = b === myBlocker ? this.me : null; });
    this.me.diveT = 0; this.me.recoverT = 0; this.me.coolT = 0;
    this.state = 'action';
    this.show(this.el.dive, this.el.hint);
    setTimeout(() => this.hide(this.el.hint), 1800);
  }

  dive() {
    const m = this.me;
    if (this.state !== 'action' || m.coolT > 0 || m.delay > 0) return;
    sfx.dive();
    if (m.by) { // shed the block
      m.engagedT = 0; if (m.by) m.by.engaged = null; m.by = null;
    }
    m.diveT = 0.38; m.coolT = 1.3;
    this.el.dive.classList.add('cool');
  }

  update(dt) {
    if (this.state === 'question' || this.state === 'feedback' || this.state === 'between') {
      this.presnapT += dt;
      if (this.mover && this.state !== 'between') {
        const cycle = this.presnapT % 3.6;
        const k = clamp((cycle - 0.7) / 1.9, 0, 1);
        const e = k * k * (3 - 2 * k);
        const los = this.los;
        this.mover.x = this.mover.x0 + (this.moverTarget.x - this.mover.x0) * e;
        this.mover.y = this.mover.y0 + ((los - this.moverTarget.d) - this.mover.y0) * e;
        this.mover.moving = k > 0 && k < 1;
      }
    } else if (this.state === 'action') {
      this.simulate(dt);
    }
    // camera
    // Wide shot before the snap (whole formation, LOS near the top so the question card
    // doesn't cover it), tight shot during the play.
    const live = (this.state === 'action' || this.state === 'result') && this.carrier;
    const k = 1 - Math.pow(0.002, dt);
    const targetS = live ? 10 : PRESNAP_SCALE;
    this.r.s += (targetS - this.r.s) * Math.min(1, k * 1.2);
    let tx, ty;
    if (live) {
      const c = this.carrier;
      tx = c.x * 0.65 + this.me.x * 0.35;
      ty = c.y * 0.7 + this.me.y * 0.3 + 2;
    } else {
      tx = 0;
      ty = (this.los ?? 25) - (0.22 * this.r.H) / this.r.s;
    }
    const halfView = this.r.W / 2 / this.r.s;
    const lim = Math.max(0, HALF_W - halfView + 1.5);
    tx = clamp(tx, -lim, lim);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
  }

  simulate(dt) {
    const c = this.carrier, m = this.me, los = this.los;
    this.playT += dt;

    // --- ball carrier AI ---
    let tx, ty;
    if (c.phase === 'hole') {
      tx = this.gapX; ty = los + 1;
      if (c.y >= los - 0.5 || Math.abs(c.x - this.gapX) < 1) c.phase = 'open';
    }
    if (c.phase === 'open') { tx = c.x; ty = 110; }
    let dx = tx - c.x, dy = ty - c.y;
    let L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    // avoid defenders in front
    let ax = 0;
    for (const d of this.def) {
      if (d.engagedT > 0) continue;
      const rx = c.x - d.x, ry = d.y - c.y;
      const dd = Math.hypot(rx, ry);
      if (dd < 7 && ry > -1.5) ax += (rx === 0 ? (Math.random() - .5) : Math.sign(rx)) * (7 - dd) / 7;
    }
    this.jukeT -= dt;
    if (this.jukeT <= 0) { this.juke = rand(-1, 1); this.jukeT = rand(0.5, 1.1); }
    if (c.phase === 'open') { dx += ax * 1.4 + this.juke * 0.5; dy = Math.max(dy, 0.55); }
    // stay off the sideline
    if (c.x > HALF_W - 3) dx -= 0.8; if (c.x < -HALF_W + 3) dx += 0.8;
    L = Math.hypot(dx, dy) || 1;
    const cs = this.mods.carrier * (this.playT < 0.3 ? 0.6 : 1);
    c.vx += ((dx / L) * cs - c.vx) * Math.min(1, dt * 7);
    c.vy += ((dy / L) * cs - c.vy) * Math.min(1, dt * 7);
    c.x += c.vx * dt; c.y += c.vy * dt; c.moving = true;

    // --- QB fades after the handoff
    const qb = this.off.find(p => p.role === 'qb');
    if (qb && qb !== c && this.playT < 0.8) { qb.y -= 1.2 * dt; qb.moving = true; } else if (qb) qb.moving = false;

    // --- blockers ---
    for (const b of this.off) {
      if (b === c || b.role === 'qb') continue;
      if (b.engaged) {
        const d = b.engaged;
        if (d.engagedT <= 0) { b.engaged = null; b.used = true; continue; }
        b.x += ((d.x) - b.x) * Math.min(1, dt * 8) * 0.2; b.y += ((d.y - 0.9) - b.y) * Math.min(1, dt * 8) * 0.5;
        b.moving = true;
        continue;
      }
      if (b.used) { b.moving = false; continue; }
      let target = b.target;
      if (!target || target.engagedT > 0 || target.down) {
        const range = b.role === 'wr' ? 9 : 4.5;
        target = this.def.filter(d => !d.by && !d.isMe && dist(d, b) < range).sort((a, z) => dist(a, b) - dist(z, b))[0];
        if (!target && b.target === m && !m.by) target = m;
      }
      if (!target) { b.moving = false; continue; }
      const bx = target.x - b.x, by = (target.y - 0.6) - b.y, bl = Math.hypot(bx, by) || 1;
      const bs = b.role === 'ol' ? 4.0 : 5.0;
      b.x += bx / bl * bs * dt; b.y += by / bl * bs * dt; b.moving = true;
      if (bl < 0.95 && !target.by && target.diveT <= 0) {
        b.engaged = target; target.by = b;
        target.engagedT = target.isMe ? this.mods.shed : (target.role === 'dl' ? rand(1.0, 2.0) : rand(0.6, 1.3));
        if (target.isMe) sfx.hit();
      }
    }

    // --- defenders ---
    for (const d of this.def) {
      d.moving = false;
      if (d.delay > 0) { d.delay -= dt; continue; }
      if (d.engagedT > 0) { d.engagedT -= dt; if (d.engagedT <= 0 && d.by) { d.by.engaged = null; d.by.used = true; d.by = null; } }
      if (d.isMe) continue;
      const spd = (d.role === 'dl' ? 4.1 : d.role === 'lb' ? 4.6 : 5.0) * (d.engagedT > 0 ? 0.12 : 1);
      const lead = Math.min(dist(d, c) / 6, 1.1);
      const px = c.x + c.vx * lead, py = c.y + c.vy * lead;
      const vx = px - d.x, vy = py - d.y, vl = Math.hypot(vx, vy) || 1;
      d.x += vx / vl * spd * dt; d.y += vy / vl * spd * dt; d.moving = true;
      if (dist(d, c) < 0.85 && d.engagedT <= 0) return this.endPlay('team', d);
    }

    // --- you ---
    m.coolT = Math.max(0, m.coolT - dt);
    if (m.coolT <= 0) this.el.dive.classList.remove('cool');
    if (m.delay <= 0) {
      let ix = 0, iy = 0;
      if (this.keys.ArrowLeft || this.keys.a) ix -= 1;
      if (this.keys.ArrowRight || this.keys.d) ix += 1;
      if (this.keys.ArrowUp || this.keys.w) iy += 1;
      if (this.keys.ArrowDown || this.keys.s) iy -= 1;
      if (this.pointer) {
        const w = this.r.toWorld(this.pointer.cx, this.pointer.cy, this.cam);
        const px = w.x - m.x, py = w.y - m.y, pl = Math.hypot(px, py);
        if (pl > 0.35) { ix = px / pl; iy = py / pl; }
      }
      if (m.diveT > 0) {
        m.diveT -= dt;
        if (!ix && !iy) { ix = c.x - m.x; iy = c.y - m.y; }
        if (m.diveT <= 0) m.recoverT = 0.45;
      } else if (m.recoverT > 0) m.recoverT -= dt;
      const il = Math.hypot(ix, iy);
      if (il > 0) {
        let sp = this.mods.me;
        if (m.diveT > 0) sp *= 1.75; else if (m.recoverT > 0) sp *= 0.35;
        if (m.engagedT > 0) sp *= 0.18;
        m.vx = ix / il * sp; m.vy = iy / il * sp;
        m.x += m.vx * dt; m.y += m.vy * dt; m.moving = true;
      }
      m.x = clamp(m.x, -HALF_W - 1, HALF_W + 1);
      const reach = m.diveT > 0 ? 1.7 : 1.0;
      if (dist(m, c) < reach && m.engagedT <= 0) return this.endPlay('me', m, m.diveT > 0);
    }

    // --- end conditions ---
    if (c.y >= 100) return this.endPlay('td');
    if (Math.abs(c.x) >= HALF_W) return this.endPlay('oob');
    if (c.y <= 0) return this.endPlay('safety');
    if (this.playT > MAX_PLAY_TIME) return this.endPlay('team', this.def[0]);
  }

  async endPlay(how, tackler = null, diving = false) {
    if (this.state !== 'action') return;
    this.state = 'result';
    this.hide(this.el.dive, this.el.hint);
    const c = this.carrier;
    c.moving = false;
    const s = this.stats;
    const spot = clamp(c.y, 0.5, 100);
    const yards = Math.round(spot - this.los);
    let fumble = false;

    if (how === 'me' || how === 'team') {
      c.down = true;
      if (tackler) { tackler.down = how === 'me' && diving; }
      sfx.hit();
      if (how === 'me') {
        s.tackles++;
        fumble = diving && this.wasCorrect && Math.random() < 0.25;
      }
    } else {
      sfx.whistle();
    }

    let msg, cls = '';
    if (how === 'td') {
      s.opp += 7;
      sfx.bad();
      await this.banner('TOUCHDOWN<small>THEY SCORE. +7 OPP</small>', 'bad', 1900);
      return this.nextDrive();
    }
    if (how === 'safety') {
      s.score += 500;
      sfx.great();
      await this.banner('SAFETY!<small>+2 DEFENSE · +500</small>', 'good', 1900);
      s.stops++;
      return this.nextDrive();
    }
    if (fumble) {
      s.turnovers++; s.stops++;
      s.score += 750 + 50;
      sfx.great();
      await this.banner('FUMBLE!<small>DEFENSE BALL · +800</small>', 'good', 2000);
      return this.nextDrive();
    }

    if (how === 'me') {
      if (yards <= 0) { s.tfl++; s.score += 150; msg = `TACKLE FOR LOSS!<small>${yards === 0 ? 'NO GAIN' : yards + ' YDS'} · +150</small>`; cls = 'good'; }
      else { s.score += 50; msg = `TACKLE!<small>+${yards} YDS · +50</small>`; cls = yards <= 3 ? 'good' : ''; }
    } else if (how === 'oob') {
      msg = `OUT OF BOUNDS<small>${yards >= 0 ? '+' : ''}${yards} YDS</small>`;
    } else {
      msg = `BROUGHT DOWN<small>${yards >= 0 ? '+' : ''}${yards} YDS</small>`;
      cls = yards >= 8 ? 'bad' : '';
    }

    const newLos = clamp(Math.round(spot), 1, 99);
    let firstDown = false;
    if (newLos >= this.firstDown) {
      firstDown = true;
      this.down = 1;
      this.firstDown = Math.min(newLos + 10, 100);
      msg = msg.replace('</small>', ' · FIRST DOWN</small>');
      cls = 'bad';
    } else {
      this.down++;
    }
    this.los = newLos;
    this.hud();
    await this.banner(msg, cls, 1500);

    if (!firstDown && this.down > 3) {
      if (this.los >= FG_RANGE) {
        s.opp += 3; s.score += 200;
        sfx.whistle();
        await this.banner('HELD TO A FIELD GOAL<small>+3 OPP · +200</small>', '', 1900);
      } else {
        s.stops++; s.score += 500;
        sfx.great();
        await this.banner('STOP! THEY PUNT<small>+500</small>', 'good', 1900);
      }
      return this.nextDrive();
    }
    this.nextPlay();
  }

  async finish() {
    this.state = 'over';
    this.hud();
    await this.banner('FINAL', '', 1100);
    this.stop();
    this.onEnd({
      stats: { ...this.stats },
      attempts: this.attempts,
      missed: [...this.missed.values()],
    });
  }

  // ---------- drawing ----------
  draw() {
    const r = this.r, cam = this.cam;
    if (!this.off) { r.drawField(cam); return; }
    const showLines = this.state !== 'action';
    r.drawField(cam, { los: this.los, firstDown: this.firstDown });
    const t = this.t;
    const presnap = this.state === 'question' || this.state === 'feedback' || this.state === 'between';
    for (const p of this.off) {
      const showLabel = presnap && p.role !== 'ol';
      const hot = presnap && p === this.mover;
      r.drawPlayer(p.x, p.y, cam, 'off', {
        facing: 1, frame: t, moving: p.moving, hasBall: p.hasBall && !presnap, down: p.down,
        label: showLabel ? p.id : null, labelBg: hot ? '#ffcc33' : undefined, labelColor: hot ? '#000' : undefined,
      });
    }
    if (presnap && this.mover && this.state !== 'between') {
      const los = this.los;
      r.drawArrow(this.mover.x0, this.mover.y0 - 1.3, this.moverTarget.x, los - this.moverTarget.d - 1.3, cam, 'rgba(255,204,51,.6)');
    }
    for (const d of this.def) {
      r.drawPlayer(d.x, d.y, cam, 'def', {
        facing: -1, frame: t, moving: d.moving, you: d.isMe && !d.down, down: d.down,
        label: d.isMe && this.state === 'action' && d.delay > 0 ? '?!' : (d.isMe && d.engagedT > 0 && this.state === 'action' ? 'SHED!' : null),
        labelBg: '#e63946',
      });
    }
    if (this.state === 'action' && this.carrier) {
      // indicator above the runner
      const c = this.carrier;
      const px = r.sx(c.x, cam), py = r.sy(c.y, cam);
      r.ctx.fillStyle = '#fff';
      const bob = Math.round(Math.sin(t * 8));
      r.ctx.fillRect(px - 1, py - 13 + bob, 3, 3);
      r.ctx.fillRect(px, py - 10 + bob, 1, 1);
    }
  }
}
