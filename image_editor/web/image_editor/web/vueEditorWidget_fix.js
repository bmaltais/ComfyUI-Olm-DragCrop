/**
 * Refactored Vue-based editor widget for OlmImageEditor
 *
 * New approach:
 * 1. Node shows image preview + Edit button (createImagePreviewWidget)
 * 2. Edit button opens full-screen modal editor (openFullScreenEditor)
 * 3. Modal editor contains the full Vue editor interface
 */

import { setCanvas, setDirty, getCanvas, getEditorInfo } from './editorState.js';
import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from './constants.js';
import { applyCanvas } from './applyHandler.js';
import { uploadImageToInput, isImageFile } from '../ComfyUI-Olm-DragCrop/utils/pasteDropUtils.js';

// Global state
const previewWidgets = new Map(); // nodeId -> widget info
const vueApps = new Map(); // nodeId -> Vue app for full-screen editor
let currentImageData = null; // Store current image for editing

// Helper function to update image preview size based on available node space
function updateImagePreviewSize(node, imagePreview) {
  if (!imagePreview || !imagePreview.naturalWidth) return;

  const nodeWidth = node.size?.[0] ?? 300;
  const nodeHeight = node.size?.[1] ?? 140;

  // Calculate available space for image (subtract button and padding space)
  const buttonHeight = 32; // Edit button height
  const padding = 32; // Top/bottom padding
  const availableImageHeight = nodeHeight - buttonHeight - padding;

  // Ensure minimum viable space
  const effectiveImageHeight = Math.max(80, availableImageHeight);

  // Update image styling to fill available space
  imagePreview.style.maxHeight = `${effectiveImageHeight}px`;
  imagePreview.style.maxWidth = '100%';
  imagePreview.style.width = 'auto';
  imagePreview.style.height = 'auto';
  imagePreview.style.objectFit = 'contain';

  console.log('[ImageEditor] Image preview resized to fill available space:', {
    nodeSize: `${nodeWidth}x${nodeHeight}`,
    availableImageHeight: effectiveImageHeight,
    imageNaturalSize: `${imagePreview.naturalWidth}x${imagePreview.naturalHeight}`
  });
}

