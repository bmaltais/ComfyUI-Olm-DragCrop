/**
 * Layers module for OlmImageEditor
 *
 * Manages the layer system and synchronization between Vue reactive state
 * and Fabric.js canvas objects. Each layer corresponds to a Fabric object.
 */

/**
 * Create a new layer object
 * @param {string} name - Layer name
 * @param {Object} options - Layer options
 * @returns {Object} Layer object
 */
export function createLayer(name = 'New Layer', options = {}) {
  return {
    id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9),
    name,
    visible: options.visible !== undefined ? options.visible : true,
    opacity: options.opacity !== undefined ? options.opacity : 100,
    blendMode: options.blendMode || 'normal',
    fabricObject: null,
    locked: options.locked || false,
    ...options
  };
}

/**
 * Add a layer to the canvas and layers array
 * @param {fabric.Canvas} canvas - Fabric canvas
 * @param {Array} layers - Vue reactive layers array
 * @param {Object} layer - Layer object
 * @param {number} index - Insert at index (optional, defaults to end)
 */
export function addLayer(canvas, layers, layer, index = -1) {
  if (index === -1) {
    layers.push(layer);
    index = layers.length - 1;
  } else {
    layers.splice(index, 0, layer);
  }

  // If layer has a fabric object, add it to canvas
  if (layer.fabricObject) {
    canvas.add(layer.fabricObject);
    syncLayerToFabricObject(layer);
  }

  console.log('[Layers] Added layer:', layer.name, 'at index:', index);
  return index;
}

/**
 * Remove a layer from the canvas and layers array
 * @param {fabric.Canvas} canvas - Fabric canvas
 * @param {Array} layers - Vue reactive layers array
 * @param {number} index - Layer index to remove
 * @returns {Object|null} Removed layer or null
 */
export function removeLayer(canvas, layers, index) {
  if (index < 0 || index >= layers.length) return null;

  const layer = layers[index];

  // Remove fabric object from canvas
  if (layer.fabricObject) {
    canvas.remove(layer.fabricObject);
  }

  // Remove from layers array
  const removed = layers.splice(index, 1)[0];

  console.log('[Layers] Removed layer:', removed.name, 'from index:', index);
  canvas.renderAll();
  return removed;
}

/**
 * Duplicate a layer
 * @param {fabric.Canvas} canvas - Fabric canvas
 * @param {Array} layers - Vue reactive layers array
 * @param {number} index - Index of layer to duplicate
 * @returns {number} Index of new layer
 */
export function duplicateLayer(canvas, layers, index) {
  if (index < 0 || index >= layers.length) return -1;

  const originalLayer = layers[index];
  const newLayer = createLayer(originalLayer.name + ' Copy', {
    visible: originalLayer.visible,
    opacity: originalLayer.opacity,
    blendMode: originalLayer.blendMode,
    locked: originalLayer.locked
  });

  // Clone fabric object if it exists
  if (originalLayer.fabricObject) {
    originalLayer.fabricObject.clone((cloned) => {
      newLayer.fabricObject = cloned;
      // Offset the cloned object slightly
      cloned.set({
        left: cloned.left + 10,
        top: cloned.top + 10
      });
      canvas.add(cloned);
      syncLayerToFabricObject(newLayer);
      canvas.renderAll();
    });
  }

  // Add layer after the original
  const newIndex = addLayer(canvas, layers, newLayer, index + 1);

  console.log('[Layers] Duplicated layer:', originalLayer.name);
  return newIndex;
}

/**
 * Reorder layers (move layer from one index to another)
 * @param {fabric.Canvas} canvas - Fabric canvas
 * @param {Array} layers - Vue reactive layers array
 * @param {number} fromIndex - Source index
 * @param {number} toIndex - Target index
 */
export function reorderLayers(canvas, layers, fromIndex, toIndex) {
  if (fromIndex < 0 || fromIndex >= layers.length ||
      toIndex < 0 || toIndex >= layers.length ||
      fromIndex === toIndex) {
    return;
  }

  // Move in layers array
  const layer = layers.splice(fromIndex, 1)[0];
  layers.splice(toIndex, 0, layer);

  // Update z-order in Fabric canvas
  updateCanvasZOrder(canvas, layers);

  console.log('[Layers] Reordered layer from', fromIndex, 'to', toIndex);
}

/**
 * Set layer visibility
 * @param {fabric.Canvas} canvas - Fabric canvas
 * @param {Object} layer - Layer object
 * @param {boolean} visible - Visibility state
 */
export function setLayerVisibility(canvas, layer, visible) {
  layer.visible = visible;

  if (layer.fabricObject) {
    layer.fabricObject.set('visible', visible);
    canvas.renderAll();
  }

  console.log('[Layers] Set layer visibility:', layer.name, visible);
}

/**
 * Set layer opacity
 * @param {fabric.Canvas} canvas - Fabric canvas
 * @param {Object} layer - Layer object
 * @param {number} opacity - Opacity value (0-100)
 */
