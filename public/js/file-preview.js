import { renderLinearMarkdown } from "../linear-markdown.js";

let pendingPreview = null;
let previousFocus = null;
const dialog = document.querySelector("#filePreviewModal");

export async function handleFilePreviewClick(event) {
  const card = event.target.closest?.("[data-file-preview]");
  if (!card || !dialog) return;
  event.preventDefault();
  pendingPreview?.abort();
  const controller = new AbortController();
  pendingPreview = controller;
  if (!dialog.open) previousFocus = document.activeElement;
  const title = dialog.querySelector("h2");
  const path = dialog.querySelector(".file-preview-path");
  const body = dialog.querySelector(".file-preview-body");
  const download = dialog.querySelector("[data-file-download]");
  const url = new URL(card.getAttribute("href"), window.location.href);
  title.textContent = card.querySelector(".file-link-label")?.textContent || "File preview";
  path.textContent = card.dataset.filePreviewPath;
  body.textContent = "Loading file…";
  body.setAttribute("aria-busy", "true");
  const downloadUrl = new URL(url);
  downloadUrl.searchParams.set("download", "1");
  download.href = downloadUrl.href;
  download.hidden = true;
  if (!dialog.open) dialog.showModal();
  try {
    const response = await fetch(url, { signal: controller.signal });
    const file = await response.json();
    if (!response.ok) throw new Error(file.error || "Could not load this file.");
    if (controller.signal.aborted) return;
    title.textContent = file.name;
    path.textContent = file.path;
    download.hidden = false;
    body.replaceChildren();
    if (file.kind === "markdown") {
      const source = (target, image = false) => {
        const nested = new URL(url);
        if (image) nested.pathname = nested.pathname.replace("/files/preview", "/context-images/preview");
        nested.searchParams.set("path", target.startsWith("/") ? target : `${file.path.slice(0, file.path.lastIndexOf("/") + 1)}${target}`);
        return nested.pathname + nested.search;
      };
      body.innerHTML = renderLinearMarkdown(file.content, "", {
        fileSource: (target) => source(target),
        imageSource: (target) => /^https?:\/\//i.test(target) ? target : source(target, true),
        copyCode: false,
      });
      window.Prism?.highlightAllUnder?.(body);
    } else if (file.kind === "text") {
      const pre = document.createElement("pre");
      pre.className = "file-preview-code";
      for (const [index, text] of file.content.split("\n").entries()) {
        const line = document.createElement("span");
        line.className = "file-preview-line";
        line.dataset.line = String(index + 1);
        line.textContent = text;
        if (index + 1 === file.line) line.classList.add("is-highlighted");
        pre.append(line);
      }
      body.append(pre);
    } else {
      body.textContent = file.reason;
    }
    body.scrollTop = 0;
    body.querySelector(".is-highlighted")?.scrollIntoView({ block: "center" });
  } catch (error) {
    if (!controller.signal.aborted) body.textContent = error.message || "Could not load this file.";
  } finally {
    if (!controller.signal.aborted) body.setAttribute("aria-busy", "false");
  }
}

dialog?.addEventListener("click", (event) => {
  if (event.target === dialog || event.target.closest("[data-file-preview-close], [data-image-preview]")) dialog.close();
  else handleFilePreviewClick(event);
});
dialog?.addEventListener("close", () => {
  pendingPreview?.abort();
  dialog.querySelector(".file-preview-body").replaceChildren();
  previousFocus?.focus?.({ preventScroll: true });
  previousFocus = null;
});
dialog?.addEventListener("keydown", (event) => event.stopPropagation());
