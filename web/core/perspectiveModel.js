import { commitState } from "./commitState.js";
import { setWidgetValue, getWidget } from "../utils/nodeUtils.js";
import { clamp } from "../utils/geometryUtils.js";
import { CANVAS_EXTEND_MAP } from "../constants.js";

/**
 * Return the sub-area of the preview where the actual image is drawn.
 * When canvasExtend = 0, this equals the full preview.
 * When canvasExtend > 0 (e.g. 0.5), the image is drawn in the center with
 * 50% of the image width added as padding on each side.
 *
 * The returned {x, y, width, height} are in preview-local coordinates
 * (i.e. relative to preview.x / preview.y, NOT absolute canvas coords).
 */
export function getImageAreaInPreview(node, preview) {
  const extendLabel = node.properties.canvasExtendLabel || "None";
  const extend = CANVAS_EXTEND_MAP[extendLabel] ?? 0;
  if (extend === 0) {
    return { x: 0, y: 0, width: preview.width, height: preview.height };
  }
  const scale = 1 / (1 + 2 * extend);
  const w = preview.width * scale;
  const h = preview.height * scale;
  const x = (preview.width - w) / 2;
  const y = (preview.height - h) / 2;
  return { x, y, width: w, height: h };
}

/**
 * Initialize perspective corners to the image rectangle (accounting for canvas extend).
 * Returns {tl, tr, br, bl} in preview-space coordinates.
 */
export function initCorners(preview, imgArea) {
  const area = imgArea || { x: 0, y: 0, width: preview.width, height: preview.height };
  return {
    tl: [area.x, area.y],
    tr: [area.x + area.width, area.y],
    br: [area.x + area.width, area.y + area.height],
    bl: [area.x, area.y + area.height],
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
 * Clamp all corners to stay within the full preview area (including extended canvas).
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
 * Corners outside the image area (in the extended canvas) produce negative
 * or > image-size pixel values, which is intentional.
 */
export function updateWidgetsFromCorners(node, preview) {
  const corners = node.properties.perspCorners;
  if (!corners) return;

  const imgArea = getImageAreaInPreview(node, preview);
  const scaleX = node.properties.actualImageWidth / imgArea.width;
  const scaleY = node.properties.actualImageHeight / imgArea.height;

  const widgetMap = {
    tl_x: Math.round((corners.tl[0] - imgArea.x) * scaleX),
    tl_y: Math.round((corners.tl[1] - imgArea.y) * scaleY),
    tr_x: Math.round((corners.tr[0] - imgArea.x) * scaleX),
    tr_y: Math.round((corners.tr[1] - imgArea.y) * scaleY),
    br_x: Math.round((corners.br[0] - imgArea.x) * scaleX),
    br_y: Math.round((corners.br[1] - imgArea.y) * scaleY),
    bl_x: Math.round((corners.bl[0] - imgArea.x) * scaleX),
    bl_y: Math.round((corners.bl[1] - imgArea.y) * scaleY),
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

  const imgArea = getImageAreaInPreview(node, preview);
  const scaleX = imgArea.width / iw;
  const scaleY = imgArea.height / ih;

  function readWidget(name) {
    const w = getWidget(node, name);
    return w ? Number(w.value) : 0;
  }

  const corners = {
    tl: [readWidget("tl_x") * scaleX + imgArea.x, readWidget("tl_y") * scaleY + imgArea.y],
    tr: [readWidget("tr_x") * scaleX + imgArea.x, readWidget("tr_y") * scaleY + imgArea.y],
    br: [readWidget("br_x") * scaleX + imgArea.x, readWidget("br_y") * scaleY + imgArea.y],
    bl: [readWidget("bl_x") * scaleX + imgArea.x, readWidget("bl_y") * scaleY + imgArea.y],
  };

  node.properties.perspCorners = corners;
  return corners;
}

/**
 * Reset corners to the image boundaries (accounting for canvas extend) and sync widgets.
 */
export function resetCorners(node, preview) {
  const imgArea = getImageAreaInPreview(node, preview);
  const corners = initCorners(preview, imgArea);
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
