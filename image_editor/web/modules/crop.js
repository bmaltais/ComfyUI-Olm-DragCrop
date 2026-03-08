/**
 * Crop tool module for OlmImageEditor
 *
 * Implements the crop functionality using Fabric.js:
 * - Draggable/resizable crop rectangle with handles
 * - Aspect ratio lock (Shift key)
 * - Semi-transparent overlay outside crop area
 * - Non-destructive preview until commit
 * - Apply crop commits the operation
 */

let cropRect = null;
let cropOverlay = null;
let isActive = false;
let aspectRatioLocked = false;
let originalAspectRatio = 1;

/**
 * Activate the crop tool on the given canvas
 * @param {fabric.Canvas} canvas - The Fabric.js canvas
 * @param {Object} options - Crop tool options
 */
export function activateCrop(canvas, options = {}) {
  if (!canvas || isActive) return;

  console.log('[Crop Tool] Activating crop tool');
  isActive = true;

  const canvasWidth = canvas.getWidth();
  const canvasHeight = canvas.getHeight();

  // Default crop area (80% of canvas, centered)
  const cropWidth = canvasWidth * 0.8;
  const cropHeight = canvasHeight * 0.8;
  const cropLeft = (canvasWidth - cropWidth) / 2;
  const cropTop = (canvasHeight - cropHeight) / 2;

  originalAspectRatio = cropWidth / cropHeight;

  // Create semi-transparent overlay that covers the entire canvas
  const fabric = window.fabric || window.Fabric;
  cropOverlay = new fabric.Rect({
    left: 0,
    top: 0,
    width: canvasWidth,
    height: canvasHeight,
    fill: 'rgba(0, 0, 0, 0.5)',
    selectable: false,
    evented: false,
    excludeFromExport: true
  });

  // Create crop rectangle
  cropRect = new fabric.Rect({
    left: cropLeft,
    top: cropTop,
    width: cropWidth,
    height: cropHeight,
    fill: 'transparent',
    stroke: '#ffffff',
    strokeWidth: 2,
    strokeDashArray: [5, 5],
    selectable: true,
    evented: true,
    excludeFromExport: true,
    // Custom properties
    _isCropRect: true
  });

  // Set up crop rectangle controls
  cropRect.setControlsVisibility({
    mtr: false, // Hide rotation control
    mb: true,   // Bottom
    ml: true,   // Left
    mr: true,   // Right
    mt: true,   // Top
    tl: true,   // Top-left
    tr: true,   // Top-right
    bl: true,   // Bottom-left
    br: true    // Bottom-right
  });

  // Add overlay and crop rect to canvas
  canvas.add(cropOverlay);
  canvas.add(cropRect);
  canvas.setActiveObject(cropRect);

  // Set up event listeners
  setupCropEvents(canvas);

  // Initial clip path update
  updateClipPath(canvas);

  canvas.renderAll();
  console.log('[Crop Tool] Crop tool activated');
}

/**
 * Deactivate the crop tool without applying changes
 * @param {fabric.Canvas} canvas - The Fabric.js canvas
 */
export function deactivateCrop(canvas) {
  if (!canvas || !isActive) return;

  console.log('[Crop Tool] Deactivating crop tool');

  // Remove crop elements
  if (cropRect) {
    canvas.remove(cropRect);
    cropRect = null;
  }

  if (cropOverlay) {
    canvas.remove(cropOverlay);
    cropOverlay = null;
  }

  // Clear clip path
  canvas.clipPath = null;

  // Remove event listeners
  removeCropEvents(canvas);

  isActive = false;
  aspectRatioLocked = false;

  canvas.renderAll();
  console.log('[Crop Tool] Crop tool deactivated');
}

/**
 * Apply the crop operation (commits the changes)
 * @param {fabric.Canvas} canvas - The Fabric.js canvas
 * @returns {boolean} - Success status
 */
export function applyCrop(canvas) {
  if (!canvas || !isActive || !cropRect) {
    console.warn('[Crop Tool] Cannot apply crop - tool not active or no crop rect');
    return false;
  }

  try {
    console.log('[Crop Tool] Applying crop...');

    const rect = cropRect;
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const width = Math.min(rect.width * rect.scaleX, canvas.getWidth() - left);
    const height = Math.min(rect.height * rect.scaleY, canvas.getHeight() - top);

    // Set canvas dimensions to crop area
    canvas.setWidth(width);
    canvas.setHeight(height);

    // Adjust all objects' positions relative to crop area
    const objects = canvas.getObjects().filter(obj => !obj._isCropRect && obj !== cropOverlay);
    objects.forEach(obj => {
      obj.set({
        left: obj.left - left,
        top: obj.top - top
      });
    });

    // Clean up crop elements
    deactivateCrop(canvas);

    canvas.renderAll();
    console.log('[Crop Tool] Crop applied successfully');
    return true;

  } catch (error) {
    console.error('[Crop Tool] Failed to apply crop:', error);
    return false;
  }
}

