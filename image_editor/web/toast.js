/**
 * Toast notification system for OlmImageEditor
 *
 * Uses ComfyUI's native toast system if available, otherwise falls back
 * to a simple DOM-based notification system.
 */

let toastContainer = null;

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type: 'success', 'error', 'info', 'warning'
 * @param {number} duration - Duration in milliseconds (default: 3000)
 */
export function showToast(message, type = 'info', duration = 3000) {
  console.log(`[Toast] ${type.toUpperCase()}: ${message}`);

  // Try to use ComfyUI's native toast system first
  if (window.app?.extensionManager?.toast) {
    try {
      const severity = {
        'success': 'success',
        'error': 'error',
        'warning': 'warn',
        'info': 'info'
      }[type] || 'info';

      window.app.extensionManager.toast.add({
        severity,
        summary: message,
        life: duration
      });
      return;
    } catch (error) {
      console.warn('[Toast] Failed to use native toast system:', error);
    }
  }

  // Fallback to custom toast implementation
  showFallbackToast(message, type, duration);
}

/**
 * Fallback toast implementation using DOM elements
 */
function showFallbackToast(message, type, duration) {
  // Create toast container if it doesn't exist
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'olm-toast-container';
    toastContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      pointer-events: none;
    `;
    document.body.appendChild(toastContainer);
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `olm-toast olm-toast-${type}`;

  const colors = {
    success: { bg: '#10B981', border: '#059669' },
    error: { bg: '#EF4444', border: '#DC2626' },
    warning: { bg: '#F59E0B', border: '#D97706' },
    info: { bg: '#3B82F6', border: '#2563EB' }
  };

  const color = colors[type] || colors.info;

  toast.style.cssText = `
    background: ${color.bg};
    border-left: 4px solid ${color.border};
    color: white;
    padding: 12px 16px;
    margin-bottom: 8px;
    border-radius: 4px;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    pointer-events: auto;
    cursor: pointer;
    transition: all 0.3s ease;
    opacity: 0;
    transform: translateX(100%);
  `;

  toast.textContent = message;
  toastContainer.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(0)';
  });

  // Add click to dismiss
  toast.addEventListener('click', () => removeToast(toast));

  // Auto-remove after duration
  setTimeout(() => removeToast(toast), duration);
}

/**
 * Remove a toast element with animation
 */
function removeToast(toast) {
  if (!toast || !toast.parentNode) return;

  toast.style.opacity = '0';
  toast.style.transform = 'translateX(100%)';

  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 300);
}

/**
 * Clear all toasts
 */
export function clearToasts() {
  if (toastContainer) {
    const toasts = toastContainer.querySelectorAll('.olm-toast');
    toasts.forEach(removeToast);
  }
}
