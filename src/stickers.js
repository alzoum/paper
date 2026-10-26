// Decorative stickers scattered around the library. Drag them anywhere; they remember where you left them.
// Double-click one to send it home.

const S = 'stroke="#141414" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';

function starPath(cx, cy, points, outer, inner) {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (Math.PI * i) / points - Math.PI / 2;
    d += `${i ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  }
  return d + 'Z';
}

const STICKERS = [
  {
    id: 'mug',
    w: 96,
    home: { dx: -560, y: 16, r: -8 },
    svg: `<svg viewBox="0 0 100 96" ${S}>
      <path d="M38 24c-5-5 5-8 0-15M54 24c-5-5 5-8 0-15" fill="none"/>
      <path d="M72 42h6a11 11 0 0 1 0 22h-6" fill="none" stroke-width="6"/>
      <path d="M72 42h6a11 11 0 0 1 0 22h-6" fill="none" stroke="#FBF3E1" stroke-width="1"/>
      <path d="M20 32h52v38a16 16 0 0 1-16 16H36a16 16 0 0 1-16-16z" fill="#FBF3E1"/>
      <path d="M21.5 50h49v12h-49z" fill="#C23A1E" stroke="none"/>
      <path d="M20 32h52v38a16 16 0 0 1-16 16H36a16 16 0 0 1-16-16z" fill="none"/>
    </svg>`,
  },
  {
    id: 'heart',
    w: 56,
    home: { dx: -420, y: 36, r: 12 },
    svg: `<svg viewBox="0 0 60 56" ${S}>
      <path d="M30 52S4 36 4 18A13 13 0 0 1 30 12a13 13 0 0 1 26 6c0 18-26 34-26 34z" fill="#C23A1E"/>
      <path d="M14 18a6 6 0 0 1 6-5" fill="none" stroke="#FBF3E1" stroke-width="3.5"/>
    </svg>`,
  },
  {
    id: 'glasses',
    w: 124,
    home: { dx: -600, y: 56, r: -6 },
    svg: `<svg viewBox="0 0 132 62" ${S}>
      <path d="M14 28L4 16M118 28l10-12" fill="none" stroke-width="4"/>
      <path d="M56 30q10-9 20 0" fill="none" stroke-width="4"/>
      <circle cx="35" cy="34" r="22" fill="#8FD19A"/>
      <circle cx="97" cy="34" r="22" fill="#8FD19A"/>
      <path d="M24 28q5-7 13-6M86 28q5-7 13-6" fill="none" stroke="#fff" stroke-width="4"/>
    </svg>`,
  },
  {
    id: 'plane',
    w: 116,
    home: { dx: -540, y: 76, r: 6 },
    svg: `<svg viewBox="0 0 120 84" ${S}>
      <path d="M4 78q22-2 34-22" fill="none" stroke-dasharray="2 8"/>
      <path d="M30 44L114 8 84 76 62 56z" fill="#fff"/>
      <path d="M62 56L114 8 56 70z" fill="#B3AAF0"/>
      <path d="M62 56L114 8" fill="none"/>
    </svg>`,
  },
  {
    id: 'pencil',
    w: 130,
    home: { dx: 440, y: 12, r: 24 },
    svg: `<svg viewBox="0 0 124 40" ${S}>
      <path d="M18 8h66v24H18z" fill="#F2C744"/>
      <path d="M18 20h66" fill="none" stroke-width="2"/>
      <path d="M6 8h12v24H6a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" fill="#C23A1E"/>
      <path d="M84 8l30 12-30 12z" fill="#FBF3E1"/>
      <path d="M104 16l10 4-10 4z" fill="#141414"/>
    </svg>`,
  },
  {
    id: 'book',
    w: 128,
    home: { dx: 450, y: 56, r: -7 },
    svg: `<svg viewBox="0 0 130 92" ${S}>
      <path d="M65 24C50 14 28 12 8 16v60c20-4 42-2 57 8 15-10 37-12 57-8V16c-20-4-42-2-57 8z" fill="#7B6FD8"/>
      <path d="M65 20C50 10 28 8 10 12v58c20-4 40-2 55 8z" fill="#FBF3E1"/>
      <path d="M65 20c15-10 37-12 55-8v58c-20-4-40-2-55 8z" fill="#FBF3E1"/>
      <path d="M22 28q16-3 32 3M22 40q16-3 32 3M22 52q16-3 32 3M78 31q16-6 30-3M78 43q16-6 30-3" fill="none" stroke-width="2.5"/>
      <path d="M96 9v28l6-5 6 5V9" fill="#C23A1E"/>
    </svg>`,
  },
  {
    id: 'star',
    w: 104,
    home: { dx: 470, y: 76, r: 10 },
    svg: `<svg viewBox="0 0 104 104" ${S}>
      <path d="${starPath(52, 52, 12, 48, 38)}" fill="#F2C744"/>
      <circle cx="40" cy="46" r="4" fill="#141414" stroke="none"/>
      <circle cx="64" cy="46" r="4" fill="#141414" stroke="none"/>
      <path d="M38 60q14 12 28 0" fill="none" stroke-width="3.5"/>
      <circle cx="31" cy="57" r="5" fill="#F4A28C" stroke="none"/>
      <circle cx="73" cy="57" r="5" fill="#F4A28C" stroke="none"/>
    </svg>`,
  },
];

const STORE_KEY = 'folio.stickers';

function loadPlaces() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch {
    return {};
  }
}

function savePlaces(places) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(places));
  } catch {}
}

export function mountStickers(root) {
  const layer = document.createElement('div');
  layer.className = 'sticker-layer';
  layer.setAttribute('aria-hidden', 'true');
  root.prepend(layer);

  const places = loadPlaces();

  for (const s of STICKERS) {
    const el = document.createElement('div');
    el.className = `sticker sticker-${s.id}`;
    el.innerHTML = s.svg;
    el.style.setProperty('--w', s.w + 'px');
    el.title = 'Drag me around';
    layer.append(el);

    const place = () => {
      const p = places[s.id] || s.home;
      // dx is measured from the page centre so stickers stay in the margins on wide screens;
      // clamp keeps them on screen when the window is narrow. y is a share of the viewport height.
      el.style.left = `clamp(8px, calc(50% + ${p.dx}px), calc(100% - ${s.w + 12}px))`;
      el.style.top = `${p.y}vh`;
      el.style.setProperty('--r', `${p.r}deg`);
    };
    place();

    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const lr = layer.getBoundingClientRect();
      const ox = e.clientX - lr.left - el.offsetLeft;
      const oy = e.clientY - lr.top - el.offsetTop;
      drag = { ox, oy, lr, moved: false, sx: e.clientX, sy: e.clientY };
      el.setPointerCapture(e.pointerId);
      el.classList.add('lifted');
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true;
      const left = e.clientX - drag.lr.left - drag.ox;
      const top = e.clientY - drag.lr.top - drag.oy;
      el.style.left = Math.max(0, Math.min(left, drag.lr.width - s.w)) + 'px';
      el.style.top = Math.max(0, top) + 'px';
    });
    const drop = () => {
      if (!drag) return;
      el.classList.remove('lifted');
      if (drag.moved) {
        // Layout offsets ignore the tilt and bob animation, so the sticker lands exactly where it was dropped.
        const prev = places[s.id] || s.home;
        places[s.id] = {
          dx: Math.round(el.offsetLeft - layer.clientWidth / 2),
          y: +((el.offsetTop / window.innerHeight) * 100).toFixed(2),
          r: prev.r,
        };
        savePlaces(places);
        place();
      } else {
        el.classList.remove('boing');
        void el.offsetWidth;
        el.classList.add('boing');
      }
      drag = null;
    };
    el.addEventListener('pointerup', drop);
    el.addEventListener('pointercancel', drop);
    el.addEventListener('dblclick', () => {
      delete places[s.id];
      savePlaces(places);
      place();
    });
  }
}
