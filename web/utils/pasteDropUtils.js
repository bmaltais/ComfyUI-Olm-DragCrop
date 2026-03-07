/**
 * Shared paste / drag-drop helpers used by both OlmDragCrop and OlmDragPerspective.
 *
 * Each node provides a node-specific `onAfterPreviewArea(node, preview)` callback
 * that is invoked inside the shared showUploadedPreview onload handler to handle
 * node-specific reset logic (resetCrop vs resetCorners / _preserveCorners).
 */

import { app } from "../../../scripts/app.js";
import { getPreviewAreaCached } from "../ui/nodeLayout.js";
import { getWidget } from "./nodeUtils.js";

// ---------------------------------------------------------------------------
// File-type helpers
// ---------------------------------------------------------------------------

export function isImageFile(file) {
  if (!file) return false;
  if (typeof file.type === "string" && file.type.startsWith("image/")) return true;
  const n = String(file.name || "").toLowerCase();
  return /\.(png|jpe?g|webp|bmp|gif|tiff?)$/.test(n);
}

export function extractFirstImageFile(args) {
  for (const a of args) {
    if (!a) continue;
    if (isImageFile(a)) return a;
    if (Array.isArray(a)) {
      const f = a.find((f) => isImageFile(f));
      if (f) return f;
    }
    if (typeof FileList !== "undefined" && a instanceof FileList && a.length) {
      for (const f of a) { if (isImageFile(f)) return f; }
    }
    const dtFiles = a?.dataTransfer?.files;
    if (dtFiles?.length) { for (const f of dtFiles) { if (isImageFile(f)) return f; } }
    const dtItems = a?.dataTransfer?.items;
    if (dtItems?.length) {
      for (const item of dtItems) {
        const f = item?.kind === "file" && typeof item.getAsFile === "function" ? item.getAsFile() : null;
        if (f && isImageFile(f)) return f;
      }
    }
    const clipFiles = a?.clipboardData?.files;
    if (clipFiles?.length) { for (const f of clipFiles) { if (isImageFile(f)) return f; } }
  }
  return null;
}

export function hasImageItems(e) {
  const items = e?.dataTransfer?.items;
  if (!items) return false;
  // Accept file drags even if MIME type is missing (matches ComfyUI default behaviour).
  for (const item of items) { if (item?.kind === "file") return true; }
  return false;
}

// ---------------------------------------------------------------------------
// Upload helpers
// ---------------------------------------------------------------------------

export async function uploadImageToInput(file) {
  const isPasted =
    file?.name === "image.png" &&
    typeof file?.lastModified === "number" &&
    Math.abs(file.lastModified - Date.now()) < 2000;

  const body = new FormData();
  body.append("image", file, file.name || "pasted_image.png");
  body.append("type", "input");
  body.append("overwrite", "false");
  if (isPasted) body.append("subfolder", "pasted");

  const res = await app.api.fetchApi("/upload/image", { method: "POST", body });
  if (!res?.ok) throw new Error(`Image upload failed (${res?.status || "unknown"})`);

  const payload = await res.json();
  if (payload?.subfolder) return `${payload.subfolder}/${payload.name || payload.filename || file.name}`;
  return payload?.name || payload?.filename || file.name;
}

