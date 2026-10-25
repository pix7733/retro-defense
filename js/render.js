// Pixel renderer shared by the game, Film Room and the coach preview.
export const S = 10;            // default pixels per yard (logical)
export const HALF_W = 26.67;    // half field width in yards
const HASH = 8.89;              // NFHS hashes: 53'4" from each sideline

export const TEAM = {
  def: { jersey: '#c8102e', trim: '#ffffff', helmet: '#f4f1e8', mask: '#222', skin: '#8d5524' },
  off: { jersey: '#1e3a5f', trim: '#ffcc33', helmet: '#9aa5b1', mask: '#111', skin: '#c68642' },
};

export class Renderer {
  constructor(canvas, { width = 320, aspect = null, scale = S } = {}) {
    this.canvas = canvas;
    this.s = scale;
    this.ctx = canvas.getContext('2d');
    this.W = width;
    this.aspect = aspect;
    this.resize();
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    const aspect = this.aspect || (r.height > 0 && r.width > 0 ? r.height / r.width : 1.4);
    this.H = Math.max(160, Math.round(this.W * aspect));
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx.imageSmoothingEnabled = false;
  }
  // world -> screen
  sx(x, cam) { return Math.round(this.W / 2 + (x - cam.x) * this.s); }
  sy(y, cam) { return Math.round(this.H / 2 - (y - cam.y) * this.s); }
  // screen (client px) -> world
  toWorld(clientX, clientY, cam) {
    const r = this.canvas.getBoundingClientRect();
    const px = (clientX - r.left) / r.width * this.W;
    const py = (clientY - r.top) / r.height * this.H;
    return { x: cam.x + (px - this.W / 2) / this.s, y: cam.y - (py - this.H / 2) / this.s };
  }

  drawField(cam, { los = null, firstDown = null } = {}) {
    const { ctx, W, H } = this;
    const yTop = cam.y + H / 2 / this.s, yBot = cam.y - H / 2 / this.s;
    // out of bounds / track
    ctx.fillStyle = '#1b5e20';
    ctx.fillRect(0, 0, W, H);
    // grass bands every 5 yards
    for (let y = Math.floor(yBot / 5) * 5; y < yTop + 5; y += 5) {
      const top = this.sy(y + 5, cam), bot = this.sy(y, cam);
      ctx.fillStyle = (Math.floor(y / 5) % 2 === 0) ? '#2e7d32' : '#338a38';
      if (y < 0 || y >= 100) ctx.fillStyle = y < 0 ? '#1e3a5f' : '#a4161a';
      ctx.fillRect(this.sx(-HALF_W, cam), top, HALF_W * 2 * this.s, bot - top);
    }
    // sidelines
    ctx.fillStyle = '#fff';
    ctx.fillRect(this.sx(-HALF_W, cam) - 2, 0, 2, H);
    ctx.fillRect(this.sx(HALF_W, cam), 0, 2, H);
    // yard lines + hashes
    for (let y = Math.ceil(yBot); y <= yTop; y++) {
      if (y < 0 || y > 100) continue;
      const py = this.sy(y, cam);
      if (y % 5 === 0) {
        ctx.fillStyle = y === 0 || y === 100 ? '#fff' : 'rgba(255,255,255,.85)';
        ctx.fillRect(this.sx(-HALF_W, cam), py, HALF_W * 2 * this.s, y % 50 === 0 || y === 0 || y === 100 ? 2 : 1);
      }
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      for (const hx of [-HASH, HASH]) ctx.fillRect(this.sx(hx, cam) - 2, py, 4, 1);
      ctx.fillRect(this.sx(-HALF_W, cam), py, 3, 1);
      ctx.fillRect(this.sx(HALF_W, cam) - 3, py, 3, 1);
    }
    // numbers
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = 10; y <= 90; y += 10) {
      if (y < yBot - 2 || y > yTop + 2) continue;
      const n = y <= 50 ? y : 100 - y;
      const py = this.sy(y, cam);
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.fillText(String(n), this.sx(-HALF_W + 4, cam), py);
      ctx.fillText(String(n), this.sx(HALF_W - 4, cam), py);
    }
    // end zone words
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    if (yTop > 100) ctx.fillText('DEFENSE', this.sx(0, cam), this.sy(105, cam));
    if (yBot < 0) ctx.fillText('VISITORS', this.sx(0, cam), this.sy(-5, cam));
    // LOS and line to gain
    if (los != null) {
      ctx.fillStyle = '#4cc9f0';
      ctx.fillRect(this.sx(-HALF_W, cam), this.sy(los, cam), HALF_W * 2 * this.s, 2);
    }
    if (firstDown != null && firstDown < 100) {
      ctx.fillStyle = '#ffcc33';
      ctx.fillRect(this.sx(-HALF_W, cam), this.sy(firstDown, cam), HALF_W * 2 * this.s, 2);
    }
  }

  // Top-down pixel player. facing: 1 = up the screen (offense), -1 = down (defense)
  drawPlayer(x, y, cam, team, o = {}) {
    const { ctx } = this;
    const px = this.sx(x, cam), py = this.sy(y, cam);
    if (px < -12 || px > this.W + 12 || py < -16 || py > this.H + 16) return;
    const c = TEAM[team];
    const t = o.frame || 0;
    const moving = o.moving;
    const leg = moving ? (Math.floor(t * 10) % 2 ? 1 : -1) : 0;

    if (o.down) { // on the ground
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(px - 6, py - 2, 12, 5);
      ctx.fillStyle = c.jersey; ctx.fillRect(px - 5, py - 2, 8, 4);
      ctx.fillStyle = c.helmet; ctx.fillRect(px + 3, py - 2, 4, 4);
      return;
    }
    if (o.you) {
      const pulse = 7 + Math.round(Math.sin(t * 6));
      ctx.strokeStyle = '#ffcc33'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(px + .5, py + 3.5, pulse, pulse * .55, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.fillRect(px - 4, py + 3, 9, 3);
    // legs
    ctx.fillStyle = '#ddd';
    ctx.fillRect(px - 2, py + 2 + leg, 2, 3);
    ctx.fillRect(px + 1, py + 2 - leg, 2, 3);
    // body / shoulder pads
    ctx.fillStyle = c.jersey;
    ctx.fillRect(px - 4, py - 3, 9, 6);
    ctx.fillStyle = c.trim;
    ctx.fillRect(px - 4, py - 3, 9, 1);
    // arms
    ctx.fillStyle = c.skin;
    ctx.fillRect(px - 5, py - 1 - leg, 1, 3);
    ctx.fillRect(px + 5, py - 1 + leg, 1, 3);
    // helmet
    ctx.fillStyle = c.helmet;
    ctx.fillRect(px - 2, py - 7, 5, 5);
    ctx.fillRect(px - 3, py - 6, 7, 3);
    ctx.fillStyle = c.mask;
    if ((o.facing || 1) > 0) ctx.fillRect(px - 2, py - 7, 5, 1);
    else ctx.fillRect(px - 2, py - 3, 5, 1);
    // ball
    if (o.hasBall) {
      ctx.fillStyle = '#8d5524'; ctx.fillRect(px + 3, py - 1, 4, 3);
      ctx.fillStyle = '#fff'; ctx.fillRect(px + 4, py, 2, 1);
    }
    // label
    if (o.label) {
      ctx.font = '6px "Press Start 2P", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const w = ctx.measureText(o.label).width + 4;
      ctx.fillStyle = o.labelBg || 'rgba(0,0,0,.7)';
      ctx.fillRect(px - w / 2, py + 7, w, 8);
      ctx.fillStyle = o.labelColor || '#fff';
      ctx.fillText(o.label, px + .5, py + 14);
    }
    if (o.you) {
      const bob = Math.round(Math.sin(t * 5) * 2);
      ctx.font = '6px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000'; ctx.fillRect(px - 11, py - 20 + bob, 23, 9);
      ctx.fillStyle = '#ffcc33'; ctx.fillText('YOU', px + .5, py - 13 + bob);
      ctx.fillRect(px - 1, py - 11 + bob, 3, 2);
    }
  }

  drawArrow(x1, y1, x2, y2, cam, color = '#ffcc33') {
    const { ctx } = this;
    const a = { x: this.sx(x1, cam), y: this.sy(y1, cam) }, b = { x: this.sx(x2, cam), y: this.sy(y2, cam) };
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - 5 * Math.cos(ang - .5), b.y - 5 * Math.sin(ang - .5));
    ctx.lineTo(b.x - 5 * Math.cos(ang + .5), b.y - 5 * Math.sin(ang + .5));
    ctx.fill();
  }
}

