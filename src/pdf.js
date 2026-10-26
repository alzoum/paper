import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export async function openPdf(blob) {
  const data = new Uint8Array(await blob.arrayBuffer());
  return pdfjsLib.getDocument({ data }).promise;
}

// Renders a page into a fresh canvas `width` device pixels wide.
export async function renderPageToCanvas(pdf, pageNumber, width) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return canvas;
}

// Reads what the library needs from a freshly uploaded file.
export async function inspectPdf(file) {
  const pdf = await openPdf(file);
  try {
    const first = await pdf.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    let title = '';
    let author = '';
    try {
      const meta = await pdf.getMetadata();
      title = meta?.info?.Title?.trim() || '';
      author = meta?.info?.Author?.trim() || '';
    } catch {}
    const canvas = await renderPageToCanvas(pdf, 1, 480);
    const cover = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    return { pageCount: pdf.numPages, ratio: vp.height / vp.width, title, author, cover };
  } finally {
    pdf.destroy();
  }
}
