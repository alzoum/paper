import { openDB } from 'idb';

// Everything lives in this browser's IndexedDB: book records, the original
// PDF blobs (kept in their own store so listing the library stays cheap),
// marks (bookmarks / highlights / notes) and reader settings.
const dbPromise = openDB('folio', 1, {
  upgrade(db) {
    db.createObjectStore('books', { keyPath: 'id' });
    db.createObjectStore('files');
    const marks = db.createObjectStore('marks', { keyPath: 'id' });
    marks.createIndex('bookId', 'bookId');
    db.createObjectStore('settings');
  },
});

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export async function listBooks() {
  return (await dbPromise).getAll('books');
}

export async function getBook(id) {
  return (await dbPromise).get('books', id);
}

export async function addBook(book, fileBlob) {
  const db = await dbPromise;
  const tx = db.transaction(['books', 'files'], 'readwrite');
  await Promise.all([tx.objectStore('books').put(book), tx.objectStore('files').put(fileBlob, book.id), tx.done]);
}

export async function updateBook(id, patch) {
  // Read and write in one transaction so overlapping saves can't undo each other.
  const tx = (await dbPromise).transaction('books', 'readwrite');
  const book = await tx.store.get(id);
  if (!book) return;
  Object.assign(book, patch);
  await tx.store.put(book);
  await tx.done;
  return book;
}

export async function deleteBook(id) {
  const db = await dbPromise;
  const tx = db.transaction(['books', 'files', 'marks'], 'readwrite');
  const markKeys = await tx.objectStore('marks').index('bookId').getAllKeys(id);
  await Promise.all([
    tx.objectStore('books').delete(id),
    tx.objectStore('files').delete(id),
    ...markKeys.map((k) => tx.objectStore('marks').delete(k)),
    tx.done,
  ]);
}

export async function getFile(id) {
  return (await dbPromise).get('files', id);
}

export async function listMarks(bookId) {
  return (await dbPromise).getAllFromIndex('marks', 'bookId', bookId);
}

export async function putMark(mark) {
  return (await dbPromise).put('marks', mark);
}

export async function removeMark(id) {
  return (await dbPromise).delete('marks', id);
}

export async function countMarks(bookId) {
  const marks = await listMarks(bookId);
  const counts = { bookmark: 0, highlight: 0, note: 0 };
  for (const m of marks) counts[m.type] = (counts[m.type] || 0) + 1;
  return counts;
}

const SETTING_DEFAULTS = { paper: 'original', desk: 'purple', layout: 'two', sound: true, v: 2 };

export async function getSettings() {
  const saved = await (await dbPromise).get('settings', 'reader');
  const settings = { ...SETTING_DEFAULTS, ...saved };
  // v2: pages show the PDF's true colours unless the reader picks a tint.
  if ((saved?.v || 0) < 2) Object.assign(settings, { paper: 'original', v: 2 });
  return settings;
}

export async function saveSettings(settings) {
  return (await dbPromise).put('settings', settings, 'reader');
}

// ---------- reading time, for the streak on the shelf ----------

export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getStats() {
  return (await (await dbPromise).get('settings', 'stats')) || { days: {} };
}

export async function addReadingTime(seconds) {
  const tx = (await dbPromise).transaction('settings', 'readwrite');
  const stats = (await tx.store.get('stats')) || { days: {} };
  const k = dayKey();
  stats.days[k] = (stats.days[k] || 0) + seconds;
  await tx.store.put(stats, 'stats');
  await tx.done;
}

// Days in a row with at least a minute of reading, counting back from today
// (or from yesterday, so the streak doesn't vanish before you've read today).
export function streakOf(stats) {
  const d = new Date();
  if (!(stats.days[dayKey(d)] >= 60)) d.setDate(d.getDate() - 1);
  let n = 0;
  while (stats.days[dayKey(d)] >= 60) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

// Which shelf a book sits on. Older books have no shelf yet, so infer one.
export function shelfOf(book) {
  return book.shelf || (book.finishedAt ? 'finished' : book.lastPage > 0 ? 'reading' : 'want');
}
