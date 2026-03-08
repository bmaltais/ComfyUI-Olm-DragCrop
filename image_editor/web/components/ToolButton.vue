<!--
  ToolButton.vue - Individual tool button component

  Reusable component for toolbar tools with icons and active states.
-->
<template>
  <button
    class="tool-button"
    :class="{ active, disabled }"
    :disabled="disabled"
    :title="title"
    @click="handleClick"
  >
    <i class="icon" :class="`icon-${icon}`"></i>
  </button>
</template>

<script>
export default {
  name: 'ToolButton',

  props: {
    icon: {
      type: String,
      required: true
    },
    title: {
      type: String,
      default: ''
    },
    active: {
      type: Boolean,
      default: false
    },
    disabled: {
      type: Boolean,
      default: false
    }
  },

  emits: ['click'],

  methods: {
    handleClick() {
      if (!this.disabled) {
        this.$emit('click')
      }
    }
  }
}
</script>

<style scoped>
.tool-button {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #ccc;
  transition: all 0.15s ease;
}

.tool-button:hover:not(:disabled) {
  background: #333;
  color: white;
}

.tool-button.active {
  background: #2a7adb;
  color: white;
}

.tool-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.icon {
  font-size: 16px;
  display: block;
}

/* Simple icon styles using CSS - replace with icon font if available */
.icon-cursor::before {
  content: "↖";
}

.icon-crop::before {
  content: "⊞";
}

.icon-brush::before {
  content: "🖌";
}

/* Alternative using Unicode symbols */
.icon-cursor::before {
  content: "🏠"; /* Placeholder - use actual cursor icon */
}

.icon-crop::before {
  content: "✂";
}

.icon-brush::before {
  content: "🎨";
}
</style>
