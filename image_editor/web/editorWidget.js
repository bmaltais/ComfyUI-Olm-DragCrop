/**
 * Inline editor widget for OlmImageEditor — Nodes 2.0 compatible.
 *
 * Nodes 2.0 uses Vue (not LiteGraph), so NO LiteGraph APIs are used here:
 *   ✗  app.canvas.current_node / selectNode / selected_nodes
 *   ✗  node.previewMediaType / node.pasteFile / node.onDragDrop / node.onDragOver
 *
 * Paste and drop are handled entirely via DOM events:
 *   • Paste  → hidden <textarea> is focused on mouseenter; paste events naturally
 *              land on the focused element, bypassing usePaste.ts entirely.
 *   • Drop   → dragover/drop listeners on the canvas wrapper div.
 */

import { app } from "../../scripts/app.js";
import { applyCanvas } from "./applyHandler.js";
import { setCanvas, setDirty, getCanvas, getEditorInfo } from "./editorState.js";
import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT, WEB_KEY } from "./constants.js";
import { isImageFile, uploadImageToInput } from "../ComfyUI-Olm-DragCrop/utils/pasteDropUtils.js";

// ---------------------------------------------------------------------------
// Fabric.js loader (singleton promise)
// ---------------------------------------------------------------------------
let _fabricPromise = null;

// Eagerly start loading Fabric.js as soon as this module is imported.
// This minimises the window between node creation and the first workflow run
// where the canvas would not be ready yet.
// loadFabric() is defined below — the call at the bottom of the module
// kicks off the download but result is cached via _fabricPromise.

