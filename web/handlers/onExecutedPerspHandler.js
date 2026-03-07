import { app } from "../../../scripts/app.js";
import { commitState } from "../core/commitState.js";
import { getPreviewAreaCached, computeNodeSize } from "../ui/nodeLayout.js";
import { getWidget } from "../utils/nodeUtils.js";
import {
  resetCorners,
  updateCornersFromWidgets,
  updateWidgetsFromCorners,
} from "../core/perspectiveModel.js";

export function handleOnExecutedPersp(node, message) {
  const backendData = message?.persp_info?.[0] || null;
  const shouldReset = backendData?.reset_quad_ui || false;

  const imageInfo = message?.images_custom?.[0];
  if (!imageInfo) {
    node.image.src = "";
    node.properties.actualImageWidth = 0;
    node.properties.actualImageHeight = 0;
    node.setDirtyCanvas(true);
    return;
  }

  const imageUrl = app.api.apiURL(
    `/view?filename=${imageInfo.filename}&type=${imageInfo.type}&subfolder=${imageInfo.subfolder}&rand=${Date.now()}`
  );

  node.image.onload = () => {
    node.imageLoaded = true;
    const newWidth  = node.image.naturalWidth;
    const newHeight = node.image.naturalHeight;

    const resolutionId      = `${newWidth}x${newHeight}`;
    const lastResolution    = node.properties.lastResolution || null;
    const resolutionChanged = lastResolution !== resolutionId;

    node.properties.actualImageWidth  = newWidth;
    node.properties.actualImageHeight = newHeight;
    node.properties.lastResolution    = resolutionId;

    const last_width_widget = getWidget(node, "last_width");
    if (last_width_widget) last_width_widget.value = newWidth;

    const last_height_widget = getWidget(node, "last_height");
    if (last_height_widget) last_height_widget.value = newHeight;

    if (resolutionChanged || shouldReset) {
      if (node.onResize) node.onResize(node.size);

      const newSize = node.computeSize();
      if (newSize && newSize[0] > 0 && newSize[1] > 0) {
        node.size = newSize;
      }
    }

    node._previewAreaCache = null;
    const preview = getPreviewAreaCached(node);

    if (shouldReset || resolutionChanged) {
      resetCorners(node, preview);
    } else if (backendData) {
      // Restore corners from backend pixel values
      const w = newWidth;
      const h = newHeight;
      const sx = preview.width  / w;
      const sy = preview.height / h;

      node.properties.perspCorners = {
        tl: [backendData.tl[0] * sx, backendData.tl[1] * sy],
        tr: [backendData.tr[0] * sx, backendData.tr[1] * sy],
        br: [backendData.br[0] * sx, backendData.br[1] * sy],
        bl: [backendData.bl[0] * sx, backendData.bl[1] * sy],
      };
      updateWidgetsFromCorners(node, preview);
    }

    // Cache the computed output size for display in the info panel
    if (backendData?.out_width) {
      node.properties.lastOutWidth  = backendData.out_width;
      node.properties.lastOutHeight = backendData.out_height;
    }

    commitState(node);
    node.setDirtyCanvas(true);
  };

  node.image.onerror = () => {
    node.imageLoaded = false;
    console.warn("[OlmDragPerspective] Preview image failed to load");
  };

  node.image.src = imageUrl;
  node.setDirtyCanvas(true);
}
