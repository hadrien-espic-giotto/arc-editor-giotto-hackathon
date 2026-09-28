# Giotto ARC Task Editor

A dependency-free browser editor for authoring and exporting ARC tasks. It is
deliberately isolated from both the repository's compiled site and
`arc-editor-giotto-hackathon_basic`, which remains the minimal fallback.

## Host it on GitHub Pages

This directory is a complete standalone website. The included GitHub Actions
workflow tests it and publishes it to GitHub Pages after every push to `main`.
There is no build output to commit and no hosting dependency to install.

1. Create an empty **public** GitHub repository, for example
   `arc-editor-giotto-hackathon` (do not add a README or `.gitignore`).
2. From this directory, connect and push the prepared repository:

   ```sh
   git remote add origin https://github.com/YOUR-NAME/arc-editor-giotto-hackathon.git
   git push -u origin main
   ```

3. On GitHub, open **Settings → Pages** and select **GitHub Actions** as the
   source. If the first deployment ran before Pages was enabled, open
   **Actions → Deploy to GitHub Pages** and choose **Run workflow** once.
4. GitHub shows the public URL in the deployment summary. For a repository
   with the example name it will normally be:
   `https://YOUR-NAME.github.io/arc-editor-giotto-hackathon/`.

After that, publishing an update is just:

```sh
npm test
git add .
git commit -m "Describe the editor update"
git push
```

The site works at a project URL, a custom domain, or the domain root because
all application paths are relative. HTTPS from GitHub Pages also allows its
service worker to cache an offline copy after the first visit.

## Run it

For a quick local check, open `index.html` directly. Local saving, editing,
imports, exports, previews, and PNG generation all work from a file URL.

For offline caching and installable-app behavior during local development,
serve this directory over HTTP once:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>. After the first successful load, the app
shell is cached by its service worker and can reopen without a network.

There is no build step and no runtime dependency, CDN, account, or backend.

## Included functionality

- Paint by click/drag or touch/stylus, choose colors with keys `0`–`9`, flood
  fill, draw filled rectangles, and copy/paste rectangular selections.
- Undo and redo document changes, including drawing strokes, transforms,
  resizing, pair edits, imports, and metadata.
- Resize every input and output independently from 1×1 through 30×30, with a
  warning before a shrink discards non-black cells.
- Copy an input to its output; fill or clear a grid; rotate, flip, or shift it;
  and optionally wrap pixels during shifts.
- Add, duplicate, reorder, and remove training or test pairs. New pairs can use
  explicit defaults or inherit the previous pair's input/output dimensions.
- Maintain multiple named, automatically saved drafts in the browser.
- Record a task title, team identifier, rule explanation, and solvability notes
  without putting non-standard fields into ARC task JSON.
- Import standard ARC JSON, challenge JSON with omitted test outputs, or a full
  editor backup. Imports are validated before they replace the current task.
- Preview the solver-facing puzzle or the completed answer view.
- Check structure and receive authorship warnings before export.
- Export canonical ARC JSON, a solver challenge without test answers, a private
  answer key, a restorable editor backup, and puzzle/answer PNGs.
- Work from a static host, with an offline application cache after first load.

The editor intentionally does not implement public share URLs or direct event
submission. Both require a trusted backend contract, access policy, and data
retention decision. Downloaded challenge/answer files are safer and usable now;
submission can be added cleanly once the event endpoint is defined.

## Local-data behavior

Drafts are stored in browser `localStorage`. Clearing site data removes them,
so organizers should tell students to download an **Editor backup** periodically
and before submission. The canonical task JSON excludes editor metadata; the
backup preserves it.

## Test it

```sh
npm test
```

The test suite uses Node's built-in runner and covers task/document creation,
validation and import, resize data-loss detection, immutable drawing helpers,
selection copy/paste, transforms, export separation, review warnings, and safe
filenames. No packages are installed.

Before deploying, also open the hosted app in the same desktop and mobile
browsers planned for the event and perform the short manual smoke test:

1. Draw with mouse and touch, undo, redo, resize, and transform a grid.
2. Download an editor backup, change the task, and re-import that backup.
3. Open puzzle preview and download all JSON and PNG variants.
4. Reload, confirm the draft persists, then go offline and reload again.
