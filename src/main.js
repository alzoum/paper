import 'page-flip/src/Style/stPageFlip.css';
import './style.css';
import { hideLibrary, mountLibrary, showLibrary } from './library.js';
import { openReader } from './reader.js';

const app = document.getElementById('app');
mountLibrary(app);

let closeReader = null;

async function route() {
  const match = location.hash.match(/^#\/read\/(.+)$/);
  if (closeReader) {
    await closeReader();
    closeReader = null;
  }
  if (match) {
    hideLibrary();
    closeReader = await openReader(decodeURIComponent(match[1]), app);
    if (!closeReader) location.hash = '#/';
  } else {
    await showLibrary();
  }
}

window.addEventListener('hashchange', route);
route();