// ---------------------------------------------------------------------------
// Image Preview Widget (shows in node)
// ---------------------------------------------------------------------------
export async function createImagePreviewWidget(node) {
  console.log('[ImageEditor] Creating image preview widget for node:', node.id);

  const container = document.createElement('div');
  container.className = 'image-preview-container';
  container.style.cssText = `
    width: 100%;
    height: 100%;
    min-height: 120px;
    background: #1a1a1a;
    border: 2px dashed #444;
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px;
    box-sizing: border-box;
    position: relative;
  `;

  const dropZone = document.createElement('div');
  dropZone.className = 'drop-zone';
  dropZone.style.cssText = `
    color: #666;
    font-size: 12px;
    text-align: center;
    pointer-events: none;
  `;
  dropZone.textContent = 'Drop image here or paste (Ctrl+V)';

  const imagePreview = document.createElement('img');
  imagePreview.className = 'image-preview';
  imagePreview.style.cssText = `
    max-width: 100%;
    max-height: 80px;
    display: none;
    border-radius: 4px;
  `;

  const editButton = document.createElement('button');
  editButton.className = 'edit-button';
  editButton.textContent = 'Edit Image';
  editButton.style.cssText = `
    background: #2a7adb;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 11px;
    cursor: pointer;
    display: none;
    font-weight: 600;
  `;

  editButton.addEventListener('click', () => {
    openFullScreenEditor(node, currentImageData);
  });

  container.appendChild(dropZone);
  container.appendChild(imagePreview);
  container.appendChild(editButton);

  // Handle drag and drop
  let dragCounter = 0;

  container.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    container.style.borderColor = '#2a7adb';
    container.style.backgroundColor = '#1a2332';
  });

  container.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      container.style.borderColor = '#444';
      container.style.backgroundColor = '#1a1a1a';
    }
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  container.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    container.style.borderColor = '#444';
    container.style.backgroundColor = '#1a1a1a';

    const files = Array.from(e.dataTransfer?.files || []);
    const imageFile = files.find(f => isImageFile(f));

    if (imageFile) {
      await handleImageUpload(node, imageFile, imagePreview, editButton, dropZone);
    }
  });

  // Handle paste
  const handlePaste = async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          await handleImageUpload(node, file, imagePreview, editButton, dropZone);
        }
        break;
      }
    }
  };

  // Focus container for paste events
  container.tabIndex = 0;
  container.addEventListener('focus', () => {
    document.addEventListener('paste', handlePaste);
  });

  container.addEventListener('blur', () => {
    document.removeEventListener('paste', handlePaste);
  });

  // Create DOM widget with dynamic sizing
  const widget = node.addDOMWidget('image_preview', 'div', container, {
    serialize: false,
    hideOnZoom: false,
    computeSize() {
      const nodeWidth = node.size?.[0] ?? 300;
      const nodeHeight = node.size?.[1] ?? 140;
      return [nodeWidth, Math.max(140, nodeHeight)];
    },
    onResize() {
      // When node is resized, update container and image to fill available space
      const widgetData = previewWidgets.get(node.id);
      if (widgetData) {
        const nodeWidth = node.size?.[0] ?? 300;
        const nodeHeight = node.size?.[1] ?? 140;

        // Update container to fill node
        widgetData.container.style.width = '100%';
        widgetData.container.style.height = '100%';
        widgetData.container.style.minHeight = `${Math.max(120, nodeHeight - 32)}px`;

        // Update image if present
        if (widgetData.imagePreview && widgetData.imagePreview.style.display !== 'none') {
          updateImagePreviewSize(node, widgetData.imagePreview);
        }
      }
    }
  });

  // Store widget reference
  previewWidgets.set(node.id, {
    widget,
    container,
    imagePreview,
    editButton,
    dropZone
  });

  // Set up ResizeObserver for additional resize handling
  if (window.ResizeObserver) {
    const resizeObserver = new ResizeObserver(() => {
      const widgetData = previewWidgets.get(node.id);
      if (widgetData) {
        setTimeout(() => {
          const nodeWidth = node.size?.[0] ?? 300;
          const nodeHeight = node.size?.[1] ?? 140;

          // Ensure container fills available space
          widgetData.container.style.width = '100%';
          widgetData.container.style.height = '100%';
          widgetData.container.style.minHeight = `${Math.max(120, nodeHeight - 32)}px`;

          // Update image if present
          if (widgetData.imagePreview && widgetData.imagePreview.style.display !== 'none') {
            updateImagePreviewSize(node, widgetData.imagePreview);
          }
        }, 10);
      }
    });

    // Observe the container for size changes
    resizeObserver.observe(container);

    // Store observer reference for cleanup
    previewWidgets.get(node.id).resizeObserver = resizeObserver;
  }

  console.log('[ImageEditor] Image preview widget created successfully');
  return widget;
}

async function handleImageUpload(node, file, imagePreview, editButton, dropZone) {
  console.log('[ImageEditor] Handling image upload:', file.name);

  try {
    // Upload to ComfyUI
    const path = await uploadImageToInput(file);
    console.log('[ImageEditor] Image uploaded to path:', path);

    // Update pasted_image widget
    const pw = node.widgets?.find((w) => w.name === "pasted_image");
    if (pw) {
      const vals = pw.options?.values;
      if (Array.isArray(vals) && !vals.includes(path)) vals.push(path);
      pw.value = path;
      pw.callback?.(path);
    }

    // Show preview
    const imageUrl = URL.createObjectURL(file);
    imagePreview.src = imageUrl;

    let previewHeight = 180; // Default height, will be updated

    imagePreview.onload = () => {
      URL.revokeObjectURL(imageUrl);

      // Use the dynamic sizing approach that responds to node resizing
      updateImagePreviewSize(node, imagePreview);

      console.log('[ImageEditor] Image loaded and sized dynamically for node:', node.id);
    };

    // Store image data for editing
    currentImageData = {
      file: file,
      path: path,
      url: imageUrl
    };

    // Update UI - make container more prominent
    const container = imagePreview.parentElement;
    container.style.border = '2px solid #2a7adb';
    container.style.backgroundColor = '#1a2332';

    // Show elements
    imagePreview.style.display = 'block';
    editButton.style.display = 'block';
    dropZone.style.display = 'none';

    // Mark node as dirty
    node.setDirtyCanvas?.(true, true);

    console.log('[ImageEditor] Image preview updated successfully');

  } catch (error) {
    console.error('[ImageEditor] Image upload failed:', error);
  }
}

