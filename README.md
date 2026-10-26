# Paper

A PDF reader that feels like reading on real paper. Put your PDFs on a shelf, pick one up and turn it in 3D, then read it with a realistic page curl, a pencil, a highlighter, sticky notes and calm sounds.

**Try it:** https://alzoum.github.io/paper/

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/, host anywhere
npm run deploy   # build and publish to GitHub Pages
```

## The shelf

- Books stand on shelves, sorted into **Reading**, **Want to read** and **Finished**. Drag a book onto a tab to move it.
- Hover a book for its title and progress; click it to turn it in your hands in 3D.
- A streak sticker counts the days in a row you've read.
- Add PDFs with the dashed "Add PDF" spot or by dropping files anywhere.

## How to read

| Action | How |
| --- | --- |
| Turn a page | Drag or flick a page, click it, or ← / → / Space |
| Zoom | Pinch (trackpad or touch), Ctrl/⌘ + scroll, or + / − / 0 |
| Move a zoomed page | Drag it with the hand |
| Riffle to any page | Drag the slider at the bottom |
| Bookmark | Tap the red ribbon near the spine, or press **B** |
| Pencil | **P**, then write or draw. Graphite, red or blue. ⌘Z undoes a stroke |
| Highlight | **H**, pick a colour, drag across a line. It snaps to the text |
| Sticky note | **N**, then tap a page. Tap a note to edit it |
| Erase | **E**, then rub over pencil, highlights or notes |
| Contents & search | Side panel (**M**) has the PDF's chapters, search (**/**), bookmarks, highlights and notes |
| Mood sounds | The leaf (**A**): Calm piano, Rainy window, Forest morning, Fireside, Corner café |
| ADHD mode | Top bar button: gentle never-ending motion on the desk that matches the mood |
| Paper & desk | Sliders button: Original, Warm or Dark paper; desk colour; one or two pages |
| Back to page-turning | **V** or **Esc** |

A floating timer shows how long you've been reading this session, and it pauses when you step away. Finishing a book gets confetti and a "Done" stamp.

## Where data lives

Everything stays in this browser's IndexedDB: the PDFs, reading position, marks, reading time and settings. Nothing is uploaded anywhere. Clearing site data for the app removes your library.

## Code map

- `src/library.js`: the shelves, PDF import, streak and the 3D book preview
- `src/reader.js`: the flip-book reader, zoom and pinch, tools, contents, search, timer and moods
- `src/scenes.js`: the moving ADHD-mode scenes
- `src/sound.js`: synthesized page-turn sound and mood ambience
- `src/stickers.js`: draggable stickers on the library desk
- `src/db.js`: IndexedDB storage
- `src/pdf.js`: pdf.js helpers
- `src/style.css`: all styling

Built with [pdf.js](https://mozilla.github.io/pdf.js/) and [StPageFlip](https://github.com/Nodlik/StPageFlip).
