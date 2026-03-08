# CLAUDE.md – Interactive Photoshop-like Image Editor for ComfyUI

Last updated: March 2026  
Project goal: Create a custom ComfyUI node that embeds a modular, browser-based image editor inspired by Photoshop, starting with layers + basic crop.

This file contains the **current authoritative specification** (v1.3 – Vue-first edition) that all code contributions must follow.  
Do **not** deviate from these requirements without explicit user confirmation.

## 1. High-Level Objective

Build a ComfyUI custom node named **InteractiveImageEditor** (or similar) that:

- Opens an interactive editor UI when needed
- Accepts an optional IMAGE input tensor
- Lets the user perform edits (starting with crop + full layer support)
- Outputs an edited IMAGE tensor
- Auto-applies changes if the user queues the prompt without pressing "Apply"

Key principles:

- **Vue.js 3 is the primary framework** (leverage Nodes 2.0 native Vue architecture)
- Highly modular: each major feature/tool lives in its own file under `web/modules/`
- Layers are **core** – implement them from the very beginning
- Use **Fabric.js (v5+)** exclusively for the canvas editing engine (objects = layers, transforms, events)
- Vue handles UI shell, reactivity, components; Fabric handles low-level canvas manipulation
- Support **explicit Apply** + **auto-apply on Queue Prompt**
- Use comfyui skills to help with the coding when possible

## 2. Must-Have Behaviors (Non-negotiable)

1. **Input**
   - Optional `image: IMAGE` tensor
   - If present → load as base Fabric object/layer
   - If absent → start with blank canvas (default 512×512, configurable later)

2. **Loading images**
   - Drag & drop into editor
   - Ctrl+V (paste from clipboard)
   → New images added as new Fabric objects/layers on top

3. **Layers – implemented from day 1**
   - Add layer, delete, duplicate, reorder (drag in panel)
   - Visibility toggle (eye icon)
   - Opacity slider (0–100%)
   - Basic blend modes: normal, multiply, screen (others optional later)
   - Layers panel showing thumbnails + names (editable)
   - Sync Fabric objects with Vue reactive layers array

4. **Crop tool – first tool to implement**
   - Tool icon in toolbar (C shortcut)
   - Draggable/resizable Fabric.Rect with handles
   - Aspect ratio lock (hold Shift)
   - Apply crop → crops active layer or whole canvas (user choice?)
   - Non-destructive preview (overlay), commit on apply/enter

5. **Apply & Auto-Apply**
   - "Apply" button in UI → flatten visible layers → send base64/PNG to backend
   - If user clicks **Queue Prompt** and editor is dirty → **automatically** do the same as Apply
   - Show toast: "Editor changes auto-applied"
   - Dirty flag reset after successful apply/auto-apply
   - Cancel / close without apply → keep original input

6. **Dirty tracking**
   - Set dirty = true on: object added/modified, layer added/removed/reordered/opacity changed, crop applied, etc.
   - Use Fabric.js events (`object:modified`, `object:added`, custom events) → trigger Vue reactivity

## 3. Folder Structure (Vue + Fabric)

```txt
image_editor/
├─ .claude/
│  └─ CLAUDE.md                  # Project instructions (DO NOT edit)
├─ __init__.py                   # NODE_CLASS_MAPPINGS + EXTENSION_WEB_DIRS
├─ node.py                       # OlmImageEditor class
├─ utils.py                      # tensor↔PIL, hash, preview
├─ image-editor-specs.md         # Living spec (user-maintained)
└─ web/                          # Frontend @ /extensions/ComfyUI-Olm-DragCrop-ImageEditor/
   ├─ main.js                    # registerExtension + node hooks
   ├─ components/
   │  ├─ EditorModal.vue         # main editor container
   │  ├─ Toolbar.vue
   │  ├─ LayersPanel.vue
   │  ├─ PropertiesPanel.vue
   │  └─ CanvasView.vue          # mounts Fabric canvas
   ├─ modal.js                   # Singleton modal DOM + layout
   ├─ applyHandler.js            # canvas → upload/image → widget
   ├─ autoApplyHook.js           # beforeQueuePrompt hook
   ├─ pasteDropHandler.js        # paste/drop → addImageAsNewLayer
   ├─ toast.js                   # ComfyUI toast or fallback
   ├─ editorState.js             # per-node dirty/undo/redo/canvas
   ├─ constants.js               # HISTORY_MAX, BLEND_MODES, etc.
   ├─ modules/
   │  ├─ layers.js               # Layer CRUD + Fabric sync
   │  └─ crop.js                 # Crop rect, shade, aspect, commit
   └─ libs/
      └─ fabric.min.js           # Fabric.js v5 (local bundle)
```