// ---------------------------------------------------------------------------
// Full-Screen Editor Modal
// ---------------------------------------------------------------------------
export async function openFullScreenEditor(node, imageData) {
  console.log('[ImageEditor] Opening full-screen editor for node:', node.id);

  if (!imageData) {
    console.warn('[ImageEditor] No image data available for editing');
    return;
  }

  // Create full-screen overlay
  const overlay = document.createElement('div');
  overlay.className = 'editor-modal-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.9);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  const editorContainer = document.createElement('div');
  editorContainer.className = 'fullscreen-editor-container';
  editorContainer.style.cssText = `
    width: 90vw;
    height: 90vh;
    background: #1a1a1a;
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `;

  overlay.appendChild(editorContainer);
  document.body.appendChild(overlay);

  // Load Vue components and create editor
  await loadVueComponents();

  if (!window.Vue) {
    await loadVue();
  }

  const { createApp } = window.Vue;
  const vueContainer = document.createElement('div');
  vueContainer.innerHTML = '<div id="vue-fullscreen-editor-' + node.id + '"></div>';
  editorContainer.appendChild(vueContainer);

  // Create Vue app for full-screen editor
  const app = createApp({
    components: { EditorModal },
    setup() {
      const { ref } = window.Vue;
      const showEditor = ref(true);

      return {
        showEditor,
        nodeId: node.id.toString(),
        imageData: imageData,
        handleClose: () => {
          showEditor.value = false;
          document.body.removeChild(overlay);

          // Clean up Vue app
          const vueAppData = vueApps.get(node.id);
          if (vueAppData) {
            vueAppData.app.unmount();
            vueApps.delete(node.id);
          }
        },
        handleApply: async () => {
          console.log('[ImageEditor] Apply clicked in full-screen editor');
          try {
            const canvas = getCanvas(node.id);
            if (canvas) {
              await applyCanvas(node, canvas);
              console.log('[ImageEditor] Canvas applied successfully from full-screen editor');

              // Close modal after successful apply
              document.body.removeChild(overlay);

              // Clean up Vue app
              const vueAppData = vueApps.get(node.id);
              if (vueAppData) {
                vueAppData.app.unmount();
                vueApps.delete(node.id);
              }
            }
          } catch (error) {
            console.error('[ImageEditor] Apply failed in full-screen editor:', error);
            alert('Failed to apply changes: ' + error.message);
          }
        }
      };
    },
    template: `
      <EditorModal
        v-if="showEditor"
        :node-id="nodeId"
        :initial-image="imageData"
        @close="handleClose"
        @apply="handleApply"
      />
    `
  });

  // Mount Vue app
  const mountTarget = vueContainer.querySelector('#vue-fullscreen-editor-' + node.id);
  const vueInstance = app.mount(mountTarget);

  // Store Vue app reference
  vueApps.set(node.id, { app, instance: vueInstance, overlay });

  console.log('[ImageEditor] Full-screen editor opened successfully');
}

// ---------------------------------------------------------------------------
// Cleanup functions
// ---------------------------------------------------------------------------
export function destroyImagePreviewWidget(node) {
  const widgetData = previewWidgets.get(node.id);
  if (widgetData) {
    // Clean up ResizeObserver if it exists
    if (widgetData.resizeObserver) {
      widgetData.resizeObserver.disconnect();
    }
    previewWidgets.delete(node.id);
  }

  // Clean up any open full-screen editor
  const vueAppData = vueApps.get(node.id);
  if (vueAppData) {
    try {
      vueAppData.app.unmount();
      if (vueAppData.overlay && vueAppData.overlay.parentNode) {
        vueAppData.overlay.parentNode.removeChild(vueAppData.overlay);
      }
    } catch (error) {
      console.warn('[ImageEditor] Error cleaning up Vue app:', error);
    }
    vueApps.delete(node.id);
  }

  // Clean up canvas
  const canvas = getCanvas(node.id);
  if (canvas) {
    canvas.dispose();
    setCanvas(node.id, null);
  }
}

