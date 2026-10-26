import { addBook, countMarks, dayKey, deleteBook, getStats, listBooks, shelfOf, streakOf, uid, updateBook } from './db.js';
import { inspectPdf } from './pdf.js';
import { mountStickers } from './stickers.js';
import { clothColor, escapeHtml, icon, sparkle, toast } from './icons.js';

let root;
let coverUrls = [];

let books = [];

const SHELVES = { reading: 'Reading', want: 'Want to read', finished: 'Finished' };
const SHELF_KEY = 'folio.shelf';
let shelf = null;
try {
  shelf = localStorage.getItem(SHELF_KEY);
} catch {}

// The Paper mark: a sheet with its corner curling up, as if you're about to turn it.
const LOGO = `<svg class="logo" width="26" height="26" viewBox="12 9 34 40" aria-hidden="true"><g transform="rotate(5 29 29)"><path d="M15 12h28v22c-4 0-9 4-10 12H15z" fill="#FBF3E1" stroke="#141414" stroke-width="3" stroke-linejoin="round"/><path d="M43 34c-4 0-9 4-10 12 6-1 10-6 10-12z" fill="#7B6FD8" stroke="#141414" stroke-width="3" stroke-linejoin="round"/><path d="M20 20h17M20 26h17M20 32h10" stroke="#141414" stroke-width="2.6" stroke-linecap="round"/></g></svg>`;