/**
 * Toggle aspect ratio lock
 * @param {boolean} locked - Whether to lock aspect ratio
 */
export function setAspectRatioLock(locked) {
  aspectRatioLocked = locked;
  console.log('[Crop Tool] Aspect ratio lock:', locked ? 'ON' : 'OFF');
}

/**
 * Check if crop tool is currently active
 * @returns {boolean}
 */
export function isActivated() {
  return isActive;
}

// ---------------------------------------------------------------------------
// Internal functions
// ---------------------------------------------------------------------------

function setupCropEvents(canvas) {
  canvas.on('object:scaling', handleCropScaling);
  canvas.on('object:moving', handleCropMoving);
  canvas.on('object:modified', handleCropModified);

  // Keyboard events for aspect ratio lock
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);
}

function removeCropEvents(canvas) {
  canvas.off('object:scaling', handleCropScaling);
  canvas.off('object:moving', handleCropMoving);
  canvas.off('object:modified', handleCropModified);

  document.removeEventListener('keydown', handleKeyDown);
  document.removeEventListener('keyup', handleKeyUp);
}

function handleCropScaling(event) {
  const obj = event.target;
  if (!obj || !obj._isCropRect) return;

  if (aspectRatioLocked) {
    // Maintain aspect ratio during scaling
    const scaleX = obj.scaleX;
    const scaleY = scaleX * originalAspectRatio;
    obj.set('scaleY', scaleY);
  }

  updateClipPath(event.target.canvas);
}

function handleCropMoving(event) {
  const obj = event.target;
  if (!obj || !obj._isCropRect) return;

  // Constrain crop rectangle to canvas bounds
  const canvas = event.target.canvas;
  const canvasWidth = canvas.getWidth();
  const canvasHeight = canvas.getHeight();

  const objWidth = obj.width * obj.scaleX;
  const objHeight = obj.height * obj.scaleY;

  // Keep crop rectangle within canvas bounds
  obj.set({
    left: Math.max(0, Math.min(obj.left, canvasWidth - objWidth)),
    top: Math.max(0, Math.min(obj.top, canvasHeight - objHeight))
  });

  updateClipPath(canvas);
}

function handleCropModified(event) {
  updateClipPath(event.target.canvas);
}

function updateClipPath(canvas) {
  if (!cropRect || !canvas) return;

  // Create clip path that shows everything except the crop area
  // This creates the "darkened outside" effect
  const fabric = window.fabric || window.Fabric;
  const canvasWidth = canvas.getWidth();
  const canvasHeight = canvas.getHeight();

  const cropLeft = cropRect.left;
  const cropTop = cropRect.top;
  const cropWidth = cropRect.width * cropRect.scaleX;
  const cropHeight = cropRect.height * cropRect.scaleY;

  // Update overlay to exclude crop area
  if (cropOverlay) {
    // Create a complex path that covers everything except the crop area
    const pathString = [
      `M 0 0`,
      `L ${canvasWidth} 0`,
      `L ${canvasWidth} ${canvasHeight}`,
      `L 0 ${canvasHeight}`,
      `L 0 0`,
      `M ${cropLeft} ${cropTop}`,
      `L ${cropLeft} ${cropTop + cropHeight}`,
      `L ${cropLeft + cropWidth} ${cropTop + cropHeight}`,
      `L ${cropLeft + cropWidth} ${cropTop}`,
      `L ${cropLeft} ${cropTop}`,
      `Z`
    ].join(' ');

    cropOverlay.set({
      path: pathString,
      fill: 'rgba(0, 0, 0, 0.5)'
    });
  }

  canvas.renderAll();
}

function handleKeyDown(event) {
  if (event.key === 'Shift' && isActive) {
    setAspectRatioLock(true);
  }
}

function handleKeyUp(event) {
  if (event.key === 'Shift' && isActive) {
    setAspectRatioLock(false);
  }
}

// Export the crop tool interface
export default {
  activate: activateCrop,
  deactivate: deactivateCrop,
  apply: applyCrop,
  setAspectRatioLock,
  isActivated
};