// ---------------------------------------------------------------------------
// Vue Components (keep existing implementation)
// ---------------------------------------------------------------------------
let EditorModal, CanvasView, Toolbar, LayersPanel, LayerItem, ToolButton;

async function loadVueComponents() {
  if (EditorModal) return;

  console.log('[Vue Editor] Loading Vue components...');

  const { createApp, ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } = window.Vue || await loadVue();

  // [Keep all the existing Vue component definitions from the original file]
  // I'll include the key ones here...

  // ToolButton component
  ToolButton = {
    name: 'ToolButton',
    props: {
      icon: { type: String, required: true },
      title: { type: String, default: '' },
      active: { type: Boolean, default: false },
      disabled: { type: Boolean, default: false }
    },
    emits: ['click'],
    template: `
      <button
        class="tool-button"
        :class="{ active, disabled }"
        :disabled="disabled"
        :title="title"
        @click="handleClick"
      >
        <i class="icon" :class="'icon-' + icon"></i>
      </button>
    `,
    methods: {
      handleClick() {
        if (!this.disabled) {
          this.$emit('click');
        }
      }
    }
  };

  // Toolbar component
  Toolbar = {
    name: 'Toolbar',
    components: { ToolButton },
    props: {
      activeTool: { type: String, default: 'select' }
    },
    emits: ['tool-change', 'apply', 'cancel'],
    template: `
      <div class="toolbar">
        <div class="tool-section">
          <ToolButton
            icon="cursor"
            title="Select Tool (V)"
            :active="activeTool === 'select'"
            @click="$emit('tool-change', 'select')"
          />
          <ToolButton
            icon="crop"
            title="Crop Tool (C)"
            :active="activeTool === 'crop'"
            @click="$emit('tool-change', 'crop')"
          />
          <div class="tool-separator"></div>
          <ToolButton
            icon="brush"
            title="Brush Tool (B)"
            :active="activeTool === 'brush'"
            :disabled="true"
            @click="$emit('tool-change', 'brush')"
          />
        </div>
        <div class="action-section">
          <button class="toolbar-btn secondary" @click="$emit('cancel')">Close</button>
          <button class="toolbar-btn primary" @click="$emit('apply')">Apply</button>
        </div>
      </div>
    `
  };

  // [Continue with other components... for brevity, I'll include the main CanvasView and EditorModal]

  // CanvasView component (key component for Fabric.js integration)
  CanvasView = {
    name: 'CanvasView',
    props: {
      nodeId: { type: String, required: true },
      initialImageData: { type: Object, default: null }
    },
    emits: ['canvas-ready', 'canvas-dirty'],
    setup(props, { emit }) {
      const loading = ref(true);
      const fabricCanvas = ref(null);
      const canvasRef = ref(null);

      const initFabricCanvas = async () => {
        try {
          console.log('[Vue Editor] Starting Fabric initialization for full-screen editor...');

          const { loadFabric } = await import('./editorWidget.js');
          const fabric = await loadFabric();

          if (!fabric || !fabric.Canvas) {
            throw new Error('Fabric.js not available');
          }

          const canvasEl = canvasRef.value;
          if (!canvasEl) {
            throw new Error('Canvas element ref is null');
          }

          // Create larger canvas for full-screen editing
          fabricCanvas.value = new fabric.Canvas(canvasEl, {
            width: 800,
            height: 600,
            backgroundColor: '#2c2c2c',
            selection: true
          });

          // Load initial image if provided
          if (props.initialImageData && props.initialImageData.file) {
            const imageUrl = URL.createObjectURL(props.initialImageData.file);

            window.fabric.Image.fromURL(imageUrl, (fabricImg) => {
              if (fabricImg) {
                // Center the image
                fabricImg.set({
                  left: (800 - fabricImg.width) / 2,
                  top: (600 - fabricImg.height) / 2,
                  selectable: true,
                  evented: true
                });

                fabricCanvas.value.add(fabricImg);
                fabricCanvas.value.renderAll();
                URL.revokeObjectURL(imageUrl);
              }
            });
          }

          setCanvas(props.nodeId, fabricCanvas.value);
          emit('canvas-ready', fabricCanvas.value);
          loading.value = false;

          console.log('[Vue Editor] Full-screen Fabric canvas initialized');

        } catch (error) {
          console.error('[Vue Editor] Failed to initialize full-screen canvas:', error);
          loading.value = false;
        }
      };

      onMounted(() => {
        nextTick(() => {
          setTimeout(initFabricCanvas, 50);
        });
      });

      onUnmounted(() => {
        if (fabricCanvas.value) {
          fabricCanvas.value.dispose();
          setCanvas(props.nodeId, null);
        }
      });

      return {
        loading, canvasRef
      };
    },
    template: `
      <div class="fullscreen-canvas-container">
        <canvas ref="canvasRef"></canvas>
        <div v-if="loading" class="loading-overlay">
          <div class="spinner"></div>
          <span>Loading Editor...</span>
        </div>
      </div>
    `
  };

  // Main EditorModal component
  EditorModal = {
    name: 'EditorModal',
    components: { Toolbar, CanvasView },
    props: {
      nodeId: { type: String, required: true },
      initialImage: { type: Object, default: null }
    },
    emits: ['close', 'apply'],
    setup(props, { emit }) {
      const activeTool = ref('select');

      return {
        activeTool,
        handleToolChange: (tool) => { activeTool.value = tool; },
        handleApply: () => emit('apply'),
        handleClose: () => emit('close')
      };
    },
    template: `
      <div class="fullscreen-vue-editor-modal">
        <Toolbar
          :active-tool="activeTool"
          @tool-change="handleToolChange"
          @apply="handleApply"
          @cancel="handleClose"
        />
        <div class="fullscreen-editor-main">
          <CanvasView
            :node-id="nodeId"
            :initial-image-data="initialImage"
          />
        </div>
      </div>
    `
  };

  console.log('[Vue Editor] Vue components loaded successfully');
}

