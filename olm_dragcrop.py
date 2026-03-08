"""
ComfyUI-Olm-DragCrop: Interactive image cropping and perspective correction nodes.

This module provides three custom nodes for ComfyUI:
- OlmDragCrop: Interactive crop box with drag handles for precise region selection
- OlmDragPerspective: Perspective correction with corner dragging and curve warping
- OlmCropInfoInterpreter: Helper node to extract crop coordinates from JSON output

Features:
- Paste/drop image input support (Ctrl+V, drag-and-drop)
- Preview image caching for performance optimization
- Optional opencv-python for advanced Coons patch warping
- Real-time UI overlay rendering with snapping and aspect ratio controls
"""

import torch
import numpy as np
from PIL import Image
import os
import hashlib
import folder_paths
from folder_paths import get_temp_directory
import json
from collections import OrderedDict

DEBUG_MODE = False


class LRUCache(OrderedDict):
    """
    Simple LRU cache with automatic eviction of least-recently-used entries.

    Prevents unbounded memory growth in long-running ComfyUI sessions where
    workflows are created/deleted repeatedly, generating new node IDs that
    would otherwise accumulate forever in module-level tracking dicts.
    """

    def __init__(self, max_size=1000):
        super().__init__()
        self.max_size = max_size

    def __getitem__(self, key):
        value = super().__getitem__(key)
        self.move_to_end(key)  # Mark as recently used
        return value

    def __setitem__(self, key, value):
        if key in self:
            self.move_to_end(key)  # Mark as recently used
        super().__setitem__(key, value)
        if len(self) > self.max_size:
            oldest = next(iter(self))  # First key = oldest
            del self[oldest]

    def get(self, key, default=None):
        """Override get() to also mark accessed entries as recently used."""
        if key in self:
            return self[key]  # Triggers __getitem__ which updates order
        return default


# Per-node-id memory of the last execution's image sources, keyed by node_id string.
# Used to decide whether a wired input change should override a stale pasted_image.
# Separate dicts per node class so IDs from different node types never collide.
# LRU eviction prevents memory leaks in long-running sessions.
_persp_wire_hashes = LRUCache(1000)  # OlmDragPerspective: node_id -> wire hash
_persp_pasted_images = LRUCache(1000)  # OlmDragPerspective: node_id -> pasted_image filename
_crop_wire_hashes = LRUCache(1000)  # OlmDragCrop:        node_id -> wire hash
_crop_pasted_images = LRUCache(1000)  # OlmDragCrop:        node_id -> pasted_image filename

# Preview caching: skip expensive preview saves when input hasn't changed.
# Maps node_id -> (input_hash, preview_filename) to avoid redundant GPU→CPU
# transfer, numpy conversion, PIL encoding, and disk I/O.
# LRU eviction prevents memory leaks in long-running sessions.
_crop_preview_cache = LRUCache(1000)  # OlmDragCrop:        node_id -> (hash, filename)
_persp_preview_cache = LRUCache(1000)  # OlmDragPerspective: node_id -> (hash, filename)


def debug_print(*args, **kwargs):
    if DEBUG_MODE:
        print(*args, **kwargs)


def _resolve_source_image(
    image,
    pasted_image: str,
    wire_hashes: dict,
    pasted_images: dict,
    nid: str,
    node_label: str,
):
    """
    Determine the effective source image for this execution and whether to
    signal the frontend to clear its stale pasted_image value.

    Priority rules (tracked across runs via the supplied dicts keyed by nid):
      1. No paste value  → always use wire (or raise if wire is also absent).
      2. Paste is NEW this run (pasted_fresh=True)  → paste wins.
      3. Paste is stale AND wire content changed    → wire wins; clear frontend.
      4. Paste is stale AND wire unchanged          → paste wins (last user intent).

    Updates wire_hashes and pasted_images in-place for the next run.
    Returns (source_image, clear_pasted_on_frontend, input_hash).
    """
    wire_hash = _compute_input_image_hash(image) if image is not None else ""
    last_wire = wire_hashes.get(nid, None)
    last_pasted = pasted_images.get(nid, "")

    pasted_fresh = bool(pasted_image) and (pasted_image != last_pasted)
    wire_changed = bool(image is not None) and (wire_hash != last_wire)

    clear_pasted_on_frontend = False

    if not pasted_image:
        source_image = image
    elif pasted_fresh:
        source_image = _load_uploaded_image_tensor(pasted_image)
        if source_image is None:
            source_image = image
    elif wire_changed:
        source_image = image
        clear_pasted_on_frontend = True
    else:
        source_image = _load_uploaded_image_tensor(pasted_image)
        if source_image is None:
            source_image = image

    if source_image is None:
        raise ValueError(
            f"{node_label} requires either an IMAGE input or a pasted_image upload."
        )

    effective_pasted = pasted_image if not clear_pasted_on_frontend else ""
    wire_hashes[nid] = wire_hash
    pasted_images[nid] = effective_pasted

    # Reuse the already-computed wire_hash when the wired image is selected;
    # only hash again when source_image is the pasted tensor.
    input_hash = (
        wire_hash if source_image is image else _compute_input_image_hash(source_image)
    )
    return source_image, clear_pasted_on_frontend, input_hash


