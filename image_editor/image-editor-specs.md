# Specifications for ComfyUI Custom Node: Interactive Photoshop-Like Image Editor (v1.2 Draft)

## 1. Overview
This document outlines the specifications for a custom ComfyUI node called "Interactive Image Editor." The node will function as an embeddable, Photoshop-inspired image editing application within ComfyUI workflows. It aims to provide an interactive UI for modifying images, with core support for layers implemented from the outset to ensure a robust foundation for extensibility. To facilitate a phased development approach, begin implementation with a basic crop feature as the initial tool, then expand to other modular features.

The node integrates into ComfyUI's node-based workflow system:
- **Input**: Optional IMAGE tensor (from previous nodes). If no input, start with a blank canvas or allow user upload/paste.
- **Output**: Edited IMAGE tensor for downstream workflow nodes.
- **Interaction**: When the workflow is queued or the node is activated, it opens a modal or embedded editor window in the ComfyUI frontend. Users can edit in real-time, then "Apply" to output the result. If the user queues the prompt without pressing "Apply," auto-apply the current edited state.
- **Activation Modes**: Support image input via node connection, CTRL-V (paste from clipboard), or drag-and-drop into the editor UI.
- **Target Environment**: Compatible with ComfyUI's latest stable release (v0.16.4 as of March 2026) and Nodes 2.0 (Vue-based rendering for dynamic widgets and richer interactions).

This node leverages ComfyUI's custom node API (Python backend) and frontend extensions (JavaScript/Vue for UI). It will use an open-source JavaScript image editing library (e.g., Fabric.js for canvas manipulation, with built-in layer/object support) as the foundation to ensure modularity and ease of integration.

**Goals**:
- Emulate core Photoshop features, starting with layers as a fundamental system.
- Ensure high modularity for easy extension or removal of features.
- Maintain performance within ComfyUI's web-based environment (no server-side processing beyond tensor handling).
- Phased Implementation: Start with core UI, layers, and basic crop; then add other tools modularly.

## 2. Functional Requirements
### 2.1 Core Features
- **Image Loading**:
  - Accept input IMAGE tensor from ComfyUI workflow (converted to canvas-compatible format, e.g., base64 or Blob).
  - Fallback: Blank canvas (configurable size, e.g., 512x512).
  - User-initiated: CTRL-V to paste image from clipboard; drag-and-drop files/URLs into the editor.
- **Editor UI**:
  - Modal popup or expandable node widget (using Nodes 2.0 for dynamic expansion).
  - HTML5 Canvas-based workspace with zoom, pan, and undo/redo stack (up to 20 steps).
  - Toolbar (left/right side) for tools, layers panel (bottom/right), and properties inspector (contextual based on selection).
  - Real-time preview of changes.
- **Output Handling**:
  - Explicit "Apply" button: User confirms → serializes canvas → sends to backend → outputs IMAGE tensor.
  - **Auto-Apply on Workflow Queue/Run**: If user queues prompt without pressing Apply and the editor has pending changes (dirty state), automatically trigger the same serialization + send process as "Apply." Show a brief toast/notification: "Editor changes auto-applied on queue."
  - If no changes (clean state), use the original input image (or blank if none).
  - "Cancel" / close modal without apply → revert to original input (no changes propagated).
- **Layers Support (Core from Start)**:
  - Built-in from the initial implementation: Use Fabric.js's object/grouping system to manage layers as stacked canvas objects.
  - Features: Add new layers (raster or vector), delete, reorder (drag-drop in panel), visibility toggle, opacity slider (0-100%), basic blend modes (normal, multiply, screen).
  - Layers panel: List view with thumbnails, names (editable), lock/unlock.
  - Input image loads as the base layer; pasted/dropped images add as new layers.

### 2.2 Editing Tools and Features
Implement as modular components (each in separate JS files, dynamically loaded). Prioritize basic crop as the first tool for initial development, then expand.

- **Basic Crop (Initial Feature to Implement)**:
  - Tool: Rectangular crop selection with draggable/resizable handles.
  - Functionality: Select area → crop canvas or selected layer to bounds; maintain aspect ratio option (lock via shift key).
  - Apply: Crop and commit to layer; undoable.
  - Integration: Activates on tool select; previews crop bounds with overlay.
