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

function getRotateLabel(node) {
  const rotateWidget = getWidget(node, "rotate");
  const value = rotateWidget?.value;
  const valid = ["None", "90° CW", "90° CCW", "180°"];
  return valid.includes(value) ? value : "None";
}

function getRotatedDimensions(iw, ih, rotate) {
  if (rotate === "90° CW" || rotate === "90° CCW") {
    return { width: ih, height: iw };
  }
  return { width: iw, height: ih };
}

function rotatePointUnrotToRot(x, y, iw, ih, rotate) {
  if (rotate === "90° CW") {
    return [ih - y, x];
  }
  if (rotate === "90° CCW") {
    return [y, iw - x];
  }
  if (rotate === "180°") {
    return [iw - x, ih - y];
  }
  return [x, y];
}

function rotatePointRotToUnrot(x, y, iw, ih, rotate) {
  if (rotate === "90° CW") {
    return [y, ih - x];
  }
  if (rotate === "90° CCW") {
    return [iw - y, x];
  }
  if (rotate === "180°") {
    return [iw - x, ih - y];
  }
  return [x, y];
}

export function getDisplayedImageAreaInPreview(node, preview) {
  const base = getImageAreaInPreview(node, preview);
  const iw = node.properties.actualImageWidth || 0;
  const ih = node.properties.actualImageHeight || 0;
  if (!iw || !ih || !base.width || !base.height) {
    return {
      x: base.x,
      y: base.y,
      width: base.width,
      height: base.height,
      rotate: "None",
      rotatedWidth: iw,
      rotatedHeight: ih,
    };
  }

  const rotate = getRotateLabel(node);
  const rotated = getRotatedDimensions(iw, ih, rotate);
  const scale = Math.min(base.width / rotated.width, base.height / rotated.height);
  const width = rotated.width * scale;
  const height = rotated.height * scale;
  const x = base.x + (base.width - width) / 2;
  const y = base.y + (base.height - height) / 2;

  return {
    x,
    y,
    width,
    height,
    rotate,
    rotatedWidth: rotated.width,
    rotatedHeight: rotated.height,
  };
}

function previewToImagePixel(node, preview, px, py) {
  const iw = node.properties.actualImageWidth || 0;
  const ih = node.properties.actualImageHeight || 0;
  if (!iw || !ih) return [0, 0];

  const area = getDisplayedImageAreaInPreview(node, preview);
  if (!area.width || !area.height || !area.rotatedWidth || !area.rotatedHeight) {
    return [0, 0];
  }

  const rx = ((px - area.x) * area.rotatedWidth) / area.width;
  const ry = ((py - area.y) * area.rotatedHeight) / area.height;
  return rotatePointRotToUnrot(rx, ry, iw, ih, area.rotate);
}

