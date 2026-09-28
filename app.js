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
    draftSelect: document.getElementById("draft-select"),
    metadata: {
      title: document.getElementById("meta-title"),
      teamId: document.getElementById("meta-team"),
      rule: document.getElementById("meta-rule"),
      solvability: document.getElementById("meta-solvability"),
    },
    defaultWidth: document.getElementById("default-width"),
    defaultHeight: document.getElementById("default-height"),
    inheritSize: document.getElementById("inherit-size"),
    wrapShifts: document.getElementById("wrap-shifts"),
    exportDialog: document.getElementById("export-dialog"),
    exportReport: document.getElementById("export-report"),
    previewDialog: document.getElementById("preview-dialog"),
    previewContent: document.getElementById("preview-content"),
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
  let previewIncludesAnswers = false;

  function createId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function newDraft(name = "Untitled task", documentValue = Core.createDocument()) {
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
      elements.saveState.textContent = "Saved locally";
      elements.saveState.classList.remove("saving");
    } catch (error) {
      elements.saveState.textContent = "Could not save locally";
      elements.saveState.classList.remove("saving");
      showStatus("Local saving failed. Download an editor backup to avoid losing work.", "error");
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
    showStatus(`${tool[0].toUpperCase()}${tool.slice(1)} tool selected.`);
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
    if (activeTool === "rectangle" || activeTool === "select") highlightRectangle(reference, reference, reference);
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
    if (drawing.tool === "rectangle" || drawing.tool === "select") highlightRectangle(reference, drawing.start, reference);
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
    if (action.tool === "rectangle") {
      setGrid(action.grid, Core.fillRectangle(getGrid(action.grid), action.start.row, action.start.column, action.end.row, action.end.column, selectedColor));
      remember(action.before, "Painted rectangle");
      selection = null;
      renderPairs();
      showStatus("Painted rectangle.", "success");
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
    title.textContent = side === "input" ? "Input" : "Output";
    const dimensions = document.createElement("div");
    dimensions.className = "grid-dimensions";
    dimensions.append("W", dimensionControl(grid, reference, "width"), "H", dimensionControl(grid, reference, "height"));
    heading.append(title, dimensions);

    const actions = document.createElement("div");
    actions.className = "grid-actions";
    if (side === "output") {
      actions.appendChild(actionButton("Copy input", "Copy the paired input to this output", () => {
        commit("Copied input to output", () => setGrid(reference, Core.cloneGrid(editorDocument.task[section][pairIndex].input)));
      }));
    }
    actions.appendChild(actionButton("Fill color", "Fill the entire grid with the selected color", () => {
      commit("Filled grid", () => setGrid(reference, Core.fillGrid(grid, selectedColor)));
    }));
    actions.appendChild(actionButton("Clear", "Clear this grid to black", () => {
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

    card.append(heading, createGridElement(grid, section, pairIndex, side), actions, transforms);
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
    title.textContent = `${section === "train" ? "Training" : "Test"} pair ${index + 1}`;
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

  function syncMetadata() {
    Object.entries(elements.metadata).forEach(([field, input]) => { input.value = editorDocument.metadata[field]; });
  }

  function syncSettings() {
    elements.defaultWidth.value = String(workspace.settings.defaultWidth);
    elements.defaultHeight.value = String(workspace.settings.defaultHeight);
    elements.inheritSize.checked = workspace.settings.inheritSize;
    elements.wrapShifts.checked = workspace.settings.wrapShifts;
  }

  function renderDrafts() {
    elements.draftSelect.replaceChildren();
    Object.values(workspace.drafts)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((draft) => {
        const option = document.createElement("option");
        option.value = draft.id;
        option.textContent = draft.name;
        option.selected = draft.id === workspace.activeId;
        elements.draftSelect.appendChild(option);
      });
  }

  function renderAll() {
    syncMetadata();
    syncSettings();
    renderDrafts();
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

  function switchDraft(id) {
    if (!workspace.drafts[id] || id === workspace.activeId) return;
    saveWorkspace();
    workspace.activeId = id;
    editorDocument = Core.cloneDocument(activeDraft().document);
    historyPast = [];
    historyFuture = [];
    selection = null;
    copiedFragment = null;
    saveWorkspace();
    renderAll();
    showStatus(`Opened ${activeDraft().name}.`, "success");
  }

  function addDraft(duplicate = false) {
    const suggested = duplicate ? `${activeDraft().name} copy` : `Task ${Object.keys(workspace.drafts).length + 1}`;
    const name = window.prompt("Draft name:", suggested);
    if (!name || !name.trim()) return;
    const documentValue = duplicate ? editorDocument : Core.createDocument(Core.createTask(3, 1, workspace.settings.defaultWidth, workspace.settings.defaultHeight));
    const draft = newDraft(name.trim(), documentValue);
    workspace.drafts[draft.id] = draft;
    saveWorkspace();
    switchDraft(draft.id);
  }

  function renameDraft() {
    const name = window.prompt("Draft name:", activeDraft().name);
    if (!name || !name.trim()) return;
    activeDraft().name = name.trim();
    saveWorkspace();
    renderDrafts();
    showStatus("Draft renamed.", "success");
  }

  function deleteDraft() {
    const ids = Object.keys(workspace.drafts);
    if (ids.length === 1) {
      showStatus("At least one local draft must remain.", "error");
      return;
    }
    if (!window.confirm(`Delete the local draft “${activeDraft().name}”?`)) return;
    delete workspace.drafts[workspace.activeId];
    workspace.activeId = Object.keys(workspace.drafts)[0];
    editorDocument = Core.cloneDocument(activeDraft().document);
    historyPast = [];
    historyFuture = [];
    selection = null;
    saveWorkspace();
    renderAll();
    showStatus("Draft deleted.", "success");
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
    return Core.slugify([editorDocument.metadata.teamId, editorDocument.metadata.title].filter((value) => value.trim()).join("-"));
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

  function renderExportReport() {
    try {
      const report = Core.analyzeDocument(editorDocument);
      elements.exportReport.replaceChildren();
      const summary = document.createElement("div");
      summary.className = "export-summary";
      [[report.trainCount, "training pairs"], [report.testCount, "test pairs"], [report.gridCount, "grids"]].forEach(([value, label]) => {
        const item = document.createElement("div");
        item.className = "summary-item";
        const strong = document.createElement("strong");
        strong.textContent = String(value);
        item.append(strong, label);
        summary.appendChild(item);
      });
      elements.exportReport.appendChild(summary);
      if (report.warnings.length) {
        const heading = document.createElement("p");
        heading.textContent = "The task is structurally valid, with these review warnings:";
        const list = document.createElement("ul");
        list.className = "warning-list";
        report.warnings.forEach((warning) => {
          const item = document.createElement("li");
          item.textContent = warning;
          list.appendChild(item);
        });
        elements.exportReport.append(heading, list);
      } else {
        const valid = document.createElement("p");
        valid.className = "valid-message";
        valid.textContent = "The task and metadata passed all checks.";
        elements.exportReport.appendChild(valid);
      }
    } catch (error) {
      elements.exportReport.textContent = `Validation failed: ${error.message}`;
    }
  }

  function openExportDialog() {
    renderExportReport();
    openDialog(elements.exportDialog);
  }

  function previewGrid(grid) {
    const element = document.createElement("div");
    element.className = "preview-grid";
    element.style.gridTemplateColumns = `repeat(${grid[0].length}, 20px)`;
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
      heading.textContent = sectionName === "train" ? "Training examples" : "Test cases";
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
        row.append(label, previewGrid(pair.input), arrow);
        if (sectionName === "test" && !previewIncludesAnswers) {
          const hidden = document.createElement("div");
          hidden.className = "hidden-answer";
          hidden.textContent = "?";
          hidden.setAttribute("aria-label", "Hidden test output");
          row.appendChild(hidden);
        } else row.appendChild(previewGrid(pair.output));
        section.appendChild(row);
      });
      elements.previewContent.appendChild(section);
    }
    document.getElementById("preview-puzzle").classList.toggle("selected", !previewIncludesAnswers);
    document.getElementById("preview-puzzle").setAttribute("aria-pressed", String(!previewIncludesAnswers));
    document.getElementById("preview-answer").classList.toggle("selected", previewIncludesAnswers);
    document.getElementById("preview-answer").setAttribute("aria-pressed", String(previewIncludesAnswers));
  }

  function openPreview() {
    previewIncludesAnswers = false;
    renderPreview();
    openDialog(elements.previewDialog);
  }

  function gridPixelSize(grid, cellSize, gap) {
    return { width: grid[0].length * cellSize + (grid[0].length - 1) * gap, height: grid.length * cellSize + (grid.length - 1) * gap };
  }

  function renderPngCanvas(includeAnswers) {
    const cellSize = 24;
    const gap = 1;
    const margin = 28;
    const between = 46;
    const labelHeight = 28;
    const rows = [];
    for (const section of ["train", "test"]) {
      editorDocument.task[section].forEach((pair, index) => {
        const inputSize = gridPixelSize(pair.input, cellSize, gap);
        const outputSize = section === "test" && !includeAnswers ? { width: 110, height: 110 } : gridPixelSize(pair.output, cellSize, gap);
        rows.push({ section, index, pair, inputSize, outputSize, height: Math.max(inputSize.height, outputSize.height) + labelHeight + 22 });
      });
    }
    const contentWidth = Math.max(...rows.map((row) => row.inputSize.width + between + row.outputSize.width));
    const titleHeight = 54;
    const canvas = document.createElement("canvas");
    canvas.width = contentWidth + margin * 2;
    canvas.height = titleHeight + margin + rows.reduce((sum, row) => sum + row.height, 0);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#172033";
    context.font = "700 24px sans-serif";
    context.fillText(editorDocument.metadata.title.trim() || "ARC Task", margin, 34);
    context.font = "14px sans-serif";
    context.fillStyle = "#657086";
    context.fillText(includeAnswers ? "Answer view" : "Puzzle view", margin, 56);

    function drawGrid(grid, x, y) {
      grid.forEach((gridRow, rowIndex) => gridRow.forEach((color, columnIndex) => {
        context.fillStyle = COLORS[color];
        context.fillRect(x + columnIndex * (cellSize + gap), y + rowIndex * (cellSize + gap), cellSize, cellSize);
      }));
      const size = gridPixelSize(grid, cellSize, gap);
      context.strokeStyle = "#313746";
      context.lineWidth = 2;
      context.strokeRect(x - 1, y - 1, size.width + 2, size.height + 2);
    }

    let y = titleHeight + margin;
    rows.forEach((row) => {
      context.fillStyle = "#172033";
      context.font = "700 15px sans-serif";
      context.fillText(`${row.section === "train" ? "Training" : "Test"} ${row.index + 1} · Input`, margin, y + 15);
      const outputX = margin + row.inputSize.width + between;
      context.fillText("Output", outputX, y + 15);
      const gridY = y + labelHeight;
      drawGrid(row.pair.input, margin, gridY);
      if (row.section === "test" && !includeAnswers) {
        context.setLineDash([7, 5]);
        context.strokeStyle = "#aeb7c8";
        context.strokeRect(outputX, gridY, 108, 108);
        context.setLineDash([]);
        context.fillStyle = "#aeb7c8";
        context.font = "700 42px sans-serif";
        context.fillText("?", outputX + 41, gridY + 69);
      } else drawGrid(row.pair.output, outputX, gridY);
      y += row.height;
    });
    return canvas;
  }

  function downloadPng(includeAnswers) {
    const canvas = renderPngCanvas(includeAnswers);
    canvas.toBlob((blob) => {
      if (!blob) {
        showStatus("PNG export failed in this browser.", "error");
        return;
      }
      downloadBlob(blob, `${filenameBase()}-${includeAnswers ? "answer" : "puzzle"}.png`, "image/png");
    }, "image/png");
  }

  function handleKeyboard(event) {
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
    if ({ p: "paint", f: "fill", r: "rectangle", s: "select" }[event.key.toLowerCase()]) selectTool({ p: "paint", f: "fill", r: "rectangle", s: "select" }[event.key.toLowerCase()]);
    if (event.key === "?") openDialog(elements.shortcutsDialog);
    if (event.key === "Escape" && selection) clearSelection();
  }

  Object.entries(elements.metadata).forEach(([field, input]) => {
    input.addEventListener("change", () => {
      const value = input.value;
      commit(`Updated ${field}`, () => { editorDocument.metadata[field] = value; }, { render: false, status: false });
      renderDrafts();
    });
  });
  document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => selectTool(button.dataset.tool)));
  document.addEventListener("pointermove", handlePointerMove, { passive: false });
  document.addEventListener("pointerup", finishPointerAction);
  document.addEventListener("pointercancel", finishPointerAction);
  window.addEventListener("blur", () => { if (drawing) finishPointerAction({ pointerId: drawing.pointerId }); });
  document.addEventListener("keydown", handleKeyboard);
  elements.undo.addEventListener("click", undo);
  elements.redo.addEventListener("click", redo);
  elements.draftSelect.addEventListener("change", () => switchDraft(elements.draftSelect.value));
  document.getElementById("new-draft").addEventListener("click", () => addDraft(false));
  document.getElementById("duplicate-draft").addEventListener("click", () => addDraft(true));
  document.getElementById("rename-draft").addEventListener("click", renameDraft);
  document.getElementById("delete-draft").addEventListener("click", deleteDraft);
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
  document.getElementById("open-preview").addEventListener("click", openPreview);
  document.getElementById("open-shortcuts").addEventListener("click", () => openDialog(elements.shortcutsDialog));
  document.getElementById("preview-puzzle").addEventListener("click", () => { previewIncludesAnswers = false; renderPreview(); });
  document.getElementById("preview-answer").addEventListener("click", () => { previewIncludesAnswers = true; renderPreview(); });
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
  elements.wrapShifts.addEventListener("change", () => { workspace.settings.wrapShifts = elements.wrapShifts.checked; saveWorkspace(); });

  document.getElementById("download-task").addEventListener("click", () => downloadBlob(Core.serializeTask(editorDocument.task), `${filenameBase()}.json`));
  document.getElementById("download-challenge").addEventListener("click", () => downloadBlob(JSON.stringify(Core.createChallengeTask(editorDocument.task), null, 2), `${filenameBase()}-challenge.json`));
  document.getElementById("download-answers").addEventListener("click", () => downloadBlob(JSON.stringify(Core.createAnswerKey(editorDocument.task), null, 2), `${filenameBase()}-answer-key.json`));
  document.getElementById("download-backup").addEventListener("click", () => downloadBlob(Core.serializeDocument(editorDocument), `${filenameBase()}-editor-backup.json`));
  document.getElementById("download-puzzle-png").addEventListener("click", () => downloadPng(false));
  document.getElementById("download-answer-png").addEventListener("click", () => downloadPng(true));

  renderPalette();
  renderAll();
  saveWorkspace();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("service-worker.js").catch((error) => console.warn("Offline registration failed:", error));
  }
})();