## 4. Technical Constraints & Preferences

- **Vue 3** (Composition API preferred) for all UI/reactive logic
- **Fabric.js** is the ONLY canvas library allowed (v5+)
- Initialize Fabric inside `onMounted()` of CanvasView.vue (use ref for canvas element)
- Use ES modules + dynamic imports for tools: `import('./modules/crop.js').then(m => m.init(fabricCanvas))`
- Communicate with backend via ComfyUI's WebSocket / fetch
- Auto-apply hook: `app.registerExtension({ async beforeQueuePrompt() { … } })`
- Do **not** block the queue – serialize asynchronously
- Flatten layers to single image for output (canvas.toDataURL())

## 5. Documentation Maintenance (Important – Claude Responsibilities)

As the project progresses, two key documents must be kept up-to-date:

- **`image-editor-specs.md`**  
  This is the **master living specification** document. It contains the detailed, versioned requirements (functional, architectural, non-functional).  
  → Claude is expected to **propose updates** to this file whenever:
  - New features are added or clarified
  - Decisions are made that change scope, behavior, or architecture
  - Bugs or edge cases reveal the need for specification changes
  - User gives feedback that requires spec adjustments

- **`CLAUDE.md`** (this file)  
  This is the **Claude-specific instruction sheet**.  
  → Claude should also **suggest updates** to this file when:
  - New non-negotiable rules emerge
  - Development order or priorities change
  - Important lessons learned or warnings need to be recorded
  - The user explicitly asks to modify guidelines for Claude

Always offer a proposed diff / updated section when suggesting changes to either file.  
Never silently assume changes to the specs — always confirm with the user or explicitly propose updates to the .md files.

## 6. Development Order Suggestion (strongly recommended)

Phase 1 – Get something visible & functional
1. Basic node skeleton + open modal with Vue component
2. Load Fabric.js + mount canvas in CanvasView.vue
3. Implement layers panel (Vue reactive) & base layer from input
4. Add crop tool (in crop.js, using Fabric.Rect)
5. Implement explicit Apply (canvas.toDataURL() → backend)
6. Add dirty flag (Vue ref + Fabric events) & basic undo

Phase 2 – Make it usable in real workflows
7. Hook auto-apply on queuePrompt
8. Add paste / drop → new Fabric image object
9. Add toast notifications for auto-apply

Phase 3 – Expand tools modularly
10. Brush, eraser, text, shapes, etc. (one module at a time)

## 7. What NOT to do (unless user explicitly asks)

- Replace Fabric.js with pure Canvas / another lib (keep it for object model)
- Use React/Svelte/plain JS for main UI (stick to Vue for Nodes 2.0 compatibility)
- Implement 20 tools at once – focus on modularity and crop + layers first
- Output multi-layer tensors (flatten for now)
- Ignore auto-apply requirement
- Remove layers support

## 8. Acceptance criteria for first PR / working version

- Node appears in ComfyUI
- Can open editor (Vue modal/panel)
- Input image appears as base Fabric layer
- Can add at least one new layer (even empty)
- Crop tool works on active layer or canvas
- Pressing Apply sends edited image downstream
- Queue Prompt without Apply → auto-sends current canvas state
- No crash on paste / drop

Good luck — stay modular, test early, commit often.

If anything in this file seems contradictory or unclear, ask the user before proceeding.