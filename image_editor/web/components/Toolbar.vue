<!--
  Toolbar.vue - Tool selection and action buttons

  Provides tool selection (select, crop, etc.) and action buttons (apply, cancel).
  Follows the specification to implement crop tool first.
-->
<template>
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

      <!-- Future tools will go here -->
      <ToolButton
        icon="brush"
        title="Brush Tool (B)"
        :active="activeTool === 'brush'"
        :disabled="true"
        @click="$emit('tool-change', 'brush')"
      />
    </div>

    <div class="action-section">
      <button class="toolbar-btn secondary" @click="$emit('cancel')">
        Cancel
      </button>
      <button class="toolbar-btn primary" @click="$emit('apply')">
        Apply
      </button>
    </div>
  </div>
</template>

<script>
import ToolButton from './ToolButton.vue'

export default {
  name: 'Toolbar',

  components: {
    ToolButton
  },

  props: {
    activeTool: {
      type: String,
      default: 'select'
    }
  },

  emits: ['tool-change', 'apply', 'cancel']
}
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: #252525;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}

.tool-section {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tool-separator {
  width: 1px;
  height: 24px;
  background: #444;
  margin: 0 8px;
}

.action-section {
  display: flex;
  gap: 8px;
}

.toolbar-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: sans-serif;
  min-width: 60px;
}

.toolbar-btn.primary {
  background: #2a7adb;
  color: white;
}

.toolbar-btn.primary:hover {
  background: #1e5a9e;
}

.toolbar-btn.secondary {
  background: #444;
  color: #ccc;
}

.toolbar-btn.secondary:hover {
  background: #555;
  color: white;
}
</style>
