"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Core = require("./core.js");
const source = fs.readFileSync(`${__dirname}/app.js`, "utf8");

// Exercise the real pointer and history handlers with only their DOM dependencies stubbed.
function editor(grid, selectedColor = 3, activeTool = "paint") {
  const task = Core.createTask(2, 1, 3, 2);
  task.train[0].input = Core.cloneGrid(grid);
  const cells = grid.flatMap((row, rowIndex) => row.map((color, columnIndex) => ({
    dataset: {section: "train", pairIndex: "0", side: "input", row: String(rowIndex), column: String(columnIndex)},
    style: {}, highlighted: false,
    setAttribute(name, value) { this[name] = value; },
    closest() { return this; },
    classList: {
      add() { cells[rowIndex * grid[0].length + columnIndex].highlighted = true; },
      remove() { cells[rowIndex * grid[0].length + columnIndex].highlighted = false; },
    },
  })));
  let hitCell = null;
  let savedDocument = null;
  const draft = {};
  function matchingCells(selector) {
    if (selector === "[data-tool]") return [];
    return cells.filter((cell) => {
      if (selector.includes("selection-preview") && !cell.highlighted) return false;
      return [...selector.matchAll(/\[data-([\w-]+)="([^"]+)"\]/g)].every(([, name, value]) =>
        cell.dataset[name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] === value);
    });
  }
  const state = {
    Core, selectedColor, activeTool, editorDocument: Core.createDocument(task),
    HISTORY_LIMIT: 100, historyPast: [], historyFuture: [], drawing: null, selection: null,
    COLORS: Array.from({length: 10}, (_, color) => `color-${color}`),
    COLOR_NAMES: Array.from({length: 10}, (_, color) => `name-${color}`),
    elements: {undo: {}, redo: {}, toolHelp: {}},
    showStatus() {}, renderAll() {}, activeDraft: () => draft,
    saveWorkspace() { savedDocument = JSON.stringify(state.editorDocument); },
    document: {
      querySelector: (selector) => matchingCells(selector)[0] || null,
      querySelectorAll: matchingCells,
      elementFromPoint: () => hitCell,
    },
  };
  vm.createContext(state);
  for (const name of ["snapshot", "updateHistoryButtons", "remember", "commit", "restoreSnapshot", "undo", "redo",
    "selectTool", "gridReferenceFromCell", "sameGrid", "getGrid", "setGrid", "paintReference", "cellAtPoint",
    "clearSelectionHighlight", "highlightRectangle", "applySelectionHighlight", "handlePointerDown", "handlePointerMove",
    "finishPointerAction", "clearSelection", "finishPendingStroke"]) {
    const start = source.indexOf(`  function ${name}(`);
    assert.ok(start >= 0, `Missing handler ${name}`);
    const end = source.indexOf("\n  function ", start + 1);
    vm.runInContext(source.slice(start, end), state);
  }
  const cell = (row, column) => cells[row * grid[0].length + column];
  const event = (row, column, options = {}) => ({
    button: 0, pointerId: 1, clientX: column * 30 + 15, clientY: row * 30 + 15,
    preventDefault() {}, ...options,
  });
  return {
    state, cells, cell,
    grid: () => JSON.parse(JSON.stringify(state.editorDocument.task.train[0].input)),
    saved: () => savedDocument && JSON.parse(savedDocument),
    down(row, column, options) { state.handlePointerDown(event(row, column, options), cell(row, column)); },
    move(row, column, options) { hitCell = cell(row, column); state.handlePointerMove(event(row, column, options)); },
    up(options = {}) { state.finishPointerAction({type: "pointerup", pointerId: 1, ...options}); },
    click(row, column, options) { this.down(row, column, options); this.up(); },
  };
}

test("a matching Paint click toggles to black, updates the cell, saves, and supports undo/redo", () => {
  const app = editor([[3, 0]]);
  app.down(0, 0);
  assert.deepEqual(app.grid(), [[3, 0]]);
  app.move(0, 0, {clientX: 16}); // Small click movement should still toggle once.
  app.up();
  assert.deepEqual(app.grid(), [[0, 0]]);
  assert.equal(app.cell(0, 0).style.background, "color-0");
  assert.match(app.cell(0, 0)["aria-label"], /name-0 \(0\)/);
  assert.deepEqual(app.saved().task.train[0].input, [[0, 0]]);
  assert.equal(app.state.historyPast.length, 1);
  app.state.undo();
  assert.deepEqual(app.grid(), [[3, 0]]);
  app.state.redo();
  assert.deepEqual(app.grid(), [[0, 0]]);
  app.click(0, 0);
  assert.deepEqual(app.grid(), [[3, 0]]);
});

