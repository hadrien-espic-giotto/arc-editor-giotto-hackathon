"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");

test("creates a standard ARC task and editor document", () => {
  const task = Core.createTask(2, 1, 4, 3);
  const document = Core.createDocument(task, { title: "Example" });
  assert.equal(document.task.train.length, 2);
  assert.equal(document.task.test.length, 1);
  assert.equal(document.task.train[0].input.length, 3);
  assert.equal(document.task.train[0].input[0].length, 4);
  assert.equal(document.metadata.title, "Example");
  assert.doesNotThrow(() => Core.validateDocument(document));
});

test("resize preserves content and detects discarded colored cells", () => {
  const grid = [[1, 2], [3, 4]];
  assert.deepEqual(Core.resizeGrid(grid, 3, 1), [[1, 2, 0]]);
  assert.deepEqual(Core.resizeGrid(grid, 1, 3), [[1], [3], [0]]);
  assert.equal(Core.resizeWouldDiscard(grid, 1, 2), true);
  assert.equal(Core.resizeWouldDiscard([[1, 0]], 1, 1), false);
});

test("rejects malformed grids and invalid colors", () => {
  assert.throws(() => Core.validateGrid([[0], [0, 1]]), /not rectangular/);
  assert.throws(() => Core.validateGrid([[10]]), /0 to 9/);
  assert.throws(() => Core.validateGrid([]), /at least one row/);
});

test("imports challenge JSON and creates missing test outputs", () => {
  const imported = Core.normalizeImportedTask({
    train: [{ input: [[0]], output: [[1]] }],
    test: [{ input: [[2, 2]] }],
  });
  assert.deepEqual(imported.missingTestOutputs, [0]);
  assert.deepEqual(imported.task.test[0].output, [[0, 0]]);
});

test("task and backup exports round-trip without extra fields", () => {
  const task = Core.createTask(1, 2, 2, 2);
  task.train[0].input[0][1] = 7;
  task.test[1].output[1][0] = 4;
  const roundTripped = Core.normalizeImportedTask(JSON.parse(Core.serializeTask(task))).task;
  assert.deepEqual(roundTripped, task);

  const document = Core.createDocument(task, { title: "Round trip", teamId: "7" });
  const restored = Core.normalizeEditorDocument(JSON.parse(Core.serializeDocument(document)));
  assert.deepEqual(restored, document);
});

test("flood fill and rectangle tools do not mutate their source", () => {
  const source = [[0, 0, 1], [0, 1, 1], [2, 2, 1]];
  const flooded = Core.floodFill(source, 0, 0, 4);
  assert.deepEqual(flooded, [[4, 4, 1], [4, 1, 1], [2, 2, 1]]);
  const rectangle = Core.fillRectangle(source, 0, 1, 1, 2, 3);
  assert.deepEqual(rectangle, [[0, 3, 3], [0, 3, 3], [2, 2, 1]]);
  assert.deepEqual(source, [[0, 0, 1], [0, 1, 1], [2, 2, 1]]);
});

test("selection copy and clipped paste work", () => {
  const source = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
  const fragment = Core.copyRectangle(source, 0, 1, 1, 2);
  assert.deepEqual(fragment, [[2, 3], [5, 6]]);
  assert.deepEqual(Core.pasteRectangle([[0, 0], [0, 0]], fragment, 1, 1), [[0, 0], [0, 2]]);
});

test("rotate, flip, and shift transformations are correct", () => {
  const grid = [[1, 2, 3], [4, 5, 6]];
  assert.deepEqual(Core.rotateClockwise(grid), [[4, 1], [5, 2], [6, 3]]);
  assert.deepEqual(Core.rotateCounterClockwise(grid), [[3, 6], [2, 5], [1, 4]]);
  assert.deepEqual(Core.flipHorizontal(grid), [[3, 2, 1], [6, 5, 4]]);
  assert.deepEqual(Core.flipVertical(grid), [[4, 5, 6], [1, 2, 3]]);
  assert.deepEqual(Core.shiftGrid([[1, 2], [3, 4]], 0, 1), [[0, 1], [0, 3]]);
  assert.deepEqual(Core.shiftGrid([[1, 2], [3, 4]], 0, 1, true), [[2, 1], [4, 3]]);
});

test("challenge and answer exports separate private outputs", () => {
  const task = Core.createTask(1, 1, 1, 1);
  task.test[0].output[0][0] = 8;
  const challenge = Core.createChallengeTask(task);
  const answers = Core.createAnswerKey(task);
  assert.equal(challenge.test[0].output, undefined);
  assert.deepEqual(answers, { test: [{ output: [[8]] }] });
  assert.deepEqual(task.test[0].output, [[8]]);
});

test("analysis reports grid warnings without asking for submission details", () => {
  const report = Core.analyzeDocument(Core.createDocument(Core.createTask(1, 1, 1, 1)));
  assert.equal(report.valid, true);
  assert.equal(report.trainCount, 1);
  assert.equal(report.testCount, 1);
  assert.equal(report.warnings.length, 2);
  assert.ok(report.warnings.some((warning) => warning.includes("identical")));
  assert.ok(report.warnings.some((warning) => warning.includes("entirely black")));
});

test("slugify produces safe filenames", () => {
  assert.equal(Core.slugify("Team 7 – Moving Squares!"), "team-7-moving-squares");
  assert.equal(Core.slugify(""), "arc-task");
});
