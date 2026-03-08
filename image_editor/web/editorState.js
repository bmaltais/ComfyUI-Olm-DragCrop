/**
 * Per-node editor state registry.
 *
 * Stores Fabric.js canvas reference, dirty flag, and undo/redo stacks for
 * each OlmImageEditor node instance, keyed by node ID.
 */

import { HISTORY_MAX } from "./constants.js";

/** @type {Map<string, NodeEditorState>} — keys are always String(nodeId) */
const _registry = new Map();

// Normalise to string so number 371 and string "371" map to the same entry.
const _k = (id) => String(id);

class NodeEditorState {
  constructor() {
    /** @type {fabric.Canvas|null} */
    this.fabricCanvas = null;
    this.dirty = false;
    /** @type {string[]} JSON snapshots for undo */
    this.undoStack = [];
    /** @type {string[]} JSON snapshots for redo */
    this.redoStack = [];
    /** Info from the last onExecuted call (preview filename, input hash, etc.) */
    this.editorInfo = null;
  }
}

function _getOrCreate(nodeId) {
  const k = _k(nodeId);
  if (!_registry.has(k)) _registry.set(k, new NodeEditorState());
  return _registry.get(k);
}

export function getCanvas(nodeId) {
  return _registry.get(_k(nodeId))?.fabricCanvas ?? null;
}

export function setCanvas(nodeId, canvas) {
  _getOrCreate(nodeId).fabricCanvas = canvas;
}

export function isDirty(nodeId) {
  return _registry.get(_k(nodeId))?.dirty ?? false;
}

export function setDirty(nodeId, value) {
  _getOrCreate(nodeId).dirty = value;
}

export function getEditorInfo(nodeId) {
  return _registry.get(_k(nodeId))?.editorInfo ?? null;
}

export function setEditorInfo(nodeId, info) {
  _getOrCreate(nodeId).editorInfo = info;
}

/**
 * Snapshot the current canvas JSON onto the undo stack.
 * Clears the redo stack (new action invalidates forward history).
 */
export function pushUndoSnapshot(nodeId, canvas) {
  const state = _getOrCreate(nodeId);
  const json = JSON.stringify(canvas.toJSON());
  state.undoStack.push(json);
  if (state.undoStack.length > HISTORY_MAX) {
    state.undoStack.shift();
  }
  state.redoStack = [];
}

/** Undo: restore previous snapshot. Returns true if successful. */
export function undo(nodeId, canvas, onDone) {
  const state = _registry.get(_k(nodeId));
  if (!state || state.undoStack.length === 0) return false;

  const current = JSON.stringify(canvas.toJSON());
  state.redoStack.push(current);

  const prev = state.undoStack.pop();
  canvas.loadFromJSON(prev, () => {
    canvas.renderAll();
    onDone?.();
  });
  return true;
}

/** Redo: restore next snapshot. Returns true if successful. */
export function redo(nodeId, canvas, onDone) {
  const state = _registry.get(_k(nodeId));
  if (!state || state.redoStack.length === 0) return false;

  const current = JSON.stringify(canvas.toJSON());
  state.undoStack.push(current);

  const next = state.redoStack.pop();
  canvas.loadFromJSON(next, () => {
    canvas.renderAll();
    onDone?.();
  });
  return true;
}

/** Remove state when a node is removed from the graph. */
export function removeNode(nodeId) {
  _registry.delete(nodeId);
}