- **Other Tools (Modular, Post-Initial)**:
  - **Selection Tools**: Rectangular/elliptical/lasso/magic wand selections; move, copy, paste selections.
  - **Brush/Pencil/Eraser**: Configurable size, hardness, opacity; color picker (RGB/HSV).
  - **Shape Tools**: Line, rectangle, ellipse; fill/stroke options.
  - **Text Tool**: Add editable text layers with font, size, color, alignment.
  - **Resize**: Resize canvas/image with aspect ratio lock (distinct from crop).
  - **Filters/Adjustments**: Brightness/contrast, hue/saturation, blur/sharpen, invert; apply to layer or whole image.
  - **Transform Tools**: Rotate, flip, scale, skew selected layers/objects.
  - **Clone Stamp/Healing**: Sample and paint from source areas.
  - **History/Undo**: Stack-based undo/redo (integrated with layers).

### 2.3 Non-Functional Requirements
- **Performance**: Handle images up to 4K resolution without lag (use WebGL if possible via library).
- **Compatibility**: Cross-browser (Chrome, Firefox, Edge); mobile-friendly touch support.
- **Accessibility**: Basic ARIA labels for tools; keyboard shortcuts (e.g., C for crop).
- **File Formats**: Input/output PNG/JPEG; optional PSD export (if library supports).
- **Dependencies**: Minimize external libs; use Fabric.js (v5+ as of 2026) as core canvas engine (supports layers natively). No proprietary code.
- **Error Handling**: Graceful fallback for unsupported features; log errors to console.
- **Dirty State Tracking**: Canvas maintains a "dirty" flag (true after any edit, including layer changes or crops, since last apply/load).
- **Toast Notifications**: Use ComfyUI's built-in system for auto-apply feedback.
- **Testing**: Unit tests for modules (e.g., crop functionality); integration tests in ComfyUI environment.

### 2.4 Auto-Apply Mechanism
- **Trigger Points**:
  - When user clicks **Queue Prompt** in ComfyUI main UI.
  - When workflow is executed via API / script / batch queue.
- **Detection**:
  - Frontend tracks whether canvas has unsaved changes (dirty flag, triggered by layer ops, crops, etc.).
  - On queue initiation (hook into app.queuePrompt or Nodes 2.0 equivalent event), check if this node is in the current workflow and if editor is open/dirty.
- **Behavior**:
  - If dirty → auto-serialize canvas (toDataURL or toBlob) → send to backend via existing ComfyUI WebSocket/fetch channel used for Apply.
  - Backend receives and processes as if Apply was pressed.
  - If not dirty → no action needed (original input flows through).
- **Edge Cases**:
  - Editor closed but changes were made earlier → treat as clean (or optionally persist last applied state).
  - Multiple instances of the node in workflow → each handles independently.
  - Workflow paused/resumed → preserve dirty state.
  - Error during auto-apply → fallback to original input + error toast.
  - Layer-specific: Ensure serialization captures all layers (Fabric.js toJSON() for state).

## 3. Architecture
### 3.1 Backend (Python - ComfyUI Custom Node)
- **Directory Structure**:
  ```
  custom_nodes/
  └── comfyui-image-editor/
      ├── __init__.py
      ├── node.py  # Defines the ComfyUI node class
      ├── utils.py  # Helper functions (e.g., tensor to base64)
      └── web/  # Frontend files (served by ComfyUI)
          ├── main.js  # Entry point: Loads modules, initializes editor with layers
          ├── modules/  # Modular features
              ├── layers.js  # Core layers management (loaded first)
              ├── crop.js    # Basic crop tool (initial implementation)
              ├── brush.js
              ├── selection.js
              ├── ... (one per tool/feature)
          └── libs/  # External libs (e.g., fabric.min.js)
  ```
- **Node Definition** (in node.py):
  - Class: `InteractiveImageEditor`
  - INPUT_TYPES: {"optional": {"image": ("IMAGE",)}}
  - RETURN_TYPES: ("IMAGE",)
  - FUNCTION: "edit_image" – Placeholder that triggers frontend interaction; on apply/auto-apply, convert canvas data back to tensor.
  - CATEGORY: "image/editing"
  - Use ComfyUI's API for widget registration (e.g., add custom button to open editor).
- **Integration**: Register a custom endpoint or use WebSocket for real-time data transfer between frontend and backend (e.g., send edited image data back). Handle layer data if serialized (e.g., via JSON for multi-layer output, but flatten to single IMAGE tensor initially).

