import { MODAL_HIDE_DELAY_MS } from "./constants.js";
import { els } from "./state.js";
import { showModalElement } from "./ui.js";

export let imagePreviewTransitionTimer = 0;

export let imagePreviewScale = 1;

export let imagePreviewOffsetX = 0;

export let imagePreviewOffsetY = 0;

export let imagePreviewDrag = null;

export let imagePreviewItems = [];

export let imagePreviewIndex = 0;

let imagePreviewPreviousFocus = null;

export function openImagePreview(src, alt = "", items = [{ src, alt }]) {
  if (!els.imagePreviewModal || !src) return;
  clearTimeout(imagePreviewTransitionTimer);
  if (els.imagePreviewModal.hidden) imagePreviewPreviousFocus = document.activeElement;
  imagePreviewItems = items.filter((item, index) => item.src && items.findIndex((other) => other.src === item.src) === index);
  imagePreviewIndex = imagePreviewItems.findIndex((item) => item.src === src);
  if (imagePreviewIndex < 0) {
    imagePreviewIndex = imagePreviewItems.length;
    imagePreviewItems.push({ src, alt });
  }
  renderImagePreview();
  showModalElement(els.imagePreviewModal);
  els.imagePreviewModal.querySelector(".image-preview-modal")?.focus({ preventScroll: true });
}

function renderImagePreview() {
  const { src, alt } = imagePreviewItems[imagePreviewIndex];
  const image = els.imagePreviewModal.querySelector(".image-preview-frame img");
  const title = els.imagePreviewModal.querySelector("#imagePreviewTitle");
  imagePreviewDrag = null;
  els.imagePreviewModal.classList.remove("is-dragging");
  imagePreviewScale = 1;
  imagePreviewOffsetX = 0;
  imagePreviewOffsetY = 0;
  image.src = src;
  image.alt = alt;
  applyImagePreviewTransform();
  title.textContent = alt || "Image preview";
  const frame = els.imagePreviewModal.querySelector(".image-preview-frame");
  frame.scrollTop = 0;
  frame.scrollLeft = 0;
  els.imagePreviewModal.querySelector(".image-preview-count").textContent = `${imagePreviewIndex + 1} / ${imagePreviewItems.length}`;
  for (const button of els.imagePreviewModal.querySelectorAll("[data-image-preview-step]")) {
    button.disabled = imagePreviewItems.length < 2;
  }
}

export function navigateImagePreview(step) {
  if (!els.imagePreviewModal || els.imagePreviewModal.hidden || els.imagePreviewModal.classList.contains("is-closing") || imagePreviewItems.length < 2) return;
  imagePreviewIndex = (imagePreviewIndex + step + imagePreviewItems.length) % imagePreviewItems.length;
  renderImagePreview();
}

export function handleImagePreviewKeydown(event) {
  if (!els.imagePreviewModal || els.imagePreviewModal.hidden || event.altKey || event.ctrlKey || event.metaKey) return false;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return false;
  event.preventDefault();
  navigateImagePreview(event.key === "ArrowLeft" ? -1 : 1);
  return true;
}

export function closeImagePreview() {
  if (!els.imagePreviewModal || els.imagePreviewModal.hidden) return;
  clearTimeout(imagePreviewTransitionTimer);
  imagePreviewDrag = null;
  els.imagePreviewModal.classList.remove("is-open");
  els.imagePreviewModal.classList.remove("is-dragging");
  els.imagePreviewModal.classList.add("is-closing");
  imagePreviewTransitionTimer = setTimeout(() => {
    const image = els.imagePreviewModal.querySelector(".image-preview-frame img");
    image.removeAttribute("src");
    image.alt = "";
    image.style.removeProperty("--image-preview-scale");
    image.style.removeProperty("--image-preview-x");
    image.style.removeProperty("--image-preview-y");
    els.imagePreviewModal.hidden = true;
    imagePreviewItems = [];
    els.imagePreviewModal.classList.remove("is-closing");
    imagePreviewPreviousFocus?.focus?.({ preventScroll: true });
    imagePreviewPreviousFocus = null;
  }, MODAL_HIDE_DELAY_MS);
}