export function setLayerOpacity(canvas, layer, opacity) {
  layer.opacity = Math.max(0, Math.min(100, opacity));

  if (layer.fabricObject) {
    layer.fabricObject.set('opacity', layer.opacity / 100);
    canvas.renderAll();
  }

  console.log('[Layers] Set layer opacity:', layer.name, layer.opacity);
}

/**
 * Set layer blend mode
 * @param {fabric.Canvas} canvas - Fabric canvas
 * @param {Object} layer - Layer object
 * @param {string} blendMode - Blend mode ('normal', 'multiply', 'screen', etc.)
 */
export function setLayerBlendMode(canvas, layer, blendMode) {
  layer.blendMode = blendMode;

  if (layer.fabricObject) {
    const compositeOp = getCompositeOperation(blendMode);
    layer.fabricObject.set('globalCompositeOperation', compositeOp);
    canvas.renderAll();
  }

  console.log('[Layers] Set layer blend mode:', layer.name, blendMode);
}

/**
 * Create a layer from a Fabric object
 * @param {fabric.Object} fabricObject - Fabric object
 * @param {string} name - Layer name
 * @returns {Object} Layer object
 */
export function createLayerFromFabricObject(fabricObject, name) {
  const layer = createLayer(name);
  layer.fabricObject = fabricObject;

  // Sync properties from fabric object
  if (fabricObject.opacity !== undefined) {
    layer.opacity = Math.round(fabricObject.opacity * 100);
  }
  if (fabricObject.visible !== undefined) {
    layer.visible = fabricObject.visible;
  }

  // Add reference to layer in fabric object
  fabricObject._layerId = layer.id;

  return layer;
}

/**
 * Sync layer properties to its Fabric object
 * @param {Object} layer - Layer object
 */
export function syncLayerToFabricObject(layer) {
  if (!layer.fabricObject) return;

  layer.fabricObject.set({
    opacity: layer.opacity / 100,
    visible: layer.visible,
    globalCompositeOperation: getCompositeOperation(layer.blendMode),
    selectable: !layer.locked,
    evented: !layer.locked
  });

  // Add layer reference
  layer.fabricObject._layerId = layer.id;
}

/**
 * Update canvas z-order to match layers array order
 * @param {fabric.Canvas} canvas - Fabric canvas
 * @param {Array} layers - Layers array
 */
export function updateCanvasZOrder(canvas, layers) {
  // Fabric canvas z-order: first added = bottom, last added = top
  // Layers array: index 0 = bottom, last index = top

  layers.forEach((layer, index) => {
    if (layer.fabricObject) {
      canvas.moveTo(layer.fabricObject, index);
    }
  });

  canvas.renderAll();
}

/**
 * Find layer by Fabric object
 * @param {Array} layers - Layers array
 * @param {fabric.Object} fabricObject - Fabric object
 * @returns {Object|null} Layer object or null
 */
export function findLayerByFabricObject(layers, fabricObject) {
  if (fabricObject._layerId) {
    return layers.find(layer => layer.id === fabricObject._layerId);
  }
  return layers.find(layer => layer.fabricObject === fabricObject);
}

/**
 * Get all visible layers
 * @param {Array} layers - Layers array
 * @returns {Array} Visible layers
 */
export function getVisibleLayers(layers) {
  return layers.filter(layer => layer.visible);
}

/**
 * Generate layer thumbnail (simplified)
 * @param {Object} layer - Layer object
 * @param {number} size - Thumbnail size (default: 32)
 * @returns {string|null} Data URL of thumbnail or null
 */
export function generateLayerThumbnail(layer, size = 32) {
  if (!layer.fabricObject) return null;

  try {
    // This is a simplified thumbnail generation
    // In a full implementation, you'd render the fabric object to a small canvas
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Simple placeholder thumbnail
    ctx.fillStyle = '#444';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#666';
    ctx.fillRect(2, 2, size - 4, size - 4);

    return canvas.toDataURL();
  } catch (error) {
    console.warn('[Layers] Failed to generate thumbnail:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helper functions
// ---------------------------------------------------------------------------

/**
 * Convert blend mode to Fabric.js composite operation
 * @param {string} blendMode - Blend mode name
 * @returns {string} Composite operation
 */
function getCompositeOperation(blendMode) {
  const blendModeMap = {
    'normal': 'source-over',
    'multiply': 'multiply',
    'screen': 'screen',
    'overlay': 'overlay',
    'soft-light': 'soft-light',
    'hard-light': 'hard-light',
    'color-dodge': 'color-dodge',
    'color-burn': 'color-burn',
    'darken': 'darken',
    'lighten': 'lighten',
    'difference': 'difference',
    'exclusion': 'exclusion'
  };

  return blendModeMap[blendMode] || 'source-over';
}

// Export all functions
export default {
  createLayer,
  addLayer,
  removeLayer,
  duplicateLayer,
  reorderLayers,
  setLayerVisibility,
  setLayerOpacity,
  setLayerBlendMode,
  createLayerFromFabricObject,
  syncLayerToFabricObject,
  updateCanvasZOrder,
  findLayerByFabricObject,
  getVisibleLayers,
  generateLayerThumbnail
};
