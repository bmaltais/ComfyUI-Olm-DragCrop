# Bolt's Performance Journal ⚡

This journal tracks critical performance-related learnings discovered while optimizing this codebase.

## 2025-05-15 - Preview Image Caching
**Learning:** Redundant GPU→CPU transfers and image encoding for previews can be avoided by using content-based hashing of the input image.
**Action:** Implement a cache check using `os.path.isfile()` on a hashed filename before performing expensive image processing.

## 2025-05-15 - JPEG Encoding Trap (RGBA)
**Learning:** PIL's JPEG encoder does not support `RGBA` mode and will crash if the image has an alpha channel.
**Action:** Always call `.convert("RGB")` on a PIL Image before saving it as a JPEG if the source might have an alpha channel.
