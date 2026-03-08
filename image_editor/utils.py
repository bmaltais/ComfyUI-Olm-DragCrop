"""
Utility helpers for the OlmImageEditor node.

Provides tensor ↔ PIL conversions, preview JPEG saving, and image hashing,
following the same patterns used in olm_dragcrop.py.
"""

import logging
import os

import numpy as np
import torch
from PIL import Image

log = logging.getLogger(__name__)


def tensor_to_pil(tensor: torch.Tensor) -> Image.Image:
    """Convert a (B, H, W, C) float32 IMAGE tensor to a PIL Image (first frame)."""
    frame = tensor[0]  # (H, W, C)
    arr = (frame.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def pil_to_tensor(img: Image.Image) -> torch.Tensor:
    """Convert a PIL Image to a (1, H, W, C) float32 IMAGE tensor."""
    arr = np.array(img.convert("RGB")).astype(np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


def load_image_as_tensor(filepath: str) -> torch.Tensor:
    """Load an image file from disk and return a (1, H, W, C) float32 tensor."""
    img = Image.open(filepath).convert("RGB")
    return pil_to_tensor(img)


def save_preview_jpeg(tensor: torch.Tensor, filepath: str, quality: int = 85) -> None:
    """Save the first frame of an IMAGE tensor as a JPEG preview file."""
    img = tensor_to_pil(tensor)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    img.save(filepath, format="JPEG", quality=quality)
    log.debug("[OlmImageEditor] Saved preview: %s", filepath)


def compute_image_hash(tensor: torch.Tensor) -> str:
    """Lightweight change-detection hash for an IMAGE tensor.

    Uses the same single-scalar approach as olm_dragcrop._compute_input_image_hash:
    subsample every 8th pixel, sum to float64. Transfers only one scalar to CPU
    instead of copying the whole sampled tensor — ~10x faster on GPU tensors.
    """
    try:
        frame = tensor[0]  # (H, W, C) — stays on device
        sample = frame[::8, ::8, :]  # strided view, no copy
        total = sample.to(torch.float64).sum().item()  # single scalar to CPU
        return f"{tensor.shape}|{total:.8f}"
    except Exception:
        return ""
