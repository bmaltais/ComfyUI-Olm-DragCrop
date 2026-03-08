"""
OlmImageEditor: Interactive Photoshop-like image editor node for ComfyUI.

Images enter via three paths:
  1. Wired IMAGE input
  2. Drag-and-drop / Ctrl+V onto the node (sets pasted_image widget)
  3. Apply button in the inline editor (also sets pasted_image widget)

The backend uses the same priority logic as OlmDragCrop so the most recent
user intent always wins across runs.
"""

import hashlib
import logging
import os

import folder_paths
import numpy as np
import torch
from folder_paths import get_temp_directory
from PIL import Image

from .utils import compute_image_hash, load_image_as_tensor

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Cross-run state (keyed by sanitized node_id)
# ---------------------------------------------------------------------------
_wire_hashes: dict = {}  # node_id → hash of last wired tensor
_pasted_images: dict = {}  # node_id → pasted_image path from last run

# Preview cache: node_id -> (input_hash, preview_filename)
_preview_cache: dict = {}
_STATE_MAX = 500  # shared limit for all per-node dicts


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _sanitize_node_id(node_id) -> str:
    nid = str(node_id) if node_id is not None else "unknown"
    sanitized = "".join(
        c
        for c in nid
        if ("A" <= c <= "Z")
        or ("a" <= c <= "z")
        or ("0" <= c <= "9")
        or c in ("_", "-")
    )
    return (sanitized or "unknown")[:64]


def _preview_filename_hash(input_hash: str) -> str:
    return hashlib.sha1(input_hash.encode("utf-8")).hexdigest()[:16]


def _evict(d: dict) -> None:
    """FIFO eviction: keep the most-recent _STATE_MAX entries."""
    if len(d) > _STATE_MAX:
        for k in list(d.keys())[: len(d) - _STATE_MAX]:
            del d[k]


def _save_preview(tensor: torch.Tensor, nid: str, input_hash: str) -> str | None:
    if not input_hash:
        return None
    temp_dir = get_temp_directory()
    cached_hash, cached_filename = _preview_cache.get(nid, (None, None))
    if cached_hash == input_hash and cached_filename:
        if os.path.isfile(os.path.join(temp_dir, cached_filename)):
            return cached_filename
    try:
        os.makedirs(temp_dir, exist_ok=True)
        filename = f"imageeditor_{nid}_{_preview_filename_hash(input_hash)}.jpg"
        filepath = os.path.join(temp_dir, filename)
        if not os.path.isfile(filepath):
            arr = (tensor[0].cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
            Image.fromarray(arr).convert("RGB").save(filepath, "JPEG", quality=90)
        _preview_cache[nid] = (input_hash, filename)
        _evict(_preview_cache)
        return filename
    except Exception as exc:
        log.warning("[OlmImageEditor] Preview save failed: %s", exc)
        return None


def _load_pasted_tensor(pasted_image: str) -> torch.Tensor | None:
    if not pasted_image:
        return None
    try:
        fp = folder_paths.get_annotated_filepath(pasted_image)
        return load_image_as_tensor(fp)
    except Exception as exc:
        log.warning(
            "[OlmImageEditor] Could not load pasted_image '%s': %s", pasted_image, exc
        )
        return None


# ---------------------------------------------------------------------------
# Node class
# ---------------------------------------------------------------------------
class OlmImageEditor:
    """Interactive inline image editor (Fabric.js canvas embedded in the node).

    Priority logic (same as OlmDragCrop):
      1. No pasted_image  → use wire (or error if absent).
      2. pasted_image is fresh this run → pasted_image wins.
      3. pasted_image is stale AND wire changed → wire wins; clear frontend widget.
      4. pasted_image is stale AND wire unchanged → keep pasted_image (last user intent).

    Apply and paste/drop both write to pasted_image, so they are treated uniformly.
    """

    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = folder_paths.filter_files_content_types(
            [
                f
                for f in os.listdir(input_dir)
                if os.path.isfile(os.path.join(input_dir, f))
            ],
            ["image"],
        )
        return {
            "optional": {
                "image": ("IMAGE",),
                # Receives paste/drop/apply uploads. Leading "" gives an empty default
                # so the node correctly passes through the wired image on first run.
                "pasted_image": ([""] + sorted(files), {"image_upload": True}),
            },
            "hidden": {
                "node_id": "UNIQUE_ID",
            },
        }

    @classmethod
    def VALIDATE_INPUTS(cls, pasted_image=None, **kwargs):
        if pasted_image and pasted_image != "":
            try:
                fp = folder_paths.get_annotated_filepath(pasted_image)
                if not os.path.isfile(fp):
                    return f"pasted_image file not found: {pasted_image}"
            except Exception as exc:
                return f"Invalid pasted_image path '{pasted_image}': {exc}"
        return True

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("IMAGE",)
    FUNCTION = "edit"
    CATEGORY = "image/editing"
    OUTPUT_NODE = True

    def edit(
        self,
        image: torch.Tensor | None = None,
        pasted_image: str = "",
        node_id: str | None = None,
    ):
        nid = _sanitize_node_id(node_id)

        # Priority logic (identical to OlmDragCrop's _resolve_source_image)
        wire_hash = compute_image_hash(image) if image is not None else ""
        last_wire = _wire_hashes.get(nid)
        last_pasted = _pasted_images.get(nid, "")

        pasted_fresh = bool(pasted_image) and (pasted_image != last_pasted)
        wire_changed = bool(image is not None) and (wire_hash != last_wire)
        clear_pasted_on_frontend = False

        if not pasted_image:
            output = image
        elif pasted_fresh:
            loaded = _load_pasted_tensor(pasted_image)
            output = loaded if loaded is not None else image
        elif wire_changed:
            output = image
            clear_pasted_on_frontend = True
        else:
            loaded = _load_pasted_tensor(pasted_image)
            output = loaded if loaded is not None else image

        if output is None:
            raise ValueError(
                "[OlmImageEditor] No image available. "
                "Connect an IMAGE input, or drop / Ctrl+V an image onto the node."
            )

        _wire_hashes[nid] = wire_hash
        _pasted_images[nid] = pasted_image if not clear_pasted_on_frontend else ""
        _evict(_wire_hashes)
        _evict(_pasted_images)

        # Preview for the frontend canvas
        input_hash = compute_image_hash(output)
        preview_filename = _save_preview(output, nid, input_hash)

        editor_info = {
            "node_id": nid,
            "input_hash": input_hash,
            "clear_pasted_image": clear_pasted_on_frontend,
        }
        if preview_filename:
            editor_info["preview_filename"] = preview_filename
            editor_info["preview_subfolder"] = ""
            editor_info["preview_type"] = "temp"

        return {
            "ui": {
                "images_custom": (
                    [{"filename": preview_filename, "subfolder": "", "type": "temp"}]
                    if preview_filename
                    else []
                ),
                "editor_info": [editor_info],
            },
            "result": (output,),
        }