// Static formation picture (used by Film Room + coach preview). Animates motion if present.
export function startPreview(canvas, scenario, { you = null, width = 320, aspect = 0.6 } = {}) {
  return import('./formations.js').then(({ offenseLayout, defenseLayout, motionTarget }) => {
    const r = new Renderer(canvas, { width, aspect });
    const los = 50;
    const off = offenseLayout(scenario?.formation || 'spread', scenario?.strength || 'right');
    const def = defenseLayout(off);
    const mover = scenario?.motion ? off.find(p => p.id === scenario.motion) : null;
    const tgt = mover ? motionTarget(mover) : null;
    let t0 = performance.now(), raf = 0, stopped = false;
    const cam = { x: 0, y: los + 1.5 };
    const tick = (now) => {
      if (stopped) return;
      const t = (now - t0) / 1000;
      r.drawField(cam, { los });
      const cycle = t % 3.2;
      const k = Math.min(1, Math.max(0, (cycle - 0.6) / 1.8));
      const ease = k * k * (3 - 2 * k);
      for (const p of def) {
        const isYou = you && (p.id === you || (you === 'Corner' && p.id === 'Corner'));
        r.drawPlayer(p.x, los + p.d, cam, 'def', { facing: -1, frame: t, you: isYou });
      }
      for (const p of off) {
        let x = p.x, d = p.d, moving = false;
        if (p === mover) { x = p.x + (tgt.x - p.x) * ease; d = p.d + (tgt.d - p.d) * ease; moving = k > 0 && k < 1; }
        const showLabel = p.role !== 'ol';
        const hot = p === mover;
        r.drawPlayer(x, los - d, cam, 'off', {
          facing: 1, frame: t, moving,
          label: showLabel ? p.id : null,
          labelBg: hot ? '#ffcc33' : undefined, labelColor: hot ? '#000' : undefined,
        });
      }
      if (mover && k < 0.05) r.drawArrow(mover.x, los - mover.d - 1.2, tgt.x, los - tgt.d - 1.2, cam);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  });
}
