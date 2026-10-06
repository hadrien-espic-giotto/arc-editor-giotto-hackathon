"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Core = require("./core.js");
const script = fs.readFileSync(`${__dirname}/submission.js`, "utf8");

function page({ savedTeam = "", storageFails = false, fetch = async () => ({ ok: true }) } = {}) {
  const elements = new Map();
  const requests = [];
  const stored = new Map([["giotto-arc-submission-team", savedTeam]]);
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        value: "", textContent: "", className: "", validityMessage: "", files: [],
        dataset: { placeholder: "true" }, action: `https://example.com/${id}`,
        button: { disabled: true }, handlers: {},
        setCustomValidity(message) { this.validityMessage = message; },
        reportValidity() { this.reportedValidity = true; },
        addEventListener(name, handler) { this.handlers[name] = handler; },
        querySelector() { return this.button; },
        async fire(name) { await this.handlers[name]({ preventDefault() {} }); },
      });
    }
    return elements.get(id);
  }
  vm.runInNewContext(script, {
    document: { getElementById: element }, window: { ARCEditorCore: Core },
    navigator: {}, location: { protocol: "file:" },
    localStorage: {
      getItem(key) { if (storageFails) throw new Error("Unavailable"); return stored.get(key); },
      setItem(key, value) { if (storageFails) throw new Error("Unavailable"); stored.set(key, value); },
    },
    async fetch(url, options) { requests.push({ url, ...options }); return fetch(url, options); },
  });
  return { element, requests, stored };
}

test("team names become safe snake_case filenames and persist independently of the editor", async () => {
  const { element, stored } = page();
  const team = element("team-name");
  for (const [name, expected] of [
    ["  Grid Explorers!  ", "grid_explorers.json"],
    ["GridExplorers", "grid_explorers.json"],
    ["ARCExplorers", "arc_explorers.json"],
    ["Équipe / Déjà Vu", "equipe_deja_vu.json"],
    ["../../Team 42", "team_42.json"],
  ]) {
    team.value = name;
    await team.fire("input");
    assert.equal(element("team-filename").textContent, expected);
    assert.equal(stored.get("giotto-arc-submission-team"), name);
  }
});

test("restores the team name on a later visit and works without local storage", () => {
  const restored = page({ savedTeam: "Grid Explorers" });
  assert.equal(restored.element("team-filename").textContent, "grid_explorers.json");
  const unavailable = page({ storageFails: true });
  assert.equal(unavailable.element("task-submission").button.disabled, false);
  assert.equal(unavailable.element("explanation-submission").button.disabled, false);
});

test("placeholder JSON submission validates an editor export without sending it", async () => {
  const { element, requests } = page({ savedTeam: "Grid Explorers" });
  element("task-json").value = Core.serializeTask(Core.createTask());
  await element("task-submission").fire("submit");
  assert.match(element("task-status").textContent, /grid_explorers\.json.*nothing has been sent/);
  assert.equal(requests.length, 0);
});

test("an explanation can be submitted later without any task JSON", async () => {
  const { element, requests } = page({ savedTeam: "Grid Explorers" });
  element("task-explanation").value = "Reflect each object across the blue line.";
  await element("explanation-submission").fire("submit");
  assert.match(element("explanation-status").textContent, /grid_explorers\.txt.*nothing has been sent/);
  assert.equal(element("task-json").value, "");
  assert.equal(requests.length, 0);
});

test("empty or unusable team names block both submission paths", async () => {
  for (const name of ["", "  ", "!!!", "../"]) {
    const { element, requests } = page({ savedTeam: name });
    await element("task-submission").fire("submit");
    await element("explanation-submission").fire("submit");
    assert.match(element("team-name").validityMessage, /Enter a team name/);
    assert.equal(requests.length, 0);
  }
});

test("malformed JSON and invalid ARC grids are rejected without altering the draft", async () => {
  for (const json of ["{", "null", "{}", '{"train":[],"test":[]}', JSON.stringify({
    train: [{ input: [[10]], output: [[0]] }], test: [{ input: [[0]], output: [[0]] }],
  }), JSON.stringify({ train: [{ input: [[0]], output: [[0]] }], test: [{ input: [[0]] }] })]) {
    const { element, requests } = page({ savedTeam: "Team" });
    element("task-json").value = json;
    await element("task-submission").fire("submit");
    assert.ok(element("task-json").validityMessage);
    assert.equal(element("task-json").value, json);
    assert.equal(element("task-status").className, "submission-status error");
    assert.equal(requests.length, 0);
    await element("task-json").fire("input");
    assert.equal(element("task-json").validityMessage, "");
  }
});

test("whitespace-only explanations are rejected and editing clears the error", async () => {
  const { element, requests } = page({ savedTeam: "Team" });
  element("task-explanation").value = "  \n ";
  await element("explanation-submission").fire("submit");
  assert.ok(element("task-explanation").validityMessage);
  assert.equal(requests.length, 0);
  await element("task-explanation").fire("input");
  assert.equal(element("task-explanation").validityMessage, "");
});

test("choosing a file fills the JSON field and read failures keep existing content", async () => {
  const { element } = page();
  const file = element("task-file");
  file.files = [{ name: "task.json", async text() { return "test content"; } }];
  await file.fire("change");
  assert.equal(element("task-json").value, "test content");
  file.files = [{ async text() { throw new Error("Read failure"); } }];
  await file.fire("change");
  assert.equal(element("task-json").value, "test content");
  assert.match(element("task-status").textContent, /Could not read/);
});

test("configured endpoints receive separate JSON and explanation payloads with matching names", async () => {
  const { element, requests } = page({ savedTeam: "Team One" });
  const task = Core.createTask();
  element("task-json").value = Core.serializeTask(task);
  element("task-explanation").value = "  The rule.  ";
  for (const id of ["task-submission", "explanation-submission"]) {
    delete element(id).dataset.placeholder;
    await element(id).fire("submit");
  }
  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(requests[0].body), { team_name: "Team One", filename: "team_one.json", task });
  assert.deepEqual(JSON.parse(requests[1].body), { team_name: "Team One", filename: "team_one.txt", explanation: "The rule." });
  assert.equal(element("task-status").className, "submission-status success");
  assert.equal(element("explanation-status").className, "submission-status success");
});

test("failed submissions keep content and allow retry", async () => {
  for (const fetch of [async () => ({ ok: false, status: 500 }), async () => { throw new Error("Offline"); }]) {
    const { element } = page({ savedTeam: "Team", fetch });
    const form = element("explanation-submission");
    delete form.dataset.placeholder;
    element("task-explanation").value = "The rule.";
    await form.fire("submit");
    assert.equal(element("explanation-status").className, "submission-status error");
    assert.equal(element("task-explanation").value, "The rule.");
    assert.equal(form.button.disabled, false);
  }
});

test("a pending request blocks duplicate sends while leaving the other form usable", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const { element, requests } = page({ savedTeam: "Team", fetch: () => pending });
  const form = element("explanation-submission");
  delete form.dataset.placeholder;
  element("task-explanation").value = "The rule.";
  const submission = form.fire("submit");
  assert.equal(form.button.disabled, true);
  assert.equal(element("task-submission").button.disabled, false);
  await form.fire("submit");
  assert.equal(requests.length, 1);
  finish({ ok: true });
  await submission;
  assert.equal(form.button.disabled, false);
});