test("continuous painting does not toggle matching cells, including the starting cell or revisited cells", () => {
  for (const original of [[[3, 0, 3]], [[0, 3, 0]]]) {
    const app = editor(original);
    app.down(0, 0);
    app.move(0, 1);
    app.move(0, 2);
    app.move(0, 1);
    app.move(0, 0);
    app.up();
    assert.deepEqual(app.grid(), [[3, 3, 3]]);
    assert.equal(app.state.historyPast.length, 1);
    app.state.undo();
    assert.deepEqual(app.grid(), original);
    app.state.redo();
    assert.deepEqual(app.grid(), [[3, 3, 3]]);
  }
});

test("dragging within the same cell, pointer cancellation, and interrupted strokes do not toggle", () => {
  const app = editor([[3, 3]]);
  app.down(0, 0);
  app.move(0, 0, {clientX: 22});
  app.up();
  assert.deepEqual(app.grid(), [[3, 3]]);
  app.down(0, 0);
  app.up({type: "pointercancel"});
  assert.deepEqual(app.grid(), [[3, 3]]);
  app.down(0, 0);
  app.state.finishPendingStroke();
  assert.deepEqual(app.grid(), [[3, 3]]);
  assert.equal(app.state.historyPast.length, 0);
});

test("Ctrl/Cmd click replaces disconnected instances only in the clicked grid, under every tool", () => {
  for (const tool of ["paint", "fill", "select"]) {
    for (const modifier of ["ctrlKey", "metaKey"]) {
      const original = [[1, 0, 1], [0, 1, 2]];
      const app = editor(original, 4, tool);
      const otherGrids = JSON.stringify([app.state.editorDocument.task.train[0].output,
        app.state.editorDocument.task.train[1], app.state.editorDocument.task.test]);
      app.down(0, 0, {[modifier]: true});
      assert.equal(app.state.drawing, null);
      app.move(1, 0);
      app.up();
      assert.deepEqual(app.grid(), [[4, 0, 4], [0, 4, 2]]);
      assert.equal(JSON.stringify([app.state.editorDocument.task.train[0].output,
        app.state.editorDocument.task.train[1], app.state.editorDocument.task.test]), otherGrids);
      assert.equal(app.state.historyPast.length, 1);
      assert.deepEqual(app.saved().task.train[0].input, app.grid());
      app.state.undo();
      assert.deepEqual(app.grid(), original);
      app.state.redo();
      assert.deepEqual(app.grid(), [[4, 0, 4], [0, 4, 2]]);
    }
  }
});

test("Ctrl click on the selected color is a no-op; black can be replaced or used as the replacement", () => {
  const matching = editor([[3, 0, 3]]);
  matching.click(0, 0, {ctrlKey: true});
  assert.deepEqual(matching.grid(), [[3, 0, 3]]);
  assert.equal(matching.state.historyPast.length, 0);
  matching.click(0, 1, {ctrlKey: true});
  assert.deepEqual(matching.grid(), [[3, 3, 3]]);
  const black = editor([[3, 0, 3]], 0);
  black.click(0, 0, {ctrlKey: true});
  assert.deepEqual(black.grid(), [[0, 0, 0]]);
  black.click(0, 0);
  assert.equal(black.state.historyPast.length, 1);
});

test("ordinary Fill still recolors only connected cells and does not toggle matching cells", () => {
  const app = editor([[1, 1, 0], [1, 0, 1]], 2, "fill");
  app.click(0, 0);
  assert.deepEqual(app.grid(), [[2, 2, 0], [2, 0, 1]]);
  app.click(0, 0);
  assert.deepEqual(app.grid(), [[2, 2, 0], [2, 0, 1]]);
  assert.equal(app.state.historyPast.length, 1);
});

test("Select still selects without painting, and changing to Paint or Fill clears it", () => {
  for (const tool of ["paint", "fill"]) {
    const app = editor([[3, 0], [0, 3]], 3, "select");
    app.down(0, 0);
    app.move(1, 1);
    app.up();
    assert.deepEqual(app.grid(), [[3, 0], [0, 3]]);
    assert.equal(app.state.historyPast.length, 0);
    assert.equal(app.cells.filter(cell => cell.highlighted).length, 4);
    app.state.selectTool(tool);
    assert.equal(app.state.selection, null);
    assert.equal(app.cells.filter(cell => cell.highlighted).length, 0);
  }
});

test("right clicks and a second pointer do not modify an active stroke", () => {
  const app = editor([[3, 0]]);
  app.click(0, 0, {button: 2, ctrlKey: true});
  assert.deepEqual(app.grid(), [[3, 0]]);
  app.down(0, 0);
  app.move(0, 1, {pointerId: 2});
  app.up({pointerId: 2});
  assert.ok(app.state.drawing);
  app.up();
  assert.deepEqual(app.grid(), [[0, 0]]);
});
