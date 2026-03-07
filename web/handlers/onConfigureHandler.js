import { commitState } from "../core/commitState.js";
import { syncCropWidgetsFromProperties } from "../core/cropModel.js";
import { removeNodeInputs, getWidget } from "../utils/nodeUtils.js";

export function handleOnConfigure(node) {
  removeNodeInputs(node);

  node.forceUpdate();

  // If an IMAGE wire is already connected, clear any stale pasted_image value.
  const imageInput = node.inputs?.find((i) => i.name === "image");
  if (imageInput?.link != null) {
    const pastedWidget = getWidget(node, "pasted_image");
    if (pastedWidget) pastedWidget.value = "";
  }

  syncCropWidgetsFromProperties(node);
  node.updateInfoToggleLabel();

  commitState(node);
}
