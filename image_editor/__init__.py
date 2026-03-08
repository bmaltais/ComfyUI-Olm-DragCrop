"""
image_editor sub-package for ComfyUI-Olm-DragCrop.

Registers the OlmImageEditor node and serves its frontend files by inserting
the local web/ directory into ComfyUI's EXTENSION_WEB_DIRS mapping before
the server sets up its static routes.
"""

import logging
import os

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Register image_editor/web/ as an additional extension web directory.
# ComfyUI normally supports one WEB_DIRECTORY per custom-node pack, but the
# EXTENSION_WEB_DIRS dict is read at server route-setup time (after all
# __init__.py files have been executed), so adding to it here is safe.
# Files are served at /extensions/ComfyUI-Olm-DragCrop-ImageEditor/
# ---------------------------------------------------------------------------
_WEB_KEY = "ComfyUI-Olm-DragCrop-ImageEditor"
_web_dir = os.path.join(os.path.dirname(__file__), "web")

try:
    import nodes as _nodes  # noqa: PLC0415 (import inside function body)

    if os.path.isdir(_web_dir):
        _nodes.EXTENSION_WEB_DIRS[_WEB_KEY] = _web_dir
        log.info("[OlmImageEditor] Registered web dir: %s", _web_dir)
    else:
        log.warning(
            "[OlmImageEditor] web/ directory not found at %s – UI will not load",
            _web_dir,
        )
except Exception as exc:
    log.warning("[OlmImageEditor] Could not register web dir: %s", exc)

# ---------------------------------------------------------------------------
# Node exports
# ---------------------------------------------------------------------------
from .node import OlmImageEditor  # noqa: E402

NODE_CLASS_MAPPINGS = {
    "OlmImageEditor": OlmImageEditor,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "OlmImageEditor": "Interactive Image Editor",
}
