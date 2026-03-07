import {
  handleOnMouseDown,
  handleOnMouseLeave,
  handleOnMouseMove,
  handleOnMouseUp,
} from "../core/dragController.js";

import { removeNodeInputs, getWidget } from "../utils/nodeUtils.js";
import { getPreviewAreaCached } from "../ui/nodeLayout.js";
import { resetCrop } from "../core/cropModel.js";
import { app } from "../../../scripts/app.js";

// ---------------------------------------------------------------------------
// Paste / Drop helpers
// ---------------------------------------------------------------------------

function isImageFile(file) {
  if (!file) return false;
  if (typeof file.type === "string" && file.type.startsWith("image/")) return true;
  const n = String(file.name || "").toLowerCase();
  return /\.(png|jpe?g|webp|bmp|gif|tiff?)$/.test(n);
}

function extractFirstImageFile(args) {
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

function hasImageItems(e) {
  const items = e?.dataTransfer?.items;
  if (!items) return false;
  for (const item of items) { if (item?.kind === "file") return true; }
  return false;
}

async function uploadImageToInput(file) {
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

function splitUploadedPath(uploadedPath) {
  const p = String(uploadedPath || "");
  const ix = p.lastIndexOf("/");
  if (ix === -1) return { subfolder: "", filename: p };
  return { subfolder: p.slice(0, ix), filename: p.slice(ix + 1) };
}

function showUploadedPreview(node, uploadedPath) {
  const { subfolder, filename } = splitUploadedPath(uploadedPath);
  if (!filename) {
    console.warn("[OlmDragCrop] showUploadedPreview - empty filename, aborting");
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
    resetCrop(node, preview);

    const lwWidget = getWidget(node, "last_width");
    if (lwWidget) lwWidget.value = newWidth;
    const lhWidget = getWidget(node, "last_height");
    if (lhWidget) lhWidget.value = newHeight;

    node.setDirtyCanvas(true, true);
  };
  node.image.onerror = (err) => {
    console.warn("[OlmDragCrop] node.image FAILED to load:", imageUrl, err);
    node.imageLoaded = false;
  };
  node.image.src = imageUrl;
}

async function setPastedImageFromFile(node, file) {
  if (!isImageFile(file)) return false;

  // Dedup guard: multiple hooks may fire for the same user action.
  const dedupeKey = `${file.name}:${file.size}:${file.lastModified}`;
  if (node._pasteDedupeKey === dedupeKey) return false;
  node._pasteDedupeKey = dedupeKey;
  setTimeout(() => { if (node._pasteDedupeKey === dedupeKey) node._pasteDedupeKey = null; }, 1000);

  const uploadedName = await uploadImageToInput(file);

  const pastedWidget = getWidget(node, "pasted_image");
  if (!pastedWidget) throw new Error("pasted_image widget not found on OlmDragCrop node");

  const values = pastedWidget.options?.values;
  if (Array.isArray(values) && !values.includes(uploadedName)) values.push(uploadedName);

  pastedWidget.value = uploadedName;
  pastedWidget.callback?.(uploadedName);

  const dv = getWidget(node, "drawing_version");
  if (dv) dv.value = Date.now();

  showUploadedPreview(node, uploadedName);

  node.setDirtyCanvas(true, true);
  return true;
}

// ---------------------------------------------------------------------------

export function handleOnAdded(node) {
  removeNodeInputs(node);

  const originalOnMouseDown = node.onMouseDown;
  const originalOnMouseMove = node.onMouseMove;
  const originalOnMouseUp = node.onMouseUp;
  const originalOnMouseLeave = node.onMouseLeave;

  node.onMouseDown = function (e, pos, canvas) {
    const preview = getPreviewAreaCached(node);
    const wasHandled = originalOnMouseDown?.call(this, e, pos, canvas);
    if (wasHandled) return true;
    return handleOnMouseDown?.(node, e, pos, canvas, preview);
  };

  node.onMouseMove = function (e, pos, canvas) {
    const preview = getPreviewAreaCached(node);
    const wasHandled = originalOnMouseMove?.call(this, e, pos, canvas);
    if (wasHandled) return true;
    return handleOnMouseMove?.(node, e, pos, canvas, preview);
  };

  node.onMouseUp = function (e, pos, canvas) {
    const preview = getPreviewAreaCached(node);
    const wasHandled = originalOnMouseUp?.call(this, e, pos, canvas);
    if (wasHandled) return true;
    return handleOnMouseUp?.(node, e, pos, canvas, preview);
  };

  node.onMouseLeave = function (e, pos, canvas) {
    const preview = getPreviewAreaCached(node);
    const wasHandled = originalOnMouseLeave?.call(this, e, pos, canvas);
    if (wasHandled) return true;
    return handleOnMouseLeave?.(node, e, preview);
  };

  const originalOnDragOver = node.onDragOver;
  node.onDragOver = function (e) {
    const handled = originalOnDragOver?.call(this, e);
    if (handled) return true;
    return hasImageItems(e);
  };

  node.onDragDrop = function (...args) {
    const file = extractFirstImageFile(args);
    if (!file || !isImageFile(file)) return false;
    setPastedImageFromFile(node, file).catch((err) => {
      console.warn("[OlmDragCrop] Failed to handle dropped image:", err);
    });
    return true;
  };

  node.onPasteFile = function (...args) {
    const file = extractFirstImageFile(args);
    if (!file || !isImageFile(file)) return false;
    setPastedImageFromFile(node, file).catch((err) => {
      console.warn("[OlmDragCrop] Failed to handle pasted image:", err);
    });
    return true;
  };

  node.pasteFile = function (file) {
    if (!file || !isImageFile(file)) return;
    setPastedImageFromFile(node, file).catch((err) => {
      console.warn("[OlmDragCrop] Failed to handle pasteFile image:", err);
    });
  };

  node.pasteFiles = function (files) {
    const file = Array.isArray(files) ? files.find((f) => isImageFile(f)) : null;
    if (!file) return;
    setPastedImageFromFile(node, file).catch((err) => {
      console.warn("[OlmDragCrop] Failed to handle pasteFiles image:", err);
    });
  };
}
