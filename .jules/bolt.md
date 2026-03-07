# Bolt Journal — ComfyUI-Olm-DragCrop

Performance learnings specific to this codebase.

---

## 2026-03-07 - Preview Image Caching
**Learning:** Both OlmDragCrop and OlmDragPerspective were saving preview PNGs on every execution, even with unchanged inputs. The code already tracked `input_hash` for change detection but wasn't leveraging it for preview caching.
**Action:** Cache `(input_hash, preview_filename)` per node. Skip GPU→CPU transfer + numpy conversion + PIL encoding + disk I/O (~10-50ms) when hash matches. Zero overhead on cache miss.

