import { app } from "../../scripts/app.js";
import { handleDrawForegroundPersp } from "./core/perspectiveRender.js";
import { handleOnExecutedPersp } from "./handlers/onExecutedPerspHandler.js";
import { getWidget, hideWidget, setWidgetValue } from "./utils/nodeUtils.js";
import { clamp } from "./utils/geometryUtils.js";
import { commitState } from "./core/commitState.js";
import {
  computeNodeSize,
  getPreviewAreaCached,
  handleResize,
} from "./ui/nodeLayout.js";
import {
  initCorners,
  getCornerHit,
  clampCorners,
  resetCorners,
  updateWidgetsFromCorners,
  updateCornersFromWidgets,
} from "./core/perspectiveModel.js";
import {
  DEFAULT_SIZE,
  DEFAULT_COLOR,
  colorOptions,
  WIDGET_ROW_H,
  TEXTCONTENT,
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
        actualImageWidth:  DEFAULT_SIZE,
        actualImageHeight: DEFAULT_SIZE,
        infoDisplayEnabled: true,
        box_color: colorOptions.find((o) => o.name === DEFAULT_COLOR)?.value || "#d5ff6b",
        lastOutWidth:  null,
        lastOutHeight: null,
      };

      for (const key in defaults) {
        if (node.properties[key] === undefined) {
          node.properties[key] = defaults[key];
        }
      }

      node.image = new Image();
      node.image.src = "";
      node.imageLoaded   = false;
      node.dragging      = false;
      node.draggingCorner = null; // "tl"|"tr"|"br"|"bl"
    }

    // -------------------------------------------------------------------------
    // Hide internal widgets (managed by frontend, not shown to user)
    // -------------------------------------------------------------------------
    function hideInternalWidgets(node) {
      const hidden = [
        "drawing_version",
        "last_width", "last_height",
        "tl_x", "tl_y",
        "tr_x", "tr_y",
        "br_x", "br_y",
        "bl_x", "bl_y",
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

      // Reset Perspective
      node.addWidget("button", "Reset Perspective", "reset_persp", () => {
        showConfirmDialog(
          "Reset perspective corners to the full image?",
          (confirmed) => {
            if (!confirmed) return;
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

      // Only handle clicks inside the preview area
      if (
        localPos.x < -12 || localPos.y < -12 ||
        localPos.x > preview.width + 12 || localPos.y > preview.height + 12
      ) {
        return false;
      }

      const hit = getCornerHit(node.properties.perspCorners, localPos);
      if (hit) {
        node.dragging      = true;
        node.draggingCorner = hit;
        node.setDirtyCanvas(true);
        return true;
      }
      return false;
    }

    function onPerspMouseMove(node, e, pos, preview) {
      if (!node.dragging || !node.draggingCorner) return false;
      if (e.buttons !== 1) {
        onPerspMouseUp(node, e, pos, preview);
        return false;
      }

      const mousePos = [e.canvasX, e.canvasY];
      const localPos = getPreviewLocalPos(node.pos, mousePos, preview);

      // Clamp to preview bounds
      const cx = clamp(localPos.x, 0, preview.width);
      const cy = clamp(localPos.y, 0, preview.height);

      node.properties.perspCorners[node.draggingCorner] = [cx, cy];
      updateWidgetsFromCorners(node, preview);
      node.setDirtyCanvas(true);
      return true;
    }

    function onPerspMouseUp(node, e, pos, preview) {
      if (!node.dragging) return false;
      node.dragging      = false;
      node.draggingCorner = null;
      commitState(node);
      node.setDirtyCanvas(true);
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
      // Restore corner widgets after load
      const preview = getPreviewAreaCached(node);
      if (node.properties.perspCorners) {
        updateWidgetsFromCorners(node, preview);
      }
      const dv = getWidget(node, "drawing_version");
      if (dv) dv.value = Date.now();
      node._updateInfoToggleLabel();
      commitState(node);
    };

    nodeType.prototype.onAdded = function () {
      const node = this;

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
      if (type === LiteGraph.INPUT && link_info?.type === "IMAGE") {
        this.setDirtyCanvas(true);
      }
    };
  },
});
