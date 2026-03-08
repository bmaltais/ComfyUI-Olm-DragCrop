<!--
  LayersPanel.vue - Layer management panel

  Implements the core layer functionality required by the specification:
  - Add, delete, duplicate layers
  - Reorder via drag & drop
  - Visibility toggle (eye icon)
  - Opacity slider (0-100%)
  - Basic blend modes (normal, multiply, screen)
  - Editable layer names
-->
<template>
  <div class="layers-panel">
    <div class="panel-header">
      <h4>Layers</h4>
      <div class="layer-actions">
        <button class="action-btn" @click="addLayer" title="Add Layer">
          +
        </button>
        <button
          class="action-btn"
          @click="duplicateActiveLayer"
          :disabled="!hasActiveLayer"
          title="Duplicate Layer"
        >
          ⧉
        </button>
        <button
          class="action-btn delete"
          @click="deleteActiveLayer"
          :disabled="!canDeleteLayer"
          title="Delete Layer"
        >
          🗑
        </button>
      </div>
    </div>

    <div class="layers-list" @drop="handleDrop" @dragover.prevent>
      <LayerItem
        v-for="(layer, index) in reversedLayers"
        :key="layer.id"
        :layer="layer"
        :index="layers.length - 1 - index"
        :active="activeLayer === layers.length - 1 - index"
        :draggable="true"
        @select="selectLayer"
        @visibility-toggle="toggleVisibility"
        @opacity-change="changeOpacity"
        @blend-mode-change="changeBlendMode"
        @name-change="changeName"
        @drag-start="handleDragStart"
        @drag-end="handleDragEnd"
      />
    </div>

    <!-- Properties for active layer -->
    <div v-if="activeLayerData" class="layer-properties">
      <div class="property-row">
        <label>Opacity</label>
        <input
          type="range"
          min="0"
          max="100"
          :value="activeLayerData.opacity"
          @input="changeOpacity(activeLayer, $event.target.value)"
          class="opacity-slider"
        >
        <span class="opacity-value">{{ activeLayerData.opacity }}%</span>
      </div>

      <div class="property-row">
        <label>Blend Mode</label>
        <select
          :value="activeLayerData.blendMode"
          @change="changeBlendMode(activeLayer, $event.target.value)"
          class="blend-select"
        >
          <option value="normal">Normal</option>
          <option value="multiply">Multiply</option>
          <option value="screen">Screen</option>
        </select>
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue'
import LayerItem from './LayerItem.vue'

export default {
  name: 'LayersPanel',

  components: {
    LayerItem
  },

  props: {
    layers: {
      type: Array,
      required: true
    },
    activeLayer: {
      type: Number,
      default: -1
    }
  },

  emits: [
    'layer-add',
    'layer-delete',
    'layer-duplicate',
    'layer-select',
    'layer-reorder',
    'layer-opacity',
    'layer-visibility',
    'layer-blend-mode',
    'layer-name-change'
  ],

  setup(props, { emit }) {
    // Computed properties
    const reversedLayers = computed(() => {
      // Display layers in reverse order (top layer first)
      return [...props.layers].reverse()
    })

    const activeLayerData = computed(() => {
      return props.layers[props.activeLayer] || null
    })

    const hasActiveLayer = computed(() => {
      return props.activeLayer >= 0 && props.activeLayer < props.layers.length
    })

    const canDeleteLayer = computed(() => {
      return hasActiveLayer.value && props.layers.length > 1
    })

    // Drag and drop state
    let draggedIndex = -1

    // Methods
    const addLayer = () => {
      emit('layer-add')
    }

    const duplicateActiveLayer = () => {
      if (hasActiveLayer.value) {
        emit('layer-duplicate', props.activeLayer)
      }
    }

    const deleteActiveLayer = () => {
      if (canDeleteLayer.value) {
        emit('layer-delete', props.activeLayer)
      }
    }

    const selectLayer = (index) => {
      emit('layer-select', index)
    }

    const toggleVisibility = (index) => {
      const layer = props.layers[index]
      emit('layer-visibility', index, !layer.visible)
    }

    const changeOpacity = (index, opacity) => {
      emit('layer-opacity', index, parseInt(opacity))
    }

    const changeBlendMode = (index, blendMode) => {
      emit('layer-blend-mode', index, blendMode)
    }

    const changeName = (index, name) => {
      emit('layer-name-change', index, name)
    }

    const handleDragStart = (index) => {
      draggedIndex = index
    }

    const handleDragEnd = () => {
      draggedIndex = -1
    }

    const handleDrop = (event) => {
      event.preventDefault()

      const dropIndex = parseInt(event.dataTransfer.getData('text/plain'))
      if (draggedIndex >= 0 && dropIndex >= 0 && draggedIndex !== dropIndex) {
        emit('layer-reorder', draggedIndex, dropIndex)
      }
    }

    return {
      // Computed
      reversedLayers,
      activeLayerData,
      hasActiveLayer,
      canDeleteLayer,

      // Methods
      addLayer,
      duplicateActiveLayer,
      deleteActiveLayer,
      selectLayer,
      toggleVisibility,
      changeOpacity,
      changeBlendMode,
      changeName,
      handleDragStart,
      handleDragEnd,
      handleDrop
    }
  }
}
</script>

<style scoped>
.layers-panel {
  width: 220px;
  background: #1e1e1e;
  border-left: 1px solid #333;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.panel-header {
  padding: 12px;
  border-bottom: 1px solid #333;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-header h4 {
  margin: 0;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}

.layer-actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: #333;
  color: #ccc;
  border-radius: 3px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.action-btn:hover:not(:disabled) {
  background: #444;
  color: white;
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.action-btn.delete:hover:not(:disabled) {
  background: #d73a49;
}

.layers-list {
  flex: 1;
  overflow-y: auto;
}

.layer-properties {
  padding: 12px;
  border-top: 1px solid #333;
  background: #252525;
}

.property-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.property-row:last-child {
  margin-bottom: 0;
}

.property-row label {
  color: #ccc;
  font-size: 11px;
  min-width: 50px;
}

.opacity-slider {
  flex: 1;
  height: 4px;
}

.opacity-value {
  color: #ccc;
  font-size: 11px;
  min-width: 30px;
  text-align: right;
}

.blend-select {
  flex: 1;
  background: #333;
  color: #ccc;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 2px 4px;
  font-size: 11px;
}
</style>
