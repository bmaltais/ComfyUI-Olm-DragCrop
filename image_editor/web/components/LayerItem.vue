<!--
  LayerItem.vue - Individual layer in the layers panel

  Represents a single layer with:
  - Thumbnail preview
  - Editable name
  - Visibility toggle (eye icon)
  - Active state indication
  - Drag & drop support for reordering
-->
<template>
  <div
    class="layer-item"
    :class="{ active, dragging }"
    :draggable="draggable"
    @click="selectLayer"
    @dragstart="handleDragStart"
    @dragend="handleDragEnd"
    @dragover.prevent="handleDragOver"
    @drop.prevent="handleDrop"
  >
    <!-- Layer thumbnail -->
    <div class="layer-thumbnail">
      <canvas
        ref="thumbnailCanvas"
        width="32"
        height="32"
        class="thumbnail-canvas"
      ></canvas>
    </div>

    <!-- Layer info -->
    <div class="layer-info">
      <input
        v-if="editingName"
        v-model="editedName"
        @blur="finishNameEdit"
        @keydown.enter="finishNameEdit"
        @keydown.escape="cancelNameEdit"
        class="name-input"
        ref="nameInput"
      />
      <div
        v-else
        class="layer-name"
        @dblclick="startNameEdit"
        :title="layer.name"
      >
        {{ layer.name }}
      </div>
    </div>

    <!-- Layer controls -->
    <div class="layer-controls">
      <button
        class="visibility-btn"
        :class="{ hidden: !layer.visible }"
        @click.stop="toggleVisibility"
        :title="layer.visible ? 'Hide Layer' : 'Show Layer'"
      >
        {{ layer.visible ? '👁' : '🚫' }}
      </button>
    </div>

    <!-- Drop indicator -->
    <div v-if="dragOver" class="drop-indicator"></div>
  </div>
</template>

<script>
import { ref, nextTick, onMounted, watch } from 'vue'

export default {
  name: 'LayerItem',

  props: {
    layer: {
      type: Object,
      required: true
    },
    index: {
      type: Number,
      required: true
    },
    active: {
      type: Boolean,
      default: false
    },
    draggable: {
      type: Boolean,
      default: true
    }
  },

  emits: [
    'select',
    'visibility-toggle',
    'name-change',
    'drag-start',
    'drag-end'
  ],

  setup(props, { emit }) {
    // Refs
    const thumbnailCanvas = ref(null)
    const nameInput = ref(null)

    // State
    const editingName = ref(false)
    const editedName = ref('')
    const dragging = ref(false)
    const dragOver = ref(false)

    // Methods
    const selectLayer = () => {
      emit('select', props.index)
    }

    const toggleVisibility = () => {
      emit('visibility-toggle', props.index)
    }

    const startNameEdit = () => {
      editingName.value = true
      editedName.value = props.layer.name
      nextTick(() => {
        if (nameInput.value) {
          nameInput.value.focus()
          nameInput.value.select()
        }
      })
    }

    const finishNameEdit = () => {
      if (editedName.value.trim() && editedName.value !== props.layer.name) {
        emit('name-change', props.index, editedName.value.trim())
      }
      editingName.value = false
    }

    const cancelNameEdit = () => {
      editingName.value = false
      editedName.value = ''
    }

    const handleDragStart = (event) => {
      dragging.value = true
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', props.index.toString())
      emit('drag-start', props.index)
    }

    const handleDragEnd = () => {
      dragging.value = false
      emit('drag-end')
    }

    const handleDragOver = (event) => {
      if (event.dataTransfer.types.includes('text/plain')) {
        dragOver.value = true
        event.dataTransfer.dropEffect = 'move'
      }
    }

    const handleDrop = (event) => {
      dragOver.value = false
      const draggedIndex = parseInt(event.dataTransfer.getData('text/plain'))
      if (draggedIndex !== props.index) {
        // The parent will handle the reorder
        event.stopPropagation()
      }
    }

    const generateThumbnail = () => {
      const canvas = thumbnailCanvas.value
      if (!canvas) return

      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, 32, 32)

      // Generate a simple thumbnail
      if (props.layer.fabricObject) {
        // If this layer has a Fabric object, try to render it
        try {
          // This is a simplified approach - in practice, you'd want to
          // render the fabric object to a temporary canvas and scale it down
          ctx.fillStyle = '#666'
          ctx.fillRect(4, 4, 24, 24)
          ctx.fillStyle = '#999'
          ctx.fillRect(8, 8, 16, 16)
        } catch (error) {
          console.warn('[LayerItem] Thumbnail generation failed:', error)
        }
      } else {
        // Default thumbnail for empty layers
        ctx.fillStyle = '#444'
        ctx.fillRect(2, 2, 28, 28)
        ctx.strokeStyle = '#666'
        ctx.strokeRect(2, 2, 28, 28)
      }
    }

    // Watch for layer changes to regenerate thumbnail
    watch(() => props.layer, generateThumbnail, { deep: true })
    watch(() => props.layer.visible, () => {
      // Update thumbnail opacity based on visibility
      const canvas = thumbnailCanvas.value
      if (canvas) {
        canvas.style.opacity = props.layer.visible ? '1' : '0.5'
      }
    })

    onMounted(() => {
      generateThumbnail()
    })

    return {
      // Refs
      thumbnailCanvas,
      nameInput,

      // State
      editingName,
      editedName,
      dragging,
      dragOver,

      // Methods
      selectLayer,
      toggleVisibility,
      startNameEdit,
      finishNameEdit,
      cancelNameEdit,
      handleDragStart,
      handleDragEnd,
      handleDragOver,
      handleDrop
    }
  }
}
</script>

<style scoped>
.layer-item {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  cursor: pointer;
  position: relative;
  user-select: none;
}

.layer-item:hover {
  background: #2a2a2a;
}

.layer-item.active {
  background: #2a7adb;
}

.layer-item.dragging {
  opacity: 0.5;
}

.layer-thumbnail {
  margin-right: 8px;
  flex-shrink: 0;
}

.thumbnail-canvas {
  display: block;
  border: 1px solid #444;
  border-radius: 2px;
}

.layer-info {
  flex: 1;
  min-width: 0;
}

.layer-name {
  color: #ccc;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.layer-item.active .layer-name {
  color: white;
}

.name-input {
  background: #333;
  border: 1px solid #555;
  color: #fff;
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 2px;
  width: 100%;
}

.layer-controls {
  display: flex;
  gap: 4px;
  margin-left: 8px;
}

.visibility-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  border-radius: 2px;
}

.visibility-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.visibility-btn.hidden {
  opacity: 0.5;
}

.drop-indicator {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: #2a7adb;
  top: -1px;
}
</style>