def _validate_pasted_image_input(pasted_image):
    """Shared VALIDATE_INPUTS logic for nodes that accept a pasted_image combo."""
    if pasted_image and pasted_image != "":
        try:
            fp = folder_paths.get_annotated_filepath(pasted_image)
            if not os.path.isfile(fp):
                return f"pasted_image file not found: {pasted_image}"
        except Exception as e:
            return f"Invalid pasted_image path '{pasted_image}': {e}"
    return True


def _compute_input_image_hash(image: torch.Tensor) -> str:
    """
    Compute a lightweight signature for change detection between executions.

    Instead of a full SHA-256 over the entire first frame (which requires a
    large GPU→CPU transfer and two full-frame copies), we subsample every 8th
    pixel in each spatial dimension and sum to a single float64 scalar.
    That's ~64x less data transferred and negligible collision risk for
    natural-image change detection.
    """
    try:
        frame = image[0]  # (H, W, C) — stays on device
        sample = frame[::8, ::8, :]  # strided view, no copy
        total = sample.to(torch.float64).sum().item()  # one scalar to CPU
        return f"{image.shape}|{total:.8f}"
    except Exception as e:
        print(f"[OlmDrag] Failed to compute input image hash: {e}")
        return ""


def _load_uploaded_image_tensor(image_name: str):
    """Load an uploaded input image filename into a Comfy IMAGE tensor (B,H,W,C)."""
    if not image_name:
        return None

    image_path = folder_paths.get_annotated_filepath(image_name)
    with Image.open(image_path) as im:
        arr = np.array(im.convert("RGB")).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None,]


def _prune_node_preview_files(temp_dir: str, prefix: str, keep_filename: str):
    """Delete old per-node preview JPEGs in temp, keeping only the active one."""
    try:
        for name in os.listdir(temp_dir):
            if not name.startswith(prefix) or not name.endswith(".jpg"):
                continue
            if name == keep_filename:
                continue
            path = os.path.join(temp_dir, name)
            if os.path.isfile(path):
                os.remove(path)
    except Exception as e:
        debug_print(f"[OlmDrag] Preview cleanup skipped: {e}")


def _preview_filename_hash(input_hash: str) -> str:
    """Return a filesystem-safe digest token derived from the input hash string."""
    return hashlib.sha1(input_hash.encode("utf-8")).hexdigest()


def _sanitize_node_id(node_id: str) -> str:
    """
    Sanitize the node_id for use in filenames and cache keys.
    Allows only ASCII alphanumeric characters, underscores, and hyphens,
    and truncates to a reasonable maximum length to avoid filesystem issues.
    """
    if node_id is None:
        return "unknown"
    nid = str(node_id)
    # Allow only ASCII [A-Za-z0-9_-] to keep filenames portable and predictable.
    sanitized = "".join(
        c
        for c in nid
        if (
            ("A" <= c <= "Z")
            or ("a" <= c <= "z")
            or ("0" <= c <= "9")
            or c in ("_", "-")
        )
    )
    if not sanitized:
        sanitized = "unknown"
    # Truncate to avoid excessively long filenames (e.g., from malicious input).
    max_len = 64
    if len(sanitized) > max_len:
        sanitized = sanitized[:max_len]
    return sanitized


