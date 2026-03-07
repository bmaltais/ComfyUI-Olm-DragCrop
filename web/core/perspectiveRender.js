import { ColorUtils } from "../utils/colorUtils.js";
import { GRAPHICS, TEXT, TEXTCONTENT, LAYOUT } from "../constants.js";
import { computeOutputDimensions, getImageAreaInPreview } from "./perspectiveModel.js";

/**
 * Draw the perspective quad overlay:
 * - Darken area outside the quad
 * - Draw the quad outline
 * - Draw a corner handle at each of the 4 corners
 * - Optionally show output dimensions inside
 *
 * corners: {tl, tr, br, bl} in preview-space coords (relative to preview origin)
 * previewArea: {x, y, width, height} in canvas space
 */
export function drawPerspectiveQuad(
  ctx,
  corners,
  box_color,
  infoDisplayEnabled,
  previewArea
) {
  if (!corners) return;

  // Translate corners from preview-local to canvas space
  const px = previewArea.x;
  const py = previewArea.y;

  const tl = [corners.tl[0] + px, corners.tl[1] + py];
  const tr = [corners.tr[0] + px, corners.tr[1] + py];
  const br = [corners.br[0] + px, corners.br[1] + py];
  const bl = [corners.bl[0] + px, corners.bl[1] + py];

  ctx.save();

  // --- Darken outside the quad (evenodd fill trick) ---
  // The outer rect covers the full preview including the extended canvas area.
  ctx.fillStyle = GRAPHICS.croppedDarken;
  ctx.beginPath();
  ctx.rect(previewArea.x, previewArea.y, previewArea.width, previewArea.height);
  // Inner quad (counter-clockwise so evenodd punches a hole)
  ctx.moveTo(tl[0], tl[1]);
  ctx.lineTo(tr[0], tr[1]);
  ctx.lineTo(br[0], br[1]);
  ctx.lineTo(bl[0], bl[1]);
  ctx.closePath();
  ctx.fill("evenodd");

  // --- Draw quad outline ---
  ctx.strokeStyle = box_color;
  ctx.lineWidth = GRAPHICS.cropLineWidth;
  ctx.beginPath();
  ctx.moveTo(tl[0], tl[1]);
  ctx.lineTo(tr[0], tr[1]);
  ctx.lineTo(br[0], br[1]);
  ctx.lineTo(bl[0], bl[1]);
  ctx.closePath();
  ctx.stroke();

  // --- Draw corner handles ---
  const handleSize = GRAPHICS.handleSize + 2; // slightly bigger than crop handles
  const half = handleSize / 2;
  const cornerPts = [tl, tr, br, bl];

  ctx.fillStyle = ColorUtils.darken(box_color, GRAPHICS.darkenFactor);
  ctx.strokeStyle = box_color;
  ctx.lineWidth = GRAPHICS.handleLineWidth;

  for (const [hx, hy] of cornerPts) {
    ctx.beginPath();
    ctx.rect(hx - half, hy - half, handleSize, handleSize);
    ctx.fill();
    ctx.stroke();
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

function drawSource(ctx, node, preview) {
  const imgArea = getImageAreaInPreview(node, preview);
  const hasExtend = imgArea.x > 0 || imgArea.y > 0;

  ctx.save();

  // Fill the full preview with the extended canvas background
  if (hasExtend) {
    ctx.fillStyle = "#1c1c1c";
    ctx.fillRect(preview.x, preview.y, preview.width, preview.height);
  }

  if (node.imageLoaded) {
    ctx.drawImage(
      node.image,
      preview.x + imgArea.x, preview.y + imgArea.y,
      imgArea.width, imgArea.height
    );
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
    "Drag the corners to set the perspective region.",
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

  drawSource(ctx, node, preview);
  drawPreviewBorder(ctx, node, preview);
  drawPerspInfo(ctx, node, nodeCtx, widgetHeight);

  if (node.properties.perspCorners) {
    drawPerspectiveQuad(
      ctx,
      node.properties.perspCorners,
      node.properties.box_color,
      node.properties.infoDisplayEnabled,
      preview
    );
  }

  drawInstruction(ctx, node);
}