export function applyImagePreviewTransform() {
  const image = els.imagePreviewModal?.querySelector(".image-preview-frame img");
  if (!image) return;
  image.style.setProperty("--image-preview-scale", imagePreviewScale);
  image.style.setProperty("--image-preview-x", `${imagePreviewOffsetX}px`);
  image.style.setProperty("--image-preview-y", `${imagePreviewOffsetY}px`);
}

export function handleImagePreviewWheel(event) {
  if (!els.imagePreviewModal || els.imagePreviewModal.hidden) return;
  event.preventDefault();
  const image = els.imagePreviewModal.querySelector(".image-preview-frame img");
  const rect = image.getBoundingClientRect();
  const oldScale = imagePreviewScale;
  const nextScale = Math.min(5, Math.max(1, imagePreviewScale + (event.deltaY < 0 ? 0.15 : -0.15)));
  if (nextScale === oldScale) return;
  const scaleRatio = nextScale / oldScale;
  const baseCenterX = rect.left + rect.width / 2 - imagePreviewOffsetX;
  const baseCenterY = rect.top + rect.height / 2 - imagePreviewOffsetY;
  imagePreviewOffsetX += (event.clientX - baseCenterX - imagePreviewOffsetX) * (1 - scaleRatio);
  imagePreviewOffsetY += (event.clientY - baseCenterY - imagePreviewOffsetY) * (1 - scaleRatio);
  imagePreviewScale = nextScale;
  if (imagePreviewScale === 1) {
    imagePreviewOffsetX = 0;
    imagePreviewOffsetY = 0;
  }
  applyImagePreviewTransform();
}

export function handleImagePreviewPointerDown(event) {
  if (event.button !== 0 || imagePreviewScale <= 1) return;
  imagePreviewDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: imagePreviewOffsetX,
    offsetY: imagePreviewOffsetY,
  };
  els.imagePreviewModal?.classList.add("is-dragging");
  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

export function handleImagePreviewPointerMove(event) {
  if (!imagePreviewDrag || imagePreviewDrag.pointerId !== event.pointerId) return;
  imagePreviewOffsetX = imagePreviewDrag.offsetX + event.clientX - imagePreviewDrag.startX;
  imagePreviewOffsetY = imagePreviewDrag.offsetY + event.clientY - imagePreviewDrag.startY;
  applyImagePreviewTransform();
}

export function endImagePreviewDrag(event) {
  if (!imagePreviewDrag || imagePreviewDrag.pointerId !== event.pointerId) return;
  imagePreviewDrag = null;
  els.imagePreviewModal?.classList.remove("is-dragging");
  event.currentTarget.releasePointerCapture?.(event.pointerId);
}

export function handleImagePreviewClick(event) {
  if (event.target.closest?.(".agent-image-chip button")) return;
  const target = event.target.closest?.("[data-image-preview]");
  if (!target) return;
  event.preventDefault();
  const scopeSelector = ".terminal-split-pane, .terminal-panel, .linear-panel";
  const scope = target.closest(scopeSelector) || els.flowPane;
  const items = [...scope.querySelectorAll("[data-image-preview]")]
    .filter((item) => (item.closest(scopeSelector) || els.flowPane) === scope)
    .map(imagePreviewItem);
  const { src, alt } = imagePreviewItem(target);
  openImagePreview(src, alt, items);
}

function imagePreviewItem(target) {
  return {
    src: target.dataset.imagePreviewSrc || target.getAttribute("href") || "",
    alt: target.dataset.imagePreviewAlt || target.querySelector("img")?.alt || "",
  };
}

export const imagePreviewFrame = els.imagePreviewModal?.querySelector(".image-preview-frame");
