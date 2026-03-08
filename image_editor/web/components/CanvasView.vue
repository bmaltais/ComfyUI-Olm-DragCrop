<!--
  CanvasView.vue - Fabric.js canvas container

  This component is responsible for:
  - Mounting and initializing the Fabric.js canvas
  - Handling paste/drop events for new images
  - Loading initial images from backend
  - Canvas event delegation to parent
-->
<template>
  <div class="canvas-container"
       @dragover.prevent="handleDragOver"
       @drop.prevent="handleDrop"
       @mouseenter="focusPasteTarget">

    <!-- Hidden textarea for paste events -->
    <textarea
      ref="pasteTarget"
      class="paste-target"
      @paste="handlePaste"
      aria-hidden="true"
    ></textarea>

    <!-- Fabric.js canvas element -->
    <canvas ref="canvasEl"></canvas>

    <!-- Loading overlay -->
    <div v-if="loading" class="loading-overlay">
      <div class="spinner"></div>
      <span>Loading Fabric.js...</span>
    </div>

    <!-- Drop hint -->
    <div v-if="dragOver" class="drop-hint">
      Drop image here to add as new layer
    </div>
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { loadFabric } from '../editorWidget.js'
import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from '../constants.js'
import { isImageFile } from '../../ComfyUI-Olm-DragCrop/utils/pasteDropUtils.js'

