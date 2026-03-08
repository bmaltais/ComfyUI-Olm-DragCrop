/**
 * OlmImageEditor – ComfyUI frontend extension entry point.
 *
 * Refactored to show image preview + Edit button in node,
 * with full-screen modal editor when Edit is clicked.
 */

import { app } from "../../scripts/app.js";
import { EXTENSION_NAME, NODE_CLASS } from "./constants.js";
import {
  createImagePreviewWidget,
  destroyImagePreviewWidget,
} from "./vueEditorWidget.js";
import { setEditorInfo, removeNode } from "./editorState.js";
import { getWidget, hideWidget } from "../ComfyUI-Olm-DragCrop/utils/nodeUtils.js";
// Import auto-apply hook to register it
import "./autoApplyHook.js";

app.registerExtension({
  name: EXTENSION_NAME,

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_CLASS) return;

    // --- onNodeCreated ---
    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _origCreated?.apply(this, arguments);
      const node = this;
      node.serialize_widgets = true;

      // Hide the pasted_image combo widget (driven programmatically).
      hideWidget(getWidget(node, "pasted_image"), -4);

      // Create the image preview widget with Edit button (instead of full editor)
      createImagePreviewWidget(node).catch((err) =>
        console.error("[OlmImageEditor] createImagePreviewWidget error:", err)
      );
    };

    // --- onExecuted ---
    const _origExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      _origExecuted?.apply(this, arguments);
      console.log("[OlmImageEditor] onExecuted message keys:", Object.keys(message ?? {}));
      const info = message?.editor_info?.[0];
      console.log("[OlmImageEditor] editor_info:", info);
      if (info) {
        setEditorInfo(this.id, info);

        // Backend signals wire took over — clear the stale pasted_image widget.
        if (info.clear_pasted_image) {
          const pw = getWidget(this, "pasted_image");
          if (pw) pw.value = "";
        }

        // TODO: Update image preview widget with new image
        // This will be handled by the preview widget when implemented
      }
    };

    // --- onConfigure (workflow reload) ---
    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (data) {
      _origConfigure?.apply(this, arguments);
      hideWidget(getWidget(this, "pasted_image"), -4);

      // Clear pasted_image if a wire is already connected at load time.
      const wiredImage = this.inputs?.some(
        (inp) => inp.type === "IMAGE" && inp.link != null
      );
      if (wiredImage) {
        const pw = getWidget(this, "pasted_image");
        if (pw?.value) pw.value = "";
      }
    };

    // --- onRemoved ---
    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      _origRemoved?.apply(this, arguments);
      destroyImagePreviewWidget(this);
      removeNode(this.id);
    };
  },
});
