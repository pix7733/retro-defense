// World coordinates are in yards.
// x: lateral, 0 = middle of the field, sidelines at +/-26.67.
// y: yard line from the offense's own goal line (0) to the defense's goal line (100).
// d (offense) = depth behind the LOS, d (defense) = depth off the LOS.

export const POSITIONS = ['Left End', 'Right End', 'Mike', 'Will', 'Star', 'Bama', '3 Tech', '1 Tech', 'Corner', 'Free Safety'];

export const FORMATIONS = {
  spread: 'Spread 2x2',
  trips: 'Trips 3x1',
  empty: 'Empty',
  pro: 'I-Form / Pro',
  ace: 'Ace (2 TE)',
  wing: 'Wing',
  pistol: 'Pistol',
};

export const MOTION_PLAYERS = ['H', 'Y', 'Z', 'X', 'RB'];

const OL = [
  { id: 'LT', x: -4, d: 0, role: 'ol' },
  { id: 'LG', x: -2, d: 0, role: 'ol' },
  { id: 'C', x: 0, d: 0, role: 'ol' },
  { id: 'RG', x: 2, d: 0, role: 'ol' },
  { id: 'RT', x: 4, d: 0, role: 'ol' },
];

// Strength-right layouts. Each has 7 on the line and 4 backs.
const LAYOUTS = {
  spread: [
    { id: 'QB', x: 0, d: 5, role: 'qb' }, { id: 'RB', x: -1.5, d: 5, role: 'rb' },
    { id: 'X', x: -20, d: 0, role: 'wr' }, { id: 'Y', x: -10, d: 1, role: 'wr' },
    { id: 'H', x: 10, d: 1, role: 'wr' }, { id: 'Z', x: 20, d: 0, role: 'wr' },
  ],
  trips: [
    { id: 'QB', x: 0, d: 5, role: 'qb' }, { id: 'RB', x: -1.5, d: 5, role: 'rb' },
    { id: 'X', x: -20, d: 0, role: 'wr' }, { id: 'Y', x: 6, d: 0, role: 'te' },
    { id: 'H', x: 12, d: 1, role: 'wr' }, { id: 'Z', x: 19, d: 1, role: 'wr' },
  ],
  empty: [
    { id: 'QB', x: 0, d: 5, role: 'qb' }, { id: 'RB', x: -6, d: 1, role: 'rb' },
    { id: 'X', x: -20, d: 0, role: 'wr' }, { id: 'Y', x: -12, d: 1, role: 'wr' },
    { id: 'H', x: 10, d: 1, role: 'wr' }, { id: 'Z', x: 20, d: 0, role: 'wr' },
  ],
  pro: [
    { id: 'QB', x: 0, d: 1, role: 'qb' }, { id: 'H', x: 0, d: 4, role: 'rb' },
    { id: 'RB', x: 0, d: 7, role: 'rb' }, { id: 'Y', x: 6, d: 0, role: 'te' },
    { id: 'X', x: -19, d: 0, role: 'wr' }, { id: 'Z', x: 17, d: 1, role: 'wr' },
  ],
  ace: [
    { id: 'QB', x: 0, d: 1, role: 'qb' }, { id: 'RB', x: 0, d: 6, role: 'rb' },
    { id: 'Y', x: 6, d: 0, role: 'te' }, { id: 'H', x: -6, d: 0, role: 'te' },
    { id: 'X', x: -18, d: 1, role: 'wr' }, { id: 'Z', x: 17, d: 1, role: 'wr' },
  ],
  wing: [
    { id: 'QB', x: 0, d: 1, role: 'qb' }, { id: 'RB', x: 0, d: 6, role: 'rb' },
    { id: 'Y', x: 6, d: 0, role: 'te' }, { id: 'H', x: 7.5, d: 1, role: 'te' },
    { id: 'X', x: -19, d: 0, role: 'wr' }, { id: 'Z', x: 17, d: 1, role: 'wr' },
  ],
  pistol: [
    { id: 'QB', x: 0, d: 4, role: 'qb' }, { id: 'RB', x: 0, d: 7, role: 'rb' },
    { id: 'Y', x: 6, d: 0, role: 'te' }, { id: 'H', x: -10, d: 1, role: 'wr' },
    { id: 'X', x: -20, d: 0, role: 'wr' }, { id: 'Z', x: 18, d: 1, role: 'wr' },
  ],
};

export function offenseLayout(formation = 'spread', strength = 'right') {
  const s = strength === 'left' ? -1 : 1;
  const base = LAYOUTS[formation] || LAYOUTS.spread;
  return [...OL, ...base].map(p => ({ ...p, x: p.x * s }));
}

// Where the motion man ends up.
export function motionTarget(p) {
  if (p.role === 'rb' || Math.abs(p.x) < 3) {
    const side = p.x <= 0 ? 1 : -1;
    return { x: side * 13, d: Math.max(1, p.d - 2) };
  }
  // receivers and wings come across the formation
  return { x: -Math.sign(p.x) * Math.max(4, Math.abs(p.x) * 0.45), d: Math.max(p.d, 1.5) };
}

// Defensive alignment, from the defense looking at the offense.
// The defense faces "down" the screen, so its left is +x.
export const DEFENSE_ALIGN = {
  'Left End':    { x: 6.5, d: 1, role: 'dl' },
  'Right End':   { x: -6.5, d: 1, role: 'dl' },
  '3 Tech':      { x: 3, d: 1, role: 'dl' },
  '1 Tech':      { x: -1, d: 1, role: 'dl' },
  'Mike':        { x: -1.5, d: 5, role: 'lb' },
  'Will':        { x: 3.5, d: 5, role: 'lb' },
  'Star':        { x: -10, d: 4, role: 'lb' },
  'Bama':        { x: 10, d: 4, role: 'lb' },
  'Corner':      { x: -19, d: 7, role: 'db' },
  'Corner2':     { x: 19, d: 7, role: 'db' },
  'Free Safety': { x: 0, d: 12, role: 'db' },
};

export function defenseLayout(offense) {
  // Corners and overhangs slide over the widest receivers.
  const wide = offense.filter(p => p.role === 'wr' || p.role === 'te');
  const leftMost = wide.reduce((a, p) => (p.x < a.x ? p : a), { x: -19 });
  const rightMost = wide.reduce((a, p) => (p.x > a.x ? p : a), { x: 19 });
  return Object.entries(DEFENSE_ALIGN).map(([pos, a]) => {
    let x = a.x;
    if (pos === 'Corner') x = Math.min(-8, leftMost.x + 1);
    if (pos === 'Corner2') x = Math.max(8, rightMost.x - 1);
    return { id: pos, x, d: a.d, role: a.role };
  });
}
