import { renderCheckouts, scheduleCheckoutsLoaded } from "./checkouts.js";
import { COLLAPSED_SETTINGS_SECTIONS_KEY } from "./constants.js";
import { renderFlowPane } from "./flows.js";
import { api } from "./net.js";
import { els, state } from "./state.js";
import { toast } from "./ui.js";

export let repoConfigSaveTimer = 0;

export let agentConfigSaveTimer = 0;

export let envSaveTimer = 0;

export function repoConfigSignature() {
  return JSON.stringify({
    repoUrl: els.repoUrl.value,
    serveCommand: els.serveCommand.value,
  });
}

export function agentConfigSignature() {
  return JSON.stringify({
    developerInstructions: els.agentDeveloperInstructions.value,
  });
}

export function repoUrlConfigured() {
  return Boolean(els.repoUrl.value.trim());
}

export function reportAutoSaveError(error) {
  console.error(error);
}

export function scheduleRepoConfigSave() {
  clearTimeout(repoConfigSaveTimer);
  repoConfigSaveTimer = setTimeout(() => void saveRepoConfig().catch(reportAutoSaveError), 600);
}

export function scheduleAgentConfigSave() {
  clearTimeout(agentConfigSaveTimer);
  agentConfigSaveTimer = setTimeout(() => void saveAgentConfig().catch(reportAutoSaveError), 600);
}

export async function saveRepoConfig() {
  clearTimeout(repoConfigSaveTimer);
  const signature = repoConfigSignature();
  if (signature === state.lastSavedRepoConfig) return;
  await api("/api/repo", {
    method: "POST",
    body: JSON.stringify({
      repoUrl: els.repoUrl.value,
      serveCommand: els.serveCommand.value,
    }),
  });
  state.lastSavedRepoConfig = signature;
  renderFlowPane();
  toast("Repo config saved");
}

export async function saveAgentConfig() {
  clearTimeout(agentConfigSaveTimer);
  const signature = agentConfigSignature();
  if (signature === state.lastSavedAgentConfig) return;
  await api("/api/agents", {
    method: "POST",
    body: JSON.stringify({
      developerInstructions: els.agentDeveloperInstructions.value,
    }),
  });
  state.lastSavedAgentConfig = signature;
  toast("Agent settings saved");
}

export function scheduleEnvSave() {
  clearTimeout(envSaveTimer);
  envSaveTimer = setTimeout(() => void saveEnv().catch(reportAutoSaveError), 900);
}

export function parseEnvEditorRows(contents) {
  return contents
    .split(/\r?\n/)
    .map((rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) return null;
      const normalizedLine = line.startsWith("export ") ? line.slice(7).trim() : line;
      const index = normalizedLine.indexOf("=");
      if (index === -1) return null;
      const key = normalizedLine.slice(0, index).trim();
      if (!key) return null;
      let value = normalizedLine.slice(index + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return { key, value };
    })
    .filter(Boolean);
}

export function maskedEnvValue(value) {
  return value ? "*".repeat(value.length) : "";
}

export function revealEnvValueInput(input) {
  if (!input?.classList?.contains("env-value")) return;
  input.value = input.dataset.envValue || "";
  input.dataset.envMasked = "false";
}

export function maskEnvValueInput(input) {
  if (!input?.classList?.contains("env-value")) return;
  input.dataset.envValue = input.value;
  input.value = maskedEnvValue(input.dataset.envValue);
  input.dataset.envMasked = "true";
}

export function createEnvValueRow(value = "", active = false) {
  const valueField = document.createElement("div");
  valueField.className = "env-value-field";
  valueField.dataset.envActive = active ? "true" : "false";

  const activeInput = document.createElement("input");
  activeInput.className = "env-active-value";
  activeInput.type = "radio";
  activeInput.setAttribute("aria-label", "Active value");

  const valueInput = document.createElement("input");
  valueInput.className = "env-value";
  valueInput.placeholder = "VALUE";
  valueInput.autocomplete = "off";
  valueInput.spellcheck = false;
  valueInput.dataset.envValue = value;
  valueInput.dataset.envMasked = "true";
  valueInput.value = maskedEnvValue(value);

  valueField.append(activeInput, valueInput);
  return valueField;
}

export function createEnvRow(key = "", values = [{ value: "", active: false }]) {
  const row = document.createElement("div");
  row.className = "env-row";

  const keyField = document.createElement("div");
  keyField.className = "env-key-field";

  const keyInput = document.createElement("input");
  keyInput.className = "env-key";
  keyInput.placeholder = "KEYNAME";
  keyInput.autocomplete = "off";
  keyInput.spellcheck = false;
  keyInput.value = key;

  const addValueButton = document.createElement("button");
  addValueButton.className = "env-add-value";
  addValueButton.type = "button";
  addValueButton.setAttribute("aria-label", "Add value");
  addValueButton.textContent = "+";

  const valueList = document.createElement("div");
  valueList.className = "env-values";
  for (const value of values.length ? values : [{ value: "", active: false }]) {
    valueList.append(createEnvValueRow(value.value, value.active));
  }

  keyField.append(keyInput, addValueButton);
  row.append(keyField, valueList);
  return row;
}

