# Bolt's Performance Journal ⚡

This journal tracks critical performance-related learnings discovered while optimizing this codebase.

## 2025-05-15 - Initializing Bolt's Journal
**Learning:** Initialized the journal to track performance optimizations for the Olm DragCrop project.
**Action:** Use this journal to document significant performance discoveries and avoid repeating past mistakes.

## 2025-05-15 - JPEG Encoding Trap (RGBA)
**Learning:** PIL's JPEG encoder does not support `RGBA` mode and will crash if the image has an alpha channel.
**Action:** Always call `.convert("RGB")` on a PIL Image before saving it as a JPEG if the source might have an alpha channel.
