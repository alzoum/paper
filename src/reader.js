import { PageFlip } from 'page-flip';
import { addReadingTime, getBook, getFile, getSettings, listMarks, putMark, removeMark, saveSettings, shelfOf, uid, updateBook } from './db.js';
import { openPdf, renderPageToCanvas } from './pdf.js';
import { playPageTurn, resumeAudio, setAmbience, setAmbienceVolume, setSoundEnabled, stopAmbience } from './sound.js';
import { clothColor, escapeHtml, icon, sparkle, toast } from './icons.js';
import { sceneHtml } from './scenes.js';

const PENCIL_COLORS = { graphite: '#3A3A3A', red: '#C23A1E', blue: '#2F5BD3' };
const PENCIL_WIDTH = 3.2; // in page units, where a page is 1000 wide
const HIGHLIGHT_COLORS = {
  yellow: '#F2C744',
  green: '#8FD19A',
  pink: '#F4A28C',
  blue: '#B3AAF0',
};
// 'original' shows the PDF exactly as the file draws it; the others recolour it.
const PAPERS = { original: 'Original', cream: 'Warm', night: 'Dark' };
const LAYOUTS = { two: 'Two pages', one: 'One page' };
const ZOOMS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
const MAX_ZOOM = 4;
const DESKS = { purple: 'Purple', forest: 'Forest', mint: 'Mint', ink: 'Ink' };
// Moods for the leaf button: name and icon.
const AMBIENCES = {
  music: ['Calm piano', 'music'],
  rain: ['Rainy window', 'rain'],
  forest: ['Forest morning', 'tree'],
  fire: ['Fireside', 'flame'],
  cafe: ['Corner café', 'cup'],
};
const LEAF = `<svg class="leaf" width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 27C3 14 12 4 28 4c1 14-7 23-19 23z" fill="#8FD19A" stroke="#141414" stroke-width="2.5" stroke-linejoin="round"/><path d="M5 27c4-7 10-12 17-16" fill="none" stroke="#141414" stroke-width="2.2" stroke-linecap="round"/><path d="M12 20l-.5-5M16 16.5l4 .3" fill="none" stroke="#141414" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const PANEL_TITLES = { contents: 'Contents', search: 'Search', bookmark: 'Bookmarks', highlight: 'Highlights', note: 'Notes' };
const MAX_HITS = 300;
// Reading time only counts while someone is actually there.
const IDLE_AFTER = 5 * 60 * 1000;
const RENDER_AHEAD = 5;
const KEEP_RENDERED = 14;
// Height of a single marker stroke, as a fraction of the page height.
const MARKER_BAND = 0.022;

/**
 * Opens a book in the reader. Resolves to a cleanup function, or null if the
 * book can't be found.
 */
export async function openReader(bookId, container) {
  const [book, file, settings] = await Promise.all([getBook(bookId), getFile(bookId), getSettings()]);
  if (!book || !file) {
    toast('That book is no longer on your shelf');
    return null;
  }
  if (!DESKS[settings.desk]) settings.desk = 'purple';
  if (!PAPERS[settings.paper]) settings.paper = 'original';
  if (!LAYOUTS[settings.layout]) settings.layout = 'two';
  if (!AMBIENCES[settings.ambience]) settings.ambience = 'off';
  if (!(settings.ambienceVolume >= 0 && settings.ambienceVolume <= 1)) settings.ambienceVolume = 0.7;
  if (!AMBIENCES[settings.lastMood]) settings.lastMood = 'music';
  setSoundEnabled(settings.sound);
  // Opening a book from "Want to read" means you're reading it now.
  if (shelfOf(book) === 'want') book.shelf = 'reading';
  updateBook(book.id, { lastOpenedAt: Date.now(), shelf: shelfOf(book) });

  const N = book.pageCount;
  // Flip-book layout: 0 = front cover, 1..N = PDF pages, optional blank, then back cover.
  // An even page total keeps the back cover alone on the left.
  const hasBlank = N % 2 === 1;
  const backIndex = N + 1 + (hasBlank ? 1 : 0);
  const total = backIndex + 1;

  const root = document.createElement('div');
  root.className = `reader paper-${settings.paper} desk-${settings.desk}`;
  root.style.setProperty('--cloth', clothColor(book.id));
  root.innerHTML = template(book);
  container.append(root);

  const $ = (s) => root.querySelector(s);
  const stage = $('.stage');
  const host = $('.book-host');
  const ink = $('.ink-layer');
  const panel = $('.panel');
  const scrub = $('.scrub');
  scrub.max = String(total - 1);

  let marks = [];
  let tool = 'read';
  let color = 'yellow';
  let pencilColor = 'graphite';
  const pencilHistory = []; // ids of strokes written this session, for undo
  // Pencil strokes live in an SVG sized to the page's own proportions, so lines never stretch.
  const PAGE_H = Math.round(1000 * (book.ratio || 1.414));
  let closed = false;
  let pdf = null;
  const cleanups = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };

  // ---------- pages ----------
  const pageEls = [];
  for (let i = 0; i < total; i++) pageEls.push(makePage(i));

  function makePage(i) {
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.index = i;
    if (i === 0 || i === backIndex) {
      el.dataset.density = 'hard';
      el.classList.add('cover', i === 0 ? 'cover-front' : 'cover-back');
      el.innerHTML =
        i === 0
          ? `<div class="cover-inner">
              ${sparkle('#ffffff', 30, 'deco c1')}${sparkle('#F2C744', 20, 'deco c2')}
              <div class="cover-label"><span class="tape"></span><span class="tag"></span><h2>${escapeHtml(book.title)}</h2>${
                book.author ? `<p>${escapeHtml(book.author)}</p>` : ''
              }</div>
              <span class="cover-hint">Drag the corner to open</span>
            </div>`
          : `<div class="cover-inner"><span class="colophon">Paper</span></div>`;
    } else if (i > N) {
      el.classList.add('blank');
      el.innerHTML = '<div class="paper"><span class="the-end">·</span></div>';
    } else {
      el.classList.add('pdf');
      el.dataset.page = i;
      el.innerHTML = `
        <div class="paper">
          <div class="sheet loading"></div>
          <div class="tint"></div>
          <div class="marks"></div>
          <button class="ribbon" data-page="${i}" aria-label="Bookmark page ${i}" title="Bookmark this page"></button>
          <span class="folio-num">${i}</span>
        </div>`;
    }
    return el;
  }

  // ---------- page flip ----------
  const bookEl = document.createElement('div');
  bookEl.className = 'book';
  host.append(bookEl);

  const baseW = 500;
  const startPage = Math.min(Math.max(book.lastPage || 0, 0), total - 1);
  const flip = new PageFlip(bookEl, {
    width: baseW,
    height: Math.round(baseW * (book.ratio || 1.414)),
    size: 'stretch',
    minWidth: 280,
    maxWidth: 1600,
    minHeight: 200,
    maxHeight: 2400,
    showCover: true,
    usePortrait: true,
    autoSize: false,
    maxShadowOpacity: 0.45,
    flippingTime: 750,
    mobileScrollSupport: false,
    swipeDistance: 30,
    startPage,
  });
  flip.loadFromHTML(pageEls);

  let current = flip.getCurrentPageIndex();
  flip.on('flip', (e) => {
    current = e.data;
    onPageChanged();
  });
  flip.on('changeState', (e) => {
    root.dataset.state = e.data;
    if (e.data === 'flipping') {
      playPageTurn();
      // Opening or closing a cover: slide the book toward the centre as it swings.
      if (current === 0 || current >= backIndex) centerClosedBook(true);
    }
    if (e.data === 'read') {
      centerClosedBook();
      setTimeout(refreshScene, 450); // after the cover finishes sliding
    }
  });
  // page-flip only finishes a dragged page once it crosses the spine. A real page goes over with a
  // modest pull or a quick flick, so judge the release by how far and how fast the hand moved.
  const flipper = flip.getFlipController();
  const settleBack = flipper.stopMove.bind(flipper);
  let pull = null;
  on(bookEl, 'pointerdown', (e) => (pull = { x0: e.clientX, x: e.clientX, t: performance.now(), vx: 0 }));
  on(window, 'pointermove', (e) => {
    if (!pull) return;
    const now = performance.now();
    const dt = now - pull.t;
    if (dt > 0) pull.vx = 0.7 * ((e.clientX - pull.x) / dt) + 0.3 * pull.vx;
    pull.x = e.clientX;
    pull.t = now;
  });
  flipper.stopMove = () => {
    const calc = flipper.calc;
    if (calc && pull && flip.getState() === 'user_fold') {
      const toward = calc.getDirection() === 0 ? -1 : 1; // forward turns pull left, back turns pull right
      const rect = flipper.getBoundsRect();
      const dragged = (pull.x - pull.x0) * toward;
      const speed = performance.now() - pull.t < 90 ? pull.vx * toward : 0; // px/ms, ignore a held-still hand
      if (dragged > rect.pageWidth * 0.2 || (speed > 0.35 && dragged > 20)) {
        pull = null;
        const y = calc.getCorner() === 'bottom' ? rect.height : 0;
        return flipper.animateFlippingTo(calc.getPosition(), { x: -rect.pageWidth, y }, true);
      }
    }
    pull = null;
    settleBack();
  };

  flip.on('changeOrientation', () => {
    queueRenders();
    updateLabels();
    centerClosedBook();
  });

  // A closed book sits in the middle of the desk, not on one half of the spread.
  function centerClosedBook(opening = false) {
    const landscape = flip.getOrientation() === 'landscape';
    const half = (flip.getBoundsRect()?.pageWidth || 0) / 2;
    let shift = 0;
    if (landscape && !opening && current === 0) shift = -half;
    if (landscape && !opening && current >= backIndex) shift = half;
    bookEl.style.transform = shift ? `translateX(${shift}px)` : '';
  }

  // ---------- rendering PDF pages lazily ----------
  const rendered = new Map(); // page -> rendered pixel width
  const pending = new Set();
  let rendering = false;

  let zoom = 1;

  // Render each page at the pixel size it actually occupies on screen (plus headroom when unzoomed),
  // so text stays as crisp as the original file.
  function pageWidthPx() {
    const w = flip.getBoundsRect()?.pageWidth || 500;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    return Math.min(Math.ceil(w * dpr * (zoom > 1 ? 1 : 1.35)), 4096);
  }

  function visiblePages() {
    const portrait = flip.getOrientation() === 'portrait';
    if (portrait || current === 0) return [current];
    if (current === backIndex) return [current];
    const left = current % 2 === 1 ? current : current - 1;
    return [left, left + 1].filter((i) => i < total);
  }

  function queueRenders() {
    const want = pageWidthPx();
    for (let i = current - RENDER_AHEAD; i <= current + RENDER_AHEAD + 1; i++) {
      if (i >= 1 && i <= N && (rendered.get(i) || 0) < want * 0.95) pending.add(i);
    }
    // Free memory far from where you're reading.
    for (const p of [...rendered.keys()]) {
      if (Math.abs(p - current) > (zoom > 1.5 ? 4 : KEEP_RENDERED)) {
        const sheet = pageEls[p].querySelector('.sheet');
        sheet.replaceChildren();
        sheet.classList.add('loading');
        rendered.delete(p);
      }
    }
    pump();
  }

  async function pump() {
    if (rendering || closed || !pdf) return;
    rendering = true;
    while (pending.size && !closed) {
      const next = [...pending].sort((a, b) => Math.abs(a - current) - Math.abs(b - current))[0];
      pending.delete(next);
      const width = pageWidthPx();
      try {
        const canvas = await renderPageToCanvas(pdf, next, width);
        if (closed) break;
        const sheet = pageEls[next].querySelector('.sheet');
        sheet.replaceChildren(canvas);
        sheet.classList.remove('loading');
        rendered.set(next, width);
      } catch (err) {
        if (!closed) console.error('render failed', next, err);
      }
    }
    rendering = false;
  }

  // ---------- marks: bookmarks, highlights, notes ----------
  function marksOn(page, type) {
    return marks.filter((m) => m.page === page && (!type || m.type === type));
  }

  function drawMarks(page) {
    const el = pageEls[page];
    if (!el || !el.classList.contains('pdf')) return;
    const layer = el.querySelector('.marks');
    let html = '';
    for (const m of marksOn(page)) {
      if (m.type === 'highlight') {
        const r = m.rect;
        html += `<div class="hl" data-id="${m.id}" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%;--hl:${HIGHLIGHT_COLORS[m.color] || HIGHLIGHT_COLORS.yellow}"></div>`;
      } else if (m.type === 'note') {
        html += `<button class="note-pin" data-id="${m.id}" style="left:${m.x * 100}%;top:${m.y * 100}%" title="${escapeHtml(m.text)}" aria-label="Note: ${escapeHtml(m.text)}"></button>`;
      }
    }
    const lines = marksOn(page, 'pencil');
    if (lines.length) html += scribbleSvg(lines.map((m) => pathTag(m.points, m.color, m.id)).join(''));
    layer.innerHTML = html;
    el.querySelector('.ribbon').classList.toggle('on', marksOn(page, 'bookmark').length > 0);
  }

  function scribbleSvg(inner) {
    return `<svg class="scribbles" viewBox="0 0 1000 ${PAGE_H}" preserveAspectRatio="none" aria-hidden="true">${inner}</svg>`;
  }

  function pathTag(points, c, id = '') {
    return `<path class="pc-${c}" data-id="${id}" d="${pencilPath(points)}" stroke-width="${PENCIL_WIDTH}"/>`;
  }

  // Smooth the hand's points into curves through their midpoints.
  function pencilPath(points) {
    const P = points.map(([x, y]) => [+(x * 1000).toFixed(1), +(y * PAGE_H).toFixed(1)]);
    if (P.length === 1) return `M${P[0][0]} ${P[0][1]}h0.1`;
    let d = `M${P[0][0]} ${P[0][1]}`;
    for (let i = 1; i < P.length - 1; i++) {
      const mx = ((P[i][0] + P[i + 1][0]) / 2).toFixed(1);
      const my = ((P[i][1] + P[i + 1][1]) / 2).toFixed(1);
      d += `Q${P[i][0]} ${P[i][1]} ${mx} ${my}`;
    }
    const last = P[P.length - 1];
    return d + `L${last[0]} ${last[1]}`;
  }

  async function addMark(mark) {
    mark.id ??= uid();
    mark.bookId = book.id;
    mark.createdAt ??= Date.now();
    marks.push(mark);
    drawMarks(mark.page);
    refreshPanel();
    updateLabels();
    await putMark(mark);
    return mark;
  }

  async function deleteMark(id, { undo = true } = {}) {
    const m = marks.find((x) => x.id === id);
    if (!m) return;
    marks = marks.filter((x) => x.id !== id);
    drawMarks(m.page);
    refreshPanel();
    updateLabels();
    await removeMark(id);
    if (undo) {
      const what = { bookmark: 'Bookmark', highlight: 'Highlight', note: 'Note', pencil: 'Pencil mark' }[m.type];
      toast(`${what} removed`, { label: 'Undo', run: () => addMark(m) });
    }
  }

  function toggleBookmark(page) {
    if (page < 1 || page > N) return;
    const existing = marksOn(page, 'bookmark')[0];
    if (existing) deleteMark(existing.id, { undo: false });
    else {
      addMark({ type: 'bookmark', page });
      playPageTurn(0.35);
    }
  }

  // ---------- ink layer: pencil, highlighter, sticky notes, eraser ----------
  function hitTest(x, y) {
    ink.style.pointerEvents = 'none';
    const el = document.elementFromPoint(x, y);
    ink.style.pointerEvents = '';
    return el;
  }

  function pageFromPoint(x, y) {
    const page = hitTest(x, y)?.closest?.('.page.pdf');
    if (!page) return null;
    const r = page.getBoundingClientRect();
    return {
      page: Number(page.dataset.page),
      el: page,
      fx: (x - r.left) / r.width,
      fy: (y - r.top) / r.height,
      rect: r,
    };
  }

  let stroke = null;
  on(ink, 'pointerdown', (e) => {
    if (tool === 'read' || ['flipping', 'user_fold'].includes(flip.getState())) return;
    e.preventDefault();
    if (tool === 'erase') {
      ink.setPointerCapture(e.pointerId);
      stroke = { erase: true };
      eraseAt(e.clientX, e.clientY);
      return;
    }
    if (tool === 'note') {
      const pin = hitTest(e.clientX, e.clientY)?.closest?.('.note-pin');
      const m = pin && marks.find((x) => x.id === pin.dataset.id);
      if (m) return openNoteEditor(m, e.clientX, e.clientY);
    }
    const hit = pageFromPoint(e.clientX, e.clientY);
    if (!hit) return;
    ink.setPointerCapture(e.pointerId);
    stroke = { ...hit, x0: hit.fx, y0: hit.fy, x1: hit.fx, y1: hit.fy };
    if (tool === 'pencil') {
      stroke.points = [[hit.fx, hit.fy]];
      hit.el.querySelector('.marks').insertAdjacentHTML('beforeend', scribbleSvg(pathTag(stroke.points, pencilColor)));
      stroke.temp = hit.el.querySelector('.marks').lastElementChild;
    }
    if (tool === 'highlight') {
      stroke.temp = document.createElement('div');
      stroke.temp.className = 'hl drawing';
      stroke.temp.style.setProperty('--hl', HIGHLIGHT_COLORS[color]);
      hit.el.querySelector('.marks').append(stroke.temp);
      sizeStroke();
    }
  });

  on(ink, 'pointermove', (e) => {
    if (!stroke) return;
    if (stroke.erase) return eraseAt(e.clientX, e.clientY);
    if (stroke.points) {
      // Coalesced events keep fast handwriting smooth instead of joining dots.
      for (const ev of e.getCoalescedEvents?.() || [e]) {
        const x = clamp01((ev.clientX - stroke.rect.left) / stroke.rect.width);
        const y = clamp01((ev.clientY - stroke.rect.top) / stroke.rect.height);
        const [lx, ly] = stroke.points[stroke.points.length - 1];
        if (Math.hypot(x - lx, y - ly) > 0.0015) stroke.points.push([x, y]);
      }
      stroke.temp.firstElementChild.setAttribute('d', pencilPath(stroke.points));
      return;
    }
    stroke.x1 = clamp01((e.clientX - stroke.rect.left) / stroke.rect.width);
    stroke.y1 = clamp01((e.clientY - stroke.rect.top) / stroke.rect.height);
    if (stroke.temp) sizeStroke();
  });

  const endStroke = (e) => {
    if (!stroke) return;
    const s = stroke;
    stroke = null;
    if (s.erase) return;
    if (s.points) {
      const points = s.points.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]);
      addMark({ type: 'pencil', page: s.page, color: pencilColor, points }).then((m) => pencilHistory.push(m.id));
      return;
    }
    if (tool === 'highlight') {
      const raw = strokeRect(s);
      if (raw.w <= 0.012) return s.temp.remove();
      const single = raw.h === MARKER_BAND;
      textLines(s.page)
        .then((items) => (single ? snapToLine(items, raw) : raw))
        .catch(() => raw)
        .then((r) => {
          s.temp.remove();
          addMark({ type: 'highlight', page: s.page, rect: r, color, snippet: snippetFor(s.page, r) });
        });
    } else if (tool === 'note') {
      openNoteEditor({ page: s.page, x: s.x0, y: s.y0 }, e.clientX, e.clientY);
    }
  };
  on(ink, 'pointerup', endStroke);
  on(ink, 'pointercancel', () => {
    stroke?.temp?.remove();
    stroke = null;
  });

  function strokeRect(s) {
    const x = Math.min(s.x0, s.x1);
    const w = Math.abs(s.x1 - s.x0);
    const dy = Math.abs(s.y1 - s.y0);
    // A mostly-horizontal drag is one marker stroke across a line of text;
    // a taller drag highlights a block.
    if (dy < MARKER_BAND * 1.5) return { x, y: s.y0 - MARKER_BAND / 2, w, h: MARKER_BAND };
    return { x, y: Math.min(s.y0, s.y1), w, h: dy };
  }

  function sizeStroke() {
    const r = strokeRect(stroke);
    Object.assign(stroke.temp.style, {
      left: r.x * 100 + '%',
      top: r.y * 100 + '%',
      width: r.w * 100 + '%',
      height: r.h * 100 + '%',
    });
  }

  // Text positions per page (as page fractions) so a marker stroke can snap onto the line beneath it.
  const textCache = new Map();
  function textLines(p) {
    if (!textCache.has(p)) {
      textCache.set(
        p,
        (async () => {
          const page = await pdf.getPage(p);
          const vp = page.getViewport({ scale: 1 });
          const { items } = await page.getTextContent();
          const out = [];
          for (const it of items) {
            if (!it.str?.trim() || !it.width) continue;
            const [, b, c, d, e, f] = it.transform;
            if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) continue; // skip rotated text
            const size = Math.abs(d) || it.height;
            const [x0, base] = vp.convertToViewportPoint(e, f);
            const [x1] = vp.convertToViewportPoint(e + it.width, f);
            out.push({
              str: it.str,
              x: Math.min(x0, x1) / vp.width,
              w: Math.abs(x1 - x0) / vp.width,
              y: (base - size * 0.82) / vp.height,
              h: (size * 1.04) / vp.height,
            });
          }
          return out;
        })(),
      );
    }
    return textCache.get(p);
  }

  function snapToLine(items, r) {
    const cy = r.y + r.h / 2;
    const mid = (it) => it.y + it.h / 2;
    const near = items.filter((it) => Math.abs(mid(it) - cy) <= it.h && it.x < r.x + r.w && it.x + it.w > r.x);
    if (!near.length) return r;
    const best = near.reduce((a, b) => (Math.abs(mid(b) - cy) < Math.abs(mid(a) - cy) ? b : a));
    const line = near.filter((it) => Math.abs(mid(it) - mid(best)) < best.h * 0.5);
    const top = Math.min(...line.map((it) => it.y));
    const bottom = Math.max(...line.map((it) => it.y + it.h));
    const left = Math.max(r.x, Math.min(...line.map((it) => it.x)));
    const right = Math.min(r.x + r.w, Math.max(...line.map((it) => it.x + it.w)));
    if (right - left < 0.005) return r;
    const pad = (bottom - top) * 0.1;
    return { x: left - 0.003, y: top - pad, w: right - left + 0.006, h: bottom - top + pad * 2 };
  }

  function eraseAt(x, y) {
    const el = hitTest(x, y)?.closest?.('.hl, .note-pin');
    if (el?.dataset.id) return deleteMark(el.dataset.id);
    // Pencil lines are thin, so rub them out by distance rather than by what's under the pointer.
    const hit = pageFromPoint(x, y);
    if (!hit) return;
    const aspect = hit.rect.height / hit.rect.width;
    const reach = 12 / hit.rect.width;
    const line = marksOn(hit.page, 'pencil').find((m) =>
      m.points.some((p, i) => {
        const q = m.points[i + 1] || p;
        return segmentDistance(hit.fx, hit.fy * aspect, p[0], p[1] * aspect, q[0], q[1] * aspect) < reach;
      }),
    );
    if (line) deleteMark(line.id);
  }

  // A small image of what was highlighted, for the side panel.
  function snippetFor(page, r) {
    const canvas = pageEls[page].querySelector('canvas');
    if (!canvas) return '';
    const sx = r.x * canvas.width;
    const sy = r.y * canvas.height;
    const sw = Math.max(1, r.w * canvas.width);
    const sh = Math.max(1, r.h * canvas.height);
    const scale = Math.min(1, 360 / sw);
    const out = document.createElement('canvas');
    out.width = Math.round(sw * scale);
    out.height = Math.round(sh * scale);
    out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.8);
  }

  // ---------- note editor ----------
  const editor = $('.note-editor');
  let editing = null;

  function openNoteEditor(target, cx, cy) {
    editing = target;
    const ta = editor.querySelector('textarea');
    ta.value = target.text || '';
    editor.querySelector('[data-action=delete-note]').hidden = !target.id;
    editor.querySelector('.ne-title').textContent = `${target.id ? 'Note' : 'New note'} · page ${target.page}`;
    editor.hidden = false;
    const w = editor.offsetWidth;
    const h = editor.offsetHeight;
    editor.style.left = Math.min(Math.max(12, cx + 14), window.innerWidth - w - 12) + 'px';
    editor.style.top = Math.min(Math.max(12, cy - 20), window.innerHeight - h - 12) + 'px';
    ta.focus();
  }

  function closeNoteEditor() {
    editor.hidden = true;
    editing = null;
  }

  async function saveNote() {
    if (!editing) return;
    const text = editor.querySelector('textarea').value.trim();
    const target = editing;
    closeNoteEditor();
    if (!text) {
      if (target.id) deleteMark(target.id);
      return;
    }
    if (target.id) {
      target.text = text;
      target.updatedAt = Date.now();
      drawMarks(target.page);
      refreshPanel();
      await putMark(target);
    } else {
      await addMark({ type: 'note', page: target.page, x: target.x, y: target.y, text });
    }
  }

  editor.querySelector('[data-action=save-note]').onclick = saveNote;
  editor.querySelector('[data-action=cancel-note]').onclick = closeNoteEditor;
  editor.querySelector('[data-action=delete-note]').onclick = () => {
    const id = editing?.id;
    closeNoteEditor();
    if (id) deleteMark(id);
  };
  editor.querySelector('textarea').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote();
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeNoteEditor();
    }
  });

  // Clicks on ribbons and note pins inside the book (page-flip forwards button clicks).
  on(host, 'click', (e) => {
    const ribbon = e.target.closest('.ribbon');
    if (ribbon) return toggleBookmark(Number(ribbon.dataset.page));
    const pin = e.target.closest('.note-pin');
    if (pin) {
      const m = marks.find((x) => x.id === pin.dataset.id);
      if (m) openNoteEditor(m, e.clientX, e.clientY);
    }
  });

  // ---------- tools ----------
  function setTool(next) {
    tool = next;
    root.dataset.tool = tool;
    root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    ink.hidden = tool === 'read';
    // Page corners shouldn't lift while you're holding a pen. page-flip reads this setting live.
    flip.getSettings().showPageCorners = tool === 'read' && zoom <= 1;
    if (tool !== 'read' && flip.getState() === 'fold_corner') flip.getFlipController().stopMove();
    if (tool === 'highlight' && pdf) pdfPagesInView().forEach(textLines);
    closeNoteEditor();
  }
  root.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => setTool(tool === b.dataset.tool ? 'read' : b.dataset.tool)));
  root.querySelectorAll('[data-color]').forEach(
    (b) =>
      (b.onclick = () => {
        color = b.dataset.color;
        root.querySelectorAll('[data-color]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        setTool('highlight');
      }),
  );
  root.querySelectorAll('[data-pencil]').forEach(
    (b) =>
      (b.onclick = () => {
        pencilColor = b.dataset.pencil;
        root.querySelectorAll('[data-pencil]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        setTool('pencil');
      }),
  );

  // ---------- labels, progress, scrubber ----------
  function pdfPagesInView() {
    return visiblePages().filter((i) => i >= 1 && i <= N);
  }

  function updateLabels() {
    const pages = pdfPagesInView();
    let label;
    if (current === 0) label = 'Cover';
    else if (current >= backIndex || (!pages.length && current > N)) label = 'The end';
    else label = pages.length > 1 ? `Pages ${pages[0]}–${pages[1]} of ${N}` : `Page ${pages[0]} of ${N}`;
    $('.page-label').textContent = label;
    scrub.value = String(current);
    scrub.style.setProperty('--p', current / (total - 1));
    const read = pages.length ? pages[pages.length - 1] : current > N ? N : 0;
    $('.pct').textContent = `${Math.round((read / N) * 100)}%`;
    const marked = pages.some((p) => marksOn(p, 'bookmark').length);
    $('[data-action=bookmark]').setAttribute('aria-pressed', String(marked));
    $('[data-action=prev]').disabled = current === 0;
    $('[data-action=next]').disabled = current >= backIndex || (visiblePages().includes(backIndex));
  }

  let saveTimer;
  function onPageChanged() {
    updateLabels();
    queueRenders();
    centerClosedBook();
    if (tool === 'highlight') pdfPagesInView().forEach(textLines);
    clearTimeout(saveTimer);
    const pages = pdfPagesInView();
    const lastPage = current === 0 ? 0 : pages.length ? pages[0] : N;
    saveTimer = setTimeout(() => updateBook(book.id, { lastPage, lastOpenedAt: Date.now() }), 400);
    if (panelTab === 'contents') refreshPanel();
    if (current >= backIndex && !book.finishedAt) celebrate();
  }

  // ---------- reading timer ----------
  // Counts time actually spent reading: it pauses when the tab is hidden, the book is closed,
  // or nobody has touched anything for a while.
  let lastActivity = Date.now();
  let unsaved = 0; // seconds not yet added to the daily totals
  let sessionSecs = 0;
  const timerEl = $('.read-timer');
  const stir = () => (lastActivity = Date.now());
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel']) on(window, type, stir, { passive: true });
  const ticker = setInterval(() => {
    const reading = !document.hidden && Date.now() - lastActivity < IDLE_AFTER && pdfPagesInView().length > 0;
    timerEl.classList.toggle('paused', !reading);
    if (!reading) return;
    sessionSecs++;
    unsaved++;
    book.readSeconds = (book.readSeconds || 0) + 1;
    timerEl.querySelector('b').textContent = fmtClock(sessionSecs);
    if (unsaved >= 30) flushTime();
  }, 1000);
  cleanups.push(() => clearInterval(ticker));

  function flushTime() {
    if (!unsaved) return;
    const seconds = unsaved;
    unsaved = 0;
    addReadingTime(seconds);
    updateBook(book.id, { readSeconds: book.readSeconds });
  }

  function chapterBounds() {
    const tops = chapters.filter((c) => c.depth === 0);
    return tops.length >= 2 ? tops : chapters;
  }

  function chapterAt(page) {
    return chapterBounds().filter((c) => c.page <= page).pop() || null;
  }

  // ---------- finishing a book ----------
  function celebrate() {
    book.finishedAt = Date.now();
    book.shelf = 'finished';
    updateBook(book.id, { finishedAt: book.finishedAt, shelf: 'finished' });
    flushTime();
    const colors = ['#7B6FD8', '#C23A1E', '#F2C744', '#8FD19A', '#FBF3E1', '#B3AAF0'];
    let bits = '';
    for (let i = 0; i < 90; i++) {
      const shape = i % 6 === 0 ? 'star' : i % 3 === 0 ? 'dot' : '';
      bits += `<i class="confetti ${shape}" style="left:${(Math.random() * 100).toFixed(1)}%;--c:${colors[i % colors.length]};--d:${(Math.random() * 0.7).toFixed(2)}s;--t:${(2.2 + Math.random() * 1.6).toFixed(2)}s;--x:${Math.round((Math.random() - 0.5) * 260)}px;--r:${Math.round((Math.random() - 0.5) * 1440)}deg"></i>`;
    }
    const spent = book.readSeconds >= 60 ? `You spent ${fmtMinutes(book.readSeconds / 60)} with it. ` : '';
    const layer = document.createElement('div');
    layer.className = 'celebrate';
    layer.innerHTML = `${bits}
      <div class="done-card" role="dialog" aria-label="Book finished">
        <span class="tape"></span>
        ${sparkle('#F2C744', 34, 'deco d1')}${sparkle('#ffffff', 22, 'deco d2')}
        <span class="stamp">Done!</span>
        <h2>You finished <em>${escapeHtml(book.title)}</em></h2>
        <p>${spent}It’s on your Finished shelf now.</p>
        <div class="done-actions">
          <button class="btn primary" data-done="shelf">Back to shelf</button>
          <button class="btn ghost" data-done="stay">Keep it open</button>
        </div>
      </div>`;
    root.append(layer);
    on(layer, 'click', (e) => {
      const b = e.target.closest('[data-done]');
      if (b?.dataset.done === 'shelf') location.hash = '#/';
      else if (b) layer.remove();
    });
  }

  on(scrub, 'input', () => {
    const v = Number(scrub.value);
    $('.scrub-tip').textContent = v === 0 ? 'Cover' : v > N ? 'End' : `p. ${v}`;
    $('.scrub-tip').style.setProperty('--at', v / (total - 1));
    scrub.style.setProperty('--p', v / (total - 1));
    root.classList.add('scrubbing');
  });
  on(scrub, 'change', () => {
    root.classList.remove('scrubbing');
    const v = Number(scrub.value);
    if (v !== current) {
      playPageTurn(0.8);
      flip.turnToPage(v);
      current = flip.getCurrentPageIndex();
      onPageChanged();
    }
  });

  // ---------- side panel ----------
  let panelTab = 'contents';
  function refreshPanel() {
    root.querySelectorAll('[data-tab]').forEach((t) => {
      const type = t.dataset.tab;
      t.setAttribute('aria-selected', String(type === panelTab));
      const count = t.querySelector('em');
      if (count) count.textContent = marks.filter((m) => m.type === type).length || '';
    });
    $('.panel-title').textContent = PANEL_TITLES[panelTab];
    $('.panel-search').hidden = panelTab !== 'search';
    if (panelTab === 'contents') return renderContents();
    if (panelTab === 'search') return renderSearch();
    const items = marks.filter((m) => m.type === panelTab).sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
    const list = $('.panel-list');
    if (!items.length) {
      const empty = {
        bookmark: 'Tap the red ribbon at the top of a page (near the spine) to bookmark it.',
        highlight: 'Pick the highlighter and drag across a line of text.',
        note: 'Pick the sticky note and tap anywhere on a page.',
      };
      list.innerHTML = `<p class="panel-empty">${empty[panelTab]}</p>`;
      return;
    }
    list.innerHTML = items
      .map((m) => {
        let body = '';
        if (m.type === 'highlight')
          body = m.snippet
            ? `<img src="${m.snippet}" alt="Highlighted passage" style="--hl:${HIGHLIGHT_COLORS[m.color]}" />`
            : `<span class="swatch" style="--hl:${HIGHLIGHT_COLORS[m.color]}"></span>`;
        if (m.type === 'note') body = `<p>${escapeHtml(m.text)}</p>`;
        if (m.type === 'bookmark') body = `<p class="muted">Saved ${new Date(m.createdAt).toLocaleDateString()}</p>`;
        return `<li>
          <button class="mark-jump" data-jump="${m.page}"><span class="mark-page">Page ${m.page}</span>${body}</button>
          <button class="icon-btn small" data-remove="${m.id}" aria-label="Remove">${icon('trash', 16)}</button>
        </li>`;
      })
      .join('');
  }

  root.querySelectorAll('[data-tab]').forEach(
    (t) =>
      (t.onclick = () => {
        panelTab = t.dataset.tab;
        refreshPanel();
      }),
  );
  // ---------- contents: the PDF's own chapter list ----------
  let chapters = []; // { title, page, depth }, in page order
  let chaptersLoaded = false;

  async function loadChapters() {
    try {
      const out = [];
      const walk = async (items, depth) => {
        for (const it of items || []) {
          const page = await destPage(it.dest);
          if (page) out.push({ title: it.title?.trim() || 'Untitled', page, depth });
          if (depth < 2) await walk(it.items, depth + 1);
        }
      };
      await walk(await pdf.getOutline(), 0);
      chapters = out.sort((a, b) => a.page - b.page);
    } catch (err) {
      console.warn('No chapter list', err);
    }
    chaptersLoaded = true;
    if (panelTab === 'contents') refreshPanel();
  }

  async function destPage(dest) {
    try {
      if (typeof dest === 'string') dest = await pdf.getDestination(dest);
      if (!Array.isArray(dest)) return 0;
      const idx = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0]);
      return idx + 1;
    } catch {
      return 0;
    }
  }

  function renderContents() {
    const list = $('.panel-list');
    if (!chaptersLoaded) return (list.innerHTML = '<p class="panel-empty">Reading the chapter list…</p>');
    if (!chapters.length)
      return (list.innerHTML = '<p class="panel-empty">This PDF doesn’t include a chapter list. Use Search to find your way around.</p>');
    const here = chapterAt(pdfPagesInView().at(-1) || 1);
    list.innerHTML = chapters
      .map(
        (c) => `<li class="toc-item depth-${Math.min(c.depth, 2)}${c === here ? ' here' : ''}">
          <button class="toc-jump" data-jump="${c.page}"><span>${escapeHtml(c.title)}</span><b>${c.page}</b></button>
        </li>`,
      )
      .join('');
  }

  // ---------- search inside the book ----------
  let search = { q: '', results: [], token: 0, done: true, scanned: 0, chars: 0 };

  async function runSearch(q) {
    const token = search.token + 1;
    search = { q, results: [], token, done: q.length < 2, scanned: 0, chars: 0 };
    renderSearch();
    if (search.done) return;
    const needle = q.toLowerCase();
    let painted = 0;
    for (let p = 1; p <= N; p++) {
      let items;
      try {
        items = await textLines(p);
      } catch {
        continue;
      }
      if (token !== search.token || closed) return;
      // Join the page's text runs so a phrase can span them, remembering where each run starts.
      let text = '';
      const spans = [];
      for (const it of items) {
        if (text) text += ' ';
        spans.push({ start: text.length, it });
        text += it.str;
      }
      search.chars += text.length;
      const hay = text.toLowerCase();
      for (let at = hay.indexOf(needle); at !== -1 && search.results.length < MAX_HITS; at = hay.indexOf(needle, at + needle.length)) {
        const from = Math.max(0, at - 40);
        const to = Math.min(text.length, at + needle.length + 60);
        search.results.push({
          page: p,
          rect: matchRect(spans, at, needle.length),
          snippet:
            (from ? '…' : '') +
            escapeHtml(text.slice(from, at)) +
            `<mark>${escapeHtml(text.slice(at, at + needle.length))}</mark>` +
            escapeHtml(text.slice(at + needle.length, to)) +
            (to < text.length ? '…' : ''),
        });
      }
      search.scanned = p;
      if (search.results.length >= MAX_HITS) break;
      if (performance.now() - painted > 150) {
        painted = performance.now();
        renderSearch();
      }
    }
    search.done = true;
    renderSearch();
  }

  function matchRect(spans, at, len) {
    let s = spans[0];
    for (const x of spans) {
      if (x.start > at) break;
      s = x;
    }
    const { it } = s;
    const n = Math.max(1, it.str.length);
    const a = Math.min(n, Math.max(0, at - s.start));
    const b = Math.min(n, a + len);
    return { x: it.x + (it.w * a) / n, y: it.y, w: Math.max((it.w * (b - a)) / n, 0.01), h: it.h };
  }

  function renderSearch() {
    if (panelTab !== 'search') return;
    const list = $('.panel-list');
    const status = $('.search-status');
    const n = search.results.length;
    if (search.q.length < 2) {
      status.textContent = '';
      return (list.innerHTML = '<p class="panel-empty">Type a word or phrase to find it anywhere in the book.</p>');
    }
    status.textContent = search.done
      ? `${n >= MAX_HITS ? MAX_HITS + '+' : n} match${n === 1 ? '' : 'es'}`
      : `Searching… page ${search.scanned} of ${N}`;
    if (!n) {
      if (!search.done) return (list.innerHTML = '');
      return (list.innerHTML = search.chars
        ? `<p class="panel-empty">No matches for “${escapeHtml(search.q)}”.</p>`
        : '<p class="panel-empty">This PDF looks like scanned images, so there’s no text to search.</p>');
    }
    list.innerHTML = search.results
      .map((r, i) => `<li><button class="mark-jump" data-hit="${i}"><span class="mark-page">Page ${r.page}</span><p>${r.snippet}</p></button></li>`)
      .join('');
  }

  // Jump to a match and wave a marker over it for a moment.
  function showHit(r) {
    goTo(r.page);
    root.querySelectorAll('.search-hit').forEach((el) => el.remove());
    const el = document.createElement('div');
    el.className = 'search-hit';
    Object.assign(el.style, {
      left: (r.rect.x - 0.004) * 100 + '%',
      top: (r.rect.y - 0.003) * 100 + '%',
      width: (r.rect.w + 0.008) * 100 + '%',
      height: (r.rect.h + 0.006) * 100 + '%',
    });
    pageEls[r.page].querySelector('.marks').append(el);
    setTimeout(() => el.remove(), 6000);
  }

  function openSearch() {
    panelTab = 'search';
    refreshPanel();
    togglePanel(true);
    const input = $('.panel-search input');
    setTimeout(() => (input.focus(), input.select()), 60);
  }

  let searchTimer;
  on($('.panel-search input'), 'input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(e.target.value.trim()), 250);
  });
  on($('.panel-search'), 'submit', (e) => {
    e.preventDefault();
    clearTimeout(searchTimer);
    runSearch($('.panel-search input').value.trim());
  });

  on($('.panel-list'), 'click', (e) => {
    const hit = e.target.closest('[data-hit]');
    if (hit) return showHit(search.results[Number(hit.dataset.hit)]);
    const rm = e.target.closest('[data-remove]');
    if (rm) return deleteMark(rm.dataset.remove);
    const jump = e.target.closest('[data-jump]');
    if (jump) goTo(Number(jump.dataset.jump));
  });

  function goTo(page) {
    if (visiblePages().includes(page)) return;
    if (Math.abs(page - current) <= 2) flip.flip(page);
    else {
      playPageTurn(0.8);
      flip.turnToPage(page);
      current = flip.getCurrentPageIndex();
      onPageChanged();
    }
    if (window.innerWidth < 760) togglePanel(false);
  }

  function togglePanel(force) {
    const open = force ?? !root.classList.contains('panel-open');
    root.classList.toggle('panel-open', open);
    $('[data-action=panel]').setAttribute('aria-pressed', String(open));
    panel.setAttribute('aria-hidden', String(!open));
  }

  // ---------- settings popover ----------
  const pop = $('.settings-pop');
  function applySettings() {
    root.className = root.className.replace(/\b(paper|desk)-\w+/g, '').trim();
    root.classList.add(`paper-${settings.paper}`, `desk-${settings.desk}`);
    pop.querySelectorAll('[data-paper]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.paper === settings.paper)));
    pop.querySelectorAll('[data-desk]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.desk === settings.desk)));
    pop.querySelectorAll('[data-layout]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === settings.layout)));
    pop.querySelector('[data-sound]').setAttribute('aria-pressed', String(settings.sound));
    setSoundEnabled(settings.sound);
    applyMood();
    applyLayout();
    saveSettings(settings);
  }
  // page-flip goes single-page when the stage is narrower than two minWidths, and reads this setting live.
  // Zooming makes the book element wider; scaling minWidth with it keeps page-flip from
  // switching a single page into a two-page spread (or back) just because of zoom.
  const layoutMinWidth = () => (settings.layout === 'one' ? 100000 : 280 * zoom);
  function applyLayout() {
    const minWidth = layoutMinWidth();
    if (flip.getSettings().minWidth === minWidth) return;
    flip.getSettings().minWidth = minWidth;
    flip.update();
    current = flip.getCurrentPageIndex();
    centerClosedBook();
    updateLabels();
    queueRenders();
  }

  // ---------- zoom ----------
  // `from` is the screen point being zoomed around and `to` is where that same spot of the
  // page should end up, so a pinch can zoom and slide in one gesture. Default: the view's centre.
  function setZoom(next, from, to = from) {
    next = Math.min(MAX_ZOOM, Math.max(1, Math.round(next * 100) / 100));
    if (Math.abs(next - zoom) < 0.01) return;
    const h = host.getBoundingClientRect();
    from ??= { x: h.left + host.clientWidth / 2, y: h.top + host.clientHeight / 2 };
    to ??= from;
    const fx = (host.scrollLeft + from.x - h.left) / host.scrollWidth;
    const fy = (host.scrollTop + from.y - h.top) / host.scrollHeight;
    zoom = next;
    bookEl.style.width = bookEl.style.height = zoom * 100 + '%';
    flip.getSettings().minWidth = layoutMinWidth();
    host.classList.toggle('zoomed', zoom > 1);
    root.classList.toggle('zoomed', zoom > 1);
    // On a zoomed page the hand moves the paper, so corners shouldn't curl under the cursor.
    flip.getSettings().showPageCorners = tool === 'read' && zoom <= 1;
    flip.update();
    centerClosedBook();
    host.scrollLeft = fx * host.scrollWidth - (to.x - h.left);
    host.scrollTop = fy * host.scrollHeight - (to.y - h.top);
    $('.zoom-val').textContent = Math.round(zoom * 100) + '%';
    $('[data-action=zoom-out]').disabled = zoom <= 1;
    $('[data-action=zoom-in]').disabled = zoom >= MAX_ZOOM;
  }
  const zoomStep = (dir) => setZoom(dir > 0 ? ZOOMS.find((z) => z > zoom + 0.01) ?? MAX_ZOOM : [...ZOOMS].reverse().find((z) => z < zoom - 0.01) ?? 1);

  // ---------- pinch to zoom, drag to move around a zoomed page ----------
  // While fingers are moving the book is only scaled on screen (cheap and smooth); the real,
  // sharp re-layout happens once when the pinch ends.
  let pinch = null;
  // Make page-flip forget any half-started touch so a pinch can't end in a page turn.
  const calmPageFlip = () => {
    if (flip.getState() === 'user_fold') flip.getFlipController().stopMove();
    flip.userStop({ x: 0, y: 0 }, true);
  };
  function pinchStart(x, y) {
    calmPageFlip();
    const b = bookEl.getBoundingClientRect();
    pinch = { start: zoom, scale: 1, from: { x, y }, to: { x, y } };
    bookEl.style.transformOrigin = `${x - b.left}px ${y - b.top}px`;
    root.classList.add('pinching');
  }
  function pinchMove(scale, x, y) {
    if (!pinch) return;
    pinch.scale = Math.min(MAX_ZOOM, Math.max(1, pinch.start * scale)) / pinch.start;
    pinch.to = { x, y };
    bookEl.style.scale = String(pinch.scale);
    bookEl.style.translate = `${x - pinch.from.x}px ${y - pinch.from.y}px`;
  }
  function pinchEnd() {
    if (!pinch) return;
    const { start, scale, from, to } = pinch;
    pinch = null;
    bookEl.style.scale = bookEl.style.translate = bookEl.style.transformOrigin = '';
    root.classList.remove('pinching');
    setZoom(start * scale, from, to);
    calmPageFlip();
  }

  // Trackpad pinch arrives as ctrl+wheel in Chrome, Edge and Firefox.
  let wheelTimer;
  on(stage, 'wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (!pinch) pinchStart(e.clientX, e.clientY);
    const factor = Math.exp(-e.deltaY * (e.deltaMode ? 0.1 : 0.01));
    pinchMove((pinch.start * pinch.scale * factor) / pinch.start, pinch.to.x, pinch.to.y);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(pinchEnd, 160);
  }, { passive: false });

  // Safari reports trackpad pinches as gesture events instead.
  on(stage, 'gesturestart', (e) => {
    e.preventDefault();
    pinchStart(e.clientX, e.clientY);
  });
  on(stage, 'gesturechange', (e) => {
    e.preventDefault();
    pinchMove(e.scale, e.clientX, e.clientY);
  });
  on(stage, 'gestureend', (e) => {
    e.preventDefault();
    pinchEnd();
  });

  // Touch: two fingers pinch, one finger drags a zoomed page around.
  const touches = new Map();
  let pan = null;
  const between = () => {
    const [a, b] = [...touches.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  // page-flip listens for mousedown/touchstart on the book itself. Stop those here, before they
  // arrive, whenever the gesture is a pinch or a pan, so the page doesn't start to turn.
  const handOnZoomedPage = (e) => tool === 'read' && zoom > 1 && !e.target.closest?.('button, a');
  on(host, 'mousedown', (e) => handOnZoomedPage(e) && e.stopPropagation(), true);
  on(host, 'touchstart', (e) => {
    if (e.touches.length > 1 || handOnZoomedPage(e)) {
      e.stopPropagation();
      e.preventDefault();
      calmPageFlip();
    }
  }, { capture: true, passive: false });
  // Keep the moves and the lift of a pinch or pan away from page-flip's window listeners too.
  const ownGesture = (e) => {
    if (pinch || pan || e.touches?.length > 1) e.stopPropagation();
  };
  on(host, 'touchmove', ownGesture, true);
  on(host, 'touchend', ownGesture, true);

  on(host, 'pointerdown', (e) => {
    if (tool !== 'read') return;
    if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      pan = null;
      const m = between();
      pinchStart(m.x, m.y);
      pinch.d0 = m.d;
      return;
    }
    if (handOnZoomedPage(e) && !pinch) {
      pan = { x: e.clientX, y: e.clientY, left: host.scrollLeft, top: host.scrollTop, id: e.pointerId };
      host.setPointerCapture(e.pointerId);
      root.classList.add('panning');
    }
  });
  on(host, 'pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch?.d0 && touches.size === 2) {
      const m = between();
      return pinchMove(m.d / pinch.d0, m.x, m.y);
    }
    if (pan && e.pointerId === pan.id) {
      host.scrollLeft = pan.left - (e.clientX - pan.x);
      host.scrollTop = pan.top - (e.clientY - pan.y);
    }
  });
  const liftFinger = (e) => {
    touches.delete(e.pointerId);
    if (pinch?.d0 && touches.size < 2) pinchEnd();
    if (pan && e.pointerId === pan.id) {
      pan = null;
      root.classList.remove('panning');
    }
  };
  on(host, 'pointerup', liftFinger);
  on(host, 'pointercancel', liftFinger);

  on(pop, 'click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.paper) settings.paper = b.dataset.paper;
    if (b.dataset.desk) settings.desk = b.dataset.desk;
    if (b.dataset.layout) settings.layout = b.dataset.layout;
    if (b.hasAttribute('data-sound')) settings.sound = !settings.sound;
    applySettings();
  });

  // ---------- mood: the leaf on the desk plays calm sounds ----------
  const mood = $('.mood');
  const moodCard = $('.mood-card');
  function applyMood() {
    const playing = settings.ambience !== 'off';
    mood.classList.toggle('playing', playing);
    mood.querySelectorAll('[data-ambience]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ambience === settings.ambience)));
    mood.querySelector('.mood-now').textContent = playing ? AMBIENCES[settings.ambience][0] : '';
    mood.querySelector('.leaf-btn').setAttribute('aria-label', playing ? `Mood: ${AMBIENCES[settings.ambience][0]}` : 'Mood sounds');
    $('.mood-vol input').value = String(settings.ambienceVolume);
    setAmbienceVolume(settings.ambienceVolume);
    setAmbience(settings.ambience);
    if (playing) settings.lastMood = settings.ambience;
    applyAdhd();
  }

  // ---------- ADHD mode: the desk around the book never stops moving ----------
  let sceneKind = '';
  let sceneZone = null;
  function applyAdhd() {
    const open = !!settings.adhd;
    $('[data-action=adhd]').setAttribute('aria-pressed', String(open));
    showScene(open ? (settings.ambience !== 'off' ? settings.ambience : settings.lastMood) : '');
  }

  function setAdhd(open) {
    settings.adhd = open;
    // A scene without its sound feels hollow, so ADHD mode starts the last mood.
    if (open && settings.ambience === 'off') settings.ambience = settings.lastMood;
    resumeAudio();
    applySettings();
  }

  // Where the desk is open beside the book, so the motion shows instead of hiding behind it.
  function openDesk() {
    const s = stage.getBoundingClientRect();
    const block = bookEl.querySelector('.stf__block')?.getBoundingClientRect();
    const pages = flip.getBoundsRect();
    if (!s.width || !block || !pages) return { l: 0, r: 100 };
    // A closed book shows one page, slid to the middle by centerClosedBook().
    const closedBook = flip.getOrientation() === 'landscape' && (current === 0 || current >= backIndex);
    const left = block.left + pages.left + (closedBook ? pages.pageWidth / 2 : 0);
    const width = closedBook ? pages.pageWidth : pages.width;
    return { l: ((left - s.left) / s.width) * 100, r: ((left + width - s.left) / s.width) * 100 };
  }

  function showScene(kind, force = false) {
    const zone = openDesk();
    if (kind === sceneKind && !force) return;
    sceneKind = kind;
    sceneZone = zone;
    root.querySelectorAll('.scene').forEach((old) => {
      old.classList.add('leaving');
      setTimeout(() => old.remove(), 800);
    });
    const html = sceneHtml(kind, zone);
    if (!html) return;
    const layer = document.createElement('div');
    layer.className = `scene scene-${kind}`;
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = html;
    stage.prepend(layer);
  }

  // Rebuild the scene when the open desk changes noticeably (resizing, opening the cover).
  function refreshScene() {
    if (!sceneKind || !sceneZone) return;
    const z = openDesk();
    if (Math.abs(z.l - sceneZone.l) > 3 || Math.abs(z.r - sceneZone.r) > 3) showScene(sceneKind, true);
  }

  function toggleMoodCard(force) {
    moodCard.hidden = !(force ?? moodCard.hidden);
    mood.querySelector('.leaf-btn').setAttribute('aria-expanded', String(!moodCard.hidden));
  }
  on(mood, 'click', (e) => {
    if (e.target.closest('.leaf-btn')) return toggleMoodCard();
    const b = e.target.closest('[data-ambience]');
    if (!b) return;
    // Tapping the mood that's playing turns it off.
    settings.ambience = settings.ambience === b.dataset.ambience ? 'off' : b.dataset.ambience;
    resumeAudio();
    applySettings();
  });
  on($('.mood-vol input'), 'input', (e) => {
    settings.ambienceVolume = Number(e.target.value);
    setAmbienceVolume(settings.ambienceVolume);
  });
  on($('.mood-vol input'), 'change', () => saveSettings(settings));

  // ---------- toolbar actions ----------
  on(root, 'click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    switch (b.dataset.action) {
      case 'back':
        location.hash = '#/';
        break;
      case 'prev':
        flip.flipPrev();
        break;
      case 'next':
        flip.flipNext();
        break;
      case 'bookmark': {
        const pages = pdfPagesInView();
        const marked = pages.find((p) => marksOn(p, 'bookmark').length);
        if (marked) toggleBookmark(marked);
        else if (pages.length) toggleBookmark(pages[0]);
        break;
      }
      case 'panel':
        togglePanel();
        break;
      case 'adhd':
        setAdhd(!settings.adhd);
        break;
      case 'search':
        if (root.classList.contains('panel-open') && panelTab === 'search') togglePanel(false);
        else openSearch();
        break;
      case 'settings':
        pop.hidden = !pop.hidden;
        b.setAttribute('aria-pressed', String(!pop.hidden));
        break;
      case 'zoom-in':
        zoomStep(1);
        break;
      case 'zoom-out':
        zoomStep(-1);
        break;
      case 'zoom-reset':
        setZoom(1);
        break;
      case 'fullscreen':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
        break;
    }
  });
  on(document, 'pointerdown', (e) => {
    if (!moodCard.hidden && !e.target.closest('.mood')) toggleMoodCard(false);
    if (!pop.hidden && !e.target.closest('.settings-pop, [data-action=settings]')) {
      pop.hidden = true;
      $('[data-action=settings]').setAttribute('aria-pressed', 'false');
    }
  });

  on(document, 'keydown', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (((e.metaKey || e.ctrlKey) && k === 'f') || (k === '/' && !e.metaKey && !e.ctrlKey)) {
      e.preventDefault();
      return openSearch();
    }
    if ((e.metaKey || e.ctrlKey) && k === 'z' && !e.shiftKey) {
      const id = pencilHistory.pop();
      if (id) {
        e.preventDefault();
        deleteMark(id, { undo: false });
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault();
      flip.flipNext();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      flip.flipPrev();
    } else if (k === 'b') $('[data-action=bookmark]').click();
    else if (k === 'a') toggleMoodCard();
    else if (k === 'p') setTool(tool === 'pencil' ? 'read' : 'pencil');
    else if (k === 'h') setTool(tool === 'highlight' ? 'read' : 'highlight');
    else if (k === 'n') setTool(tool === 'note' ? 'read' : 'note');
    else if (k === 'e') setTool(tool === 'erase' ? 'read' : 'erase');
    else if (k === 'v') setTool('read');
    else if (k === 'm') togglePanel();
    else if (k === 'f') $('[data-action=fullscreen]').click();
    else if (e.key === '+' || e.key === '=') zoomStep(1);
    else if (e.key === '-' || e.key === '_') zoomStep(-1);
    else if (e.key === '0') setZoom(1);
    else if (e.key === 'Escape') {
      if (!editor.hidden) closeNoteEditor();
      else if (!moodCard.hidden) toggleMoodCard(false);
      else if (tool !== 'read') setTool('read');
      else location.hash = '#/';
    }
  });

  // Keep the book fitted to the stage when the window, panel or fullscreen changes.
  let resizeTimer;
  const ro = new ResizeObserver(() => {
    flip.update();
    centerClosedBook();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      queueRenders();
      refreshScene();
    }, 200);
  });
  ro.observe(host);
  ro.observe(bookEl);
  cleanups.push(() => ro.disconnect());

  // ---------- boot ----------
  setTool('read');
  applySettings();
  updateLabels();
  centerClosedBook();
  [marks, pdf] = await Promise.all([listMarks(book.id), openPdf(file)]);
  if (closed) {
    pdf.destroy();
    return () => {};
  }
  for (let p = 1; p <= N; p++) drawMarks(p);
  refreshPanel();
  loadChapters();
  // Browsers keep sound asleep until the first touch, so wake any ambience then.
  on(window, 'pointerdown', resumeAudio);
  on(window, 'keydown', resumeAudio);
  updateLabels();
  queueRenders();
  requestAnimationFrame(() => root.classList.add('ready'));

  return async function close() {
    closed = true;
    clearTimeout(saveTimer);
    stopAmbience();
    flushTime();
    const pages = pdfPagesInView();
    await updateBook(book.id, { lastPage: current === 0 ? 0 : pages.length ? pages[0] : N, lastOpenedAt: Date.now() });
    cleanups.forEach((fn) => fn());
    try {
      flip.destroy();
    } catch {}
    pdf?.destroy();
    root.remove();
  };
}

