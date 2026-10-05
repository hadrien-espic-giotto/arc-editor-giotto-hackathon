(function startEditor() {
  "use strict";

  const Core = window.ARCEditorCore;
  const WORKSPACE_KEY = "giotto-arc-editor-workspace-v2";
  const LEGACY_KEY = "giotto-arc-editor-task-v1";
  const HISTORY_LIMIT = 100;
  const COLORS = [
    "#000000", "#0074d9", "#ff4136", "#2ecc40", "#ffdc00",
    "#aaaaaa", "#f012be", "#ff851b", "#7fdbff", "#870c25",
  ];
  const COLOR_NAMES = ["black", "blue", "red", "green", "yellow", "gray", "magenta", "orange", "sky blue", "maroon"];

  const elements = {
    saveState: document.getElementById("save-state"),
    status: document.getElementById("status"),
    palette: document.getElementById("palette"),
    trainPairs: document.getElementById("train-pairs"),
    testPairs: document.getElementById("test-pairs"),
    undo: document.getElementById("undo"),
    redo: document.getElementById("redo"),
    recoverTask: document.getElementById("recover-task"),
    recoveryDialog: document.getElementById("recovery-dialog"),
    recoveryList: document.getElementById("recovery-list"),
    recoveryHelp: document.getElementById("recovery-help"),
    defaultWidth: document.getElementById("default-width"),
    defaultHeight: document.getElementById("default-height"),
    inheritSize: document.getElementById("inherit-size"),
    exportDialog: document.getElementById("export-dialog"),
    exportReport: document.getElementById("export-report"),
    previewContent: document.getElementById("preview-content"),
    downloadTask: document.getElementById("download-task"),
    toolHelp: document.getElementById("tool-help"),
    shortcutsDialog: document.getElementById("shortcuts-dialog"),
  };

  let workspace = loadWorkspace();
  let editorDocument = Core.cloneDocument(activeDraft().document);
  let selectedColor = 0;
  let activeTool = "paint";
  let historyPast = [];
  let historyFuture = [];
  let drawing = null;
  let selection = null;
  let copiedFragment = null;
  let reviewedTaskJSON = null;

  function createId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function newDraft(name = "Task 1", documentValue = Core.createDocument()) {
    return { id: createId(), name, updatedAt: new Date().toISOString(), document: Core.cloneDocument(documentValue) };
  }

  function defaultWorkspace() {
    const draft = newDraft();
    return {
      activeId: draft.id,
      drafts: { [draft.id]: draft },
      settings: { defaultWidth: 8, defaultHeight: 8, inheritSize: true, wrapShifts: false },
    };
  }

  function loadWorkspace() {
    try {
      const saved = localStorage.getItem(WORKSPACE_KEY);
      if (saved) {
        const raw = JSON.parse(saved);
        const drafts = {};
        Object.values(raw.drafts || {}).forEach((draft) => {
          if (!draft || !draft.id) return;
          drafts[draft.id] = {
            id: String(draft.id),
            name: typeof draft.name === "string" && draft.name.trim() ? draft.name.trim() : "Untitled task",
            updatedAt: typeof draft.updatedAt === "string" ? draft.updatedAt : new Date().toISOString(),
            document: Core.normalizeEditorDocument(draft.document),
          };
        });
        const ids = Object.keys(drafts);
        if (ids.length) {
          const settings = raw.settings || {};
          return {
            activeId: drafts[raw.activeId] ? raw.activeId : ids[0],
            drafts,
            settings: {
              defaultWidth: validDimension(settings.defaultWidth) ? settings.defaultWidth : 8,
              defaultHeight: validDimension(settings.defaultHeight) ? settings.defaultHeight : 8,
              inheritSize: settings.inheritSize !== false,
              wrapShifts: settings.wrapShifts === true,
            },
          };
        }
      }
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const task = Core.normalizeImportedTask(JSON.parse(legacy)).task;
        const migrated = defaultWorkspace();
        migrated.drafts[migrated.activeId].document = Core.createDocument(task);
        migrated.drafts[migrated.activeId].name = "Migrated task";
        return migrated;
      }
    } catch (error) {
      console.warn("Could not restore the saved workspace:", error);
    }
    return defaultWorkspace();
  }

  function activeDraft() {
    return workspace.drafts[workspace.activeId];
  }

  function validDimension(value) {
    return Number.isInteger(value) && value >= Core.MIN_SIZE && value <= Core.MAX_SIZE;
  }

  function saveWorkspace() {
    elements.saveState.textContent = "Saving…";
    elements.saveState.classList.add("saving");
    try {
      const draft = activeDraft();
      draft.document = Core.cloneDocument(editorDocument);
      draft.updatedAt = new Date().toISOString();
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
      elements.saveState.textContent = "Saved automatically";
      elements.saveState.classList.remove("saving", "error");
      return true;
    } catch (error) {
      elements.saveState.textContent = "Autosave failed — download JSON to keep your work";
      elements.saveState.classList.remove("saving");
      elements.saveState.classList.add("error");
      showStatus("Local saving failed. Use Review & download JSON to save your work to a file.", "error");
      return false;
    }
  }

  function showStatus(message, kind = "") {
    elements.status.textContent = message;
    elements.status.className = kind;
  }

  function snapshot() {
    return Core.serializeDocument(editorDocument, 0);
  }

  function updateHistoryButtons() {
    elements.undo.disabled = historyPast.length === 0;
    elements.redo.disabled = historyFuture.length === 0;
    elements.undo.title = historyPast.length ? `Undo ${historyPast[historyPast.length - 1].label} (Ctrl/⌘+Z)` : "Nothing to undo";
    elements.redo.title = historyFuture.length ? `Redo ${historyFuture[historyFuture.length - 1].label} (Ctrl/⌘+Shift+Z)` : "Nothing to redo";
  }

  function remember(before, label) {
    const after = snapshot();
    if (before === after) return false;
    historyPast.push({ snapshot: before, label });
    if (historyPast.length > HISTORY_LIMIT) historyPast.shift();
    historyFuture = [];
    saveWorkspace();
    updateHistoryButtons();
    return true;
  }

  function commit(label, mutation, options = {}) {
    const before = snapshot();
    mutation();
    Core.validateDocument(editorDocument);
    const changed = remember(before, label);
    if (changed && options.render !== false) renderAll();
    if (changed && options.status !== false) showStatus(`${label}.`, "success");
    return changed;
  }

  function restoreSnapshot(serialized) {
    editorDocument = Core.normalizeEditorDocument(JSON.parse(serialized));
    activeDraft().document = Core.cloneDocument(editorDocument);
    selection = null;
    drawing = null;
    saveWorkspace();
    renderAll();
  }

  function undo() {
    if (!historyPast.length) return;
    const action = historyPast.pop();
    historyFuture.push({ snapshot: snapshot(), label: action.label });
    restoreSnapshot(action.snapshot);
    showStatus(`Undid ${action.label}.`, "success");
  }

  function redo() {
    if (!historyFuture.length) return;
    const action = historyFuture.pop();
    historyPast.push({ snapshot: snapshot(), label: action.label });
    restoreSnapshot(action.snapshot);
    showStatus(`Redid ${action.label}.`, "success");
  }

  function renderPalette() {
    elements.palette.replaceChildren();
    COLORS.forEach((hex, color) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "palette-color";
      button.dataset.color = String(color);
      button.style.background = hex;
      button.style.color = [0, 1, 2, 6, 9].includes(color) ? "#fff" : "#111";
      button.textContent = String(color);
      button.title = `${COLOR_NAMES[color]} (${color})`;
      button.setAttribute("aria-label", `Select ${COLOR_NAMES[color]}, color ${color}`);
      button.addEventListener("click", () => selectColor(color));
      elements.palette.appendChild(button);
    });
    selectColor(selectedColor);
  }

  function selectColor(color) {
    selectedColor = color;
    elements.palette.querySelectorAll(".palette-color").forEach((button) => {
      const selected = Number(button.dataset.color) === color;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    showStatus(`Selected ${COLOR_NAMES[color]} (${color}).`);
  }

  function selectTool(tool) {
    activeTool = tool;
    document.querySelectorAll("[data-tool]").forEach((button) => {
      const selected = button.dataset.tool === tool;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const instructions = {
      paint: "Paint: click or drag to color cells.",
      fill: "Fill: click to recolor connected cells of the same color.",
      select: "Select: drag over cells, copy them, then select a destination and paste.",
    };
    elements.toolHelp.textContent = instructions[tool];
    showStatus(instructions[tool]);
  }

  function gridReferenceFromCell(cell) {
    return {
      section: cell.dataset.section,
      pairIndex: Number(cell.dataset.pairIndex),
      side: cell.dataset.side,
      row: Number(cell.dataset.row),
      column: Number(cell.dataset.column),
    };
  }

  function sameGrid(first, second) {
    return first && second && first.section === second.section && first.pairIndex === second.pairIndex && first.side === second.side;
  }

  function getGrid(reference) {
    return editorDocument.task[reference.section][reference.pairIndex][reference.side];
  }

  function setGrid(reference, grid) {
    editorDocument.task[reference.section][reference.pairIndex][reference.side] = grid;
  }

  function paintReference(reference) {
    const grid = getGrid(reference);
    if (grid[reference.row][reference.column] === selectedColor) return false;
    grid[reference.row][reference.column] = selectedColor;
    const selector = `.grid-cell[data-section="${reference.section}"][data-pair-index="${reference.pairIndex}"][data-side="${reference.side}"][data-row="${reference.row}"][data-column="${reference.column}"]`;
    const cell = document.querySelector(selector);
    if (cell) {
      cell.style.background = COLORS[selectedColor];
      cell.setAttribute("aria-label", `Row ${reference.row + 1}, column ${reference.column + 1}, ${COLOR_NAMES[selectedColor]} (${selectedColor})`);
    }
    saveWorkspace();
    return true;
  }

  function cellAtPoint(event) {
    const node = document.elementFromPoint(event.clientX, event.clientY);
    return node && node.closest ? node.closest(".grid-cell") : null;
  }

  function clearSelectionHighlight() {
    document.querySelectorAll(".grid-cell.selection-preview").forEach((cell) => cell.classList.remove("selection-preview"));
  }

  function highlightRectangle(reference, start, end) {
    clearSelectionHighlight();
    const minRow = Math.min(start.row, end.row);
    const maxRow = Math.max(start.row, end.row);
    const minColumn = Math.min(start.column, end.column);
    const maxColumn = Math.max(start.column, end.column);
    document.querySelectorAll(`.grid-cell[data-section="${reference.section}"][data-pair-index="${reference.pairIndex}"][data-side="${reference.side}"]`).forEach((cell) => {
      const row = Number(cell.dataset.row);
      const column = Number(cell.dataset.column);
      if (row >= minRow && row <= maxRow && column >= minColumn && column <= maxColumn) cell.classList.add("selection-preview");
    });
  }

  function applySelectionHighlight() {
    clearSelectionHighlight();
    if (!selection) return;
    const pair = editorDocument.task[selection.section] && editorDocument.task[selection.section][selection.pairIndex];
    const grid = pair && pair[selection.side];
    if (!grid || selection.row >= grid.length || selection.column >= grid[0].length) {
      selection = null;
      return;
    }
    highlightRectangle(selection, selection, selection.end);
  }

  function handlePointerDown(event, cell) {
    if (event.button !== 0 || drawing) return;
    event.preventDefault();
    const reference = gridReferenceFromCell(cell);
    if (activeTool === "fill") {
      commit("Flood filled grid", () => setGrid(reference, Core.floodFill(getGrid(reference), reference.row, reference.column, selectedColor)));
      return;
    }
    drawing = {
      pointerId: event.pointerId,
      tool: activeTool,
      grid: reference,
      start: reference,
      end: reference,
      before: snapshot(),
      changed: false,
    };
    if (activeTool === "paint") drawing.changed = paintReference(reference);
    if (activeTool === "select") highlightRectangle(reference, reference, reference);
  }

  function handlePointerMove(event) {
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    const cell = cellAtPoint(event);
    if (!cell) return;
    const reference = gridReferenceFromCell(cell);
    if (!sameGrid(reference, drawing.grid)) return;
    event.preventDefault();
    drawing.end = reference;
    if (drawing.tool === "paint") drawing.changed = paintReference(reference) || drawing.changed;
    if (drawing.tool === "select") highlightRectangle(reference, drawing.start, reference);
  }

  function finishPointerAction(event) {
    if (!drawing || (event.pointerId !== undefined && drawing.pointerId !== event.pointerId)) return;
    const action = drawing;
    drawing = null;
    if (action.tool === "paint") {
      if (action.changed) {
        remember(action.before, "Painted stroke");
        showStatus("Painted stroke.", "success");
      }
      return;
    }
    if (action.tool === "select") {
      selection = {
        section: action.grid.section,
        pairIndex: action.grid.pairIndex,
        side: action.grid.side,
        row: Math.min(action.start.row, action.end.row),
        column: Math.min(action.start.column, action.end.column),
        end: {
          row: Math.max(action.start.row, action.end.row),
          column: Math.max(action.start.column, action.end.column),
        },
      };
      applySelectionHighlight();
      showStatus("Selection ready. Copy it or choose another grid position for pasting.");
    }
  }

  function copySelection() {
    if (!selection) {
      showStatus("Select a rectangle before copying.", "error");
      return;
    }
    const pair = editorDocument.task[selection.section] && editorDocument.task[selection.section][selection.pairIndex];
    if (!pair || !pair[selection.side]) {
      clearSelection();
      showStatus("That selection no longer exists. Select cells again.", "error");
      return;
    }
    copiedFragment = Core.copyRectangle(getGrid(selection), selection.row, selection.column, selection.end.row, selection.end.column);
    showStatus(`Copied ${copiedFragment[0].length}×${copiedFragment.length} cells.`, "success");
  }

  function pasteSelection() {
    if (!selection || !copiedFragment) {
      showStatus("Copy a selection, then select the destination cell or rectangle.", "error");
      return;
    }
    commit("Pasted selection", () => setGrid(selection, Core.pasteRectangle(getGrid(selection), copiedFragment, selection.row, selection.column)));
  }

  function clearSelection() {
    selection = null;
    clearSelectionHighlight();
    showStatus("Selection cleared.");
  }

  function createGridElement(grid, section, pairIndex, side, readOnly = false) {
    const scroller = document.createElement("div");
    scroller.className = "grid-scroll";
    const element = document.createElement("div");
    element.className = "grid";
    element.style.gridTemplateColumns = `repeat(${grid[0].length}, var(--cell-size))`;
    grid.forEach((row, rowIndex) => {
      row.forEach((color, columnIndex) => {
        const cell = document.createElement(readOnly ? "div" : "button");
        if (!readOnly) cell.type = "button";
        cell.className = "grid-cell";
        cell.style.background = COLORS[color];
        cell.dataset.section = section;
        cell.dataset.pairIndex = String(pairIndex);
        cell.dataset.side = side;
        cell.dataset.row = String(rowIndex);
        cell.dataset.column = String(columnIndex);
        cell.setAttribute("aria-label", `Row ${rowIndex + 1}, column ${columnIndex + 1}, ${COLOR_NAMES[color]} (${color})`);
        if (!readOnly) {
          cell.addEventListener("pointerdown", (event) => handlePointerDown(event, cell));
          cell.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            const reference = gridReferenceFromCell(cell);
            commit("Painted cell", () => { getGrid(reference)[reference.row][reference.column] = selectedColor; });
          });
        }
        element.appendChild(cell);
      });
    });
    scroller.appendChild(element);
    return scroller;
  }

  function dimensionControl(grid, reference, dimension) {
    const input = document.createElement("input");
    input.type = "number";
    input.className = "dimension-input";
    input.min = String(Core.MIN_SIZE);
    input.max = String(Core.MAX_SIZE);
    input.value = String(dimension === "width" ? grid[0].length : grid.length);
    input.setAttribute("aria-label", `${reference.side} grid ${dimension}`);
    input.addEventListener("change", () => {
      const value = Number(input.value);
      if (!validDimension(value)) {
        input.value = String(dimension === "width" ? grid[0].length : grid.length);
        showStatus(`Grid ${dimension} must be between ${Core.MIN_SIZE} and ${Core.MAX_SIZE}.`, "error");
        return;
      }
      const width = dimension === "width" ? value : grid[0].length;
      const height = dimension === "height" ? value : grid.length;
      if (Core.resizeWouldDiscard(grid, width, height) && !window.confirm("Shrinking this grid will discard colored cells. Continue?")) {
        input.value = String(dimension === "width" ? grid[0].length : grid.length);
        return;
      }
      commit(`Resized ${reference.side} grid`, () => setGrid(reference, Core.resizeGrid(grid, width, height)));
    });
    return input;
  }

  function actionButton(label, title, handler, extraClass = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button button-secondary button-small ${extraClass}`.trim();
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", handler);
    return button;
  }

  function transformGrid(reference, label, transformer) {
    commit(label, () => setGrid(reference, transformer(getGrid(reference))));
  }

  function transformGroup(label, buttons) {
    const group = document.createElement("div");
    group.className = "transform-group";
    const groupLabel = document.createElement("span");
    groupLabel.className = "transform-label";
    groupLabel.textContent = label;
    group.append(groupLabel, ...buttons);
    return group;
  }

  function createGridCard(section, pairIndex, side) {
    const reference = { section, pairIndex, side };
    const grid = getGrid(reference);
    const card = document.createElement("section");
    card.className = "grid-card";
    const heading = document.createElement("div");
    heading.className = "grid-heading";
    const title = document.createElement("h3");
    title.textContent = side === "input" ? "Input" : section === "test" ? "Correct output (answer)" : "Correct output";
    const dimensions = document.createElement("div");
    dimensions.className = "grid-dimensions";
    for (const dimension of ["width", "height"]) {
      const label = document.createElement("label");
      label.append(dimension === "width" ? "Width " : "Height ", dimensionControl(grid, reference, dimension));
      dimensions.appendChild(label);
    }
    heading.append(title, dimensions);

    const actions = document.createElement("div");
    actions.className = "grid-actions";
    if (side === "output") {
      actions.appendChild(actionButton("Copy input", "Copy the paired input to this output", () => {
        commit("Copied input to output", () => setGrid(reference, Core.cloneGrid(editorDocument.task[section][pairIndex].input)));
      }));
    }
    actions.appendChild(actionButton("Fill grid", "Fill the entire grid with the selected color", () => {
      commit("Filled grid", () => setGrid(reference, Core.fillGrid(grid, selectedColor)));
    }));
    actions.appendChild(actionButton("Clear grid", "Clear this grid to black", () => {
      if (!Core.isBlankGrid(grid) && !window.confirm("Clear every cell in this grid?")) return;
      commit("Cleared grid", () => setGrid(reference, Core.fillGrid(grid, 0)));
    }));

    const transforms = document.createElement("div");
    transforms.className = "grid-actions transform-actions";
    transforms.setAttribute("aria-label", "Grid transformations");
    transforms.append(
      transformGroup("Rotate", [
        actionButton("↺", "Rotate counter-clockwise", () => transformGrid(reference, "Rotated grid counter-clockwise", Core.rotateCounterClockwise)),
        actionButton("↻", "Rotate clockwise", () => transformGrid(reference, "Rotated grid clockwise", Core.rotateClockwise)),
      ]),
      transformGroup("Flip", [
        actionButton("⇋", "Flip horizontally", () => transformGrid(reference, "Flipped grid horizontally", Core.flipHorizontal)),
        actionButton("⇵", "Flip vertically", () => transformGrid(reference, "Flipped grid vertically", Core.flipVertical)),
      ]),
      transformGroup("Shift", [
        actionButton("←", "Shift left", () => transformGrid(reference, "Shifted grid left", (value) => Core.shiftGrid(value, 0, -1, workspace.settings.wrapShifts))),
        actionButton("↑", "Shift up", () => transformGrid(reference, "Shifted grid up", (value) => Core.shiftGrid(value, -1, 0, workspace.settings.wrapShifts))),
        actionButton("↓", "Shift down", () => transformGrid(reference, "Shifted grid down", (value) => Core.shiftGrid(value, 1, 0, workspace.settings.wrapShifts))),
        actionButton("→", "Shift right", () => transformGrid(reference, "Shifted grid right", (value) => Core.shiftGrid(value, 0, 1, workspace.settings.wrapShifts))),
      ]),
    );

    const moreTools = document.createElement("details");
    moreTools.className = "more-grid-tools";
    const moreToolsLabel = document.createElement("summary");
    moreToolsLabel.textContent = "More grid tools";
    const wrapLabel = document.createElement("label");
    wrapLabel.className = "check-label shift-wrap-control";
    const wrapInput = document.createElement("input");
    wrapInput.type = "checkbox";
    wrapInput.checked = workspace.settings.wrapShifts;
    wrapInput.addEventListener("change", () => {
      workspace.settings.wrapShifts = wrapInput.checked;
      document.querySelectorAll(".shift-wrap-control input").forEach((input) => { input.checked = wrapInput.checked; });
      saveWorkspace();
    });
    wrapLabel.append(wrapInput, "Wrap shifted cells around edges (all grids)");
    moreTools.append(moreToolsLabel, transforms, wrapLabel);
    card.append(heading, createGridElement(grid, section, pairIndex, side), actions, moreTools);
    return card;
  }

  function pairButton(label, title, handler, disabled = false, danger = false) {
    const button = actionButton(label, title, handler, danger ? "button-danger" : "");
    button.disabled = disabled;
    return button;
  }

  function movePair(section, index, direction) {
    commit("Reordered pair", () => {
      const pairs = editorDocument.task[section];
      const target = index + direction;
      [pairs[index], pairs[target]] = [pairs[target], pairs[index]];
    });
  }

  function createPairElement(section, index) {
    const wrapper = document.createElement("article");
    wrapper.className = "pair";
    const heading = document.createElement("div");
    heading.className = "pair-heading";
    const title = document.createElement("h3");
    title.textContent = `${section === "train" ? "Example" : "Test"} ${index + 1}`;
    const controls = document.createElement("div");
    controls.className = "pair-heading-actions";
    const pairs = editorDocument.task[section];
    controls.append(
      pairButton("↑", "Move pair earlier", () => movePair(section, index, -1), index === 0),
      pairButton("↓", "Move pair later", () => movePair(section, index, 1), index === pairs.length - 1),
      pairButton("Duplicate", "Duplicate this pair", () => {
        commit("Duplicated pair", () => {
          const pair = pairs[index];
          pairs.splice(index + 1, 0, { input: Core.cloneGrid(pair.input), output: Core.cloneGrid(pair.output) });
        });
      }),
      pairButton("Remove", "Remove this pair", () => {
        if (!window.confirm(`Remove ${section} pair ${index + 1}?`)) return;
        commit("Removed pair", () => pairs.splice(index, 1));
      }, pairs.length === 1, true),
    );
    heading.append(title, controls);
    const gridPair = document.createElement("div");
    gridPair.className = "grid-pair";
    const arrow = document.createElement("div");
    arrow.className = "pair-arrow";
    arrow.textContent = "→";
    arrow.setAttribute("aria-hidden", "true");
    gridPair.append(createGridCard(section, index, "input"), arrow, createGridCard(section, index, "output"));
    wrapper.append(heading, gridPair);
    return wrapper;
  }

  function renderSection(section, target) {
    target.replaceChildren();
    editorDocument.task[section].forEach((_, index) => target.appendChild(createPairElement(section, index)));
  }

  function renderPairs() {
    renderSection("train", elements.trainPairs);
    renderSection("test", elements.testPairs);
    applySelectionHighlight();
  }

  function syncSettings() {
    elements.defaultWidth.value = String(workspace.settings.defaultWidth);
    elements.defaultHeight.value = String(workspace.settings.defaultHeight);
    elements.inheritSize.checked = workspace.settings.inheritSize;
  }

  function savedTasks() {
    return Object.values(workspace.drafts)
      .filter((draft) => draft.id !== workspace.activeId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function renderTaskControls() {
    elements.recoverTask.hidden = savedTasks().length === 0;
  }

  function renderRecovery() {
    elements.recoveryList.replaceChildren();
    savedTasks().forEach((draft) => {
      const row = document.createElement("article");
      row.className = "recovery-item";
      const details = document.createElement("div");
      details.className = "recovery-details";
      const title = document.createElement("h3");
      title.textContent = draft.name;
      const saved = document.createElement("p");
      const date = new Date(draft.updatedAt);
      const timestamp = date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      const task = draft.document.task;
      saved.textContent = `Last saved ${timestamp} · ${task.train.length} example${task.train.length === 1 ? "" : "s"} · ${task.test.length} test${task.test.length === 1 ? "" : "s"}`;
      details.append(title, saved);
      const thumbnails = document.createElement("div");
      thumbnails.className = "recovery-thumbnails";
      thumbnails.setAttribute("aria-label", "First example: input and correct output");
      [task.train[0].input, task.train[0].output].forEach((grid, index) => {
        const thumbnailCard = document.createElement("div");
        thumbnailCard.className = "recovery-thumbnail";
        const label = document.createElement("span");
        label.textContent = index === 0 ? "Input" : "Output";
        const thumbnail = previewGrid(grid);
        thumbnail.style.setProperty("--preview-cell-size", `${Math.min(10, 100 / Math.max(grid.length, grid[0].length))}px`);
        thumbnailCard.append(label, thumbnail);
        thumbnails.appendChild(thumbnailCard);
      });
      const restore = actionButton("Open this task", `Open saved task ${draft.name}`, () => {
        if (!activateDraft(draft)) {
          elements.recoveryHelp.textContent = "Your current work could not be saved, so it has been kept open. Go back to editing and download JSON to keep it before opening another task.";
          elements.recoveryHelp.classList.add("error");
          return;
        }
        elements.recoveryDialog.close();
        showStatus("Saved task recovered. Your other work is still available under Recover previous task.", "success");
      });
      row.append(details, thumbnails, restore);
      elements.recoveryList.appendChild(row);
    });
  }

  function openRecovery() {
    elements.recoveryHelp.textContent = "Open a previous task to continue editing it. Your current task stays saved too.";
    elements.recoveryHelp.classList.remove("error");
    finishPendingStroke();
    saveWorkspace();
    renderRecovery();
    openDialog(elements.recoveryDialog);
  }

  function renderAll() {
    syncSettings();
    renderTaskControls();
    renderPairs();
    updateHistoryButtons();
  }

  function createPairForSection(section) {
    const pairs = editorDocument.task[section];
    if (workspace.settings.inheritSize && pairs.length) {
      const previous = pairs[pairs.length - 1];
      return {
        input: Core.createGrid(previous.input[0].length, previous.input.length),
        output: Core.createGrid(previous.output[0].length, previous.output.length),
      };
    }
    return Core.createPair(workspace.settings.defaultWidth, workspace.settings.defaultHeight);
  }

  function addPair(section) {
    commit(`Added ${section === "train" ? "training" : "test"} pair`, () => editorDocument.task[section].push(createPairForSection(section)));
  }

  function finishPendingStroke() {
    if (drawing) finishPointerAction({ pointerId: drawing.pointerId });
  }

  function activateDraft(draft) {
    finishPendingStroke();
    if (!saveWorkspace()) return false;
    const previousId = workspace.activeId;
    const previousDocument = editorDocument;
    const isNew = !workspace.drafts[draft.id];
    workspace.drafts[draft.id] = draft;
    workspace.activeId = draft.id;
    editorDocument = Core.cloneDocument(draft.document);
    if (!saveWorkspace()) {
      workspace.activeId = previousId;
      editorDocument = previousDocument;
      if (isNew) delete workspace.drafts[draft.id];
      return false;
    }
    historyPast = [];
    historyFuture = [];
    selection = null;
    copiedFragment = null;
    renderAll();
    return true;
  }

  function startNewTask() {
    const numbers = Object.values(workspace.drafts).map((draft) => Number((/^Task (\d+)$/.exec(draft.name) || [])[1]) || 0);
    const name = `Task ${Math.max(0, ...numbers) + 1}`;
    const task = Core.createTask(3, 1, workspace.settings.defaultWidth, workspace.settings.defaultHeight);
    if (activateDraft(newDraft(name, Core.createDocument(task)))) {
      showStatus("New task started. Use Recover previous task if you meant to keep editing your previous work.", "success");
    }
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result));
        let imported;
        let missingTestOutputs = [];
        if (raw && raw.editor === "giotto-arc-task-editor" && raw.task) {
          imported = Core.normalizeEditorDocument(raw);
        } else {
          const normalized = Core.normalizeImportedTask(raw);
          imported = Core.createDocument(normalized.task);
          missingTestOutputs = normalized.missingTestOutputs;
        }
        const before = snapshot();
        editorDocument = imported;
        remember(before, "Imported task");
        selection = null;
        renderAll();
        const warning = missingTestOutputs.length ? ` ${missingTestOutputs.length} missing test output(s) became blank grids.` : "";
        showStatus(`Import succeeded.${warning}`, warning ? "" : "success");
      } catch (error) {
        showStatus(`Import failed: ${error.message}`, "error");
      }
    };
    reader.onerror = () => showStatus("Import failed: the file could not be read.", "error");
    reader.readAsText(file);
  }

  function filenameBase() {
    return Core.slugify(activeDraft().name);
  }

  function downloadBlob(content, filename, type = "application/json") {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showStatus(`Downloaded ${filename}.`, "success");
  }

  function openDialog(dialog) {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function openExportDialog() {
    reviewedTaskJSON = null;
    elements.downloadTask.disabled = true;
    elements.exportReport.replaceChildren();
    elements.previewContent.replaceChildren();
    try {
      const report = Core.analyzeDocument(editorDocument);
      renderPreview();
      reviewedTaskJSON = Core.serializeTask(editorDocument.task);
      const valid = document.createElement("p");
      valid.className = "valid-message";
      valid.textContent = `JSON format is valid: ${report.trainCount} example${report.trainCount === 1 ? "" : "s"} and ${report.testCount} test${report.testCount === 1 ? "" : "s"}.`;
      elements.exportReport.appendChild(valid);
      if (report.warnings.length) {
        const heading = document.createElement("p");
        heading.textContent = "Before downloading, check these details. You can still download if they are intentional.";
        const list = document.createElement("ul");
        list.className = "warning-list";
        report.warnings.forEach((warning) => {
          const item = document.createElement("li");
          item.textContent = warning;
          list.appendChild(item);
        });
        elements.exportReport.append(heading, list);
      }
      elements.downloadTask.disabled = false;
    } catch (error) {
      elements.exportReport.textContent = `Cannot download this task: ${error.message}`;
    }
    openDialog(elements.exportDialog);
  }

  function confirmDownload() {
    if (!elements.exportDialog.open || !reviewedTaskJSON || elements.downloadTask.disabled) return;
    try {
      const currentTaskJSON = Core.serializeTask(editorDocument.task);
      if (currentTaskJSON !== reviewedTaskJSON) {
        openExportDialog();
        showStatus("The task changed. Review the updated preview before downloading.");
        return;
      }
      downloadBlob(reviewedTaskJSON, `${filenameBase()}.json`);
      elements.exportDialog.close();
    } catch (error) {
      reviewedTaskJSON = null;
      elements.downloadTask.disabled = true;
      elements.exportReport.textContent = `Cannot download this task: ${error.message}`;
    }
  }

  function previewGrid(grid) {
    const element = document.createElement("div");
    element.className = "preview-grid";
    element.style.gridTemplateColumns = `repeat(${grid[0].length}, var(--preview-cell-size))`;
    grid.forEach((row) => row.forEach((color) => {
      const cell = document.createElement("div");
      cell.className = "preview-cell";
      cell.style.background = COLORS[color];
      element.appendChild(cell);
    }));
    return element;
  }

  function renderPreview() {
    elements.previewContent.replaceChildren();
    for (const sectionName of ["train", "test"]) {
      const section = document.createElement("section");
      section.className = "preview-section";
      const heading = document.createElement("h3");
      heading.textContent = sectionName === "train" ? "Examples of your rule" : "Tests and correct answers";
      section.appendChild(heading);
      editorDocument.task[sectionName].forEach((pair, index) => {
        const row = document.createElement("div");
        row.className = "preview-pair";
        const label = document.createElement("div");
        label.className = "preview-label";
        label.textContent = `${sectionName === "train" ? "Example" : "Test"} ${index + 1}`;
        const arrow = document.createElement("span");
        arrow.textContent = "→";
        arrow.setAttribute("aria-hidden", "true");
        const input = document.createElement("div");
        input.className = "preview-grid-card";
        const inputLabel = document.createElement("h3");
        inputLabel.textContent = "Input";
        input.append(inputLabel, previewGrid(pair.input));
        const output = document.createElement("div");
        output.className = "preview-grid-card";
        const outputLabel = document.createElement("h3");
        outputLabel.textContent = sectionName === "test" ? "Correct output (answer)" : "Correct output";
        output.append(outputLabel, previewGrid(pair.output));
        row.append(label, input, arrow, output);
        section.appendChild(row);
      });
      elements.previewContent.appendChild(section);
    }
  }

  function handleKeyboard(event) {
    if (document.querySelector("dialog[open]")) return;
    const editingText = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (!editingText && modifier && event.key.toLowerCase() === "c") {
      event.preventDefault();
      copySelection();
      return;
    }
    if (!editingText && modifier && event.key.toLowerCase() === "v") {
      event.preventDefault();
      pasteSelection();
      return;
    }
    if (editingText) return;
    if (/^[0-9]$/.test(event.key)) selectColor(Number(event.key));
    if ({ p: "paint", f: "fill", s: "select" }[event.key.toLowerCase()]) selectTool({ p: "paint", f: "fill", s: "select" }[event.key.toLowerCase()]);
    if (event.key === "?") openDialog(elements.shortcutsDialog);
    if (event.key === "Escape" && selection) clearSelection();
  }

  document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => selectTool(button.dataset.tool)));
  document.addEventListener("pointermove", handlePointerMove, { passive: false });
  document.addEventListener("pointerup", finishPointerAction);
  document.addEventListener("pointercancel", finishPointerAction);
  window.addEventListener("blur", finishPendingStroke);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      finishPendingStroke();
      saveWorkspace();
    }
  });
  window.addEventListener("pagehide", () => {
    finishPendingStroke();
    saveWorkspace();
  });
  document.addEventListener("keydown", handleKeyboard);
  elements.undo.addEventListener("click", undo);
  elements.redo.addEventListener("click", redo);
  document.getElementById("new-task").addEventListener("click", startNewTask);
  elements.recoverTask.addEventListener("click", openRecovery);
  document.getElementById("copy-selection").addEventListener("click", copySelection);
  document.getElementById("paste-selection").addEventListener("click", pasteSelection);
  document.getElementById("clear-selection").addEventListener("click", clearSelection);
  document.getElementById("add-train").addEventListener("click", () => addPair("train"));
  document.getElementById("add-test").addEventListener("click", () => addPair("test"));
  document.getElementById("import-file").addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) importFile(file);
    event.target.value = "";
  });
  document.getElementById("open-export").addEventListener("click", openExportDialog);
  document.getElementById("open-shortcuts").addEventListener("click", () => openDialog(elements.shortcutsDialog));
  elements.defaultWidth.addEventListener("change", () => {
    const value = Number(elements.defaultWidth.value);
    if (!validDimension(value)) { elements.defaultWidth.value = String(workspace.settings.defaultWidth); return; }
    workspace.settings.defaultWidth = value;
    saveWorkspace();
  });
  elements.defaultHeight.addEventListener("change", () => {
    const value = Number(elements.defaultHeight.value);
    if (!validDimension(value)) { elements.defaultHeight.value = String(workspace.settings.defaultHeight); return; }
    workspace.settings.defaultHeight = value;
    saveWorkspace();
  });
  elements.inheritSize.addEventListener("change", () => { workspace.settings.inheritSize = elements.inheritSize.checked; saveWorkspace(); });

  elements.downloadTask.addEventListener("click", confirmDownload);
  elements.exportDialog.addEventListener("close", () => {
    reviewedTaskJSON = null;
    elements.downloadTask.disabled = true;
  });

  renderPalette();
  renderAll();
  saveWorkspace();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("service-worker.js").catch((error) => console.warn("Offline registration failed:", error));
  }
})();
