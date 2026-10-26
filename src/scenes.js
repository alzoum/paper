// ADHD mode: moving desk scenes that match the mood sound: rain falls, flames flicker, leaves drift,
// steam curls and notes float. Everything is a flat sticker with a black outline, animated
// with CSS transforms only so it stays smooth behind the book.

const INK = '#141414';
const OUTLINE = `stroke="${INK}" stroke-linejoin="round" stroke-linecap="round"`;

const rand = (a, b) => a + Math.random() * (b - a);

// Open desk on either side of the book, as percentages of the stage width. When the book
// fills the width (phones), pieces may go anywhere and show above and below it.
let zone = { l: 0, r: 100 };
const roomy = () => zone.l > 6 && 100 - zone.r > 6;
function x(margin = 1) {
  if (!roomy()) return rand(-3, 100);
  return Math.random() < 0.5 ? rand(-2, zone.l - margin) : rand(zone.r + margin * 0.3, 100 - margin);
}
// Evenly spaced spots along both open sides, for rows like flames and grass.
function row(step) {
  if (!roomy()) return Array.from({ length: Math.ceil(104 / step) }, (_, i) => i * step - 4);
  const out = [];
  for (let p = -3; p < zone.l - 1; p += step) out.push(p);
  for (let p = zone.r - 2; p < 101; p += step) out.push(p);
  return out;
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

const DROP = `<svg viewBox="0 0 12 20" width="12" height="20"><path d="M6 1S1 9 1 13a5 5 0 0 0 10 0C11 9 6 1 6 1z" fill="#FBF3E1" ${OUTLINE} stroke-width="2"/></svg>`;

const CLOUD = (w) =>
  `<svg viewBox="0 0 120 60" width="${w}" height="${w / 2}"><path d="M22 52a16 16 0 0 1-2-32 22 22 0 0 1 40-10 18 18 0 0 1 30 8 16 16 0 0 1 8 34z" fill="#FBF3E1" ${OUTLINE} stroke-width="3.5"/></svg>`;

const FLAME = `<svg viewBox="0 0 40 60" width="100%" height="100%" preserveAspectRatio="none"><path d="M20 2c4 12 18 20 18 36a18 18 0 0 1-36 0c0-9 6-14 10-20 1 6 3 8 6 8-2-8 0-17 2-24z" fill="#C23A1E" ${OUTLINE} stroke-width="3"/><path d="M20 26c4 6 10 9 10 16a10 10 0 0 1-20 0c0-6 5-9 10-16z" fill="#F2C744" ${OUTLINE} stroke-width="2.5"/></svg>`;

const EMBER = (c) => `<svg viewBox="0 0 12 12" width="10" height="10"><circle cx="6" cy="6" r="4.5" fill="${c}" ${OUTLINE} stroke-width="2"/></svg>`;

const LEAF = (fill) =>
  `<svg viewBox="0 0 32 32" width="100%" height="100%"><path d="M5 27C3 14 12 4 28 4c1 14-7 23-19 23z" fill="${fill}" ${OUTLINE} stroke-width="2.5"/><path d="M5 27c4-7 10-12 17-16" fill="none" ${OUTLINE} stroke-width="2.2"/></svg>`;

const GRASS = `<svg viewBox="0 0 40 40" width="100%" height="100%" preserveAspectRatio="none"><path d="M4 40C6 26 4 16 2 8c6 8 9 18 10 32M14 40c0-14 4-26 10-36-2 12-3 24-2 36M24 40c2-10 8-18 14-22-6 8-8 14-8 22" fill="#8FD19A" ${OUTLINE} stroke-width="2.5"/></svg>`;

const MUG = `<svg viewBox="0 0 70 60" width="70" height="60"><path d="M54 22h4a9 9 0 0 1 0 18h-4" fill="none" ${OUTLINE} stroke-width="4"/><path d="M8 14h46v28a14 14 0 0 1-14 14H22A14 14 0 0 1 8 42z" fill="#FBF3E1" ${OUTLINE} stroke-width="3"/><path d="M9.5 28h43v9h-43z" fill="#C23A1E"/><path d="M8 14h46v28a14 14 0 0 1-14 14H22A14 14 0 0 1 8 42z" fill="none" ${OUTLINE} stroke-width="3"/></svg>`;

const STEAM = `<svg viewBox="0 0 20 60" width="20" height="60"><path d="M10 58c-8-8 8-14 0-22S18 22 10 14 12 4 10 2" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M10 58c-8-8 8-14 0-22S18 22 10 14 12 4 10 2" fill="none" stroke="#FBF3E1" stroke-width="3.5" stroke-linecap="round"/></svg>`;

const BUBBLE = `<svg viewBox="0 0 46 36" width="46" height="36"><path d="M6 4h34a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H18l-9 6 2-6H6a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="#FBF3E1" ${OUTLINE} stroke-width="2.5"/><circle cx="15" cy="16" r="2.4" fill="${INK}"/><circle cx="23" cy="16" r="2.4" fill="${INK}"/><circle cx="31" cy="16" r="2.4" fill="${INK}"/></svg>`;

const NOTE = (fill, two) =>
  two
    ? `<svg viewBox="0 0 36 40" width="100%" height="100%"><path d="M11 32V8l20-5v24" fill="none" ${OUTLINE} stroke-width="3.5"/><path d="M11 8l20-5v6l-20 5z" fill="${INK}"/><ellipse cx="7" cy="32" rx="6" ry="5" fill="${fill}" ${OUTLINE} stroke-width="2.5"/><ellipse cx="27" cy="27" rx="6" ry="5" fill="${fill}" ${OUTLINE} stroke-width="2.5"/></svg>`
    : `<svg viewBox="0 0 26 40" width="100%" height="100%"><path d="M12 32V4c4 6 12 6 10 16" fill="none" ${OUTLINE} stroke-width="3.5"/><ellipse cx="8" cy="32" rx="7" ry="5.5" fill="${fill}" ${OUTLINE} stroke-width="2.5"/></svg>`;

const SPARK = (fill) =>
  `<svg viewBox="-2 -2 28 28" width="100%" height="100%"><path d="M12 0C13 7 17 11 24 12 17 13 13 17 12 24 11 17 7 13 0 12 7 11 11 7 12 0Z" fill="${fill}" ${OUTLINE} stroke-width="2"/></svg>`;

// Each piece: an outer element that travels and an inner one that wobbles, with
// negative delays so the scene is already in full swing when it appears.
function piece(cls, style, inner, innerCls = '') {
  return `<i class="sc ${cls}" style="${style}"><b class="${innerCls}">${inner}</b></i>`;
}

const BUILD = {
  rain() {
    let html = '';
    for (let i = 0; i < 4; i++)
      html += piece('cloud', `top:${rand(2, 14).toFixed(1)}%;--t:${rand(60, 110).toFixed(0)}s;--d:-${rand(0, 100).toFixed(0)}s`, CLOUD(rand(90, 150)));
    for (let i = 0; i < 40; i++) {
      const t = rand(0.9, 1.6);
      html += piece('drop', `left:${x().toFixed(1)}%;--t:${t.toFixed(2)}s;--d:-${rand(0, t).toFixed(2)}s;--s:${rand(0.7, 1.2).toFixed(2)}`, DROP);
    }
    return html;
  },

  fire() {
    let html = '';
    for (const at of row(roomy() ? 3.2 : 6.5)) {
      const h = rand(70, 140);
      html += piece(
        'flame',
        `left:${(at + rand(-1, 1)).toFixed(1)}%;--h:${h.toFixed(0)}px;--w:${(h * 0.62).toFixed(0)}px;--t:${rand(0.6, 1.1).toFixed(2)}s;--d:-${rand(0, 1).toFixed(2)}s`,
        FLAME,
      );
    }
    for (let i = 0; i < 26; i++) {
      const t = rand(3, 6);
      html += piece(
        'ember',
        `left:${x().toFixed(1)}%;--t:${t.toFixed(2)}s;--d:-${rand(0, t).toFixed(2)}s;--x:${rand(-40, 40).toFixed(0)}px`,
        EMBER(pick(['#F2C744', '#F2C744', '#C23A1E', '#FBF3E1'])),
      );
    }
    return html;
  },

  forest() {
    let html = '';
    for (let i = 0; i < 22; i++) {
      const t = rand(9, 16);
      const size = rand(22, 40);
      html += piece(
        'leaf',
        `left:${x().toFixed(1)}%;--size:${size.toFixed(0)}px;--t:${t.toFixed(1)}s;--d:-${rand(0, t).toFixed(1)}s;--sway:${rand(2.5, 4.5).toFixed(1)}s;--x:${rand(30, 80).toFixed(0)}px`,
        LEAF(pick(['#8FD19A', '#8FD19A', '#1F4A2E', '#F2C744'])),
        'sway',
      );
    }
    for (const at of row(roomy() ? 3.5 : 7))
      html += piece(
        'grass',
        `left:${at.toFixed(1)}%;--h:${rand(34, 60).toFixed(0)}px;--t:${rand(2.5, 4).toFixed(1)}s;--d:-${rand(0, 3).toFixed(1)}s`,
        GRASS,
      );
    return html;
  },

  cafe() {
    let html = '';
    const spots = roomy() ? [zone.l / 2 - 3, (zone.r + 100) / 2 - 3] : [8, 78];
    for (const left of spots) {
      html += piece('mug', `left:${left.toFixed(1)}%`, MUG);
      for (let k = 0; k < 3; k++)
        html += piece('steam', `left:calc(${left}% + ${18 + k * 12}px);--t:${rand(3, 4.5).toFixed(1)}s;--d:-${rand(0, 4).toFixed(1)}s`, STEAM);
    }
    for (let i = 0; i < 7; i++) {
      const t = rand(7, 12);
      html += piece('bubble', `left:${x().toFixed(1)}%;--t:${t.toFixed(1)}s;--d:-${rand(0, t).toFixed(1)}s;--r:${rand(-10, 10).toFixed(0)}deg`, BUBBLE);
    }
    return html;
  },

  music() {
    let html = '';
    for (let i = 0; i < 20; i++) {
      const t = rand(8, 14);
      html += piece(
        'note',
        `left:${x().toFixed(1)}%;--size:${rand(26, 44).toFixed(0)}px;--t:${t.toFixed(1)}s;--d:-${rand(0, t).toFixed(1)}s;--sway:${rand(2, 3.5).toFixed(1)}s;--x:${rand(20, 50).toFixed(0)}px`,
        NOTE(pick(['#F2C744', '#FBF3E1', '#8FD19A', '#F4A28C']), Math.random() < 0.4),
        'sway',
      );
    }
    for (let i = 0; i < 12; i++)
      html += piece(
        'twinkle',
        `left:${x().toFixed(1)}%;top:${rand(4, 90).toFixed(1)}%;--size:${rand(12, 24).toFixed(0)}px;--t:${rand(2, 4).toFixed(1)}s;--d:-${rand(0, 4).toFixed(1)}s`,
        SPARK(pick(['#FBF3E1', '#F2C744'])),
      );
    return html;
  },
};

export function sceneHtml(kind, open = { l: 0, r: 100 }) {
  zone = open;
  return BUILD[kind] ? BUILD[kind]() : '';
}