function fmtClock(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = String(secs % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function fmtMinutes(mins) {
  mins = Math.max(1, Math.round(mins));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function template(book) {
  const toolBtn = (name, ic, label, key) =>
    `<button class="tool" data-tool="${name}" aria-pressed="false" title="${label} (${key})" aria-label="${label}">${icon(ic)}</button>`;
  return `
    <header class="r-bar">
      <button class="btn ghost back" data-action="back" aria-label="Back to library">${icon('back', 18)}<span>Library</span></button>
      <div class="r-title">
        <strong>${escapeHtml(book.title)}</strong>
        <span class="page-label"></span>
      </div>
      <div class="toolbox" role="toolbar" aria-label="Reading tools">
        ${toolBtn('read', 'hand', 'Turn pages', 'V')}
        ${toolBtn('pencil', 'pencil', 'Pencil', 'P')}
        <span class="swatches pencil-swatches">
          ${Object.entries(PENCIL_COLORS)
            .map(
              ([name, hex], i) =>
                `<button class="swatch-btn" data-pencil="${name}" style="--hl:${hex}" aria-pressed="${i === 0}" aria-label="${name} pencil" title="${name} pencil"></button>`,
            )
            .join('')}
        </span>
        ${toolBtn('highlight', 'marker', 'Highlighter', 'H')}
        <span class="swatches hl-swatches">
          ${Object.entries(HIGHLIGHT_COLORS)
            .map(
              ([name, hex], i) =>
                `<button class="swatch-btn" data-color="${name}" style="--hl:${hex}" aria-pressed="${i === 0}" aria-label="${name} highlighter" title="${name}"></button>`,
            )
            .join('')}
        </span>
        ${toolBtn('note', 'note', 'Sticky note', 'N')}
        ${toolBtn('erase', 'eraser', 'Eraser', 'E')}
      </div>
      <div class="r-actions">
        <button class="icon-btn" data-action="bookmark" aria-pressed="false" title="Bookmark (B)" aria-label="Bookmark this page">${icon('bookmark')}</button>
        <button class="adhd-btn" data-action="adhd" aria-pressed="false" title="Gentle, never-ending motion around the book to help you focus">${sparkle('#F2C744', 16)}<span>ADHD mode</span></button>
        <button class="icon-btn" data-action="search" title="Search (/)" aria-label="Search this book">${icon('search')}</button>
        <button class="icon-btn" data-action="panel" aria-pressed="false" title="Contents, search & marks (M)" aria-label="Open side panel">${icon('panel')}</button>
        <button class="icon-btn" data-action="settings" aria-pressed="false" title="Paper & desk" aria-label="Reading settings">${icon('settings')}</button>
        <button class="icon-btn hide-sm" data-action="fullscreen" title="Fullscreen (F)" aria-label="Fullscreen">${icon('expand')}</button>
      </div>
      <div class="settings-pop" hidden>
        <h4>Paper</h4>
        <div class="choice">${Object.entries(PAPERS)
          .map(([k, v]) => `<button data-paper="${k}" class="paper-chip paper-chip-${k}">${v}</button>`)
          .join('')}</div>
        <h4>Desk</h4>
        <div class="choice">${Object.entries(DESKS)
          .map(([k, v]) => `<button data-desk="${k}" class="desk-chip desk-chip-${k}">${v}</button>`)
          .join('')}</div>
        <h4>Layout</h4>
        <div class="choice">${Object.entries(LAYOUTS)
          .map(([k, v]) => `<button data-layout="${k}">${v}</button>`)
          .join('')}</div>
        <h4>Sound</h4>
        <div class="choice"><button data-sound class="toggle">Page-turn sound</button></div>

      </div>
    </header>
    <div class="r-main">
      <div class="stage">
        <button class="edge prev" data-action="prev" aria-label="Previous page">${icon('left', 28)}</button>
        <div class="book-host"></div>
        <div class="ink-layer" hidden></div>
        <div class="mood">
          <div class="mood-card" hidden role="dialog" aria-label="Mood sounds">
            <span class="tape"></span>
            <h4>Set the mood</h4>
            <div class="mood-list">${Object.entries(AMBIENCES)
              .map(([k, [name, ic]]) => `<button data-ambience="${k}" aria-pressed="false">${icon(ic, 18)}<span>${name}</span></button>`)
              .join('')}</div>
            <label class="mood-vol">${icon('volume', 18)}<input type="range" min="0" max="1" step="0.05" aria-label="Mood volume" /></label>
          </div>
          <button class="leaf-btn" aria-expanded="false" title="Mood sounds (A)">${LEAF}<span class="waves"><i></i><i></i><i></i></span><span class="mood-now"></span></button>
        </div>
        <div class="read-timer paused" title="Time spent reading this session (pauses when you step away)"><i></i><b>0:00</b></div>
        <svg class="defs" width="0" height="0" aria-hidden="true">
          <filter id="pencil-grain" x="-2%" y="-2%" width="104%" height="104%">
            <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="7" result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.4 0 0 0 -0.35" result="grain" />
            <feComposite in="SourceGraphic" in2="grain" operator="in" />
          </filter>
        </svg>
        <button class="edge next" data-action="next" aria-label="Next page">${icon('right', 28)}</button>
      </div>
      <aside class="panel" aria-hidden="true" aria-label="Your marks">
        <div class="tabs" role="tablist">
          <button role="tab" data-tab="contents" title="Contents" aria-label="Contents">${icon('list', 18)}</button>
          <button role="tab" data-tab="search" title="Search" aria-label="Search">${icon('search', 18)}</button>
          <button role="tab" data-tab="bookmark" title="Bookmarks" aria-label="Bookmarks">${icon('bookmark', 18)}<em></em></button>
          <button role="tab" data-tab="highlight" title="Highlights" aria-label="Highlights">${icon('marker', 18)}<em></em></button>
          <button role="tab" data-tab="note" title="Notes" aria-label="Notes">${icon('note', 18)}<em></em></button>
        </div>
        <h3 class="panel-title"></h3>
        <form class="panel-search" hidden>
          <input type="search" placeholder="Find a word or phrase…" aria-label="Search this book" />
          <span class="search-status" aria-live="polite"></span>
        </form>
        <ul class="panel-list"></ul>
      </aside>
    </div>
    <footer class="r-foot">
      <div class="scrub-wrap">
        <input type="range" class="scrub" min="0" value="0" step="1" aria-label="Riffle through pages" />
        <span class="scrub-tip"></span>
      </div>
      <div class="zoom" role="group" aria-label="Zoom">
        <button class="icon-btn small" data-action="zoom-out" aria-label="Zoom out" title="Zoom out (−)" disabled>−</button>
        <button class="zoom-val" data-action="zoom-reset" title="Reset zoom (0)">100%</button>
        <button class="icon-btn small" data-action="zoom-in" aria-label="Zoom in" title="Zoom in (+)">+</button>
      </div>
      <span class="pct"></span>
    </footer>
    <div class="note-editor" hidden role="dialog" aria-label="Note">
      <div class="ne-title"></div>
      <textarea rows="5" placeholder="Write in the margin…"></textarea>
      <div class="ne-actions">
        <button class="btn ghost danger small" data-action="delete-note">${icon('trash', 16)}<span>Delete</span></button>
        <span class="spacer"></span>
        <button class="btn ghost small" data-action="cancel-note">Cancel</button>
        <button class="btn primary small" data-action="save-note">Save</button>
      </div>
    </div>`;
}
