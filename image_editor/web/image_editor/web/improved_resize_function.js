// Helper function to update image preview size based on available node space
function updateImagePreviewSize(node, imagePreview) {
  if (!imagePreview || !imagePreview.naturalWidth) return;

  const nodeWidth = node.size?.[0] ?? 300;
  const nodeHeight = node.size?.[1] ?? 140;

  // Calculate available space for image (subtract button and padding space)
  const buttonHeight = 36; // Edit button height + margin
  const padding = 32; // Top/bottom padding
  const availableImageHeight = nodeHeight - buttonHeight - padding;
  const availableImageWidth = nodeWidth - padding;

  // Ensure minimum viable space but allow much larger images
  const effectiveImageHeight = Math.max(80, availableImageHeight);
  const effectiveImageWidth = Math.max(100, availableImageWidth);

  // Reset any previous constraints
  imagePreview.style.minHeight = '';
  imagePreview.style.minWidth = '';

  // Update image styling to fill available space more aggressively
  imagePreview.style.maxHeight = `${effectiveImageHeight}px`;
  imagePreview.style.maxWidth = `${effectiveImageWidth}px`;
  imagePreview.style.width = 'auto';
  imagePreview.style.height = 'auto';
  imagePreview.style.objectFit = 'contain';

  // Force the image to scale up by using min-height/min-width when there's lots of space
  if (effectiveImageHeight > 150) {
    imagePreview.style.minHeight = `${Math.min(effectiveImageHeight * 0.7, 300)}px`;
  }
  if (effectiveImageWidth > 200) {
    imagePreview.style.minWidth = `${Math.min(effectiveImageWidth * 0.7, 400)}px`;
  }

  console.log('[ImageEditor] Image preview resized to fill available space:', {
    nodeSize: `${nodeWidth}x${nodeHeight}`,
    availableSpace: `${effectiveImageWidth}x${effectiveImageHeight}`,
    constraints: {
      maxHeight: `${effectiveImageHeight}px`,
      maxWidth: `${effectiveImageWidth}px`,
      minHeight: imagePreview.style.minHeight,
      minWidth: imagePreview.style.minWidth
    },
    imageNaturalSize: `${imagePreview.naturalWidth}x${imagePreview.naturalHeight}`
  });
}
