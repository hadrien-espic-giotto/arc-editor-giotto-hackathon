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
imports, and JSON downloads all work from a file URL.

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
  fill, and copy/paste rectangular selections. Each drawing tool has a short
  instruction beside it.
- Undo and redo document changes, including drawing strokes, transforms,
  resizing, pair edits, and imports.
- Resize every input and output independently from 1×1 through 30×30, with a
  warning before a shrink discards non-black cells.
- Copy an input to its output; fill or clear a grid; rotate, flip, or shift it;
  and optionally wrap pixels during shifts. Rotate, Flip, and Shift are under
  **More grid tools** on each grid.
- Add, duplicate, reorder, and remove training or test pairs. New pairs can use
  explicit defaults or inherit the previous pair's input/output dimensions.
- Save editing automatically in this browser and resume the current task when
  reopening the page. **New task** starts a fresh task without deleting any work;
  **Recover previous task** opens earlier tasks, with timestamps and thumbnails.
  If saving fails, starting or recovering a task is blocked to protect current work.
- Import standard ARC JSON, challenge JSON with omitted test outputs, or a full
  editor backup. Imports are validated before they replace the current task.
- Use **Review & download JSON** to see all inputs and correct outputs,
  including test answers. Review grid warnings, then choose **Confirm & download
  JSON** to save one standard ARC task file.
- Exported JSON contains only `train` and `test` pairs with `input` and `output`
  grids; team names, explanations, and other submission details are handled
  outside the editor.
- Work from a static host, with an offline application cache after first load.

## Submission page

Open `submission.html`, or use **Submit task** in the editor. The page accepts a
team name and pasted/uploaded ARC JSON, with a separate button for the text
explanation. Team names become snake_case filenames, such as `grid_explorers.json`
and `grid_explorers.txt`. Only the team name is remembered in this browser, so
participants can return to add an explanation while evaluation is running.

Both submission endpoints currently use placeholder URLs. Preview submissions
validate the content but do not send data. To connect
a backend, replace each form's `action` in `submission.html` and remove its
`data-placeholder="true"` attribute. **Workshop home** links to the published
landing page at <https://hadrien-espic-giotto.github.io/landing-page-giotto-hackathon/>.

Each endpoint receives an HTTP POST with `Content-Type: application/json`:

- Task: `{ "team_name": "Grid Explorers", "filename": "grid_explorers.json", "task": { "train": [...], "test": [...] } }`
- Explanation: `{ "team_name": "Grid Explorers", "filename": "grid_explorers.txt", "explanation": "..." }`

The backend must associate the two files by their shared filename base; the
explanation can arrive independently on a later visit. A successful HTTP
response confirms submission; errors leave the content available for retry.

## Local-data behavior

Tasks are saved in browser `localStorage`, including each painted cell and
when the page is hidden or closed. **New task** keeps all previous tasks available
under **Recover previous task**; recovering also keeps the task you switch away
from. Existing drafts from the older draft manager remain recoverable.

Clearing site data removes these browser saves, so download your task using **Review & download JSON** before leaving. The
JSON can be imported to continue editing. Existing saved drafts and older
editor backups are still readable, but submission metadata is no longer shown
or exported.

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
2. Review and download task JSON, change the task, and re-import the JSON.
3. Confirm the review shows test outputs, cancel it, edit a grid, and review
   again before downloading. Check that Rotate, Flip, and Shift work under
   **More grid tools**.
4. Start a new task, recover the previous task, and confirm both are still
   available after reloading. Navigate away during an unfinished paint stroke
   and confirm the stroke persists when returning.
5. Go offline and reload again.
