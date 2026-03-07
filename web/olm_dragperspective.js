import { app } from "../../scripts/app.js";
import { handleDrawForegroundPersp } from "./core/perspectiveRender.js";
import { handleOnExecutedPersp } from "./handlers/onExecutedPerspHandler.js";
import { getWidget, hideWidget, removePerspInputs } from "./utils/nodeUtils.js";
import { clamp } from "./utils/geometryUtils.js";
import { commitState } from "./core/commitState.js";
import {
  computeNodeSize,
  getPreviewAreaCached,
  handleResize,
} from "./ui/nodeLayout.js";
import {
  getCornerHit,
  resetCorners,
  updateCornersFromWidgets,
  updateWidgetsFromCorners,
  initBows,
  getBowHandleHit,
  updateWidgetsFromBows,
  updateBowsFromWidgets,
  applyBowDrag,
} from "./core/perspectiveModel.js";
import {
  DEFAULT_SIZE,
  DEFAULT_COLOR,
  colorOptions,
  WIDGET_ROW_H,
  TEXTCONTENT,
  CANVAS_EXTEND_OPTIONS,
} from "./constants.js";
import { showConfirmDialog } from "./ui/confirmDialog.js";

app.registerExtension({
  name: "olm.dragperspective",

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "OlmDragPerspective") return;

    // -------------------------------------------------------------------------
    // State initialization
    // -------------------------------------------------------------------------
    function initNodeState(node) {
      node.serialize_widgets = true;
      node.properties = node.properties || {};

      const defaults = {
        perspCorners: null,
        perspBows: null,
        actualImageWidth:  DEFAULT_SIZE,
        actualImageHeight: DEFAULT_SIZE,
        infoDisplayEnabled: true,
        box_color: colorOptions.find((o) => o.name === DEFAULT_COLOR)?.value || "#d5ff6b",
        lastOutWidth:  null,
        lastOutHeight: null,
        canvasExtendLabel: "None",
      };

      for (const key in defaults) {
        if (node.properties[key] === undefined) {
          node.properties[key] = defaults[key];
        }
      }
      // Ensure bows always has a valid object
      if (!node.properties.perspBows) {
        node.properties.perspBows = initBows();
      }

      node.image = new Image();
      node.image.src = "";
      node.imageLoaded    = false;
      // Tell ComfyUI's isImageNode() this is an image node so Ctrl+V paste
      // routes to this node instead of creating a new LoadImage node.
      node.previewMediaType = "image";
      node.dragging       = false;
      node.draggingCorner = null; // "tl"|"tr"|"br"|"bl"
      node.draggingBow    = null; // "top"|"right"|"bottom"|"left"
      node.hoveringBow    = null; // "top"|"right"|"bottom"|"left"
    }

    // -------------------------------------------------------------------------
    // Hide internal widgets (managed by frontend, not shown to user)
    // -------------------------------------------------------------------------
    function hideInternalWidgets(node) {
      const hidden = [
        "drawing_version",
        "pasted_image",
        "last_width", "last_height",
        "tl_x", "tl_y",
        "tr_x", "tr_y",
        "br_x", "br_y",
        "bl_x", "bl_y",
        "top_bow_x", "top_bow_y", "right_bow_x", "right_bow_y",
        "bottom_bow_x", "bottom_bow_y", "left_bow_x", "left_bow_y",
      ];
      for (const name of hidden) {
        const w = getWidget(node, name);
        if (w) hideWidget(w, name === "drawing_version" ? 0 : -4);
      }
    }

    // -------------------------------------------------------------------------
    // User-facing widgets
    // -------------------------------------------------------------------------
    function createWidgets(node) {
      // Force Refresh
      node.addWidget("button", TEXTCONTENT.forceRefreshWidget, "refresh", () => {
        const dv = getWidget(node, "drawing_version");
        if (dv) dv.value = Date.now();
        commitState(node);
        node.setDirtyCanvas(true);
      });

      // Hide/Show Info Text toggle
      node.infoToggle = node.addWidget(
        "button",
        node._getInfoToggleLabel(),
        null,
        () => {
          node.properties.infoDisplayEnabled = !node.properties.infoDisplayEnabled;
          node._updateInfoToggleLabel();
          commitState(node);
          node.setDirtyCanvas(true);
        }
      );

      // Box Color
      const colorNames = colorOptions.map((o) => o.name);
      const defaultColorEntry = colorOptions.find((o) => o.name === DEFAULT_COLOR);
      node.properties.box_color = defaultColorEntry?.value || "#d5ff6b";

      node.addWidget(
        "combo",
        TEXTCONTENT.boxColorWidget,
        defaultColorEntry?.name || DEFAULT_COLOR,
        (value) => {
          const selected = colorOptions.find((o) => o.name === value);
          if (selected) {
            node.properties.box_color = selected.value;
            commitState(node);
            node.setDirtyCanvas(true);
          }
        },
        { values: colorNames }
      );

      // Canvas Extend
      node.addWidget(
        "combo",
        "Canvas Extend",
        node.properties.canvasExtendLabel || "None",
        (value) => {
          node.properties.canvasExtendLabel = value;
          // Re-map corners from pixel widgets into the new preview space
          const preview = getPreviewAreaCached(node);
          if (node.properties.perspCorners) {
            updateCornersFromWidgets(node, preview);
          }
          commitState(node);
          node.setDirtyCanvas(true);
        },
        { values: CANVAS_EXTEND_OPTIONS }
      );

      // Reset Transform
      node.addWidget("button", "Reset Transform", "reset_persp", () => {
        showConfirmDialog(
          "Reset perspective corners and rotation to defaults?",
          (confirmed) => {
            if (!confirmed) return;
            // Reset canvas extend to None
            node.properties.canvasExtendLabel = "None";
            const extendWidget = node.widgets?.find((w) => w.name === "Canvas Extend");
            if (extendWidget) extendWidget.value = "None";
            // Reset rotation to None
            const rotateWidget = node.widgets?.find((w) => w.name === "rotate");
            if (rotateWidget) rotateWidget.value = "None";
            const preview = getPreviewAreaCached(node);
            resetCorners(node, preview);
            commitState(node);
            node.setDirtyCanvas(true);
          }
        );
      });
    }

    // -------------------------------------------------------------------------
    // Mouse handling helpers
    // -------------------------------------------------------------------------
    function getPreviewLocalPos(nodePos, pos, preview) {
      return {
        x: pos[0] - nodePos[0] - preview.x,
        y: pos[1] - nodePos[1] - preview.y,
      };
    }

    function onPerspMouseDown(node, e, pos, preview) {
      if (!node.properties.perspCorners) return false;

      const mousePos  = [e.canvasX, e.canvasY];
      const localPos  = getPreviewLocalPos(node.pos, mousePos, preview);

      // Only handle clicks inside the preview area (with 12px tolerance)
      if (
        localPos.x < -12 || localPos.y < -12 ||
        localPos.x > preview.width + 12 || localPos.y > preview.height + 12
      ) {
        return false;
      }

      // Corner handles take priority
      const cornerHit = getCornerHit(node.properties.perspCorners, localPos);
      if (cornerHit) {
        node.dragging       = true;
        node.draggingCorner = cornerHit;
        node.draggingBow    = null;
        node.setDirtyCanvas(true);
        return true;
      }

      // Bow (edge midpoint) handles
      const bows = node.properties.perspBows || initBows();
      const bowHit = getBowHandleHit(
        node,
        preview,
        node.properties.perspCorners,
        bows,
        localPos
      );
      if (bowHit) {
        node.dragging       = true;
        node.draggingCorner = null;
        node.draggingBow    = bowHit;
        node.setDirtyCanvas(true);
        return true;
      }

      return false;
    }

    function onPerspMouseMove(node, e, pos, preview) {
      // Release drag if mouse button was released outside
      if (node.dragging && e.buttons !== 1) {
        onPerspMouseUp(node, e, pos, preview);
        return false;
      }

      const mousePos = [e.canvasX, e.canvasY];
      const localPos = getPreviewLocalPos(node.pos, mousePos, preview);

      // Bow dragging
      if (node.dragging && node.draggingBow) {
        applyBowDrag(
          node,
          preview,
          node.draggingBow,
          localPos,
          node.properties.perspCorners
        );
        updateWidgetsFromBows(node);
        node.setDirtyCanvas(true);
        return true;
      }

      // Corner dragging
      if (node.dragging && node.draggingCorner) {
        const cx = clamp(localPos.x, 0, preview.width);
        const cy = clamp(localPos.y, 0, preview.height);
        node.properties.perspCorners[node.draggingCorner] = [cx, cy];
        updateWidgetsFromCorners(node, preview);
        node.setDirtyCanvas(true);
        return true;
      }

      // Not dragging — track hover over bow handles for visual feedback
      if (node.properties.perspCorners && node.properties.perspBows) {
        const bows = node.properties.perspBows;
        const prevHover = node.hoveringBow;
        node.hoveringBow = getBowHandleHit(
          node,
          preview,
          node.properties.perspCorners,
          bows,
          localPos
        );
        if (prevHover !== node.hoveringBow) {
          node.setDirtyCanvas(true);
        }
      }

      return false;
    }

    function onPerspMouseUp(node, e, pos, preview) {
      if (!node.dragging) return false;
      node.dragging       = false;
      node.draggingCorner = null;
      node.draggingBow    = null;
      commitState(node);
      node.setDirtyCanvas(true);
      return true;
    }

    function isImageFile(file) {
      if (!file) return false;
      if (typeof file.type === "string" && file.type.startsWith("image/")) {
        return true;
      }
      const n = String(file.name || "").toLowerCase();
      return /\.(png|jpe?g|webp|bmp|gif|tiff?)$/.test(n);
    }

    function extractFirstImageFile(args) {
      for (const a of args) {
        if (!a) continue;

        if (isImageFile(a)) return a;

        if (Array.isArray(a)) {
          const arrFile = a.find((f) => isImageFile(f));
          if (arrFile) return arrFile;
        }

        if (typeof FileList !== "undefined" && a instanceof FileList && a.length) {
          for (const f of a) {
            if (isImageFile(f)) return f;
          }
        }

        const dtFiles = a?.dataTransfer?.files;
        if (dtFiles?.length) {
          for (const f of dtFiles) {
            if (isImageFile(f)) return f;
          }
        }

        const dtItems = a?.dataTransfer?.items;
        if (dtItems?.length) {
          for (const item of dtItems) {
            const f = item?.kind === "file" && typeof item.getAsFile === "function"
              ? item.getAsFile()
              : null;
            if (f && isImageFile(f)) return f;
          }
        }

        const clipFiles = a?.clipboardData?.files;
        if (clipFiles?.length) {
          for (const f of clipFiles) {
            if (isImageFile(f)) return f;
          }
        }
      }
      return null;
    }

    function hasImageItems(e) {
      const items = e?.dataTransfer?.items;
      if (!items) return false;
      for (const item of items) {
        // Match Comfy default drag targeting: accept file drags even if MIME is missing.
        if (item?.kind === "file") {
          return true;
        }
      }
      return false;
    }

    async function uploadImageToInput(file) {
      const isPasted =
        file?.name === "image.png" &&
        typeof file?.lastModified === "number" &&
        Math.abs(file.lastModified - Date.now()) < 2000;

      const body = new FormData();
      body.append("image", file, file.name || "pasted_image.png");
      body.append("type", "input");
      body.append("overwrite", "false");
      if (isPasted) body.append("subfolder", "pasted");

      const res = await app.api.fetchApi("/upload/image", {
        method: "POST",
        body,
      });

      if (!res?.ok) {
        throw new Error(`Image upload failed (${res?.status || "unknown"})`);
      }

      const payload = await res.json();
      if (payload?.subfolder) {
        return `${payload.subfolder}/${payload.name || payload.filename || file.name}`;
      }
      return payload?.name || payload?.filename || file.name;
    }

    function splitUploadedPath(uploadedPath) {
      const p = String(uploadedPath || "");
      const ix = p.lastIndexOf("/");
      if (ix === -1) return { subfolder: "", filename: p };
      return {
        subfolder: p.slice(0, ix),
        filename: p.slice(ix + 1),
      };
    }

    function showUploadedPreview(node, uploadedPath) {
      const { subfolder, filename } = splitUploadedPath(uploadedPath);
      if (!filename) {
        console.warn("[OlmDragPersp] showUploadedPreview - empty filename, aborting");
        return;
      }

      const params = new URLSearchParams({
        filename,
        type: "input",
        subfolder,
        rand: String(Date.now()),
      });

      const imageUrl = app.api.apiURL(`/view?${params.toString()}`);
      node.image.onload = () => {
        node.imageLoaded = true;

        const newWidth  = node.image.naturalWidth;
        const newHeight = node.image.naturalHeight;
        node.properties.actualImageWidth  = newWidth;
        node.properties.actualImageHeight = newHeight;

        // Resize node and reset corners, matching what onExecutedPersp does for new images
        node._previewAreaCache = null;
        if (node.onResize) node.onResize(node.size);
        const newSize = node.computeSize();
        if (newSize && newSize[0] > 0 && newSize[1] > 0) node.size = newSize;

        node._previewAreaCache = null;
        const preview = getPreviewAreaCached(node);
        resetCorners(node, preview);

        // Prime last_width/last_height so the backend doesn't see a "resolution
        // change" on first run (which would cause it to ignore the user's corners).
        const lwWidget = getWidget(node, "last_width");
        if (lwWidget) lwWidget.value = newWidth;
        const lhWidget = getWidget(node, "last_height");
        if (lhWidget) lhWidget.value = newHeight;

        // Tell onExecutedPersp to preserve corners on first run after a drop,
        // since we already reset them here and the user may have adjusted them.
        node.properties._preserveCorners = true;

        commitState(node);
        node.setDirtyCanvas(true, true);
      };
      node.image.onerror = (err) => {
        console.warn("[OlmDragPersp] node.image FAILED to load:", imageUrl, err);
        node.imageLoaded = false;
      };
      node.image.src = imageUrl;
    }

    async function setPastedImageFromFile(node, file) {
      if (!isImageFile(file)) return false;

      // Dedup guard: multiple hooks (onDragDrop, pasteFile, onPasteFile, pasteFiles) may fire
      // simultaneously for the same user action once previewMediaType="image" is set.
      const dedupeKey = `${file.name}:${file.size}:${file.lastModified}`;
      if (node._pasteDedupeKey === dedupeKey) return false;
      node._pasteDedupeKey = dedupeKey;
      setTimeout(() => { if (node._pasteDedupeKey === dedupeKey) node._pasteDedupeKey = null; }, 1000);

      const uploadedName = await uploadImageToInput(file);

      const pastedWidget = getWidget(node, "pasted_image");
      if (!pastedWidget) {
        throw new Error("pasted_image widget not found on OlmDragPerspective node");
      }

      const values = pastedWidget.options?.values;
      if (Array.isArray(values) && !values.includes(uploadedName)) {
        values.push(uploadedName);
      }

      pastedWidget.value = uploadedName;
      pastedWidget.callback?.(uploadedName);

      const dv = getWidget(node, "drawing_version");
      if (dv) dv.value = Date.now();

      showUploadedPreview(node, uploadedName);

      commitState(node);
      node.setDirtyCanvas(true, true);
      return true;
    }

    // -------------------------------------------------------------------------
    // Prototype methods
    // -------------------------------------------------------------------------
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const node = this;
      onNodeCreated?.apply(node, arguments);

      initNodeState(node);
      hideInternalWidgets(node);
      createWidgets(node);

      node.size = node.computeSize();

      const preview = getPreviewAreaCached(node);
      resetCorners(node, preview);
      commitState(node);
      node.setDirtyCanvas(true);
    };

    nodeType.prototype._getInfoToggleLabel = function () {
      return this.properties.infoDisplayEnabled
        ? TEXTCONTENT.infoTextToggleWidgetHide
        : TEXTCONTENT.infoTextToggleWidgetShow;
    };

    nodeType.prototype._updateInfoToggleLabel = function () {
      if (this.infoToggle) this.infoToggle.name = this._getInfoToggleLabel();
    };

    nodeType.prototype.onConfigure = function () {
      const node = this;
      removePerspInputs(node);

      // Guard: old saved workflows won't have a valid value for the rotate widget
      const rotateWidget = node.widgets?.find((w) => w.name === "rotate");
      const validRotate = ["None", "90° CW", "90° CCW", "180°"];
      if (rotateWidget && !validRotate.includes(rotateWidget.value)) {
        rotateWidget.value = "None";
      }

      // Sync canvasExtendLabel from the serialized combo widget value
      const extendWidget = node.widgets?.find((w) => w.name === "Canvas Extend");
      if (extendWidget && extendWidget.value) {
        node.properties.canvasExtendLabel = extendWidget.value;
      }

      // Restore corner preview positions from pixel widgets (respects canvas extend)
      const preview = getPreviewAreaCached(node);
      if (node.properties.perspCorners) {
        updateCornersFromWidgets(node, preview);
      }

      // Restore bow values from widgets
      updateBowsFromWidgets(node);
      if (!node.properties.perspBows) {
        node.properties.perspBows = initBows();
      }

      const dv = getWidget(node, "drawing_version");
      if (dv) dv.value = Date.now();
      node._updateInfoToggleLabel();

      // If a wire is already connected to the IMAGE input when the workflow loads,
      // clear any stale pasted_image value so the wired input takes precedence.
      const imageInputConnected = node.inputs?.some(
        (inp) => inp.type === "IMAGE" && inp.link != null
      );
      if (imageInputConnected) {
        const pastedWidget = getWidget(node, "pasted_image");
        if (pastedWidget && pastedWidget.value) {
          pastedWidget.value = "";
        }
      }

      commitState(node);
    };

    nodeType.prototype.onAdded = function () {
      const node = this;
      removePerspInputs(node);

      const origDown  = node.onMouseDown;
      const origMove  = node.onMouseMove;
      const origUp    = node.onMouseUp;
      const origLeave = node.onMouseLeave;

      node.onMouseDown = function (e, pos, canvas) {
        const preview = getPreviewAreaCached(node);
        if (origDown?.call(this, e, pos, canvas)) return true;
        return onPerspMouseDown(node, e, pos, preview);
      };

      node.onMouseMove = function (e, pos, canvas) {
        const preview = getPreviewAreaCached(node);
        if (origMove?.call(this, e, pos, canvas)) return true;
        return onPerspMouseMove(node, e, pos, preview);
      };

      node.onMouseUp = function (e, pos, canvas) {
        const preview = getPreviewAreaCached(node);
        if (origUp?.call(this, e, pos, canvas)) return true;
        return onPerspMouseUp(node, e, pos, preview);
      };

      node.onMouseLeave = function (e, pos, canvas) {
        const preview = getPreviewAreaCached(node);
        origLeave?.call(this, e, pos, canvas);
        if (node.dragging) onPerspMouseUp(node, e, pos, preview);
      };

      const originalOnDragOver = node.onDragOver;
      node.onDragOver = function (e) {
        const handled = originalOnDragOver?.call(this, e);
        if (handled) return true;
        return hasImageItems(e);
      };

      // Note: we intentionally do NOT delegate to the original onDragDrop.
      // ComfyUI's built-in image_upload handler returns true from onDragDrop,
      // which would short-circuit our preview display code. Our setPastedImageFromFile
      // already handles everything the built-in does (upload + widget update) plus
      // the canvas preview that the built-in lacks.
      node.onDragDrop = function (...args) {
        const file = extractFirstImageFile(args);
        if (!file || !isImageFile(file)) {
          console.warn("[OlmDragPersp] No image file found in drop args");
          return false;
        }

        setPastedImageFromFile(node, file).catch((err) => {
          console.warn("[OlmDragPerspective] Failed to handle dropped image:", err);
        });

        return true;
      };

      // Same pattern: don't delegate to originals — they return true and block our preview.
      node.onPasteFile = function (...args) {
        const file = extractFirstImageFile(args);
        if (!file || !isImageFile(file)) return false;
        setPastedImageFromFile(node, file).catch((err) => {
          console.warn("[OlmDragPerspective] Failed to handle pasted image:", err);
        });
        return true;
      };

      // Match Comfy's default paste pipeline: selected nodes receive pasteFile/pasteFiles.
      node.pasteFile = function (file) {
        if (!file || !isImageFile(file)) return;
        setPastedImageFromFile(node, file).catch((err) => {
          console.warn("[OlmDragPerspective] Failed to handle pasteFile image:", err);
        });
      };

      node.pasteFiles = function (files) {
        const file = Array.isArray(files) ? files.find((f) => isImageFile(f)) : null;
        if (!file) return;
        setPastedImageFromFile(node, file).catch((err) => {
          console.warn("[OlmDragPerspective] Failed to handle pasteFiles image:", err);
        });
      };
    };

    nodeType.prototype.onExecuted = function (message) {
      handleOnExecutedPersp(this, message);
    };

    nodeType.prototype.computeSize = function () {
      const node = this;
      const visibleWidgets = (node.widgets?.filter((w) => !w.hidden) || []).length;
      const widgetHeight = visibleWidgets * WIDGET_ROW_H;
      const nodeCtx = {
        actualImageWidth:  node.properties.actualImageWidth,
        actualImageHeight: node.properties.actualImageHeight,
        widgetHeight,
      };
      return computeNodeSize(nodeCtx).newSize;
    };

    nodeType.prototype.onResize = function (size) {
      const node = this;
      if (
        !node.properties.actualImageWidth ||
        !node.properties.actualImageHeight ||
        !size
      ) return;

      const visibleWidgets = (node.widgets?.filter((w) => !w.hidden) || []).length;
      const widgetHeight = visibleWidgets * WIDGET_ROW_H;
      const newSize = handleResize({
        size,
        actualImageWidth:  node.properties.actualImageWidth,
        actualImageHeight: node.properties.actualImageHeight,
        widgetHeight,
      });
      node.size = newSize;

      // Re-sync corners to new preview dimensions
      const preview = getPreviewAreaCached(node);
      if (node.properties.perspCorners) {
        updateCornersFromWidgets(node, preview);
      }

      node.setDirtyCanvas(true);
    };

    nodeType.prototype.onDrawForeground = function (ctx) {
      const node = this;
      if (node.flags.collapsed) return;

      const visibleWidgets = (node.widgets?.filter((w) => !w.hidden) || []).length;
      const widgetHeight = visibleWidgets * WIDGET_ROW_H;
      const preview = getPreviewAreaCached(node);

      handleDrawForegroundPersp(node, ctx, widgetHeight, preview);
    };

    nodeType.prototype.onConnectionsChange = function (type, index, connected, link_info) {
      // When an IMAGE input is wired, clear the pasted_image widget so the backend
      // uses the wired input instead of the previously pasted file.
      const node = this;
      const inputSlot = node.inputs?.[index];
      if (type === LiteGraph.INPUT && inputSlot?.type === "IMAGE" && connected) {
        const pastedWidget = getWidget(node, "pasted_image");
        if (pastedWidget && pastedWidget.value) {
          pastedWidget.value = "";
          node.imageLoaded = false;
          node.image.src = "";
          node.setDirtyCanvas(true, true);
        }
      }
      if (type === LiteGraph.INPUT && link_info?.type === "IMAGE") {
        this.setDirtyCanvas(true);
      }
    };
  },
});