class OlmDragCrop:
    """Interactive image cropping node with drag handles for precise region selection.

    Features:
    - Canvas overlay with draggable crop box and corner/edge handles
    - Aspect ratio locking and snapping to common ratios
    - Supports wired IMAGE input or paste/drop (Ctrl+V, drag-and-drop)
    - Real-time preview with automatic cache for unchanged inputs
    - Outputs cropped image, mask, and crop coordinates as JSON

    The crop box can be resized by dragging corners or edges, and the entire
    box can be repositioned. When the input image changes resolution, the
    crop automatically resets to the full image.
    """

    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [
            f
            for f in os.listdir(input_dir)
            if os.path.isfile(os.path.join(input_dir, f))
        ]
        return {
            "required": {
                "drawing_version": ("STRING", {"default": "init"}),
                "crop_left": ("INT", {"default": 0, "min": 0, "max": 8192}),
                "crop_right": ("INT", {"default": 0, "min": 0, "max": 8192}),
                "crop_top": ("INT", {"default": 0, "min": 0, "max": 8192}),
                "crop_bottom": ("INT", {"default": 0, "min": 0, "max": 8192}),
                "crop_width": ("INT", {"default": 512, "min": 1, "max": 8192}),
                "crop_height": ("INT", {"default": 512, "min": 1, "max": 8192}),
                "last_width": ("INT", {"default": 0}),
                "last_height": ("INT", {"default": 0}),
            },
            "optional": {
                "image": ("IMAGE",),
                "pasted_image": (sorted(files), {"image_upload": True}),
                "mask": ("MASK",),
            },
            "hidden": {
                "node_id": "UNIQUE_ID",
            },
        }

    @classmethod
    def VALIDATE_INPUTS(cls, pasted_image=None, **kwargs):
        # Only validate the file reference; the "requires IMAGE or pasted_image" guard
        # is enforced at runtime in crop().
        return _validate_pasted_image_input(pasted_image)

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("IMAGE", "MASK", "CROP_JSON")
    FUNCTION = "crop"
    CATEGORY = "image/transform"

    def crop(
        self,
        drawing_version,
        crop_left: int,
        crop_right: int,
        crop_top: int,
        crop_bottom: int,
        crop_width: int,
        crop_height: int,
        last_width: int,
        last_height: int,
        image: torch.Tensor = None,
        pasted_image: str = "",
        node_id=None,
        mask=None,
    ):
        debug_print("=" * 60)
        print(f"[OlmDragCrop] Node {node_id} executed (Backend)")

        # Normalize None to empty string for optional pasted_image
        if pasted_image is None:
            pasted_image = ""

        nid = _sanitize_node_id(node_id)
        source_image, clear_pasted_on_frontend, input_hash = _resolve_source_image(
            image,
            pasted_image,
            _crop_wire_hashes,
            _crop_pasted_images,
            nid,
            "OlmDragCrop",
        )

        batch_size, current_height, current_width, channels = source_image.shape

        debug_print("\n[OlmDragCrop] [Input Image Info]")
        debug_print(
            f"[OlmDragCrop] - Current image size: {current_width}x{current_height}"
        )
        debug_print(f"[OlmDragCrop] - Last image size:    {last_width}x{last_height}")
        debug_print(f"[OlmDragCrop] - Batch size: {batch_size}, Channels: {channels}")

        resolution_changed = (
            current_width != last_width or current_height != last_height
        )
        reset_frontend_crop = False

        if resolution_changed:
            debug_print("\n[OlmDragCrop] [Resolution Change Detected]")
            debug_print(
                "[OlmDragCrop] → Forcing full image crop and signaling frontend reset."
            )
            crop_left = 0
            crop_top = 0
            crop_right = 0
            crop_bottom = 0
            crop_width = current_width
            crop_height = current_height
            reset_frontend_crop = True

        debug_print("\n[OlmDragCrop] [Crop Inputs]")
        debug_print(f"[OlmDragCrop] - crop_left:            {crop_left}")
        debug_print(f"[OlmDragCrop] - crop_right:           {crop_right}")
        debug_print(f"[OlmDragCrop] - crop_top:             {crop_top}")
        debug_print(f"[OlmDragCrop] - crop_bottom:          {crop_bottom}")
        debug_print(f"[OlmDragCrop] - crop_width:           {crop_width}")
        debug_print(f"[OlmDragCrop] - crop_height:          {crop_height}")
        debug_print(f"[OlmDragCrop] - Computed crop_right:  {crop_right}")
        debug_print(f"[OlmDragCrop] - Computed crop_bottom: {crop_bottom}")

        computed_crop_right = crop_left + crop_width
        computed_crop_bottom = crop_top + crop_height

        if (
            crop_left < 0
            or crop_top < 0
            or computed_crop_right > current_width
            or computed_crop_bottom > current_height
            or crop_width <= 0
            or crop_height <= 0
        ):
            print("\n[OlmDragCrop] Error invalid crop area → Resetting to full image.")
            crop_left = 0
            crop_top = 0
            crop_right = 0
            crop_bottom = 0
            crop_width = current_width
            crop_height = current_height
            computed_crop_right = crop_left + crop_width
            computed_crop_bottom = crop_top + crop_height
            reset_frontend_crop = True

        cropped_image = source_image[
            :, crop_top:computed_crop_bottom, crop_left:computed_crop_right, :
        ]

        def _make_zero_mask(bs, h, w, device):
            return torch.zeros((bs, h, w), dtype=torch.float32, device=device)

        cropped_mask = None
        if mask is None or not torch.is_tensor(mask) or mask.numel() == 0:
            cropped_mask = _make_zero_mask(
                batch_size, crop_height, crop_width, source_image.device
            )
        else:
            m = mask

            if m.dim() == 4 and m.shape[1] == 1:
                m = m.squeeze(1)
            elif m.dim() == 2:
                m = m.unsqueeze(0)

            if m.dim() != 3:
                cropped_mask = _make_zero_mask(
                    batch_size, crop_height, crop_width, source_image.device
                )
            else:
                if m.shape[0] != batch_size:
                    if m.shape[0] == 1 and batch_size > 1:
                        m = m.repeat(batch_size, 1, 1)
                    else:
                        if m.shape[0] > batch_size:
                            m = m[:batch_size]
                        else:
                            m = m.repeat(int(np.ceil(batch_size / m.shape[0])), 1, 1)[
                                :batch_size
                            ]

                mh, mw = m.shape[1], m.shape[2]

                cl = max(0, min(crop_left, mw))
                cr = max(0, min(computed_crop_right, mw))
                ct = max(0, min(crop_top, mh))
                cb = max(0, min(computed_crop_bottom, mh))

                if cr <= cl or cb <= ct:
                    cropped_mask = _make_zero_mask(
                        batch_size, crop_height, crop_width, source_image.device
                    )
                else:
                    region = m[:, ct:cb, cl:cr]
                    cropped_mask = _make_zero_mask(
                        batch_size, crop_height, crop_width, source_image.device
                    )
                    rh, rw = region.shape[1], region.shape[2]
                    cropped_mask[:, :rh, :rw] = region.to(torch.float32)

        debug_print(f"[OlmDragCrop] - Computed crop_right:  {computed_crop_right}")
        debug_print(f"[OlmDragCrop] - Computed crop_bottom: {computed_crop_bottom}")

        output_width = crop_width
        output_height = crop_height

        debug_print("\n[OlmDragCrop] [Output Crop Info]")
        debug_print(f"[OlmDragCrop] - Output size: {output_width}x{output_height}")
        debug_print(f"[OlmDragCrop] - Reset frontend crop UI: {reset_frontend_crop}")
        debug_print("=" * 60)

        # Performance optimization: skip preview save when input unchanged.
        # Avoids GPU→CPU transfer + numpy conversion + PIL encoding + disk I/O (~10-50ms).
        # Uses memory cache for fast lookup and file-based persistence for robustness.
        original_filename = None
        cached_hash, cached_filename = _crop_preview_cache.get(nid, (None, None))
        if not input_hash:
            # Hash failures produce an empty key; skip cache lookup/save to avoid
            # reusing stale preview files from previous runs/sessions.
            original_filename = None
        elif cached_hash == input_hash and cached_filename:
            # Memory cache hit - reuse only if file still exists on disk.
            temp_dir = get_temp_directory()
            cached_filepath = os.path.join(temp_dir, cached_filename)
            if os.path.isfile(cached_filepath):
                original_filename = cached_filename

        if original_filename is None and input_hash and batch_size > 0:
            temp_dir = get_temp_directory()
            os.makedirs(temp_dir, exist_ok=True)

            # Use content-based hash in filename to allow for caching
            # We use the already computed input_hash from _resolve_source_image
            filename_hash = _preview_filename_hash(input_hash)
            original_filename = f"dragcrop_{nid}_{filename_hash}.jpg"
            filepath = os.path.join(temp_dir, original_filename)

            if not os.path.isfile(filepath):
                # Only save if the file doesn't exist (file-based cache miss)
                img_array = (source_image[0].cpu().numpy() * 255).astype(np.uint8)
                pil_image = Image.fromarray(img_array).convert("RGB")
                try:
                    # JPEG is significantly faster to encode than PNG and produces smaller files
                    # for high-resolution previews, reducing disk I/O and frontend load time.
                    pil_image.save(filepath, "JPEG", quality=90)
                except Exception as e:
                    print(f"[OlmDragCrop] Error saving preview image: {e}")
                    original_filename = None

            # Update memory cache for next execution
            if original_filename:
                _prune_node_preview_files(
                    temp_dir,
                    prefix=f"dragcrop_{nid}_",
                    keep_filename=original_filename,
                )
                _crop_preview_cache[nid] = (input_hash, original_filename)

        crop_payload = {
            "left": crop_left,
            "top": crop_top,
            "right": crop_right,
            "bottom": crop_bottom,
            "width": crop_width,
            "height": crop_height,
            "original_size": [current_width, current_height],
            "cropped_size": [crop_width, crop_height],
            "reset_crop_ui": reset_frontend_crop,
        }

        crop_json = json.dumps(crop_payload)

        crop_info_for_frontend = {
            **crop_payload,
            "input_hash": input_hash,
            "clear_pasted_image": clear_pasted_on_frontend,
        }

        return {
            "ui": {
                "images_custom": (
                    [{"filename": original_filename, "subfolder": "", "type": "temp"}]
                    if original_filename
                    else []
                ),
                "crop_info": [crop_info_for_frontend],
            },
            "result": (cropped_image, cropped_mask, crop_json),
        }