export function envValueRowValue(valueRow) {
  const valueInput = valueRow.querySelector(".env-value");
  return valueInput?.dataset.envValue ?? valueInput?.value ?? "";
}

export function envRowValues(row) {
  return {
    key: row.querySelector(".env-key")?.value.trim() || "",
    values: [...row.querySelectorAll(".env-value-field")].map((valueRow) => ({
      value: envValueRowValue(valueRow),
      active: valueRow.dataset.envActive === "true",
    })),
  };
}

export function envRowIsEmpty(row) {
  const values = envRowValues(row);
  return !values.key && values.values.every((item) => !item.value);
}

export function ensureTrailingEnvRow() {
  const rows = [...els.envEditor.querySelectorAll(".env-row")];
  if (!rows.length || !envRowIsEmpty(rows.at(-1))) {
    els.envEditor.append(createEnvRow());
  }
  updateEnvRowControls();
}

export function updateEnvRowControls() {
  const rows = [...els.envEditor.querySelectorAll(".env-row")];
  for (const [rowIndex, row] of rows.entries()) {
    const valueRows = [...row.querySelectorAll(".env-value-field")];
    let activeValueRow = valueRows.find((valueRow) => valueRow.dataset.envActive === "true") || valueRows.at(-1);
    const hasMultipleValues = valueRows.length > 1;
    row.classList.toggle("env-has-active-choice", hasMultipleValues);
    for (const valueRow of valueRows) {
      const radio = valueRow.querySelector(".env-active-value");
      valueRow.dataset.envActive = valueRow === activeValueRow ? "true" : "false";
      if (!radio) continue;
      radio.name = `env-active-${rowIndex}`;
      radio.hidden = !hasMultipleValues;
      radio.checked = valueRow === activeValueRow;
    }
  }
}

export function envEditorGroupsFromRows(rows) {
  const groups = [];
  const groupByKey = new Map();
  for (const row of rows) {
    if (!groupByKey.has(row.key)) {
      const group = { key: row.key, values: [] };
      groupByKey.set(row.key, group);
      groups.push(group);
    }
    groupByKey.get(row.key).values.push({ value: row.value, active: false });
  }
  for (const group of groups) {
    const activeValue = group.values.at(-1);
    if (activeValue) activeValue.active = true;
  }
  return groups;
}

export function renderEnvEditor(contents) {
  els.envEditor.replaceChildren();
  for (const group of envEditorGroupsFromRows(parseEnvEditorRows(contents || ""))) {
    els.envEditor.append(createEnvRow(group.key, group.values));
  }
  ensureTrailingEnvRow();
}

export function envEditorContents() {
  const lines = [];
  for (const row of els.envEditor.querySelectorAll(".env-row")) {
    const rowValues = envRowValues(row);
    if (!rowValues.key) continue;
    const activeValues = rowValues.values.filter((value) => value.active);
    const activeValue = activeValues.at(-1) || rowValues.values.at(-1);
    const orderedValues = [
      ...rowValues.values.filter((value) => value !== activeValue),
      ...(activeValue ? [activeValue] : []),
    ];
    for (const value of orderedValues) {
      lines.push(`${rowValues.key}=${value.value}`);
    }
  }
  return lines.join("\n");
}

export async function saveEnv() {
  clearTimeout(envSaveTimer);
  const contents = envEditorContents();
  if (contents === state.lastSavedEnv) return;
  await api("/api/env", {
    method: "PUT",
    body: JSON.stringify({ contents }),
  });
  state.lastSavedEnv = contents;
}

export function flushEnvSaveOnPageHide() {
  clearTimeout(envSaveTimer);
  const contents = envEditorContents();
  if (contents === state.lastSavedEnv) return;
  state.lastSavedEnv = contents;
  void fetch("/api/env", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents }),
    keepalive: true,
  }).catch(reportAutoSaveError);
}

export function activateEnvValueRow(valueRow) {
  const row = valueRow?.closest(".env-row");
  if (!row) return;
  for (const candidate of row.querySelectorAll(".env-value-field")) {
    candidate.dataset.envActive = candidate === valueRow ? "true" : "false";
  }
  updateEnvRowControls();
  scheduleEnvSave();
}

