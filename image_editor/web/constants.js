/** Constants for the OlmImageEditor frontend. */

export const DEFAULT_CANVAS_WIDTH = 512;
export const DEFAULT_CANVAS_HEIGHT = 512;

/** Maximum undo/redo steps stored per node. */
export const HISTORY_MAX = 20;

/** Blend modes available in the layers panel (Phase 1). */
export const BLEND_MODES = [
  { label: "Normal", value: "source-over" },
  { label: "Multiply", value: "multiply" },
  { label: "Screen", value: "screen" },
];

/** Extension ID used when registering with ComfyUI. */
export const EXTENSION_NAME = "olm.imageeditor";

/** ComfyUI node class name (must match Python class key in NODE_CLASS_MAPPINGS). */
export const NODE_CLASS = "OlmImageEditor";

/** Key used when registering this extension's web directory. */
export const WEB_KEY = "ComfyUI-Olm-DragCrop-ImageEditor";
