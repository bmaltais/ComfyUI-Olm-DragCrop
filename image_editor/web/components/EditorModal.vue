<!--
  EditorModal.vue - Main Vue container for the image editor

  This is the root component that contains all editor functionality.
  It's mounted as a modal/overlay when the user opens the editor.
-->
<template>
  <div class="editor-modal" @keydown="handleKeydown">
    <div class="editor-header">
      <h3>Interactive Image Editor</h3>
      <button class="close-btn" @click="closeEditor">&times;</button>
    </div>

    <div class="editor-body">
      <Toolbar
        :active-tool="activeTool"
        @tool-change="setActiveTool"
        @apply="applyChanges"
        @cancel="closeEditor"
      />

      <div class="editor-main">
        <CanvasView
          ref="canvasView"
          :node-id="nodeId"
          @canvas-ready="onCanvasReady"
          @canvas-dirty="setDirty"
        />

        <LayersPanel
          :layers="layers"
          :active-layer="activeLayer"
          @layer-select="selectLayer"
          @layer-add="addLayer"
          @layer-delete="deleteLayer"
          @layer-duplicate="duplicateLayer"
          @layer-reorder="reorderLayers"
          @layer-opacity="setLayerOpacity"
          @layer-visibility="setLayerVisibility"
          @layer-blend-mode="setLayerBlendMode"
        />
      </div>
    </div>
  </div>
</template>

<script>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import Toolbar from './Toolbar.vue'
import CanvasView from './CanvasView.vue'
import LayersPanel from './LayersPanel.vue'
import { setDirty, isDirty } from '../editorState.js'

export default {
  name: 'EditorModal',
  components: {
    Toolbar,
    CanvasView,
    LayersPanel
  },

  props: {
    nodeId: {
      type: String,
      required: true
    },
    initialImage: {
      type: String,
      default: null
    }
  },

  emits: ['close', 'apply'],

  setup(props, { emit }) {
    // Reactive state
    const canvasView = ref(null)
    const activeTool = ref('select')
    const activeLayer = ref(0)
    const layers = reactive([])
    const fabricCanvas = ref(null)

    // Computed properties
    const dirty = computed(() => isDirty(props.nodeId))

    // Methods
    const setActiveTool = (tool) => {
      activeTool.value = tool
      // Deactivate previous tool and activate new one
      if (fabricCanvas.value) {
        // Tool switching logic will be handled by individual tool modules
        console.log('[EditorModal] Tool changed to:', tool)
      }
    }

    const onCanvasReady = (canvas) => {
      fabricCanvas.value = canvas

      // Initialize with base layer if we have an initial image
      if (props.initialImage) {
        // This will be handled by CanvasView component
        console.log('[EditorModal] Canvas ready with initial image')
      }

      // Set up initial empty layer if no image
      if (layers.length === 0) {
        addLayer('Base Layer')
      }
    }

    const setDirty = (isDirty) => {
      setDirty(props.nodeId, isDirty)
    }

    const selectLayer = (index) => {
      activeLayer.value = index
      // Update Fabric canvas selection
      if (fabricCanvas.value && layers[index]) {
        // Layer selection logic
      }
    }

    const addLayer = (name = 'New Layer') => {
      const newLayer = {
        id: Date.now().toString(),
        name,
        visible: true,
        opacity: 100,
        blendMode: 'normal',
        fabricObject: null
      }
      layers.push(newLayer)
      activeLayer.value = layers.length - 1
      setDirty(true)
    }

    const deleteLayer = (index) => {
      if (layers.length > 1) { // Keep at least one layer
        const layer = layers[index]
        if (layer.fabricObject && fabricCanvas.value) {
          fabricCanvas.value.remove(layer.fabricObject)
        }
        layers.splice(index, 1)
        if (activeLayer.value >= index && activeLayer.value > 0) {
          activeLayer.value--
        }
        setDirty(true)
      }
    }

    const duplicateLayer = (index) => {
      const originalLayer = layers[index]
      const newLayer = {
        ...originalLayer,
        id: Date.now().toString(),
        name: originalLayer.name + ' Copy',
        fabricObject: null // Will be cloned in Fabric
      }
      layers.splice(index + 1, 0, newLayer)
      activeLayer.value = index + 1
      setDirty(true)
    }

    const reorderLayers = (oldIndex, newIndex) => {
      const layer = layers.splice(oldIndex, 1)[0]
      layers.splice(newIndex, 0, layer)
      // Update Fabric canvas z-order
      setDirty(true)
    }

    const setLayerOpacity = (index, opacity) => {
      layers[index].opacity = opacity
      if (layers[index].fabricObject) {
        layers[index].fabricObject.set('opacity', opacity / 100)
        fabricCanvas.value?.renderAll()
      }
      setDirty(true)
    }

    const setLayerVisibility = (index, visible) => {
      layers[index].visible = visible
      if (layers[index].fabricObject) {
        layers[index].fabricObject.set('visible', visible)
        fabricCanvas.value?.renderAll()
      }
      setDirty(true)
    }

    const setLayerBlendMode = (index, blendMode) => {
      layers[index].blendMode = blendMode
      if (layers[index].fabricObject) {
        // Map blend mode to Fabric's globalCompositeOperation
        const compositeOp = {
          'normal': 'source-over',
          'multiply': 'multiply',
          'screen': 'screen'
        }[blendMode] || 'source-over'

        layers[index].fabricObject.set('globalCompositeOperation', compositeOp)
        fabricCanvas.value?.renderAll()
      }
      setDirty(true)
    }

    const applyChanges = () => {
      emit('apply', fabricCanvas.value)
    }

    const closeEditor = () => {
      emit('close')
    }

    const handleKeydown = (event) => {
      // Handle keyboard shortcuts
      if (event.ctrlKey || event.metaKey) {
        switch (event.key.toLowerCase()) {
          case 'z':
            if (event.shiftKey) {
              // Redo
              console.log('[EditorModal] Redo shortcut')
            } else {
              // Undo
              console.log('[EditorModal] Undo shortcut')
            }
            event.preventDefault()
            break
          case 's':
            // Apply (Ctrl+S)
            applyChanges()
            event.preventDefault()
            break
        }
      } else {
        switch (event.key.toLowerCase()) {
          case 'c':
            setActiveTool('crop')
            break
          case 'v':
            setActiveTool('select')
            break
          case 'escape':
            if (activeTool.value !== 'select') {
              setActiveTool('select')
            } else {
              closeEditor()
            }
            break
        }
      }
    }

    onMounted(() => {
      console.log('[EditorModal] Mounted for node:', props.nodeId)
    })

    onUnmounted(() => {
      console.log('[EditorModal] Unmounted for node:', props.nodeId)
    })

    return {
      // Refs
      canvasView,

      // Reactive state
      activeTool,
      activeLayer,
      layers,

      // Computed
      dirty,

      // Methods
      setActiveTool,
      onCanvasReady,
      setDirty,
      selectLayer,
      addLayer,
      deleteLayer,
      duplicateLayer,
      reorderLayers,
      setLayerOpacity,
      setLayerVisibility,
      setLayerBlendMode,
      applyChanges,
      closeEditor,
      handleKeydown
    }
  }
}
</script>

<style scoped>
.editor-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  flex-direction: column;
  z-index: 10000;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #2a2a2a;
  border-bottom: 1px solid #444;
}

.editor-header h3 {
  margin: 0;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  color: #ccc;
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-btn:hover {
  background: #444;
  color: #fff;
}

.editor-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #1a1a1a;
}

.editor-main {
  flex: 1;
  display: flex;
  min-height: 0;
}
</style>
