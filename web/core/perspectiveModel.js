import { commitState } from "./commitState.js";
import { setWidgetValue, getWidget } from "../utils/nodeUtils.js";
import { clamp } from "../utils/geometryUtils.js";

/**
 * Initialize perspective corners to the full preview rectangle.
 * Returns {tl, tr, br, bl} in preview-space coordinates.
 */
export function initCorners(preview) {
  return {
    tl: [0, 0],
    tr: [preview.width, 0],
    br: [preview.width, preview.height],
    bl: [0, preview.height],
  };
}

/**
 * Detect which corner handle (if any) the mouse is over.
 * Returns "tl" | "tr" | "br" | "bl" | null.
 * corners: {tl, tr, br, bl} in preview-space.
 * localPos: {x, y} in preview-space.
 */
export function getCornerHit(corners, localPos, handleSize = 8) {
  const tolerance = handleSize * 1.5;
  const names = ["tl", "tr", "br", "bl"];

  let best = null;
  let bestDist = Infinity;

  for (const name of names) {
    const [cx, cy] = corners[name];
    const dist = Math.sqrt(
      (localPos.x - cx) ** 2 + (localPos.y - cy) ** 2
    );
    if (dist <= tolerance && dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }

  return best;
}

/**
 * Clamp all corners to stay within the preview area.
 */
export function clampCorners(corners, preview) {
  const result = {};
  for (const name of ["tl", "tr", "br", "bl"]) {
    result[name] = [
      clamp(corners[name][0], 0, preview.width),
      clamp(corners[name][1], 0, preview.height),
    ];
  }
  return result;
}

/**
 * Convert preview-space corners → image-pixel widgets and sync them.
 */
export function updateWidgetsFromCorners(node, preview) {
  const corners = node.properties.perspCorners;
  if (!corners) return;

  const scaleX = node.properties.actualImageWidth / preview.width;
  const scaleY = node.properties.actualImageHeight / preview.height;

  const widgetMap = {
    tl_x: Math.round(corners.tl[0] * scaleX),
    tl_y: Math.round(corners.tl[1] * scaleY),
    tr_x: Math.round(corners.tr[0] * scaleX),
    tr_y: Math.round(corners.tr[1] * scaleY),
    br_x: Math.round(corners.br[0] * scaleX),
    br_y: Math.round(corners.br[1] * scaleY),
    bl_x: Math.round(corners.bl[0] * scaleX),
    bl_y: Math.round(corners.bl[1] * scaleY),
  };

  for (const [name, val] of Object.entries(widgetMap)) {
    setWidgetValue(node, name, val);
  }
}

/**
 * Convert image-pixel widget values → preview-space corners and apply to node.
 * Returns the corners object, or null if invalid.
 */
export function updateCornersFromWidgets(node, preview) {
  const iw = node.properties.actualImageWidth;
  const ih = node.properties.actualImageHeight;
  if (!iw || !ih || !preview.width || !preview.height) return null;

  const scaleX = preview.width / iw;
  const scaleY = preview.height / ih;

  function readWidget(name) {
    const w = getWidget(node, name);
    return w ? Number(w.value) : 0;
  }

  const corners = {
    tl: [readWidget("tl_x") * scaleX, readWidget("tl_y") * scaleY],
    tr: [readWidget("tr_x") * scaleX, readWidget("tr_y") * scaleY],
    br: [readWidget("br_x") * scaleX, readWidget("br_y") * scaleY],
    bl: [readWidget("bl_x") * scaleX, readWidget("bl_y") * scaleY],
  };

  node.properties.perspCorners = corners;
  return corners;
}

/**
 * Reset corners to the full image (full preview rectangle) and sync widgets.
 */
export function resetCorners(node, preview) {
  const corners = initCorners(preview);
  node.properties.perspCorners = corners;
  updateWidgetsFromCorners(node, preview);
  return corners;
}

/**
 * Compute the approximate output dimensions from the current corners.
 * Uses max of opposite edge lengths.
 */
export function computeOutputDimensions(corners, scaleX, scaleY) {
  const [tlx, tly] = [corners.tl[0] * scaleX, corners.tl[1] * scaleY];
  const [trx, try_] = [corners.tr[0] * scaleX, corners.tr[1] * scaleY];
  const [brx, bry] = [corners.br[0] * scaleX, corners.br[1] * scaleY];
  const [blx, bly] = [corners.bl[0] * scaleX, corners.bl[1] * scaleY];

  const topW    = Math.sqrt((trx - tlx) ** 2 + (try_ - tly) ** 2);
  const bottomW = Math.sqrt((brx - blx) ** 2 + (bry - bly) ** 2);
  const leftH   = Math.sqrt((blx - tlx) ** 2 + (bly - tly) ** 2);
  const rightH  = Math.sqrt((brx - trx) ** 2 + (bry - try_) ** 2);

  return {
    width:  Math.max(1, Math.round(Math.max(topW, bottomW))),
    height: Math.max(1, Math.round(Math.max(leftH, rightH))),
  };
}