export default {
  name: 'CanvasView',

  props: {
    nodeId: {
      type: String,
      required: true
    },
    initialImageUrl: {
      type: String,
      default: null
    }
  },

  emits: ['canvas-ready', 'canvas-dirty', 'image-added'],

  setup(props, { emit }) {
    // Refs
    const canvasEl = ref(null)
    const pasteTarget = ref(null)
    const loading = ref(true)
    const dragOver = ref(false)
    const fabricCanvas = ref(null)

    // Deduplication for paste/drop events
    let dedupeKey = null

    // Methods
    const focusPasteTarget = () => {
      if (pasteTarget.value) {
        pasteTarget.value.focus({ preventScroll: true })
      }
    }

    const handleDragOver = (event) => {
      const items = event.dataTransfer?.items
      if (items) {
        for (const item of items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            dragOver.value = true
            event.dataTransfer.dropEffect = 'copy'
            return
          }
        }
      }
    }

    const handleDragLeave = () => {
      dragOver.value = false
    }

    const handleDrop = async (event) => {
      dragOver.value = false

      let file = null
      const files = event.dataTransfer?.files
      if (files?.length) {
        for (const f of files) {
          if (isImageFile(f)) {
            file = f
            break
          }
        }
      }

      if (!file) {
        const items = event.dataTransfer?.items
        if (items) {
          for (const item of items) {
            if (item.kind === 'file') {
              const f = item.getAsFile()
              if (f && isImageFile(f)) {
                file = f
                break
              }
            }
          }
        }
      }

      if (file) {
        await handleImageFile(file)
      }
    }

    const handlePaste = async (event) => {
      event.preventDefault()

      let file = null
      const items = event.clipboardData?.items
      if (items) {
        for (const item of items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            file = item.getAsFile()
            break
          }
        }
      }

      if (!file && event.clipboardData?.files?.length) {
        for (const f of event.clipboardData.files) {
          if (isImageFile(f)) {
            file = f
            break
          }
        }
      }

      if (file) {
        console.log('[CanvasView] Paste intercepted:', file.name, file.type)
        await handleImageFile(file)
      } else {
        console.log('[CanvasView] Paste: no image in clipboard')
      }
    }

    const handleImageFile = async (file) => {
      if (!isImageFile(file)) return

      // Deduplication
      const key = `${file.name}:${file.size}:${file.lastModified}`
      if (dedupeKey === key) return
      dedupeKey = key
      setTimeout(() => {
        if (dedupeKey === key) dedupeKey = null
      }, 1000)

      console.log('[CanvasView] Adding image file to canvas:', file.name)

      if (fabricCanvas.value) {
        await addImageToCanvas(file)
      }

      // Emit to parent for backend upload
      emit('image-added', file)
    }

    const addImageToCanvas = async (file) => {
      const fabric = window.fabric || window.Fabric
      if (!fabric || !fabricCanvas.value) return

      const url = URL.createObjectURL(file)

      try {
        const FabricImage = fabric.Image || fabric.FabricImage
        const img = await new Promise((resolve, reject) => {
          FabricImage.fromURL(url, resolve, { crossOrigin: 'anonymous' })
        })

        if (img && img.width > 0 && img.height > 0) {
          // Position new image at center
          img.set({
            left: (fabricCanvas.value.getWidth() - img.width) / 2,
            top: (fabricCanvas.value.getHeight() - img.height) / 2,
            selectable: true,
            evented: true
          })

          fabricCanvas.value.add(img)
          fabricCanvas.value.setActiveObject(img)
          fabricCanvas.value.renderAll()

          emit('canvas-dirty', true)
          console.log('[CanvasView] Image added to canvas:', img.width, '×', img.height)
        }
      } finally {
        URL.revokeObjectURL(url)
      }
    }

    const loadInitialImage = async (imageUrl) => {
      const fabric = window.fabric || window.Fabric
      if (!fabric || !fabricCanvas.value || !imageUrl) return

      console.log('[CanvasView] Loading initial image:', imageUrl)

      try {
        const FabricImage = fabric.Image || fabric.FabricImage
        const img = await new Promise((resolve, reject) => {
          FabricImage.fromURL(imageUrl, resolve, { crossOrigin: 'anonymous' })
        })

        if (img && img.width > 0 && img.height > 0) {
          // Clear canvas and set size to image
          fabricCanvas.value.clear()
          fabricCanvas.value.setWidth(img.width)
          fabricCanvas.value.setHeight(img.height)

          // Add as base layer (not selectable by default)
          img.set({
            left: 0,
            top: 0,
            selectable: false,
            evented: false
          })

          fabricCanvas.value.add(img)
          fabricCanvas.value.renderAll()

          console.log('[CanvasView] Initial image loaded:', img.width, '×', img.height)
        }
      } catch (error) {
        console.error('[CanvasView] Failed to load initial image:', error)
      }
    }

    const initFabricCanvas = async () => {
      try {
        const fabric = await loadFabric()
        console.log('[CanvasView] Fabric loaded, version:', fabric.version || '?')

        if (!canvasEl.value) {
          throw new Error('Canvas element not available')
        }

        // Create Fabric canvas
        fabricCanvas.value = new fabric.Canvas(canvasEl.value, {
          width: DEFAULT_CANVAS_WIDTH,
          height: DEFAULT_CANVAS_HEIGHT,
          backgroundColor: '#2c2c2c',
          selection: true,
          preserveObjectStacking: true
        })

        // Set up event listeners
        fabricCanvas.value.on('object:modified', () => emit('canvas-dirty', true))
        fabricCanvas.value.on('object:added', () => emit('canvas-dirty', true))
        fabricCanvas.value.on('object:removed', () => emit('canvas-dirty', true))

        loading.value = false

        // Emit canvas ready
        emit('canvas-ready', fabricCanvas.value)

        // Load initial image if provided
        if (props.initialImageUrl) {
          await loadInitialImage(props.initialImageUrl)
        }

        console.log('[CanvasView] Fabric canvas initialized for node:', props.nodeId)

      } catch (error) {
        console.error('[CanvasView] Failed to initialize Fabric canvas:', error)
        loading.value = false
      }
    }

    // Watch for initial image URL changes
    watch(() => props.initialImageUrl, (newUrl) => {
      if (newUrl && fabricCanvas.value) {
        loadInitialImage(newUrl)
      }
    })

    // Lifecycle
    onMounted(() => {
      console.log('[CanvasView] Mounting canvas for node:', props.nodeId)
      initFabricCanvas()

      // Add drag leave listener to document to handle leaving canvas area
      document.addEventListener('dragleave', handleDragLeave)
    })

    onUnmounted(() => {
      console.log('[CanvasView] Unmounting canvas for node:', props.nodeId)

      if (fabricCanvas.value) {
        fabricCanvas.value.dispose()
        fabricCanvas.value = null
      }

      document.removeEventListener('dragleave', handleDragLeave)
    })

    return {
      // Refs
      canvasEl,
      pasteTarget,
      loading,
      dragOver,
      fabricCanvas,

      // Methods
      focusPasteTarget,
      handleDragOver,
      handleDrop,
      handlePaste,
      addImageToCanvas
    }
  }
}
</script>

<style scoped>
.canvas-container {
  flex: 1;
  position: relative;
  background: #111;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  min-height: 300px;
}

.paste-target {
  position: absolute;
  opacity: 0;
  pointer-events: none;
  width: 1px;
  height: 1px;
  top: 0;
  left: 0;
}

canvas {
  max-width: 100%;
  max-height: 100%;
  border: 1px solid #444;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #ccc;
  font-size: 14px;
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

.drop-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(42, 122, 219, 0.9);
  color: white;
  padding: 16px 24px;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  pointer-events: none;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}
</style>
