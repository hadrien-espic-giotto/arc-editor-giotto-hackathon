(function startSubmission() {
  "use strict";

  const teamName = document.getElementById("team-name");
  const filename = document.getElementById("team-filename");
  const taskJSON = document.getElementById("task-json");
  const taskFile = document.getElementById("task-file");
  const explanation = document.getElementById("task-explanation");
  const taskForm = document.getElementById("task-submission");
  const explanationForm = document.getElementById("explanation-submission");
  const taskStatus = document.getElementById("task-status");
  const explanationStatus = document.getElementById("explanation-status");
  const TEAM_KEY = "giotto-arc-submission-team";

  function snakeCase(name) {
    return name.trim().normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function showStatus(element, message, kind = "") {
    element.textContent = message;
    element.className = `submission-status ${kind}`.trim();
  }

  function updateTeam() {
    teamName.setCustomValidity("");
    const base = snakeCase(teamName.value);
    filename.textContent = base ? `${base}.json` : "your_team.json";
    showStatus(taskStatus, "");
    showStatus(explanationStatus, "");
    // Remember only the team name so an explanation can be added on a later visit.
    try { localStorage.setItem(TEAM_KEY, teamName.value); } catch { /* Storage is optional. */ }
  }

  function getTeam() {
    const base = snakeCase(teamName.value);
    if (!base) {
      teamName.setCustomValidity("Enter a team name containing at least one letter A–Z or number.");
      teamName.reportValidity();
      return null;
    }
    return { team_name: teamName.value.trim(), filename: base };
  }

  async function send(form, status, payload, label) {
    // Placeholder URLs must never receive participant data or report a real submission.
    if (form.dataset.placeholder === "true") {
      showStatus(status, `${payload.filename} is ready. Preview only — nothing has been sent.`);
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    showStatus(status, `Submitting ${label}…`);
    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`Server returned ${response.status}.`);
      showStatus(status, `${label} submitted as ${payload.filename}.`, "success");
    } catch {
      showStatus(status, `Could not submit ${label.toLowerCase()}. Your content is still here; please try again.`, "error");
    } finally {
      button.disabled = false;
    }
  }

  teamName.addEventListener("input", updateTeam);
  taskJSON.addEventListener("input", () => {
    taskJSON.setCustomValidity("");
    showStatus(taskStatus, "");
  });
  explanation.addEventListener("input", () => {
    explanation.setCustomValidity("");
    showStatus(explanationStatus, "");
  });

  taskFile.addEventListener("change", async () => {
    const [file] = taskFile.files;
    if (!file) return;
    try {
      taskJSON.value = await file.text();
      taskJSON.setCustomValidity("");
      showStatus(taskStatus, `Loaded ${file.name}.`);
    } catch {
      showStatus(taskStatus, "Could not read that file. Try again or paste the JSON.", "error");
    }
    taskFile.value = "";
  });

  taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const team = getTeam();
    if (!team) return;
    let task;
    try {
      task = JSON.parse(taskJSON.value);
      window.ARCEditorCore.validateTask(task);
      task = window.ARCEditorCore.cloneTask(task);
    } catch (error) {
      const message = error instanceof SyntaxError ? "Enter valid JSON or choose a JSON file from the editor." : error.message;
      taskJSON.setCustomValidity(message);
      taskJSON.reportValidity();
      showStatus(taskStatus, message, "error");
      return;
    }
    await send(taskForm, taskStatus, { ...team, filename: `${team.filename}.json`, task }, "JSON");
  });

  explanationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const team = getTeam();
    if (!team) return;
    const text = explanation.value.trim();
    if (!text) {
      explanation.setCustomValidity("Enter an explanation before submitting it.");
      explanation.reportValidity();
      return;
    }
    await send(explanationForm, explanationStatus, { ...team, filename: `${team.filename}.txt`, explanation: text }, "Explanation");
  });

  try { teamName.value = localStorage.getItem(TEAM_KEY) || ""; } catch { /* Storage is optional. */ }
  updateTeam();
  const preview = [taskForm, explanationForm].some((form) => form.dataset.placeholder === "true");
  document.getElementById("submission-notice").hidden = !preview;
  [taskForm, explanationForm].forEach((form) => {
    form.querySelector('button[type="submit"]').disabled = false;
  });

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("service-worker.js").catch((error) => console.warn("Offline registration failed:", error));
  }
})();
