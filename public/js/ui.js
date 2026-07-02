import { DEFAULT_TOAST_DURATION_MS, ERROR_TOAST_DURATION_MS } from "./constants.js";
import { els } from "./state.js";

export function toast(message, options = {}) {
  const kind = options.kind || "info";
  const stack = els.toastStack;
  if (!stack) {
    console.log(message);
    return;
  }

  const item = document.createElement("div");
  item.className = `toast toast-${kind}`;
  item.setAttribute("role", kind === "error" ? "alert" : "status");
  item.textContent = message;
  stack.appendChild(item);

  const duration = options.duration ?? (kind === "error" ? ERROR_TOAST_DURATION_MS : DEFAULT_TOAST_DURATION_MS);
  window.setTimeout(() => {
    item.classList.add("toast-exiting");
    item.addEventListener("transitionend", () => item.remove(), { once: true });
    window.setTimeout(() => item.remove(), 200);
  }, duration);
}

export function showModalElement(element) {
  element.hidden = false;
  element.classList.remove("is-open", "is-closing");
  void element.offsetWidth;
  element.classList.add("is-open");
}

export async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

export function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