const FLAME = `<svg class="flame" width="22" height="26" viewBox="0 0 22 26" aria-hidden="true"><path d="M11 1c1 5 8 8 8 15a8 8 0 0 1-16 0c0-4 2-6 4-8 0 3 1 4 2.5 4C8 8 9 4 11 1z" fill="#C23A1E" stroke="#141414" stroke-width="2" stroke-linejoin="round"/><path d="M11 13c2 2 3.5 3.5 3.5 6a3.5 3.5 0 0 1-7 0c0-2 1.5-3 3.5-6z" fill="#F2C744" stroke="#141414" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

const QUOTES = [
  ['A reader lives a thousand lives before he dies.', 'George R.R. Martin'],
  ['Books are a uniquely portable magic.', 'Stephen King'],
  ['I have always imagined that Paradise will be a kind of library.', 'Jorge Luis Borges'],
  ['The more that you read, the more things you will know.', 'Dr. Seuss'],
  ['Until I feared I would lose it, I never loved to read.', 'Harper Lee'],
];

export function mountLibrary(container) {
  root = document.createElement('div');
  root.className = 'library';
  root.innerHTML = `
    <header class="lib-head">
      <div class="brand">${LOGO}<span>Paper</span></div>
      <input type="file" accept="application/pdf,.pdf" multiple hidden />
    </header>
    <section class="lib-intro">
      <div class="lib-meta"><p class="lib-count"></p><div class="streak" hidden></div></div>
      ${sparkle('#ffffff', 34, 'deco s1')}${sparkle('#F2C744', 22, 'deco s2')}${sparkle('#F2C744', 40, 'deco s3')}
    </section>
    <nav class="shelf-tabs" aria-label="Shelves">${Object.entries(SHELVES)
      .map(([k, v]) => `<button data-shelf="${k}">${v}<em></em></button>`)
      .join('')}</nav>
    <div class="shelf-sign"><div class="hero-label"><span class="tape"></span><h1>Your shelf</h1></div></div>
    <div class="shelves"></div>
    <button class="quote-card" title="Tap for another quote">
      <span class="tape"></span>
      <span class="q-text"></span>
      <span class="q-who"></span>
    </button>
    <div class="drop-hint" aria-hidden="true"><div>${icon('upload', 40)}<p>Drop PDFs to put them on your shelf</p></div></div>
  `;
  container.append(root);
  mountStickers(root);

  // A small quote under the books; tap it for the next one.
  const quoteCard = root.querySelector('.quote-card');
  let quoteAt = Math.floor(Math.random() * QUOTES.length);
  const showQuote = () => {
    const [text, who] = QUOTES[quoteAt % QUOTES.length];
    quoteCard.querySelector('.q-text').textContent = `“${text}”`;
    quoteCard.querySelector('.q-who').textContent = who;
  };
  showQuote();
  quoteCard.onclick = () => {
    quoteAt++;
    quoteCard.classList.remove('flip');
    void quoteCard.offsetWidth;
    quoteCard.classList.add('flip');
    setTimeout(showQuote, 150);
  };

  const input = root.querySelector('input[type=file]');
  input.onchange = () => {
    importFiles([...input.files]);
    input.value = '';
  };

  let dragDepth = 0;
  root.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    root.classList.add('dragging');
  });
  root.addEventListener('dragover', (e) => e.preventDefault());
  root.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) root.classList.remove('dragging');
  });
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragDepth = 0;
    root.classList.remove('dragging');
    importFiles([...e.dataTransfer.files]);
  });

  // Shelf tabs: click to switch, or drop a book on one to move it there.
  const tabs = root.querySelector('.shelf-tabs');
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-shelf]');
    if (b) pickShelf(b.dataset.shelf);
  });
  tabs.addEventListener('dragover', (e) => {
    const b = e.target.closest('[data-shelf]');
    if (!b || !e.dataTransfer.types.includes('text/folio-book')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    tabs.querySelectorAll('.drop-over').forEach((x) => x !== b && x.classList.remove('drop-over'));
    b.classList.add('drop-over');
  });
  tabs.addEventListener('dragleave', (e) => e.target.closest?.('[data-shelf]')?.classList.remove('drop-over'));
  tabs.addEventListener('drop', (e) => {
    const b = e.target.closest('[data-shelf]');
    const id = e.dataTransfer.getData('text/folio-book');
    if (!b || !id) return;
    e.preventDefault();
    e.stopPropagation();
    b.classList.remove('drop-over');
    moveBook(id, b.dataset.shelf);
  });
  const shelvesEl = root.querySelector('.shelves');
  shelvesEl.addEventListener('dragstart', (e) => {
    const card = e.target.closest?.('.book-card');
    if (!card) return;
    e.dataTransfer.setData('text/folio-book', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    root.classList.add('moving-book');
    card.classList.add('dragging');
  });
  shelvesEl.addEventListener('dragend', (e) => {
    root.classList.remove('moving-book');
    e.target.closest?.('.book-card')?.classList.remove('dragging');
    tabs.querySelectorAll('.drop-over').forEach((x) => x.classList.remove('drop-over'));
  });

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(layoutShelves);
  });

  root.querySelector('.shelves').addEventListener('click', (e) => {
    const item = e.target.closest('[data-id]');
    if (item) openPreview(books.find((b) => b.id === item.dataset.id));
    else if (e.target.closest('[data-action=upload]')) input.click();
  });

  return root;
}

export async function showLibrary() {
  root.hidden = false;
  books = (await listBooks()).sort(
    (a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt),
  );
  coverUrls.forEach(URL.revokeObjectURL);
  coverUrls = [];
  for (const b of books) {
    b._coverUrl = b.cover ? URL.createObjectURL(b.cover) : '';
    if (b._coverUrl) coverUrls.push(b._coverUrl);
  }
  const n = books.length;
  // Only speak up when the shelf is empty.
  root.querySelector('.lib-count').textContent = n ? '' : 'Nothing here yet. Add a PDF to start reading.';
  // Land on a shelf with books on it, preferring the one holding the book you read last.
  if (!SHELVES[shelf] || !books.some((b) => shelfOf(b) === shelf)) shelf = books.length ? shelfOf(books[0]) : 'reading';
  showStreak();
  layoutShelves();
}

async function showStreak() {
  const stats = await getStats();
  const days = streakOf(stats);
  const today = Math.round((stats.days[dayKey()] || 0) / 60);
  const el = root.querySelector('.streak');
  el.hidden = !days && !today;
  el.innerHTML = days
    ? `${FLAME}<b>${days}-day streak</b><span>${today ? `${today} min today` : 'read today to keep it'}</span>`
    : `${FLAME}<b>${today} min today</b><span>read tomorrow to start a streak</span>`;
}

function pickShelf(next) {
  shelf = next;
  try {
    localStorage.setItem(SHELF_KEY, next);
  } catch {}
  layoutShelves();
}

async function moveBook(id, to) {
  const b = books.find((x) => x.id === id);
  if (!b || shelfOf(b) === to) return;
  const from = shelfOf(b);
  const patch = { shelf: to };
  if (to === 'finished' && !b.finishedAt) patch.finishedAt = Date.now();
  if (to !== 'finished') patch.finishedAt = 0;
  Object.assign(b, patch);
  await updateBook(id, patch);
  layoutShelves();
  toast(`Moved to ${SHELVES[to]}`, { label: 'Undo', run: () => moveBook(id, from) });
}

export function hideLibrary() {
  root.hidden = true;
  closePreview();
}

async function importFiles(files) {
  const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!pdfs.length) {
    toast('Only PDF files can go on the shelf');
    return;
  }
  navigator.storage?.persist?.();
  let added = 0;
  for (const file of pdfs) {
    toast(`Binding “${file.name}”…`);
    try {
      const info = await inspectPdf(file);
      const id = uid();
      const title = info.title && !/^(untitled|microsoft word)/i.test(info.title)
        ? info.title
        : file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
      await addBook(
        {
          id,
          title,
          author: info.author,
          fileName: file.name,
          size: file.size,
          pageCount: info.pageCount,
          ratio: info.ratio,
          cover: info.cover,
          color: clothColor(id),
          addedAt: Date.now(),
          lastOpenedAt: 0,
          lastPage: 0,
          shelf: 'want',
        },
        file,
      );
      added++;
    } catch (err) {
      console.error(err);
      toast(`Couldn’t read “${file.name}”. Is it a valid PDF?`);
    }
  }
  if (added) {
    toast(added === 1 ? 'Added to Want to read' : `${added} books added to Want to read`);
    shelf = 'want';
  }
  await showLibrary();
}

function thickness(pageCount, w) {
  return Math.round(Math.min(56, Math.max(16, 12 + pageCount * 0.08)) * (w / 140));
}

function book3d(book, w) {
  const h = Math.round(w * Math.min(Math.max(book.ratio || 1.41, 0.6), 1.6));
  const t = thickness(book.pageCount, w);
  return `
    <div class="book3d" style="--w:${w}px;--h:${h}px;--t:${t}px;--cloth:${clothColor(book.id)}">
      <div class="face inner"></div>
      <div class="face front">${book._coverUrl ? `<img src="${book._coverUrl}" alt="" draggable="false" />` : ''}</div>
      <div class="face back"></div>
      <div class="face spine"><span>${escapeHtml(book.title)}</span></div>
      <div class="face fore"></div>
      <div class="face top"></div>
      <div class="face bottom"></div>
    </div>`;
}

function statusLine(b) {
  if (shelfOf(b) === 'finished') return b.finishedAt ? `Finished ${new Date(b.finishedAt).toLocaleDateString()}` : 'Finished';
  if (!b.lastPage) return 'Not started';
  return `Page ${b.lastPage} of ${b.pageCount}`;
}

// Book height on the shelf; widths follow each PDF's own proportions.
function bookHeight() {
  if (window.innerWidth < 761) return 124;
  return window.innerHeight < 761 ? 165 : 200;
}

function layoutShelves() {
  const shelves = root.querySelector('.shelves');
  if (!shelves || root.hidden) return;
  root.querySelectorAll('[data-shelf]').forEach((t) => {
    t.setAttribute('aria-pressed', String(t.dataset.shelf === shelf));
    t.querySelector('em').textContent = books.filter((b) => shelfOf(b) === t.dataset.shelf).length || '';
  });
  const h = bookHeight();
  const onShelf = books.filter((b) => shelfOf(b) === shelf);
  const items = onShelf.map((b) => {
    const pct = b.pageCount ? Math.round((Math.min(b.lastPage, b.pageCount) / b.pageCount) * 100) : 0;
    const w = Math.round(h / Math.min(Math.max(b.ratio || 1.41, 0.6), 1.6));
    const status = statusLine(b);
    return {
      w,
      html: `
      <button class="book-card" data-id="${b.id}" draggable="true" style="--w:${w}px;--h:${h}px;--cloth:${clothColor(b.id)}" aria-label="${escapeHtml(b.title)}, ${status}">
        <span class="cover">${
          b._coverUrl ? `<img src="${b._coverUrl}" alt="" draggable="false" />` : `<span class="cover-title">${escapeHtml(b.title)}</span>`
        }${pct > 0 && pct < 100 && shelf !== 'finished' ? `<span class="cover-progress"><i style="width:${pct}%"></i></span>` : ''}</span>
        ${shelf === 'finished' ? '<span class="done-stamp">Done</span>' : ''}
        <span class="book-tip"><b>${escapeHtml(b.title)}</b><span>${status}${pct > 0 && shelf !== 'finished' ? ` · ${pct}%` : ''}</span></span>
      </button>`,
    };
  });
  if (books.length && !onShelf.length) {
    const empty = {
      reading: 'Nothing open right now. Pick something from Want to read.',
      want: 'Your wishlist is empty. Add a PDF or drag a book here.',
      finished: 'No finished books yet. You’ve got this.',
    };
    items.push({ w: 240, html: `<p class="shelf-empty">${empty[shelf]}</p>` });
  }
  if (shelf !== 'finished' || !books.length) {
    const w = Math.round(h * 0.68);
    items.push({
      w,
      html: `
      <button class="add-card" data-action="upload" style="--w:${w}px;--h:${h}px">
        ${icon('upload', 24)}<span>${books.length ? 'Add PDF' : 'Add your first book'}</span>
      </button>`,
    });
  }
  // Fill each shelf left to right, starting a new shelf when a book won't fit.
  const phone = window.innerWidth < 761;
  const gap = phone ? 12 : 18;
  const room = Math.min(shelves.clientWidth || 1000, 1160) - (phone ? 16 : 48);
  const rows = [];
  let row = null;
  for (const it of items) {
    if (!row || row.w + gap + it.w > room) rows.push((row = { w: -gap, items: [] }));
    row.w += gap + it.w;
    row.items.push(it.html);
  }
  shelves.innerHTML = rows
    .map(
      (r) => `
      <div class="shelf-row">
        <div class="row-books">${r.items.join('')}</div>
        <div class="ledge" style="width:${r.w + (phone ? 28 : 64)}px"></div>
      </div>`,
    )
    .join('');
}

// ---------- 3D preview: pick a book off the shelf and turn it in your hands ----------

let preview = null;

async function openPreview(book) {
  if (!book) return;
  closePreview();
  const counts = await countMarks(book.id);
  const modal = document.createElement('div');
  modal.className = 'preview';
  modal.innerHTML = `
    <div class="preview-backdrop"></div>
    <div class="preview-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(book.title)}">
      <button class="icon-btn preview-close" aria-label="Close">${icon('close')}</button>
      <div class="preview-stage" title="Drag to turn the book">
        ${sparkle('#ffffff', 28, 'deco p1')}${sparkle('#F2C744', 20, 'deco p2')}
        <div class="preview-rot">${book3d(book, window.innerWidth < 560 ? 170 : 230)}</div>
        <p class="hint">${icon('rotate', 14)} Drag to turn it in your hands</p>
      </div>
      <div class="preview-info">
        <input class="title-input" value="${escapeHtml(book.title)}" aria-label="Book title" spellcheck="false" />
        ${book.author ? `<p class="author">${escapeHtml(book.author)}</p>` : ''}
        <dl class="facts">
          <div><dt>Pages</dt><dd>${book.pageCount}</dd></div>
          <div><dt>Progress</dt><dd>${statusLine(book)}</dd></div>
          <div><dt>Bookmarks</dt><dd>${counts.bookmark}</dd></div>
          <div><dt>Highlights</dt><dd>${counts.highlight}</dd></div>
          <div><dt>Notes</dt><dd>${counts.note}</dd></div>
          <div><dt>Added</dt><dd>${new Date(book.addedAt).toLocaleDateString()}</dd></div>
        </dl>
        <div class="shelf-pick" role="group" aria-label="Shelf">${Object.entries(SHELVES)
          .map(([k, v]) => `<button data-move="${k}" aria-pressed="${shelfOf(book) === k}">${v}</button>`)
          .join('')}</div>
        <div class="preview-actions">
          <button class="btn primary" data-action="read">${icon('book', 18)}<span>${book.lastPage ? 'Continue reading' : 'Open book'}</span></button>
          <button class="btn ghost danger" data-action="delete">${icon('trash', 18)}<span>Remove</span></button>
        </div>
      </div>
    </div>`;
  document.body.append(modal);
  requestAnimationFrame(() => modal.classList.add('open'));

  const rot = modal.querySelector('.preview-rot');
  const bookEl = rot.querySelector('.book3d');
  let rx = -10;
  let ry = 28;
  let vx = 0;
  let vy = 0;
  let dragging = false;
  let last = null;
  let raf = 0;
  const apply = () => (rot.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`);
  apply();

  const spin = () => {
    if (!dragging) {
      ry += vy;
      rx += vx;
      vy *= 0.94;
      vx *= 0.94;
      rx = Math.max(-70, Math.min(70, rx));
      apply();
    }
    if (dragging || Math.abs(vy) > 0.05 || Math.abs(vx) > 0.05) raf = requestAnimationFrame(spin);
    else raf = 0;
  };

  const stage = modal.querySelector('.preview-stage');
  stage.addEventListener('pointerdown', (e) => {
    dragging = true;
    last = { x: e.clientX, y: e.clientY };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('grabbing');
    if (!raf) raf = requestAnimationFrame(spin);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    vy = (e.clientX - last.x) * 0.5;
    vx = -(e.clientY - last.y) * 0.5;
    ry += vy;
    rx = Math.max(-70, Math.min(70, rx + vx));
    last = { x: e.clientX, y: e.clientY };
    apply();
  });
  const release = () => {
    dragging = false;
    stage.classList.remove('grabbing');
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  const titleInput = modal.querySelector('.title-input');
  titleInput.addEventListener('change', async () => {
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.value = book.title;
      return;
    }
    book.title = title;
    await updateBook(book.id, { title });
    modal.querySelector('.spine span').textContent = title;
    layoutShelves();
  });
  titleInput.addEventListener('keydown', (e) => e.key === 'Enter' && titleInput.blur());

  modal.querySelector('[data-action=read]').onclick = () => {
    // Swing the book to face you and open the cover before entering the reader.
    cancelAnimationFrame(raf);
    rot.style.transition = 'transform .45s cubic-bezier(.3,.7,.3,1)';
    rx = 0;
    ry = 0;
    apply();
    setTimeout(() => bookEl.classList.add('opening'), 250);
    setTimeout(() => (location.hash = `#/read/${book.id}`), 900);
  };

  modal.querySelector('.shelf-pick').onclick = async (e) => {
    const b = e.target.closest('[data-move]');
    if (!b) return;
    await moveBook(book.id, b.dataset.move);
    modal.querySelectorAll('[data-move]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    modal.querySelector('.facts div:nth-child(2) dd').textContent = statusLine(book);
  };

  const del = modal.querySelector('[data-action=delete]');
  let armed = false;
  del.onclick = async () => {
    if (!armed) {
      armed = true;
      del.querySelector('span').textContent = 'Tap again to remove';
      setTimeout(() => {
        armed = false;
        if (del.isConnected) del.querySelector('span').textContent = 'Remove';
      }, 3000);
      return;
    }
    await deleteBook(book.id);
    closePreview();
    toast(`Removed “${book.title}”`);
    showLibrary();
  };

  const close = () => closePreview();
  modal.querySelector('.preview-backdrop').onclick = close;
  modal.querySelector('.preview-close').onclick = close;
  const onKey = (e) => e.key === 'Escape' && document.activeElement !== titleInput && close();
  document.addEventListener('keydown', onKey);
  preview = { modal, cleanup: () => (cancelAnimationFrame(raf), document.removeEventListener('keydown', onKey)) };
}

function closePreview() {
  if (!preview) return;
  const { modal, cleanup } = preview;
  preview = null;
  cleanup();
  modal.classList.remove('open');
  setTimeout(() => modal.remove(), 250);
}
