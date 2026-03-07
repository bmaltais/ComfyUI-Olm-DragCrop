import { app } from "../../../scripts/app.js";
import { commitState } from "../core/commitState.js";
import { getPreviewAreaCached, computeNodeSize } from "../ui/nodeLayout.js";
import { getWidget, setWidgetValue } from "../utils/nodeUtils.js";
import {
  resetCorners,
  updateCornersFromWidgets,
  updateWidgetsFromCorners,
  updateWidgetsFromBows,
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

    // Track image identifier to detect new image inputs
    const imageId = `${imageInfo.filename}|${imageInfo.subfolder || ""}|${imageInfo.type}`;
    const lastImageId = node.properties.lastImageId || null;
    const imageChanged = lastImageId !== imageId;

    const inputHash = backendData?.input_hash || "";
    const lastInputHash = node.properties.lastInputHash || "";
    const hashChanged = !!inputHash && inputHash !== lastInputHash;

    node.properties.actualImageWidth  = newWidth;
    node.properties.actualImageHeight = newHeight;
    node.properties.lastResolution    = resolutionId;
    node.properties.lastImageId = imageId;
    node.properties.lastInputHash = inputHash;

    const last_width_widget = getWidget(node, "last_width");
    if (last_width_widget) last_width_widget.value = newWidth;

    const last_height_widget = getWidget(node, "last_height");
    if (last_height_widget) last_height_widget.value = newHeight;

    if (resolutionChanged || shouldReset || imageChanged || hashChanged) {
      if (node.onResize) node.onResize(node.size);

      const newSize = node.computeSize();
      if (newSize && newSize[0] > 0 && newSize[1] > 0) {
        node.size = newSize;
      }
    }

    node._previewAreaCache = null;
    const preview = getPreviewAreaCached(node);

    if (shouldReset || resolutionChanged || imageChanged || hashChanged) {
      // Reset transform settings (canvas extend and rotation) on new image
      node.properties.canvasExtendLabel = "None";
      const extendWidget = getWidget(node, "Canvas Extend");
      if (extendWidget) extendWidget.value = "None";
      const rotateWidget = getWidget(node, "rotate");
      if (rotateWidget) rotateWidget.value = "None";
      
      resetCorners(node, preview);
    } else if (backendData) {
      // Restore source-space corner widgets, then map to preview using
      // rotation-aware conversion in updateCornersFromWidgets.
      setWidgetValue(node, "tl_x", backendData.tl[0]);
      setWidgetValue(node, "tl_y", backendData.tl[1]);
      setWidgetValue(node, "tr_x", backendData.tr[0]);
      setWidgetValue(node, "tr_y", backendData.tr[1]);
      setWidgetValue(node, "br_x", backendData.br[0]);
      setWidgetValue(node, "br_y", backendData.br[1]);
      setWidgetValue(node, "bl_x", backendData.bl[0]);
      setWidgetValue(node, "bl_y", backendData.bl[1]);

      updateCornersFromWidgets(node, preview);
      updateWidgetsFromCorners(node, preview);

      // Restore bow values from backend payload (deep-copy the [x,y] arrays)
      if (backendData.bows) {
        const b = backendData.bows;
        node.properties.perspBows = {
          top:    [...b.top],
          right:  [...b.right],
          bottom: [...b.bottom],
          left:   [...b.left],
        };
        updateWidgetsFromBows(node);
      }
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
