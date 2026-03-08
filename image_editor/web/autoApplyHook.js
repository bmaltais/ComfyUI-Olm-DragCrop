/**
 * Auto-apply hook for OlmImageEditor
 *
 * Automatically applies editor changes when the user clicks "Queue Prompt"
 * without manually clicking Apply first. This ensures the editor changes
 * are always included in the workflow execution.
 */

import { app } from "../../scripts/app.js";
import { getCanvas, isDirty, setDirty } from "./editorState.js";
import { applyCanvas } from "./applyHandler.js";
import { showToast } from "./toast.js";

app.registerExtension({
  name: "olm.imageeditor.autoApply",

  async beforeQueuePrompt() {
    console.log('[Auto Apply] Checking for dirty OlmImageEditor nodes...');

    // Find all OlmImageEditor nodes in the current graph
    const editorNodes = app.graph._nodes?.filter(n => n.comfyClass === "OlmImageEditor") || [];

    if (editorNodes.length === 0) {
      console.log('[Auto Apply] No editor nodes found');
      return;
    }

    let appliedCount = 0;

    for (const node of editorNodes) {
      // Check if this node has dirty changes
      if (!isDirty(node.id)) {
        continue;
      }

      // Get the Fabric canvas for this node
      const canvas = getCanvas(node.id);
      if (!canvas) {
        console.warn('[Auto Apply] No canvas found for dirty node:', node.id);
        continue;
      }

      try {
        console.log('[Auto Apply] Auto-applying changes for node:', node.id);
        await applyCanvas(node, canvas);
        setDirty(node.id, false);
        appliedCount++;
      } catch (error) {
        console.error('[Auto Apply] Failed to auto-apply changes for node:', node.id, error);
        showToast(`Editor auto-apply failed for node ${node.id}. Check console.`, "error");
      }
    }

    if (appliedCount > 0) {
      const message = appliedCount === 1
        ? "Editor changes auto-applied on queue"
        : `${appliedCount} editor changes auto-applied on queue`;
      showToast(message, "success");
      console.log(`[Auto Apply] Successfully applied ${appliedCount} editor changes`);
    }
  }
});