### 3.2 Frontend (JavaScript/Vue)
- **Foundation Library**: Use Fabric.js (v5+ as of 2026) for canvas objects, layers, and events. It's modular, open-source, and supports serialization (save/load states, including layers).
- **Main UI (main.js)**:
  - Initialize Fabric.js canvas in a Vue component (leverage Nodes 2.0 for Vue integration).
  - Dynamically import modules: First load `layers.js`, then `crop.js` for initial build; e.g., `import Layers from './modules/layers.js'; import CropTool from './modules/crop.js';`.
  - Event Bus: Use Vue's event system or a simple pub/sub for tool switching, layer updates, and dirty flagging.
  - Clipboard/Drop Handling: Add event listeners for 'paste' and 'drop' events; add dropped images as new layers.
- **Modularity**:
  - Each module exports a class (e.g., `class CropTool { init(canvas) {...} }`).
  - Main UI loads all modules on startup and registers them to toolbar/layers panel.
  - Configurable: Allow disabling modules via a config file or node properties.
- **Data Flow**:
  - Input: Receive image data via ComfyUI's frontend API (e.g., base64 from backend); load as base layer.
  - Output: On "Apply"/auto-apply, serialize canvas to data URL (flattening layers), send to backend for tensor conversion. Future: Optional multi-layer output if ComfyUI supports layered tensors.
- **Layers Implementation**:
  - Use Fabric.js groups or activeSelection for layer management.
  - Serialize: `canvas.toJSON()` includes layer hierarchy.
- **Crop Implementation**:
  - Use Fabric.js rect object for crop overlay; on apply, clip canvas or layer via `canvas.clipTo` or manual redraw.
  - Dirty flag: Set on crop selection/change.

### 3.3 Queue Hook for Auto-Apply
- Hook into `app.queuePrompt` (or Nodes 2.0's workflow execution events) via `app.registerExtension`.
- Example (in main.js or extension file):
  ```javascript
  app.registerExtension({
    name: "ImageEditor.AutoApply",
    async beforeQueuePrompt() {
      const editorNodes = graph._nodes.filter(n => n.comfyClass === "InteractiveImageEditor");
      for (const node of editorNodes) {
        if (node.isDirty && node.editorInstance) {
          const dataUrl = await node.editorInstance.getEditedImage(); // Flattens layers to image
          await sendAutoApplyData(node.id, dataUrl);
        }
      }
    }
  });
  ```
- Communication: Reuse the same message format / endpoint as explicit Apply (e.g., custom ComfyUI API message type `"editor_auto_apply"` with node ID + base64 data).

## 4. Implementation Guidelines
- **Development Steps** (Phased):
  1. Set up basic ComfyUI custom node skeleton (reference official docs: https://docs.comfy.org/development/core-concepts/custom-nodes).
  2. Integrate Fabric.js and create a minimal canvas with layers panel (add base layer from input).
  3. Implement basic crop as first modular tool (in crop.js); test dirty flagging and undo.
  4. Add explicit Apply flow and auto-apply hook.
  5. Expand modularity: Add other tools one-by-one as separate files.
  6. Handle input/output via ComfyUI APIs.
  7. Test in Nodes 2.0 mode for dynamic widgets.
- **Best Practices**:
  - Use ES6+ for JS; Python 3.10+ for backend.
  - Follow ComfyUI's style: Clean, minimalist UI.
  - License: MIT for open-source compatibility.
  - Documentation: Inline comments; separate README.md with examples.
  - Layers-First: Ensure all tools interact with selected layers (e.g., crop applies to active layer).
- **Potential Challenges**:
  - Real-time interaction: Use requestAnimationFrame for smooth rendering, especially with layers.
  - Large Images: Downscale for editing, upscale on export.
  - ComfyUI Updates: Monitor for Nodes 2.0 changes (stable as of March 2026).
  - Layer Flattening: For output, merge layers to single image; future multi-output support.

## 5. Deliverables
- Source code in the structure above.
- Example workflow JSON demonstrating the node (e.g., input image → editor with crop → output).
- README with installation (git clone into custom_nodes, pip install deps if any), usage (e.g., "Start with crop tool for basic edits"), and extension guide.
- Demo video/screenshots showing layers and crop in action.

This is the full, updated specification (v1.2). It incorporates layers as core from the start and prioritizes basic crop for initial implementation. Provide feedback for further refinements before coding. This document will be updated frequently to keep track of progress, issues and new features to add.
