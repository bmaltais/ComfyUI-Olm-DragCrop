# Bolt Journal — ComfyUI-Olm-DragCrop

Performance learnings specific to this codebase.

---

## 2026-03-07 - Preview Image Caching (Enhanced)
**Learning:** Both OlmDragCrop and OlmDragPerspective were saving preview PNGs on every execution, even with unchanged inputs. The code already tracked `input_hash` for change detection but wasn't leveraging it for preview caching.
**Action:** Implemented dual-layer caching strategy: (1) LRU memory cache for fast lookup, (2) file-based persistence using content-based hash filenames. Skip GPU→CPU transfer + numpy conversion + PIL encoding + disk I/O (~10-50ms) when hash matches. Persists across ComfyUI restarts.

## 2026-03-07 - JPEG Encoding for Previews
**Learning:** PNG encoding for high-resolution previews is significantly slower than JPEG and produces much larger files, impacting both backend performance and frontend load times.
**Action:** Switched preview format from PNG to JPEG (quality=90). Combined with `.convert("RGB")` to handle any RGBA images, preventing PIL JPEG encoder crashes on alpha channels. Dramatic reduction in encoding time and file size.