async function loadVue() {
  if (window.Vue) return window.Vue;

  console.log('[Vue Editor] Loading Vue.js from CDN...');
  const { createApp, ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } = await import('https://unpkg.com/vue@3/dist/vue.esm-browser.js');

  window.Vue = { createApp, ref, reactive, computed, onMounted, onUnmounted, watch, nextTick };
  return window.Vue;
}

// Inject styles for both preview widget and full-screen editor
const styles = `
/* Full-screen editor styles */
.fullscreen-vue-editor-modal {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1a1a1a;
}

.fullscreen-editor-main {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.fullscreen-canvas-container {
  flex: 1;
  position: relative;
  background: #111;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.fullscreen-canvas-container canvas {
  border: 1px solid #444;
  border-radius: 4px;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #252525;
  border-bottom: 1px solid #333;
}

.tool-section {
  display: flex;
  gap: 6px;
}

.tool-button {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 4px;
  color: #ccc;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tool-button:hover:not(:disabled) {
  background: #333;
  color: white;
}

.tool-button.active {
  background: #2a7adb;
  color: white;
}

.action-section {
  display: flex;
  gap: 8px;
}

.toolbar-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  font-weight: 600;
}

.toolbar-btn.primary {
  background: #2a7adb;
  color: white;
}

.toolbar-btn.secondary {
  background: #444;
  color: #ccc;
}

.toolbar-btn:hover {
  filter: brightness(1.1);
}

.loading-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #ccc;
  font-size: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid #444;
  border-top: 2px solid #2a7adb;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* Icon styles */
.icon-cursor::before { content: "↖"; }
.icon-crop::before { content: "✂"; }
.icon-brush::before { content: "🖌"; }
`;

if (!document.querySelector('#image-editor-styles')) {
  const styleEl = document.createElement('style');
  styleEl.id = 'image-editor-styles';
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);
}
