import { MODAL_HIDE_DELAY_MS } from "./constants.js";
import { els } from "./state.js";
import { showModalElement } from "./ui.js";

export let imagePreviewTransitionTimer = 0;

export let imagePreviewScale = 1;

export let imagePreviewOffsetX = 0;

export let imagePreviewOffsetY = 0;

export let imagePreviewDrag = null;

export function openImagePreview(src, alt = "") {
  if (!els.imagePreviewModal || !src) return;
  clearTimeout(imagePreviewTransitionTimer);
  const image = els.imagePreviewModal.querySelector(".image-preview-frame img");
  const title = els.imagePreviewModal.querySelector("#imagePreviewTitle");
  imagePreviewScale = 1;
  imagePreviewOffsetX = 0;
  imagePreviewOffsetY = 0;
  image.src = src;
  image.alt = alt;
  applyImagePreviewTransform();
  title.textContent = alt || "Image preview";
  showModalElement(els.imagePreviewModal);
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
    els.imagePreviewModal.classList.remove("is-closing");
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
  openImagePreview(target.dataset.imagePreviewSrc || target.href, target.dataset.imagePreviewAlt || target.querySelector("img")?.alt || "");
}

export const imagePreviewFrame = els.imagePreviewModal?.querySelector(".image-preview-frame");