function imagePixelToPreview(node, preview, x, y) {
  const iw = node.properties.actualImageWidth || 0;
  const ih = node.properties.actualImageHeight || 0;
  if (!iw || !ih) return [0, 0];

  const area = getDisplayedImageAreaInPreview(node, preview);
  if (!area.width || !area.height || !area.rotatedWidth || !area.rotatedHeight) {
    return [0, 0];
  }

  const [rx, ry] = rotatePointUnrotToRot(x, y, iw, ih, area.rotate);
  const px = area.x + (rx * area.width) / area.rotatedWidth;
  const py = area.y + (ry * area.height) / area.rotatedHeight;
  return [px, py];
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
 * Stores coordinates in ROTATED space (the coordinate system the user sees).
 * Corners outside the image area (in the extended canvas) produce negative
 * or > image-size pixel values, which is intentional.
 */
export function updateWidgetsFromCorners(node, preview) {
  const corners = node.properties.perspCorners;
  if (!corners) return;

  const iw = node.properties.actualImageWidth || 0;
  const ih = node.properties.actualImageHeight || 0;
  if (!iw || !ih) return;

  const area = getDisplayedImageAreaInPreview(node, preview);
  if (!area.width || !area.height || !area.rotatedWidth || !area.rotatedHeight) return;

  // Convert preview coords to rotated image pixel coords (NOT source coords)
  function previewToRotatedPixel(px, py) {
    const rx = ((px - area.x) * area.rotatedWidth) / area.width;
    const ry = ((py - area.y) * area.rotatedHeight) / area.height;
    return [rx, ry];
  }

  const [tlx, tly] = previewToRotatedPixel(corners.tl[0], corners.tl[1]);
  const [trx, try_] = previewToRotatedPixel(corners.tr[0], corners.tr[1]);
  const [brx, bry] = previewToRotatedPixel(corners.br[0], corners.br[1]);
  const [blx, bly] = previewToRotatedPixel(corners.bl[0], corners.bl[1]);

  const widgetMap = {
    tl_x: Math.round(tlx),
    tl_y: Math.round(tly),
    tr_x: Math.round(trx),
    tr_y: Math.round(try_),
    br_x: Math.round(brx),
    br_y: Math.round(bry),
    bl_x: Math.round(blx),
    bl_y: Math.round(bly),
  };

  for (const [name, val] of Object.entries(widgetMap)) {
    setWidgetValue(node, name, val);
  }
}

/**
 * Convert image-pixel widget values → preview-space corners and apply to node.
 * Widgets store coordinates in ROTATED space (the coordinate system the user sees).
 * Returns the corners object, or null if invalid.
 */
export function updateCornersFromWidgets(node, preview) {
  const iw = node.properties.actualImageWidth;
  const ih = node.properties.actualImageHeight;
  if (!iw || !ih || !preview.width || !preview.height) return null;

  const area = getDisplayedImageAreaInPreview(node, preview);
  if (!area.width || !area.height || !area.rotatedWidth || !area.rotatedHeight) return null;

  function readWidget(name) {
    const w = getWidget(node, name);
    return w ? Number(w.value) : 0;
  }

  // Convert rotated pixel coords to preview coords
  function rotatedPixelToPreview(rx, ry) {
    const px = area.x + (rx * area.width) / area.rotatedWidth;
    const py = area.y + (ry * area.height) / area.rotatedHeight;
    return [px, py];
  }

  const [tlx, tly] = rotatedPixelToPreview(readWidget("tl_x"), readWidget("tl_y"));
  const [trx, try_] = rotatedPixelToPreview(readWidget("tr_x"), readWidget("tr_y"));
  const [brx, bry] = rotatedPixelToPreview(readWidget("br_x"), readWidget("br_y"));
  const [blx, bly] = rotatedPixelToPreview(readWidget("bl_x"), readWidget("bl_y"));

  const corners = {
    tl: [tlx, tly],
    tr: [trx, try_],
    br: [brx, bry],
    bl: [blx, bly],
  };

  node.properties.perspCorners = corners;
  return corners;
}

/**
 * Reset corners to the image boundaries (accounting for canvas extend) and sync widgets.
 * Also resets all bow values to 0 (straight edges).
 */
export function resetCorners(node, preview) {
  const displayedArea = getDisplayedImageAreaInPreview(node, preview);
  const corners = initCorners(preview, displayedArea);
  node.properties.perspCorners = corners;
  node.properties.perspBows = initBows();
  updateWidgetsFromCorners(node, preview);
  updateWidgetsFromBows(node);
  return corners;
}

// ---------------------------------------------------------------------------
// Bow (curved edge) support
// ---------------------------------------------------------------------------

/** Default bow state: all edges straight. Each value is [bow_x, bow_y] offset in image pixels. */
export function initBows() {
  return { top: [0, 0], right: [0, 0], bottom: [0, 0], left: [0, 0] };
}

/**
 * Internal: compute the bezier control point for one edge in image-pixel space.
 * Control point = edge midpoint + free 2D offset (bowX, bowY).
 */
function _computeCtrlPtPx(p1px, p2px, bowX, bowY) {
  const mx = (p1px[0] + p2px[0]) / 2;
  const my = (p1px[1] + p2px[1]) / 2;
  return [mx + bowX, my + bowY];
}

/**
 * Compute the 4 bow handle positions in preview-local space.
 * Works in rotated image coordinate space.
 * Returns {top, right, bottom, left} each as [x, y] in preview-local coords,
 * or null if data is missing.
 */
export function getBowHandlePositions(node, preview, corners, bows) {
  if (!corners || !bows) return null;

  const iw = node.properties.actualImageWidth || 0;
  const ih = node.properties.actualImageHeight || 0;
  if (!iw || !ih) return null;

  const area = getDisplayedImageAreaInPreview(node, preview);
  if (!area.width || !area.height || !area.rotatedWidth || !area.rotatedHeight) return null;

  // Convert preview coords to rotated pixel coords
  function previewToRotatedPixel(px, py) {
    const rx = ((px - area.x) * area.rotatedWidth) / area.width;
    const ry = ((py - area.y) * area.rotatedHeight) / area.height;
    return [rx, ry];
  }

  // Convert rotated pixel coords to preview coords
  function rotatedPixelToPreview(rx, ry) {
    const px = area.x + (rx * area.width) / area.rotatedWidth;
    const py = area.y + (ry * area.height) / area.rotatedHeight;
    return [px, py];
  }

  const tlPx = previewToRotatedPixel(corners.tl[0], corners.tl[1]);
  const trPx = previewToRotatedPixel(corners.tr[0], corners.tr[1]);
  const brPx = previewToRotatedPixel(corners.br[0], corners.br[1]);
  const blPx = previewToRotatedPixel(corners.bl[0], corners.bl[1]);

  const topCtrl = _computeCtrlPtPx(tlPx, trPx, bows.top[0], bows.top[1]);
  const rightCtrl = _computeCtrlPtPx(trPx, brPx, bows.right[0], bows.right[1]);
  const bottomCtrl = _computeCtrlPtPx(blPx, brPx, bows.bottom[0], bows.bottom[1]);
  const leftCtrl = _computeCtrlPtPx(tlPx, blPx, bows.left[0], bows.left[1]);

  return {
    top: rotatedPixelToPreview(topCtrl[0], topCtrl[1]),
    right: rotatedPixelToPreview(rightCtrl[0], rightCtrl[1]),
    bottom: rotatedPixelToPreview(bottomCtrl[0], bottomCtrl[1]),
    left: rotatedPixelToPreview(leftCtrl[0], leftCtrl[1]),
  };
}

/**
 * Hit-test bow handles. Returns "top"|"right"|"bottom"|"left"|null.
 * localPos: {x,y} in preview-local coords.
 */
export function getBowHandleHit(node, preview, corners, bows, localPos, handleSize = 10) {
  const positions = getBowHandlePositions(node, preview, corners, bows);
  if (!positions) return null;

  const tolerance = handleSize * 1.5;
  let best = null;
  let bestDist = Infinity;

  for (const name of ['top', 'right', 'bottom', 'left']) {
    const [hx, hy] = positions[name];
    const dist = Math.sqrt((localPos.x - hx) ** 2 + (localPos.y - hy) ** 2);
    if (dist <= tolerance && dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }

  return best;
}

/** Write bow [x,y] values to the 8 hidden bow widgets. */
export function updateWidgetsFromBows(node) {
  const bows = node.properties.perspBows;
  if (!bows) return;
  setWidgetValue(node, 'top_bow_x',    bows.top[0]);
  setWidgetValue(node, 'top_bow_y',    bows.top[1]);
  setWidgetValue(node, 'right_bow_x',  bows.right[0]);
  setWidgetValue(node, 'right_bow_y',  bows.right[1]);
  setWidgetValue(node, 'bottom_bow_x', bows.bottom[0]);
  setWidgetValue(node, 'bottom_bow_y', bows.bottom[1]);
  setWidgetValue(node, 'left_bow_x',   bows.left[0]);
  setWidgetValue(node, 'left_bow_y',   bows.left[1]);
}

/** Read bow widget values into node.properties.perspBows as {edge: [x,y]}. */
export function updateBowsFromWidgets(node) {
  function readWidget(name) {
    const w = getWidget(node, name);
    return w ? Number(w.value) : 0;
  }
  node.properties.perspBows = {
    top:    [readWidget('top_bow_x'),    readWidget('top_bow_y')],
    right:  [readWidget('right_bow_x'),  readWidget('right_bow_y')],
    bottom: [readWidget('bottom_bow_x'), readWidget('bottom_bow_y')],
    left:   [readWidget('left_bow_x'),   readWidget('left_bow_y')],
  };
}

/**
 * Update node.properties.perspBows[edgeName] based on where the user dragged.
 * Stores the full 2D offset [bow_x, bow_y] from the edge midpoint in rotated image-pixel space,
 * allowing free dragging in any direction (not constrained to perpendicular).
 * localPos: {x,y} in preview-local coords.
 */
export function applyBowDrag(node, preview, edgeName, localPos, corners) {
  const iw = node.properties.actualImageWidth || 0;
  const ih = node.properties.actualImageHeight || 0;
  if (!iw || !ih) return;

  const area = getDisplayedImageAreaInPreview(node, preview);
  if (!area.width || !area.height || !area.rotatedWidth || !area.rotatedHeight) return;

  // Convert preview coords to rotated pixel coords
  function previewToRotatedPixel(px, py) {
    const rx = ((px - area.x) * area.rotatedWidth) / area.width;
    const ry = ((py - area.y) * area.rotatedHeight) / area.height;
    return [rx, ry];
  }

  const tlPx = previewToRotatedPixel(corners.tl[0], corners.tl[1]);
  const trPx = previewToRotatedPixel(corners.tr[0], corners.tr[1]);
  const brPx = previewToRotatedPixel(corners.br[0], corners.br[1]);
  const blPx = previewToRotatedPixel(corners.bl[0], corners.bl[1]);

  const edgeMap = {
    top:    [tlPx, trPx],
    right:  [trPx, brPx],
    bottom: [blPx, brPx],
    left:   [tlPx, blPx],
  };

  const [p1, p2] = edgeMap[edgeName];
  const mx = (p1[0] + p2[0]) / 2;
  const my = (p1[1] + p2[1]) / 2;

  // Convert drag position to rotated image-pixel space and store full 2D offset from midpoint
  const dragPx = previewToRotatedPixel(localPos.x, localPos.y);
  const bowX = Math.round(dragPx[0] - mx);
  const bowY = Math.round(dragPx[1] - my);

  if (!node.properties.perspBows) node.properties.perspBows = initBows();
  node.properties.perspBows[edgeName] = [bowX, bowY];
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
