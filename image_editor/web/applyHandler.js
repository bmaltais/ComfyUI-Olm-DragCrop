/**
 * Apply handler: flattens the Fabric.js canvas to PNG, uploads it to ComfyUI's
 * input directory, then sets the `pasted_image` widget so the backend treats the
 * edited result like any other paste/drop upload.
 */

import { setDirty } from "./editorState.js";
import { uploadImageToInput } from "../ComfyUI-Olm-DragCrop/utils/pasteDropUtils.js";

function dataURLtoFile(dataUrl, filename) {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

/**
 * Serialize the Fabric canvas, upload it, and wire the result into the
 * `pasted_image` widget so the backend uses it on the next queue.
 *
 * @param {object} node - LiteGraph node
 * @param {fabric.Canvas} fabricCanvas
 */
export async function applyCanvas(node, fabricCanvas) {
  const dataUrl = fabricCanvas.toDataURL({ format: "png", multiplier: 1 });
  const file = dataURLtoFile(dataUrl, "editor_apply.png");

  const uploadedPath = await uploadImageToInput(file);

  const pw = node.widgets?.find((w) => w.name === "pasted_image");
  if (pw) {
    const vals = pw.options?.values;
    if (Array.isArray(vals) && !vals.includes(uploadedPath)) vals.push(uploadedPath);
    pw.value = uploadedPath;
    pw.callback?.(uploadedPath);
  } else {
    console.warn("[OlmImageEditor] pasted_image widget not found on node", node.id);
  }

  setDirty(node.id, false);
  node.setDirtyCanvas?.(true, true);
}