class OlmCropInfoInterpreter:
    """Helper node to extract crop coordinates from OlmDragCrop JSON output.

    Parses the crop_json string produced by OlmDragCrop and outputs individual
    integer values for left, top, right, bottom, width, height, plus formatted
    strings (CSV and human-readable).

    Useful for:
    - Connecting crop coordinates to other nodes that need integer inputs
    - Debugging crop values in workflow
    - Converting crop data to different formats
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "crop_json": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "INT", "INT", "INT", "INT", "STRING", "STRING")
    RETURN_NAMES = (
        "left",
        "top",
        "right",
        "bottom",
        "width",
        "height",
        "csv",
        "pretty",
    )
    FUNCTION = "interpret"
    CATEGORY = "image/transform"

    def interpret(self, crop_json: str):
        try:
            data = json.loads(crop_json) if crop_json else {}
        except Exception:
            data = {}

        left = int(data.get("left", 0))
        top = int(data.get("top", 0))
        right = int(data.get("right", left))
        bottom = int(data.get("bottom", top))
        width = int(data.get("width", max(0, right - left)))
        height = int(data.get("height", max(0, bottom - top)))

        csv = f"{left},{top},{right},{bottom},{width},{height}"
        pretty = f"left={left}, top={top}, right={right}, bottom={bottom}, width={width}, height={height}"

        return (left, top, right, bottom, width, height, csv, pretty)


def _has_curves(bows):
    """Return True if any bow [x,y] offset is non-zero."""
    return any(abs(v) > 0.5 for xy in bows.values() for v in xy)


def _edge_control_point_xy(p1, p2, bow_x, bow_y):
    """Quadratic bezier control point = edge midpoint + free 2D offset (bow_x, bow_y)."""
    mx, my = (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2
    return np.array([mx + bow_x, my + bow_y], dtype=np.float32)


def _compute_coons_maps(src_pts, bows, out_w, out_h):
    """
    Compute cv2.remap source maps for a bilinear Coons patch warp with curved edges.

    Each edge is a quadratic bezier defined by two corner endpoints and a control point
    at edge_midpoint + [bow_x, bow_y] (free 2D offset in image pixels).

    Coons patch formula:
        P(u,v) = (1-v)*B_top(u) + v*B_bottom(u)
               + (1-u)*B_left(v) + u*B_right(v)
               - bilinear_corner_blend(u,v)

    Returns (map_x, map_y) as float32 arrays, or None if cv2 is unavailable.
    """
    try:
        import cv2  # noqa: F401
    except ImportError:
        return None

    tl = np.array(src_pts[0], dtype=np.float32)
    tr = np.array(src_pts[1], dtype=np.float32)
    br = np.array(src_pts[2], dtype=np.float32)
    bl = np.array(src_pts[3], dtype=np.float32)

    # Control points: midpoint of each edge + free 2D offset
    # Bottom edge uses BL→BR so it matches the top's left-to-right orientation
    C_top = _edge_control_point_xy(tl, tr, bows["top"][0], bows["top"][1])
    C_right = _edge_control_point_xy(tr, br, bows["right"][0], bows["right"][1])
    C_bottom = _edge_control_point_xy(bl, br, bows["bottom"][0], bows["bottom"][1])
    C_left = _edge_control_point_xy(tl, bl, bows["left"][0], bows["left"][1])

    us = np.linspace(0.0, 1.0, out_w, dtype=np.float32)  # (out_w,)
    vs = np.linspace(0.0, 1.0, out_h, dtype=np.float32)  # (out_h,)
    U, V = np.meshgrid(us, vs)  # (out_h, out_w)

    def bezier2(p0, p1c, p2, t):
        """Quadratic bezier. t shape (N,) → returns (N, 2)."""
        t = t[:, None]
        return (1 - t) ** 2 * p0 + 2 * t * (1 - t) * p1c + t**2 * p2

    B_top = bezier2(tl, C_top, tr, us)  # (out_w, 2)
    B_bottom = bezier2(bl, C_bottom, br, us)  # (out_w, 2)
    B_left = bezier2(tl, C_left, bl, vs)  # (out_h, 2)
    B_right = bezier2(tr, C_right, br, vs)  # (out_h, 2)

    # Broadcast to (out_h, out_w, 2)
    B_top_2d = B_top[None, :, :]
    B_bottom_2d = B_bottom[None, :, :]
    B_left_2d = B_left[:, None, :]
    B_right_2d = B_right[:, None, :]

    U3 = U[:, :, None]
    V3 = V[:, :, None]

    bilinear = (
        (1 - U3) * (1 - V3) * tl
        + U3 * (1 - V3) * tr
        + U3 * V3 * br
        + (1 - U3) * V3 * bl
    )

    P = (
        (1 - V3) * B_top_2d
        + V3 * B_bottom_2d
        + (1 - U3) * B_left_2d
        + U3 * B_right_2d
        - bilinear
    )  # (out_h, out_w, 2)

    map_x = P[:, :, 0]
    map_y = P[:, :, 1]
    return map_x, map_y


def _compute_perspective_coeffs(src_pts, dst_pts):
    """
    Compute PIL perspective transform coefficients.
    Solves for the 8 coefficients [a,b,c,d,e,f,g,h] such that PIL can map
    each output pixel (dx, dy) back to the input pixel (sx, sy):
        sx = (a*dx + b*dy + c) / (g*dx + h*dy + 1)
        sy = (d*dx + e*dy + f) / (g*dx + h*dy + 1)

    src_pts: 4 [x, y] points in the source image (user-selected quad)
    dst_pts: 4 [x, y] points in the output image (rectangle corners)
    """
    A = []
    b = []
    for (sx, sy), (dx, dy) in zip(src_pts, dst_pts):
        A.append([dx, dy, 1, 0, 0, 0, -dx * sx, -dy * sx])
        b.append(sx)
        A.append([0, 0, 0, dx, dy, 1, -dx * sy, -dy * sy])
        b.append(sy)
    A = np.array(A, dtype=np.float64)
    b = np.array(b, dtype=np.float64)
    coeffs, _, _, _ = np.linalg.lstsq(A, b, rcond=None)
    return coeffs.tolist()


class OlmDragPerspective:
    """Perspective correction node with draggable corners and curve warping.

    Features:
    - Four corner handles to define a quadrilateral region in the source image
    - Four edge curve handles (bow controls) for Coons patch warping
    - Optional rotation (90° CW/CCW, 180°) applied before warping
    - Supports wired IMAGE input or paste/drop (Ctrl+V, drag-and-drop)
    - Real-time preview with automatic cache for unchanged inputs

    When opencv-python is available, uses cv2.remap with Coons patch for
    curved edge warping (bilinear quadratic bezier blending). Falls back to
    PIL perspective transform for planar quads when cv2 is unavailable or
    curves are disabled.

    The output is a rectified image where the selected quadrilateral is
    mapped to a rectangle, with dimensions computed from the quad edge lengths.
    """

    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [
            f
            for f in os.listdir(input_dir)
            if os.path.isfile(os.path.join(input_dir, f))
        ]
        files = folder_paths.filter_files_content_types(files, ["image"])
        return {
            "required": {
                "drawing_version": ("STRING", {"default": "init"}),
                "tl_x": ("INT", {"default": 0, "min": -8192, "max": 8192}),
                "tl_y": ("INT", {"default": 0, "min": -8192, "max": 8192}),
                "tr_x": ("INT", {"default": 512, "min": -8192, "max": 8192}),
                "tr_y": ("INT", {"default": 0, "min": -8192, "max": 8192}),
                "br_x": ("INT", {"default": 512, "min": -8192, "max": 8192}),
                "br_y": ("INT", {"default": 512, "min": -8192, "max": 8192}),
                "bl_x": ("INT", {"default": 0, "min": -8192, "max": 8192}),
                "bl_y": ("INT", {"default": 512, "min": -8192, "max": 8192}),
                "last_width": ("INT", {"default": 0}),
                "last_height": ("INT", {"default": 0}),
                "top_bow_x": ("INT", {"default": 0, "min": -4096, "max": 4096}),
                "top_bow_y": ("INT", {"default": 0, "min": -4096, "max": 4096}),
                "right_bow_x": ("INT", {"default": 0, "min": -4096, "max": 4096}),
                "right_bow_y": ("INT", {"default": 0, "min": -4096, "max": 4096}),
                "bottom_bow_x": ("INT", {"default": 0, "min": -4096, "max": 4096}),
                "bottom_bow_y": ("INT", {"default": 0, "min": -4096, "max": 4096}),
                "left_bow_x": ("INT", {"default": 0, "min": -4096, "max": 4096}),
                "left_bow_y": ("INT", {"default": 0, "min": -4096, "max": 4096}),
                "rotate": (["None", "90° CW", "90° CCW", "180°"], {"default": "None"}),
                "last_rotate": ("STRING", {"default": "None"}),
            },
            "optional": {
                "image": ("IMAGE",),
                "pasted_image": ([""] + sorted(files), {"image_upload": True}),
            },
            "hidden": {
                "node_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("IMAGE", "PERSP_JSON")
    FUNCTION = "correct"
    CATEGORY = "image/transform"

    @classmethod
    def VALIDATE_INPUTS(cls, pasted_image=None, **kwargs):
        # The pasted_image combo list only contains files from the root input dir,
        # but uploads may land in subfolders (e.g. "pasted/image.png"). Rather than
        # rebuilding the full recursive list on every validation call, we accept any
        # non-empty value and verify the file actually exists on disk.
        return _validate_pasted_image_input(pasted_image)

    def correct(
        self,
        drawing_version,
        tl_x: int,
        tl_y: int,
        tr_x: int,
        tr_y: int,
        br_x: int,
        br_y: int,
        bl_x: int,
        bl_y: int,
        last_width: int = 0,
        last_height: int = 0,
        top_bow_x: int = 0,
        top_bow_y: int = 0,
        right_bow_x: int = 0,
        right_bow_y: int = 0,
        bottom_bow_x: int = 0,
        bottom_bow_y: int = 0,
        left_bow_x: int = 0,
        left_bow_y: int = 0,
        rotate: str = "None",
        last_rotate: str = "None",
        image: torch.Tensor = None,
        pasted_image: str = "",
        node_id=None,
    ):
        print(f"[OlmDragPerspective] Node {node_id} executed (Backend)")

        # Normalize None to empty string for optional pasted_image
        if pasted_image is None:
            pasted_image = ""

        nid = _sanitize_node_id(node_id)
        source_image, clear_pasted_on_frontend, input_hash = _resolve_source_image(
            image,
            pasted_image,
            _persp_wire_hashes,
            _persp_pasted_images,
            nid,
            "OlmDragPerspective",
        )

        batch_size, current_height, current_width, channels = source_image.shape

        resolution_changed = (
            current_width != last_width or current_height != last_height
        )
        rotation_changed = (rotate != last_rotate)
        reset_quad_ui = False

        # Widget coordinates are stored in rotated space (what the user sees).
        # For 90° rotations the displayed width and height are swapped.
        if rotate in ("90° CW", "90° CCW"):
            rotated_w, rotated_h = current_height, current_width
        else:
            rotated_w, rotated_h = current_width, current_height

        if resolution_changed or rotation_changed:
            tl_x, tl_y = 0, 0
            tr_x, tr_y = rotated_w, 0
            br_x, br_y = rotated_w, rotated_h
            bl_x, bl_y = 0, rotated_h
            reset_quad_ui = True

        src_pts = [
            [tl_x, tl_y],
            [tr_x, tr_y],
            [br_x, br_y],
            [bl_x, bl_y],
        ]

        # Widget coordinates are already in rotated space (what user sees).
        # We just need to know the rotation type to rotate the image frames.
        rotate_k = 0
        if rotate == "90° CW":
            rotate_k = 3
        elif rotate == "90° CCW":
            rotate_k = 1
        elif rotate == "180°":
            rotate_k = 2

        # Use coordinates as-is (they're already in the rotated coordinate system)
        src_pts_warp = src_pts

        # Compute output dimensions from the edge lengths of the quad
        (rtl_x, rtl_y), (rtr_x, rtr_y), (rbr_x, rbr_y), (rbl_x, rbl_y) = src_pts_warp
        top_w = np.sqrt((rtr_x - rtl_x) ** 2 + (rtr_y - rtl_y) ** 2)
        bottom_w = np.sqrt((rbr_x - rbl_x) ** 2 + (rbr_y - rbl_y) ** 2)
        left_h = np.sqrt((rbl_x - rtl_x) ** 2 + (rbl_y - rtl_y) ** 2)
        right_h = np.sqrt((rbr_x - rtr_x) ** 2 + (rbr_y - rtr_y) ** 2)

        out_w = max(1, int(max(top_w, bottom_w)))
        out_h = max(1, int(max(left_h, right_h)))

        dst_pts = [
            [0, 0],
            [out_w, 0],
            [out_w, out_h],
            [0, out_h],
        ]

        try:
            coeffs = _compute_perspective_coeffs(src_pts_warp, dst_pts)
        except Exception as e:
            print(f"[OlmDragPerspective] Error computing perspective coefficients: {e}")
            coeffs = None

        try:
            resample = Image.Resampling.BICUBIC
        except AttributeError:
            resample = Image.BICUBIC  # Pillow < 9.1

        bows = {
            "top": [top_bow_x, top_bow_y],
            "right": [right_bow_x, right_bow_y],
            "bottom": [bottom_bow_x, bottom_bow_y],
            "left": [left_bow_x, left_bow_y],
        }
        use_curves = _has_curves(bows)

        # Precompute Coons remap maps once (same for all frames in the batch)
        coons_map_x = None
        coons_map_y = None
        if use_curves:
            try:
                # Bow offsets are already in rotated space (same as src_pts_warp), no rotation needed
                rotated_bows = bows

                maps = _compute_coons_maps(src_pts_warp, rotated_bows, out_w, out_h)
                if maps is not None:
                    coons_map_x, coons_map_y = maps
                else:
                    use_curves = False  # cv2 unavailable, fall back to PIL
            except Exception as e:
                print(f"[OlmDragPerspective] Coons warp setup failed: {e}")
                use_curves = False

        warped_frames = []
        for i in range(batch_size):
            frame = source_image[i].cpu().numpy()  # float32 H,W,C in [0,1]
            if rotate_k != 0:
                # rot90 returns a non-contiguous view; make contiguous once here
                frame = np.ascontiguousarray(np.rot90(frame, k=rotate_k))

            if use_curves and coons_map_x is not None:
                try:
                    import cv2

                    # Pass float32 directly — skips the uint8 round-trip entirely
                    warped = cv2.remap(
                        frame,
                        coons_map_x,
                        coons_map_y,
                        cv2.INTER_CUBIC,
                        borderMode=cv2.BORDER_CONSTANT,
                        borderValue=0,
                    )
                    # clip to [0,1]: cubic interpolation can slightly overshoot
                    warped_frames.append(torch.from_numpy(np.clip(warped, 0.0, 1.0)))
                    continue
                except Exception as e:
                    print(f"[OlmDragPerspective] Coons warp failed for frame {i}: {e}")
                    # fall through to PIL path below

            # PIL path — used for planar perspective transform, resize fallback,
            # or as the cv2 error fallback above
            pil_img = Image.fromarray((frame * 255).astype(np.uint8))
            if coeffs is not None:
                try:
                    warped_pil = pil_img.transform(
                        (out_w, out_h),
                        Image.PERSPECTIVE,
                        coeffs,
                        resample,
                    )
                except Exception as e:
                    print(f"[OlmDragPerspective] Warp failed for frame {i}: {e}")
                    warped_pil = pil_img.resize((out_w, out_h), resample)
            else:
                warped_pil = pil_img.resize((out_w, out_h), resample)

            warped_np = np.array(warped_pil).astype(np.float32) / 255.0
            warped_frames.append(torch.from_numpy(warped_np))

        output_image = torch.stack(warped_frames, dim=0)

        # Performance optimization: skip preview save when input unchanged.
        # Avoids GPU→CPU transfer + numpy conversion + PIL encoding + disk I/O (~10-50ms).
        # Uses memory cache for fast lookup and file-based persistence for robustness.
        original_filename = None
        cached_hash, cached_filename = _persp_preview_cache.get(nid, (None, None))
        if not input_hash:
            # Hash failures produce an empty key; skip cache lookup/save to avoid
            # reusing stale preview files from previous runs/sessions.
            original_filename = None
        elif cached_hash == input_hash and cached_filename:
            # Memory cache hit - reuse only if file still exists on disk.
            temp_dir = get_temp_directory()
            cached_filepath = os.path.join(temp_dir, cached_filename)
            if os.path.isfile(cached_filepath):
                original_filename = cached_filename

        if original_filename is None and input_hash and batch_size > 0:
            temp_dir = get_temp_directory()
            os.makedirs(temp_dir, exist_ok=True)

            # Use content-based hash in filename to allow for caching
            filename_hash = _preview_filename_hash(input_hash)
            original_filename = f"dragpersp_{nid}_{filename_hash}.jpg"
            filepath = os.path.join(temp_dir, original_filename)

            if not os.path.isfile(filepath):
                # Only save if the file doesn't exist (file-based cache miss)
                img_array = (source_image[0].cpu().numpy() * 255).astype(np.uint8)
                pil_preview = Image.fromarray(img_array).convert("RGB")
                try:
                    # JPEG is significantly faster to encode than PNG and produces smaller files
                    # for high-resolution previews, reducing disk I/O and frontend load time.
                    pil_preview.save(filepath, "JPEG", quality=90)
                except Exception as e:
                    print(f"[OlmDragPerspective] Error saving preview image: {e}")
                    original_filename = None

            # Update memory cache for next execution
            if original_filename:
                _prune_node_preview_files(
                    temp_dir,
                    prefix=f"dragpersp_{nid}_",
                    keep_filename=original_filename,
                )
                _persp_preview_cache[nid] = (input_hash, original_filename)

        persp_payload = {
            "tl": [tl_x, tl_y],
            "tr": [tr_x, tr_y],
            "br": [br_x, br_y],
            "bl": [bl_x, bl_y],
            "bows": {
                "top": [top_bow_x, top_bow_y],
                "right": [right_bow_x, right_bow_y],
                "bottom": [bottom_bow_x, bottom_bow_y],
                "left": [left_bow_x, left_bow_y],
            },
            "out_width": out_w,
            "out_height": out_h,
            "original_size": [current_width, current_height],
            "rotated_size": [rotated_w, rotated_h],
            "rotate": rotate,
            "reset_quad_ui": reset_quad_ui,
            "input_hash": input_hash,
            "clear_pasted_image": clear_pasted_on_frontend,
        }

        persp_json = json.dumps(persp_payload)

        return {
            "ui": {
                "images_custom": (
                    [{"filename": original_filename, "subfolder": "", "type": "temp"}]
                    if original_filename
                    else []
                ),
                "persp_info": [persp_payload],
            },
            "result": (output_image, persp_json),
        }


NODE_CLASS_MAPPINGS = {
    "OlmDragCrop": OlmDragCrop,
    "OlmCropInfoInterpreter": OlmCropInfoInterpreter,
    "OlmDragPerspective": OlmDragPerspective,
}


NODE_DISPLAY_NAME_MAPPINGS = {
    "OlmDragCrop": "Olm Drag Crop",
    "OlmCropInfoInterpreter": "Olm Crop Info → Values",
    "OlmDragPerspective": "Olm Correct Perspective",
}


WEB_DIRECTORY = "./web"
