import { ColorUtils } from "../utils/colorUtils.js";
import { GRAPHICS, TEXT, LAYOUT } from "../constants.js";
import { getImageAreaInPreview, getBowHandlePositions } from "./perspectiveModel.js";

/**
 * Draw the perspective quad overlay:
 * - Darken area outside the quad (using bezier-curved edges when bow handles are active)
 * - Draw the quad outline (curved when bows are non-zero)
 * - Draw corner handles (squares) and bow handles (diamonds at edge midpoints)
 * - Optionally show output dimensions inside
 *
 * corners: {tl, tr, br, bl} in preview-local coords (relative to preview origin)
 * bows: {top, right, bottom, left} bow values in image pixels
 * bowHandlePositions: {top, right, bottom, left} in preview-local coords, or null
 * activeBow: currently dragging/hovering bow edge name, or null
 * previewArea: {x, y, width, height} in canvas space
 */
export function drawPerspectiveQuad(
  ctx,
  corners,
  bows,
  bowHandlePositions,
  activeBow,
  box_color,
  infoDisplayEnabled,
  previewArea
) {
  if (!corners) return;

  const px = previewArea.x;
  const py = previewArea.y;

  // Corners in canvas space
  const tl = [corners.tl[0] + px, corners.tl[1] + py];
  const tr = [corners.tr[0] + px, corners.tr[1] + py];
  const br = [corners.br[0] + px, corners.br[1] + py];
  const bl = [corners.bl[0] + px, corners.bl[1] + py];

  // Bow control points in canvas space (fallback to straight-line midpoints when null)
  const bp = bowHandlePositions;
  const bowCanvas = {
    top:    bp ? [bp.top[0]    + px, bp.top[1]    + py] : [(tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2],
    right:  bp ? [bp.right[0]  + px, bp.right[1]  + py] : [(tr[0] + br[0]) / 2, (tr[1] + br[1]) / 2],
    bottom: bp ? [bp.bottom[0] + px, bp.bottom[1] + py] : [(br[0] + bl[0]) / 2, (br[1] + bl[1]) / 2],
    left:   bp ? [bp.left[0]   + px, bp.left[1]   + py] : [(bl[0] + tl[0]) / 2, (bl[1] + tl[1]) / 2],
  };

  ctx.save();

  // --- Darken outside the quad (evenodd fill trick) ---
  ctx.fillStyle = GRAPHICS.croppedDarken;
  ctx.beginPath();
  ctx.rect(previewArea.x, previewArea.y, previewArea.width, previewArea.height);
  // Inner quad using bezier curves (evenodd punches a hole regardless of winding)
  ctx.moveTo(tl[0], tl[1]);
  ctx.quadraticCurveTo(bowCanvas.top[0],    bowCanvas.top[1],    tr[0], tr[1]);
  ctx.quadraticCurveTo(bowCanvas.right[0],  bowCanvas.right[1],  br[0], br[1]);
  ctx.quadraticCurveTo(bowCanvas.bottom[0], bowCanvas.bottom[1], bl[0], bl[1]);
  ctx.quadraticCurveTo(bowCanvas.left[0],   bowCanvas.left[1],   tl[0], tl[1]);
  ctx.closePath();
  ctx.fill("evenodd");

  // --- Draw quad outline ---
  ctx.strokeStyle = box_color;
  ctx.lineWidth = GRAPHICS.cropLineWidth;
  ctx.beginPath();
  ctx.moveTo(tl[0], tl[1]);
  ctx.quadraticCurveTo(bowCanvas.top[0],    bowCanvas.top[1],    tr[0], tr[1]);
  ctx.quadraticCurveTo(bowCanvas.right[0],  bowCanvas.right[1],  br[0], br[1]);
  ctx.quadraticCurveTo(bowCanvas.bottom[0], bowCanvas.bottom[1], bl[0], bl[1]);
  ctx.quadraticCurveTo(bowCanvas.left[0],   bowCanvas.left[1],   tl[0], tl[1]);
  ctx.closePath();
  ctx.stroke();

  // --- Draw corner handles (transparent squares with center dot) ---
  const handleSize = GRAPHICS.handleSize + 2;
  const half = handleSize / 2;
  const cornerDotR = 1;

  ctx.strokeStyle = box_color;
  ctx.lineWidth = GRAPHICS.handleLineWidth;

  for (const [hx, hy] of [tl, tr, br, bl]) {
    // Transparent square outline
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.beginPath();
    ctx.rect(hx - half, hy - half, handleSize, handleSize);
    ctx.fill();
    ctx.stroke();
    // Small center dot (25% alpha)
    ctx.fillStyle = box_color + "40";
    ctx.beginPath();
    ctx.arc(hx, hy, cornerDotR, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Draw bow handles (diamonds at each edge midpoint) ---
  const dotR = 3;
  const diamondHalf = handleSize * 0.8;
  const bowEdges = ['top', 'right', 'bottom', 'left'];
  const hasBows = bows && bowEdges.some((e) => {
    const b = bows[e];
    return Math.abs(b[0]) > 0.5 || Math.abs(b[1]) > 0.5;
  });

  ctx.fillStyle   = ColorUtils.darken(box_color, GRAPHICS.darkenFactor);
  ctx.strokeStyle = box_color;
  ctx.lineWidth   = GRAPHICS.handleLineWidth;

  for (const edge of bowEdges) {
    const [hx, hy] = bowCanvas[edge];
    const bowActive = activeBow === edge;
    const b = bows?.[edge];
    const bowNonZero = b && (Math.abs(b[0]) > 0.5 || Math.abs(b[1]) > 0.5);

    if (bowNonZero || bowActive || hasBows) {
      // Full diamond handle
      ctx.beginPath();
      ctx.moveTo(hx,              hy - diamondHalf);
      ctx.lineTo(hx + diamondHalf, hy);
      ctx.lineTo(hx,              hy + diamondHalf);
      ctx.lineTo(hx - diamondHalf, hy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      // Subtle dot hinting the handle exists
      ctx.beginPath();
      ctx.arc(hx, hy, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // --- Info text inside quad ---
  if (infoDisplayEnabled) {
    const centroidX = (tl[0] + tr[0] + br[0] + bl[0]) / 4;
    const centroidY = (tl[1] + tr[1] + br[1] + bl[1]) / 4;

    ctx.fillStyle = box_color;
    ctx.font = TEXT.cropBoxFont;
    ctx.textAlign = "center";
    ctx.fillText("Perspective", centroidX, centroidY - 6);
    ctx.fillText("Correction", centroidX, centroidY + 8);
  }

  ctx.restore();
}

/**
 * Draw source info text above the preview (source dimensions, output estimate).
 */
function drawPerspInfo(ctx, node, nodeCtx, offsetY) {
  const baseline = offsetY + LAYOUT.CROPINFO_OFFSET;
  const lineGap = 14;

  ctx.save();
  ctx.fillStyle = GRAPHICS.colorDim;
  ctx.font = TEXT.fontSmall;
  ctx.textAlign = "left";

  const srcW = nodeCtx.actualImageWidth || 0;
  const srcH = nodeCtx.actualImageHeight || 0;

  ctx.fillText(`Source: ${srcW}×${srcH}`, 20, baseline);

  if (nodeCtx.outWidth && nodeCtx.outHeight) {
    ctx.fillText(
      `Output (est.): ${nodeCtx.outWidth}×${nodeCtx.outHeight} px`,
      20,
      baseline + lineGap
    );
  } else {
    ctx.fillText("Output: run graph to compute", 20, baseline + lineGap);
  }

  ctx.restore();
}

function drawPreviewBorder(ctx, node, preview) {
  const imgArea = getImageAreaInPreview(node, preview);
  ctx.save();
  ctx.strokeStyle = GRAPHICS.border;
  ctx.lineWidth = GRAPHICS.borderLineWidth;
  // Outer border (full preview including extended canvas)
  ctx.strokeRect(preview.x, preview.y, preview.width, preview.height);
  // If canvas is extended, draw a dashed inner border around the actual image
  if (imgArea.x > 0 || imgArea.y > 0) {
    ctx.strokeStyle = "#444";
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(
      preview.x + imgArea.x, preview.y + imgArea.y,
      imgArea.width, imgArea.height
    );
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawSource(ctx, node, preview, rotationDeg = 0) {
  const imgArea = getImageAreaInPreview(node, preview);
  const hasExtend = imgArea.x > 0 || imgArea.y > 0;

  ctx.save();

  // Fill the full preview with the extended canvas background
  if (hasExtend) {
    ctx.fillStyle = "#1c1c1c";
    ctx.fillRect(preview.x, preview.y, preview.width, preview.height);
  }

  if (node.imageLoaded) {
    const cx = preview.x + imgArea.x + imgArea.width / 2;
    const cy = preview.y + imgArea.y + imgArea.height / 2;
    const swap = rotationDeg === 90 || rotationDeg === 270;
    const natW = node.image.naturalWidth  || imgArea.width;
    const natH = node.image.naturalHeight || imgArea.height;
    // After rotation, the image's effective footprint is (natH × natW) for 90°/270°.
    // Compute a uniform scale so the rotated image fits within imgArea.
    const fitW = swap ? natH : natW;
    const fitH = swap ? natW : natH;
    const s = Math.min(imgArea.width / fitW, imgArea.height / fitH);
    const dw = natW * s;
    const dh = natH * s;
    ctx.translate(cx, cy);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.drawImage(node.image, -dw / 2, -dh / 2, dw, dh);
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform before restore
  } else {
    ctx.fillStyle = GRAPHICS.colorDimFill;
    ctx.fillRect(preview.x + imgArea.x, preview.y + imgArea.y, imgArea.width, imgArea.height);
    ctx.fillStyle = TEXT.colorDimText;
    ctx.font = TEXT.fontMessage;
    ctx.textAlign = "center";
    ctx.fillText(
      "Out of sync, run Graph to get preview",
      preview.x + preview.width / 2,
      preview.y + preview.height / 2 - 20
    );
    ctx.fillText(
      "Corner positions reset on sync, so refresh first!",
      preview.x + preview.width / 2,
      preview.y + preview.height / 2 + 40
    );
  }

  ctx.restore();
}

function drawInstruction(ctx, node) {
  ctx.save();
  ctx.fillStyle = TEXT.colorFontSmall;
  ctx.font = TEXT.fontSmall;
  ctx.textAlign = "center";
  ctx.fillText(
    "Drag corners to set perspective. Drag edge handles to curve.",
    node.size[0] / 2,
    node.size[1] - 10
  );
  ctx.restore();
}

/**
 * Top-level foreground render function for the perspective node.
 * Mirrors handleDrawForeground from render.js.
 */
export function handleDrawForegroundPersp(node, ctx, widgetHeight, preview) {
  const nodeCtx = {
    actualImageWidth:  node.properties.actualImageWidth,
    actualImageHeight: node.properties.actualImageHeight,
    outWidth:  node.properties.lastOutWidth  || null,
    outHeight: node.properties.lastOutHeight || null,
  };

  const rotateWidget = node.widgets?.find((w) => w.name === "rotate");
  const rotateMap = { "None": 0, "90° CW": 90, "90° CCW": 270, "180°": 180 };
  const rotationDeg = rotateMap[rotateWidget?.value] ?? 0;

  drawSource(ctx, node, preview, rotationDeg);
  drawPreviewBorder(ctx, node, preview);
  drawPerspInfo(ctx, node, nodeCtx, widgetHeight);

  if (node.properties.perspCorners) {
    const bows = node.properties.perspBows || { top: 0, right: 0, bottom: 0, left: 0 };
    const bowHandlePositions = getBowHandlePositions(
      node,
      preview,
      node.properties.perspCorners,
      bows
    );
    const activeBow = node.draggingBow || node.hoveringBow || null;

    drawPerspectiveQuad(
      ctx,
      node.properties.perspCorners,
      bows,
      bowHandlePositions,
      activeBow,
      node.properties.box_color,
      node.properties.infoDisplayEnabled,
      preview
    );
  }

  drawInstruction(ctx, node);
}