export function handleEnvEditorInput(event) {
  if (event.target.closest(".env-active-value")) return;
  const valueInput = event.target.closest(".env-value");
  if (valueInput) valueInput.dataset.envValue = valueInput.value;
  ensureTrailingEnvRow();
  scheduleEnvSave();
}

export function handleEnvEditorChange(event) {
  const activeInput = event.target.closest(".env-active-value");
  if (!activeInput?.checked) return;
  const valueRow = activeInput.closest(".env-value-field");
  if (valueRow) activateEnvValueRow(valueRow);
}

export function handleEnvEditorClick(event) {
  const activeInput = event.target.closest(".env-active-value");
  if (activeInput) {
    const valueRow = activeInput.closest(".env-value-field");
    if (valueRow) activateEnvValueRow(valueRow);
    return;
  }

  const button = event.target.closest(".env-add-value");
  if (!button) return;
  const row = button.closest(".env-row");
  if (!row) return;
  const keyInput = row?.querySelector(".env-key");
  const key = envRowValues(row).key;
  if (!key) {
    keyInput?.focus();
    return;
  }
  const nextRow = createEnvValueRow("");
  row.querySelector(".env-values")?.append(nextRow);
  ensureTrailingEnvRow();
  nextRow.querySelector(".env-value")?.focus();
  scheduleEnvSave();
}

export function handleEnvEditorFocusIn(event) {
  revealEnvValueInput(event.target.closest(".env-value"));
}

export function handleEnvEditorPaste(event) {
  const input = event.target.closest(".env-key, .env-value");
  const row = input?.closest(".env-row");
  if (!row || !envRowIsEmpty(row)) return;
  const pastedRows = parseEnvEditorRows(event.clipboardData?.getData("text") || "");
  if (!pastedRows.length) return;

  event.preventDefault();
  const pastedEnvRows = envEditorGroupsFromRows(pastedRows).map((group) => createEnvRow(group.key, group.values));
  row.replaceWith(...pastedEnvRows);
  ensureTrailingEnvRow();
  pastedEnvRows.at(-1)?.querySelector(".env-value")?.focus();
  scheduleEnvSave();
}

export function handleEnvEditorFocusOut(event) {
  maskEnvValueInput(event.target.closest(".env-value"));
  if (event.relatedTarget && els.envEditor.contains(event.relatedTarget)) return;
  void saveEnv().catch(reportAutoSaveError);
}

export function settingsSectionKey(section) {
  const label = section.querySelector(".settings-section-toggle span")?.textContent || "";
  return label.trim().toLowerCase().replace(/\s+/g, "-");
}

export function applySettingsSectionState(section) {
  const key = settingsSectionKey(section);
  const collapsed = state.collapsedSettingsSections.has(key);
  section.classList.toggle("collapsed", collapsed);
  section.querySelector(".settings-section-toggle")?.setAttribute("aria-expanded", String(!collapsed));
}

export function resetSettingsHorizontalScroll() {
  if (els.settingsContent.scrollLeft !== 0) els.settingsContent.scrollLeft = 0;
}

export function renderSettingsSections() {
  els.settingsContent.querySelectorAll(".settings-section").forEach(applySettingsSectionState);
  resetSettingsHorizontalScroll();
}

export function toggleSettingsSection(section) {
  const key = settingsSectionKey(section);
  if (!key) return;
  if (state.collapsedSettingsSections.has(key)) {
    state.collapsedSettingsSections.delete(key);
  } else {
    state.collapsedSettingsSections.add(key);
  }
  localStorage.setItem(COLLAPSED_SETTINGS_SECTIONS_KEY, JSON.stringify([...state.collapsedSettingsSections]));
  applySettingsSectionState(section);
}

export function setSettingsCollapsed(collapsed) {
  state.settingsCollapsed = collapsed;
  document.body.classList.toggle("settings-collapsed", collapsed);
  els.settingsToggle.setAttribute("aria-expanded", String(!collapsed));
  els.settingsToggle.setAttribute("aria-label", "Collapse settings");
  els.settingsPane.setAttribute("aria-label", collapsed ? "Expand settings" : "Settings");
  if (collapsed) {
    els.settingsPane.setAttribute("tabindex", "0");
    els.settingsPane.setAttribute("role", "button");
  } else {
    els.settingsPane.removeAttribute("tabindex");
    els.settingsPane.removeAttribute("role");
    resetSettingsHorizontalScroll();
    renderCheckouts();
    scheduleCheckoutsLoaded();
  }
}

export function toggleSettingsCollapsed() {
  setSettingsCollapsed(!state.settingsCollapsed);
}

export function setDefaultSettingsState(linear) {
  setSettingsCollapsed(Boolean(linear.signedIn));
}
