(function exposeCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ARCEditorCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCore() {
  "use strict";

  const MIN_SIZE = 1;
  const MAX_SIZE = 30;
  const DOCUMENT_VERSION = 2;
  const METADATA_FIELDS = ["title", "teamId", "rule", "solvability"];

  function assertDimension(value, label) {
    if (!Number.isInteger(value) || value < MIN_SIZE || value > MAX_SIZE) {
      throw new Error(`${label} must be an integer from ${MIN_SIZE} to ${MAX_SIZE}.`);
    }
  }

  function assertColor(value, label) {
    if (!Number.isInteger(value) || value < 0 || value > 9) {
      throw new Error(`${label} must be an integer from 0 to 9.`);
    }
  }

  function createGrid(width = 8, height = 8, fill = 0) {
    assertDimension(width, "Grid width");
    assertDimension(height, "Grid height");
    assertColor(fill, "Fill color");
    return Array.from({ length: height }, () => Array(width).fill(fill));
  }

  function cloneGrid(grid) {
    return grid.map((row) => [...row]);
  }

  function createPair(width = 8, height = 8) {
    return { input: createGrid(width, height), output: createGrid(width, height) };
  }

  function createTask(trainCount = 3, testCount = 1, width = 8, height = 8) {
    if (!Number.isInteger(trainCount) || trainCount < 1) {
      throw new Error("A task must contain at least one training pair.");
    }
    if (!Number.isInteger(testCount) || testCount < 1) {
      throw new Error("A task must contain at least one test pair.");
    }
    return {
      train: Array.from({ length: trainCount }, () => createPair(width, height)),
      test: Array.from({ length: testCount }, () => createPair(width, height)),
    };
  }

  function createMetadata(overrides = {}) {
    const metadata = {};
    METADATA_FIELDS.forEach((field) => {
      metadata[field] = typeof overrides[field] === "string" ? overrides[field] : "";
    });
    return metadata;
  }

  function createDocument(task = createTask(), metadata = {}) {
    validateTask(task);
    return {
      version: DOCUMENT_VERSION,
      metadata: createMetadata(metadata),
      task: cloneTask(task),
    };
  }

  function validateGrid(grid, label = "Grid") {
    if (!Array.isArray(grid) || grid.length === 0) {
      throw new Error(`${label} must contain at least one row.`);
    }
    assertDimension(grid.length, `${label} height`);
    if (!Array.isArray(grid[0]) || grid[0].length === 0) {
      throw new Error(`${label} must contain at least one column.`);
    }
    const width = grid[0].length;
    assertDimension(width, `${label} width`);
    grid.forEach((row, rowIndex) => {
      if (!Array.isArray(row) || row.length !== width) {
        throw new Error(`${label} row ${rowIndex + 1} is not rectangular.`);
      }
      row.forEach((color, columnIndex) => {
        assertColor(color, `${label} cell ${rowIndex + 1},${columnIndex + 1}`);
      });
    });
    return true;
  }

  function validateTask(task) {
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      throw new Error("The task must be a JSON object.");
    }
    for (const section of ["train", "test"]) {
      if (!Array.isArray(task[section]) || task[section].length === 0) {
        throw new Error(`The task must contain at least one ${section} pair.`);
      }
      task[section].forEach((pair, index) => {
        if (!pair || typeof pair !== "object" || Array.isArray(pair)) {
          throw new Error(`${section} pair ${index + 1} must be an object.`);
        }
        validateGrid(pair.input, `${section} pair ${index + 1} input`);
        validateGrid(pair.output, `${section} pair ${index + 1} output`);
      });
    }
    return true;
  }

  function validateDocument(document) {
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      throw new Error("The editor document must be an object.");
    }
    if (!document.metadata || typeof document.metadata !== "object" || Array.isArray(document.metadata)) {
      throw new Error("The editor document is missing metadata.");
    }
    METADATA_FIELDS.forEach((field) => {
      if (typeof document.metadata[field] !== "string") {
        throw new Error(`Metadata field ${field} must be text.`);
      }
    });
    validateTask(document.task);
    return true;
  }

  function normalizeImportedTask(rawTask) {
    if (!rawTask || typeof rawTask !== "object" || Array.isArray(rawTask)) {
      throw new Error("The imported file must contain one ARC task object.");
    }
    const missingTestOutputs = [];
    const normalized = { train: [], test: [] };
    for (const section of ["train", "test"]) {
      if (!Array.isArray(rawTask[section]) || rawTask[section].length === 0) {
        throw new Error(`The imported task must contain at least one ${section} pair.`);
      }
      normalized[section] = rawTask[section].map((pair, index) => {
        if (!pair || typeof pair !== "object" || Array.isArray(pair)) {
          throw new Error(`${section} pair ${index + 1} must be an object.`);
        }
        validateGrid(pair.input, `${section} pair ${index + 1} input`);
        const input = cloneGrid(pair.input);
        let output;
        if (pair.output === undefined && section === "test") {
          output = createGrid(input[0].length, input.length);
          missingTestOutputs.push(index);
        } else {
          validateGrid(pair.output, `${section} pair ${index + 1} output`);
          output = cloneGrid(pair.output);
        }
        return { input, output };
      });
    }
    validateTask(normalized);
    return { task: normalized, missingTestOutputs };
  }

  function normalizeEditorDocument(rawDocument) {
    if (!rawDocument || typeof rawDocument !== "object" || Array.isArray(rawDocument)) {
      throw new Error("The backup must contain an editor document.");
    }
    const normalizedTask = normalizeImportedTask(rawDocument.task).task;
    return createDocument(normalizedTask, createMetadata(rawDocument.metadata));
  }

  function resizeGrid(grid, width, height, fill = 0) {
    validateGrid(grid, "Grid to resize");
    const resized = createGrid(width, height, fill);
    const retainedHeight = Math.min(height, grid.length);
    const retainedWidth = Math.min(width, grid[0].length);
    for (let row = 0; row < retainedHeight; row += 1) {
      for (let column = 0; column < retainedWidth; column += 1) {
        resized[row][column] = grid[row][column];
      }
    }
    return resized;
  }

  function resizeWouldDiscard(grid, width, height) {
    validateGrid(grid, "Grid to resize");
    assertDimension(width, "Grid width");
    assertDimension(height, "Grid height");
    for (let row = 0; row < grid.length; row += 1) {
      for (let column = 0; column < grid[0].length; column += 1) {
        if ((row >= height || column >= width) && grid[row][column] !== 0) return true;
      }
    }
    return false;
  }

  function fillGrid(grid, color) {
    validateGrid(grid);
    assertColor(color, "Fill color");
    return grid.map((row) => row.map(() => color));
  }

  function fillRectangle(grid, startRow, startColumn, endRow, endColumn, color) {
    validateGrid(grid);
    assertColor(color, "Rectangle color");
    const result = cloneGrid(grid);
    const minRow = Math.max(0, Math.min(startRow, endRow));
    const maxRow = Math.min(grid.length - 1, Math.max(startRow, endRow));
    const minColumn = Math.max(0, Math.min(startColumn, endColumn));
    const maxColumn = Math.min(grid[0].length - 1, Math.max(startColumn, endColumn));
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) result[row][column] = color;
    }
    return result;
  }

  function floodFill(grid, startRow, startColumn, color) {
    validateGrid(grid);
    assertColor(color, "Fill color");
    if (startRow < 0 || startRow >= grid.length || startColumn < 0 || startColumn >= grid[0].length) {
      throw new Error("Flood-fill starting cell is outside the grid.");
    }
    const result = cloneGrid(grid);
    const originalColor = result[startRow][startColumn];
    if (originalColor === color) return result;
    const queue = [[startRow, startColumn]];
    result[startRow][startColumn] = color;
    for (let index = 0; index < queue.length; index += 1) {
      const [row, column] = queue[index];
      for (const [nextRow, nextColumn] of [[row - 1, column], [row + 1, column], [row, column - 1], [row, column + 1]]) {
        if (nextRow < 0 || nextRow >= result.length || nextColumn < 0 || nextColumn >= result[0].length) continue;
        if (result[nextRow][nextColumn] !== originalColor) continue;
        result[nextRow][nextColumn] = color;
        queue.push([nextRow, nextColumn]);
      }
    }
    return result;
  }

  function copyRectangle(grid, startRow, startColumn, endRow, endColumn) {
    validateGrid(grid);
    const minRow = Math.max(0, Math.min(startRow, endRow));
    const maxRow = Math.min(grid.length - 1, Math.max(startRow, endRow));
    const minColumn = Math.max(0, Math.min(startColumn, endColumn));
    const maxColumn = Math.min(grid[0].length - 1, Math.max(startColumn, endColumn));
    return grid.slice(minRow, maxRow + 1).map((row) => row.slice(minColumn, maxColumn + 1));
  }

  function pasteRectangle(grid, fragment, startRow, startColumn) {
    validateGrid(grid);
    validateGrid(fragment, "Copied selection");
    const result = cloneGrid(grid);
    fragment.forEach((row, rowOffset) => {
      row.forEach((color, columnOffset) => {
        const targetRow = startRow + rowOffset;
        const targetColumn = startColumn + columnOffset;
        if (targetRow >= 0 && targetRow < result.length && targetColumn >= 0 && targetColumn < result[0].length) {
          result[targetRow][targetColumn] = color;
        }
      });
    });
    return result;
  }

  function rotateClockwise(grid) {
    validateGrid(grid);
    return Array.from({ length: grid[0].length }, (_, row) =>
      Array.from({ length: grid.length }, (_, column) => grid[grid.length - 1 - column][row]));
  }

  function rotateCounterClockwise(grid) {
    return rotateClockwise(rotateClockwise(rotateClockwise(grid)));
  }

  function flipHorizontal(grid) {
    validateGrid(grid);
    return grid.map((row) => [...row].reverse());
  }

  function flipVertical(grid) {
    validateGrid(grid);
    return cloneGrid(grid).reverse();
  }

  function shiftGrid(grid, deltaRow, deltaColumn, wrap = false, fill = 0) {
    validateGrid(grid);
    assertColor(fill, "Shift fill color");
    const height = grid.length;
    const width = grid[0].length;
    const result = createGrid(width, height, fill);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        let targetRow = row + deltaRow;
        let targetColumn = column + deltaColumn;
        if (wrap) {
          targetRow = ((targetRow % height) + height) % height;
          targetColumn = ((targetColumn % width) + width) % width;
        }
        if (targetRow >= 0 && targetRow < height && targetColumn >= 0 && targetColumn < width) {
          result[targetRow][targetColumn] = grid[row][column];
        }
      }
    }
    return result;
  }

  function cloneTask(task) {
    validateTask(task);
    return {
      train: task.train.map((pair) => ({ input: cloneGrid(pair.input), output: cloneGrid(pair.output) })),
      test: task.test.map((pair) => ({ input: cloneGrid(pair.input), output: cloneGrid(pair.output) })),
    };
  }

  function cloneDocument(document) {
    validateDocument(document);
    return createDocument(document.task, document.metadata);
  }

  function serializeTask(task, spacing = 2) {
    return JSON.stringify(cloneTask(task), null, spacing);
  }

  function serializeDocument(document, spacing = 2) {
    const cloned = cloneDocument(document);
    return JSON.stringify({
      editor: "giotto-arc-task-editor",
      version: DOCUMENT_VERSION,
      metadata: cloned.metadata,
      task: cloned.task,
    }, null, spacing);
  }

  function createChallengeTask(task) {
    validateTask(task);
    return {
      train: task.train.map((pair) => ({ input: cloneGrid(pair.input), output: cloneGrid(pair.output) })),
      test: task.test.map((pair) => ({ input: cloneGrid(pair.input) })),
    };
  }

  function createAnswerKey(task) {
    validateTask(task);
    return { test: task.test.map((pair) => ({ output: cloneGrid(pair.output) })) };
  }

  function gridsEqual(first, second) {
    return JSON.stringify(first) === JSON.stringify(second);
  }

  function isBlankGrid(grid) {
    validateGrid(grid);
    return grid.every((row) => row.every((color) => color === 0));
  }

  function analyzeDocument(document) {
    validateDocument(document);
    const warnings = [];
    const requirementWarnings = [];
    let blankCount = 0;
    let nonStandardGridCount = 0;
    let unchangedTrainingPairs = 0;
    for (const section of ["train", "test"]) {
      document.task[section].forEach((pair) => {
        if (isBlankGrid(pair.input)) blankCount += 1;
        if (isBlankGrid(pair.output)) blankCount += 1;
        for (const grid of [pair.input, pair.output]) {
          if (grid.length !== 8 || grid[0].length !== 8) nonStandardGridCount += 1;
        }
      });
    }
    document.task.train.forEach((pair) => {
      if (gridsEqual(pair.input, pair.output)) unchangedTrainingPairs += 1;
    });
    if (blankCount) warnings.push(`${blankCount} grid${blankCount === 1 ? " is" : "s are"} entirely black.`);
    if (unchangedTrainingPairs) warnings.push(`${unchangedTrainingPairs} example${unchangedTrainingPairs === 1 ? " has" : "s have"} identical input and output grids.`);
    if (document.task.train.length !== 3) {
      requirementWarnings.push(`Recommended: 3 examples. This task has ${document.task.train.length}.`);
    }
    if (nonStandardGridCount) {
      requirementWarnings.push(`Recommended: 8×8 input and output grids. ${nonStandardGridCount} grid${nonStandardGridCount === 1 ? " is" : "s are"} a different size.`);
    }
    if (document.task.test.length > 1) {
      requirementWarnings.push(`Recommended: 1 test. This task has ${document.task.test.length}.`);
    }
    return {
      valid: true,
      trainCount: document.task.train.length,
      testCount: document.task.test.length,
      gridCount: (document.task.train.length + document.task.test.length) * 2,
      warnings,
      requirementWarnings,
    };
  }

  function slugify(value, fallback = "arc-task") {
    const slug = String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return slug || fallback;
  }

  return {
    DOCUMENT_VERSION,
    MAX_SIZE,
    METADATA_FIELDS,
    MIN_SIZE,
    analyzeDocument,
    cloneDocument,
    cloneGrid,
    cloneTask,
    copyRectangle,
    createAnswerKey,
    createChallengeTask,
    createDocument,
    createGrid,
    createMetadata,
    createPair,
    createTask,
    fillGrid,
    fillRectangle,
    flipHorizontal,
    flipVertical,
    floodFill,
    gridsEqual,
    isBlankGrid,
    normalizeEditorDocument,
    normalizeImportedTask,
    pasteRectangle,
    resizeGrid,
    resizeWouldDiscard,
    rotateClockwise,
    rotateCounterClockwise,
    serializeDocument,
    serializeTask,
    shiftGrid,
    slugify,
    validateDocument,
    validateGrid,
    validateTask,
  };
});