export function splitUploadedPath(uploadedPath) {
  const p = String(uploadedPath || "");
  const ix = p.lastIndexOf("/");
  if (ix === -1) return { subfolder: "", filename: p };
  return { subfolder: p.slice(0, ix), filename: p.slice(ix + 1) };
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/**
 * Load an uploaded image into the node preview canvas.
 *
 * @param {object}   node               - The LiteGraph node.
 * @param {string}   uploadedPath       - Relative path returned by the upload endpoint.
 * @param {string}   logPrefix          - Label used in console warnings, e.g. "[OlmDragCrop]".
 * @param {function} onAfterPreviewArea - Called with (node, preview) after the preview area is
 *                                        computed. Use this for node-specific reset logic
 *                                        (e.g. resetCrop or resetCorners + _preserveCorners).
 */
export function showUploadedPreview(node, uploadedPath, logPrefix, onAfterPreviewArea) {
  const { subfolder, filename } = splitUploadedPath(uploadedPath);
  if (!filename) {
    console.warn(`${logPrefix} showUploadedPreview - empty filename, aborting`);
    return;
  }

  const params = new URLSearchParams({
    filename,
    type: "input",
    subfolder,
    rand: String(Date.now()),
  });

  const imageUrl = app.api.apiURL(`/view?${params.toString()}`);

  node.image.onload = () => {
    node.imageLoaded = true;
    const newWidth  = node.image.naturalWidth;
    const newHeight = node.image.naturalHeight;
    node.properties.actualImageWidth  = newWidth;
    node.properties.actualImageHeight = newHeight;

    node._previewAreaCache = null;
    if (node.onResize) node.onResize(node.size);
    const newSize = node.computeSize();
    if (newSize && newSize[0] > 0 && newSize[1] > 0) node.size = newSize;

    node._previewAreaCache = null;
    const preview = getPreviewAreaCached(node);

    onAfterPreviewArea?.(node, preview);

    const lwWidget = getWidget(node, "last_width");
    if (lwWidget) lwWidget.value = newWidth;
    const lhWidget = getWidget(node, "last_height");
    if (lhWidget) lhWidget.value = newHeight;

    node.setDirtyCanvas(true, true);
  };

  node.image.onerror = (err) => {
    console.warn(`${logPrefix} node.image FAILED to load:`, imageUrl, err);
    node.imageLoaded = false;
  };

  node.image.src = imageUrl;
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

/**
 * Create a setPastedImageFromFile function bound to a specific node.
 *
 * @param {object}   node          - The LiteGraph node.
 * @param {string}   logPrefix     - Label used in the error thrown when the widget is missing.
 * @param {function} showPreviewFn - Called with (node, uploadedName) to update the canvas preview.
 *                                   Typically a partially-applied showUploadedPreview with the
 *                                   node-specific onAfterPreviewArea callback baked in.
 * @returns {function} async setPastedImageFromFile(file) → Promise<boolean>
 */
export function createPasteHandler(node, logPrefix, showPreviewFn) {
  return async function setPastedImageFromFile(file) {
    if (!isImageFile(file)) return false;

    // Dedup guard: multiple hooks may fire for the same user action once
    // previewMediaType="image" is set.
    const dedupeKey = `${file.name}:${file.size}:${file.lastModified}`;
    if (node._pasteDedupeKey === dedupeKey) return false;
    node._pasteDedupeKey = dedupeKey;
    setTimeout(() => { if (node._pasteDedupeKey === dedupeKey) node._pasteDedupeKey = null; }, 1000);

    const uploadedName = await uploadImageToInput(file);

    const pastedWidget = getWidget(node, "pasted_image");
    if (!pastedWidget) throw new Error(`pasted_image widget not found on ${logPrefix} node`);

    const values = pastedWidget.options?.values;
    if (Array.isArray(values) && !values.includes(uploadedName)) values.push(uploadedName);

    pastedWidget.value = uploadedName;
    pastedWidget.callback?.(uploadedName);

    const dv = getWidget(node, "drawing_version");
    if (dv) dv.value = Date.now();

    showPreviewFn(node, uploadedName);

    node.setDirtyCanvas(true, true);
    return true;
  };
}

// ---------------------------------------------------------------------------
// Hook installer
// ---------------------------------------------------------------------------

/**
 * Install the five paste / drag-drop hooks onto a node.
 *
 * Preserves any existing onDragOver handler (chained via originalOnDragOver).
 * Does NOT delegate to previous onDragDrop / onPasteFile handlers because
 * ComfyUI's built-in image_upload handler returns true from those hooks, which
 * would short-circuit our custom preview display code.
 *
 * @param {object}   node         - The LiteGraph node.
 * @param {function} pasteHandler - async (file: File) → Promise<boolean>.
 *                                  Returned by createPasteHandler().
 * @param {string}   logPrefix    - Label used in console warnings.
 */
export function installPasteDropHooks(node, pasteHandler, logPrefix) {
  const originalOnDragOver = node.onDragOver;
  node.onDragOver = function (e) {
    const handled = originalOnDragOver?.call(this, e);
    if (handled) return true;
    return hasImageItems(e);
  };

  node.onDragDrop = function (...args) {
    const file = extractFirstImageFile(args);
    if (!file || !isImageFile(file)) return false;
    pasteHandler(file).catch((err) => {
      console.warn(`${logPrefix} Failed to handle dropped image:`, err);
    });
    return true;
  };

  node.onPasteFile = function (...args) {
    const file = extractFirstImageFile(args);
    if (!file || !isImageFile(file)) return false;
    pasteHandler(file).catch((err) => {
      console.warn(`${logPrefix} Failed to handle pasted image:`, err);
    });
    return true;
  };

  node.pasteFile = function (file) {
    if (!file || !isImageFile(file)) return;
    pasteHandler(file).catch((err) => {
      console.warn(`${logPrefix} Failed to handle pasteFile image:`, err);
    });
  };

  node.pasteFiles = function (files) {
    const file = Array.isArray(files) ? files.find((f) => isImageFile(f)) : null;
    if (!file) return;
    pasteHandler(file).catch((err) => {
      console.warn(`${logPrefix} Failed to handle pasteFiles image:`, err);
    });
  };
}