export function loadFabric() {
  if (_fabricPromise) return _fabricPromise;

  _fabricPromise = new Promise((resolve, reject) => {
    const existing = window.fabric ?? window.Fabric;
    if (existing) {
      console.log("[OlmImageEditor] Fabric already loaded:", existing.version ?? "?");
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    script.src = `/extensions/${WEB_KEY}/libs/fabric.min.js`;
    console.log("[OlmImageEditor] Loading Fabric from:", script.src);

    script.onload = () => {
      const fab = window.fabric ?? window.Fabric;
      console.log("[OlmImageEditor] fabric.min.js onload — window.fabric:", !!fab, fab?.version ?? "no version");
      if (fab) resolve(fab);
      else reject(new Error("fabric.min.js loaded but window.fabric is undefined"));
    };
    script.onerror = (e) => {
      console.error("[OlmImageEditor] fabric.min.js failed to load:", script.src);
      reject(new Error("Failed to load: " + script.src));
    };
    document.head.appendChild(script);
  });

  return _fabricPromise;
}

// Kick off the download immediately so Fabric is ready before nodes are created.
loadFabric().catch((err) => console.warn("[OlmImageEditor] Eager Fabric load failed:", err.message));

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
function _buildEditorEl() {
  const root = document.createElement("div");
  root.style.cssText = `
    display:flex; flex-direction:column; width:100%;
    background:#1a1a1a; border-radius:4px;
    overflow:hidden; box-sizing:border-box; position:relative;
  `;

  // Hidden textarea — receives paste events when focused.
  // We focus it on mouseenter so Ctrl+V always lands here, not in usePaste.ts.
  const pasteTarget = document.createElement("textarea");
  pasteTarget.style.cssText = `
    position:absolute; opacity:0; pointer-events:none;
    width:1px; height:1px; top:0; left:0;
  `;
  pasteTarget.tabIndex = 0;
  pasteTarget.setAttribute("aria-hidden", "true");
  root.appendChild(pasteTarget);

  const wrap = document.createElement("div");
  wrap.style.cssText = `
    overflow:auto; display:flex;
    align-items:flex-start; justify-content:center;
    background:#111; min-height:200px;
  `;

  const canvasEl = document.createElement("canvas");
  wrap.appendChild(canvasEl);

  const footer = document.createElement("div");
  footer.style.cssText = `
    display:flex; align-items:center; justify-content:flex-end;
    gap:8px; padding:6px 10px; background:#252525;
    border-top:1px solid #333; flex-shrink:0;
  `;

  const hint = document.createElement("span");
  hint.style.cssText = "color:#666; font-size:11px; flex:1; font-family:sans-serif;";
  hint.textContent = "Hover + Ctrl+V, or drop image to load";

  const applyBtn = _makeBtn("Apply", "#2a7adb");
  footer.append(hint, applyBtn);
  root.append(wrap, footer);

  return { root, pasteTarget, canvasEl, wrap, applyBtn, hint };
}

function _makeBtn(label, bg) {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.style.cssText = `
    background:${bg}; color:#fff; border:none; border-radius:4px;
    padding:5px 16px; font-size:12px; cursor:pointer; font-weight:600;
    font-family:sans-serif;
  `;
  btn.onmouseover = () => (btn.style.filter = "brightness(1.2)");
  btn.onmouseout  = () => (btn.style.filter = "");
  return btn;
}

// ---------------------------------------------------------------------------
// Canvas loading helpers
// ---------------------------------------------------------------------------
function _loadFileOntoCanvas(fc, nodeId, file) {
  console.log("[OlmImageEditor] Loading file onto canvas:", file.name, file.size);
  const url = URL.createObjectURL(file);
  _loadUrlOntoCanvas(fc, url, () => URL.revokeObjectURL(url));
  setDirty(nodeId, true);
}

function _loadUrlOntoCanvas(fc, url, onLoad) {
  const fab = window.fabric ?? window.Fabric;
  const FabricImage = fab?.Image ?? fab?.FabricImage;
  console.log("[OlmImageEditor] _loadUrlOntoCanvas:", url.slice(0, 80), "FabricImage:", !!FabricImage);
  if (!FabricImage) {
    console.error("[OlmImageEditor] FabricImage unavailable — Fabric.js not loaded?");
    return;
  }
  FabricImage.fromURL(
    url,
    (img) => {
      onLoad?.();
      const w = img?.width ?? 0;
      const h = img?.height ?? 0;
      console.log("[OlmImageEditor] fromURL callback:", w, "×", h, img ? "" : "(null img)");
      if (!img || (w === 0 && h === 0)) {
        console.error("[OlmImageEditor] Image load failed — zero size or null img");
        return;
      }
      fc.clear();
      fc.setWidth(w);
      fc.setHeight(h);
      img.set({ left: 0, top: 0, selectable: false, evented: false });
      fc.add(img);
      fc.renderAll();
      console.log("[OlmImageEditor] Canvas updated:", w, "×", h);
    },
    { crossOrigin: "anonymous" }
  );
}

function _setPastedImageWidget(node, uploadedPath) {
  const pw = node.widgets?.find((w) => w.name === "pasted_image");
  if (!pw) { console.warn("[OlmImageEditor] pasted_image widget not found"); return; }
  const vals = pw.options?.values;
  if (Array.isArray(vals) && !vals.includes(uploadedPath)) vals.push(uploadedPath);
  pw.value = uploadedPath;
  pw.callback?.(uploadedPath);
}

async function _handleImageFile(node, fc, file) {
  if (!isImageFile(file)) return;
  if (fc) _loadFileOntoCanvas(fc, node.id, file);
  try {
    const path = await uploadImageToInput(file);
    _setPastedImageWidget(node, path);
    node.setDirtyCanvas?.(true, true);
  } catch (err) {
    console.error("[OlmImageEditor] Upload failed:", err);
  }
}

// ---------------------------------------------------------------------------
// installImageHooks — only the LiteGraph-compatible parts (no-op in Nodes 2.0)
// Called from main.js for legacy mode compatibility; DOM-based handling is the
// primary implementation via createEditorWidget.
// ---------------------------------------------------------------------------
export function installImageHooks(node) {
  // Kept minimal — DOM handling in createEditorWidget is the real implementation.
  // These hooks only fire in legacy LiteGraph mode.
  if (typeof node.onDragOver !== "undefined" || app.canvas) {
    // LiteGraph mode: set drag-border hook
    const _orig = node.onDragOver;
    node.onDragOver = function (e) {
      if (_orig?.call(this, e)) return true;
      const items = e?.dataTransfer?.items;
      if (items) for (const item of items) if (item?.kind === "file") return true;
      return false;
    };
  }
}

// ---------------------------------------------------------------------------
// createEditorWidget — the main DOM widget implementation
// ---------------------------------------------------------------------------
export async function createEditorWidget(node) {
  const { root, pasteTarget, canvasEl, wrap, applyBtn, hint } = _buildEditorEl();

  // Dedup guard for paste + drop
  let _dedupeKey = null;
  async function handleFile(file) {
    if (!isImageFile(file)) return;
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (_dedupeKey === key) return;
    _dedupeKey = key;
    setTimeout(() => { if (_dedupeKey === key) _dedupeKey = null; }, 1000);
    await _handleImageFile(node, getCanvas(node.id), file);
  }

  // ── Paste via focused textarea ──────────────────────────────────────────
  // mouseenter focuses the hidden textarea → Ctrl+V events land here, not in
  // usePaste.ts. Works in both LiteGraph and Vue (Nodes 2.0) modes.
  root.addEventListener("mouseenter", () => {
    pasteTarget.focus({ preventScroll: true });
  });

  pasteTarget.addEventListener("paste", async (e) => {
    e.preventDefault();
    const items = e.clipboardData?.items;
    let file = null;
    if (items) {
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          file = item.getAsFile();
          break;
        }
      }
    }
    if (!file && e.clipboardData?.files?.length) {
      for (const f of e.clipboardData.files) { if (isImageFile(f)) { file = f; break; } }
    }
    if (!file) { console.log("[OlmImageEditor] Paste: no image in clipboard"); return; }
    console.log("[OlmImageEditor] Paste intercepted via textarea:", file.name, file.type);
    handleFile(file).catch(console.warn);
  });

  // ── Drop onto canvas wrapper ─────────────────────────────────────────────
  wrap.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  wrap.addEventListener("drop", async (e) => {
    e.preventDefault();
    let file = null;
    if (e.dataTransfer?.files?.length) {
      for (const f of e.dataTransfer.files) { if (isImageFile(f)) { file = f; break; } }
    }
    if (!file && e.dataTransfer?.items?.length) {
      for (const item of e.dataTransfer.items) {
        if (item.kind === "file") { const f = item.getAsFile?.(); if (f && isImageFile(f)) { file = f; break; } }
      }
    }
    console.log("[OlmImageEditor] Drop on wrap:", file?.name ?? "no image file");
    if (file) handleFile(file).catch(console.warn);
  });

  // ── DOM widget registration ──────────────────────────────────────────────
  const widget = node.addDOMWidget("editor_area", "div", root, {
    serialize: false,
    hideOnZoom: false,
    computeSize() {
      const fc = getCanvas(node.id);
      return [node.size?.[0] ?? DEFAULT_CANVAS_WIDTH, (fc?.getHeight() ?? DEFAULT_CANVAS_HEIGHT) + 44];
    },
  });

  // ── Load Fabric.js ────────────────────────────────────────────────────────
  let fabric;
  try {
    fabric = await loadFabric();
    console.log("[OlmImageEditor] Fabric ready, version:", fabric.version ?? "?");
  } catch (err) {
    console.error("[OlmImageEditor] Fabric load failed:", err.message);
    hint.textContent = "Error: Fabric.js failed to load. Check console.";
    hint.style.color = "#f44";
    return widget;
  }

  const fc = new fabric.Canvas(canvasEl, {
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
    backgroundColor: "#2c2c2c",
    selection: true,
  });

  setCanvas(node.id, fc);
  console.log("[OlmImageEditor] Canvas ready for node", node.id);

  // Deferred image load: if onExecuted fired before Fabric finished loading,
  // the editorInfo was stored; pick it up now.
  const pending = getEditorInfo(node.id);
  console.log("[OlmImageEditor] Deferred editorInfo:", pending?.preview_filename ?? "none");
  if (pending) onExecutedLoadImage(node, pending);

  fc.on("object:modified", () => setDirty(node.id, true));
  fc.on("object:added",    () => setDirty(node.id, true));

  applyBtn.addEventListener("click", async () => {
    applyBtn.disabled = true;
    try { await applyCanvas(node, fc); }
    catch (err) { console.error("[OlmImageEditor] Apply failed:", err); alert("Apply failed: " + err.message); }
    finally { applyBtn.disabled = false; }
  });

  // Store handler ref for cleanup
  node._olmPasteTarget = pasteTarget;

  node.setSize?.([node.size?.[0] ?? DEFAULT_CANVAS_WIDTH, node.computeSize?.()?.[1] ?? 600]);
  node.setDirtyCanvas?.(true, true);
  return widget;
}

// ---------------------------------------------------------------------------
// onExecutedLoadImage — called by main.js after backend execution
// ---------------------------------------------------------------------------
export function onExecutedLoadImage(node, editorInfo) {
  const fc = getCanvas(node.id);
  console.log("[OlmImageEditor] onExecutedLoadImage:", {
    nodeId: node.id, hasCanvas: !!fc,
    file: editorInfo?.preview_filename ?? "missing",
  });
  if (!fc || !editorInfo?.preview_filename) return;

  const params = new URLSearchParams({
    filename: editorInfo.preview_filename,
    type:     editorInfo.preview_type      || "temp",
    subfolder: editorInfo.preview_subfolder || "",
    rand: String(Date.now()),
  });
  _loadUrlOntoCanvas(fc, app.api.apiURL(`/view?${params.toString()}`));
}

// ---------------------------------------------------------------------------
// destroyEditorWidget — called by main.js on node removal
// ---------------------------------------------------------------------------
export function destroyEditorWidget(node) {
  getCanvas(node.id)?.dispose();
  setCanvas(node.id, null);
}
