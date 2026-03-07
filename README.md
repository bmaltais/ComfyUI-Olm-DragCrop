# Olm DragCrop for ComfyUI

![Olm DragDrop splash](./assets/olm_drag_crop_splash.png)

An interactive image-transform node pack for ComfyUI. Define crop regions and perspective quads by dragging handles directly on the image preview inside the node graph — no pixel math, no external editors.

- **Author:** Olli Sorjonen
- **GitHub:** https://github.com/o-l-l-i
- **X:** https://x.com/Olmirad
- **Version:** 1.3.0

---

## ✨ What's Included

| Node | Menu name | Purpose |
|---|---|---|
| `OlmDragCrop` | **Olm Drag Crop** | Drag a crop rectangle on the image preview |
| `OlmDragPerspective` | **Olm Correct Perspective** | Drag four corner handles to warp/undistort an image |
| `OlmCropInfoInterpreter` | **Olm Crop Info → Values** | Unpack `CROP_JSON` into individual INT outputs |

---

## 📦 Installation

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/o-l-l-i/ComfyUI-Olm-DragCrop.git
```

Restart ComfyUI to load the nodes.

**Dependencies** — the core nodes work out of the box (torch, numpy and Pillow are already present in every ComfyUI install).  
`opencv-python` is ***optional*** but recommended for **OlmDragPerspective**: it enables the Coons-patch curved-edge warp. Without it the node falls back to Pillow's standard perspective transform (straight edges only).

```bash
pip install opencv-python
```

---

## 🖼️ Getting an image into a node

Both **OlmDragCrop** and **OlmDragPerspective** accept images in three ways — you can mix them freely:

| Method | How |
|---|---|
| **Wire** | Connect any `IMAGE` output to the `image` input slot |
| **Drag & drop** | Drag an image file from your OS file manager and drop it onto the node |
| **Ctrl+V** | Select the node and paste from clipboard (`Ctrl+V`) |

**Priority when inputs conflict** — the node tracks what changed between runs:
1. A freshly pasted/dropped image always wins.
2. If the paste is stale and the wired input changed, the wire takes over and the frontend clears the pasted value.
3. If nothing changed, the last-used source is preserved.

Connecting a new wire instantly clears any pasted image so the wired source takes over.

---

## 🔲 Olm Drag Crop

An interactive real-time cropping node. Drag a rectangle on the image preview to define the crop region.

### Features

- **Drag to crop** — click and drag anywhere in the image preview to draw a new crop rectangle; click and drag inside the existing box to move it; drag corner/edge handles to resize.
- **Numeric widget sync** — `crop_left`, `crop_right`, `crop_top`, `crop_bottom` stay in sync with the drag box in both directions. Fine-tune by typing values directly.
- **Aspect ratio lock** — enter a decimal (`1.777`), a ratio string (`16:9`, `4:3`), or click **Set ratio from crop** to capture the current box's ratio.
- **Pixel snap** — align crop edges to a grid; choose 2 / 4 / 8 / 16 / 32 / 64 or `none` from the **Snap to** combo.
- **Color presets** — pick the crop-box overlay color: Lime, Grey, White, Black, Red, Green, Blue, Yellow, Magenta, Cyan, Hot pink.
- **Info display** — toggle pixel dimensions and percentage labels on the crop box.
- **Mask pass-through** — optionally connect a `MASK`; it is cropped to match and passed through.
- **Reset Crop** — resets the crop to the full image; shows a confirmation dialog.
- **Force Refresh** — re-triggers the backend without changing any values.
- **Auto-resize** — the node resizes to fit the image aspect ratio.
- **Persistence** — crop position and image dimensions survive UI and backend restarts.
- **Paste / drop support** — accepts images via `Ctrl+V` or drag-and-drop directly onto the node (no wired source needed).

### Outputs

| Output | Type | Description |
|---|---|---|
| `IMAGE` | IMAGE | Cropped image |
| `MASK` | MASK | Cropped mask (zeros if none connected) |
| `CROP_JSON` | STRING | JSON with left/top/right/bottom/width/height and original size |

### Basic usage

1. Add **Olm Drag Crop** from the node search menu.
2. Supply an image — wire one in, paste (`Ctrl+V`), or drag-and-drop a file.
3. Run the graph once (wired inputs require one graph run to display the preview).
4. Drag to define the crop area. The output updates on the next run.

---

## 🔷 Olm Correct Perspective

An interactive perspective-correction / quad-warp node. Drag four corner handles and optional mid-edge bow handles to map any quadrilateral region to a flat rectangle.

### Features

- **Corner handles** — drag TL / TR / BR / BL handles anywhere on the preview to define the source quad.
- **Bow handles** — drag the mid-edge handle on each side (top, right, bottom, left) to curve that edge independently. Each bow is a free 2D offset from the edge midpoint, producing a smooth Coons-patch warp (requires `opencv-python`; falls back to planar transform without it).
- **Canvas extend** — expand the preview canvas beyond the image borders by 10 / 15 / 25 / 50 / 100 % so corners can be dragged outside the image frame.
- **Rotation** — pre-rotate the source image: None / 90° CW / 90° CCW / 180°. Handles work in the rotated coordinate space.
- **Output size** — computed automatically from the averaged edge lengths of the quad.
- **Color presets** — same color choices as OlmDragCrop.
- **Info display** — toggle corner labels and output dimensions overlay.
- **Reset Transform** — resets corners, rotation, and canvas extend; shows a confirmation dialog.
- **Force Refresh** — re-triggers the backend without moving any handles.
- **Auto-resize** — the node resizes to fit the image.
- **Persistence** — corner and bow positions survive UI and backend restarts.
- **Paste / drop support** — accepts images via `Ctrl+V` or drag-and-drop (no wired source needed).

### Outputs

| Output | Type | Description |
|---|---|---|
| `IMAGE` | IMAGE | Perspective-corrected / warped image |
| `PERSP_JSON` | STRING | JSON with corner coords, bow offsets, output size, and original size |

### Basic usage

1. Add **Olm Correct Perspective** from the node search menu.
2. Supply an image — wire one in, paste (`Ctrl+V`), or drag-and-drop a file.
3. Run the graph once (wired inputs require one run to display the preview).
4. Drag the four corner handles to the corners of the region you want to flatten.
5. Optionally drag the mid-edge bow handles to correct lens curvature.
6. Run the graph to get the corrected output.

---

## 🔢 Olm Crop Info → Values

A helper node that decodes the `CROP_JSON` string output of **Olm Drag Crop** into individual integer outputs.

### Inputs

| Input | Type |
|---|---|
| `crop_json` | STRING |

### Outputs

| Output | Type | Value |
|---|---|---|
| `left` | INT | Left crop offset |
| `top` | INT | Top crop offset |
| `right` | INT | Right crop offset from left |
| `bottom` | INT | Bottom crop offset from top |
| `width` | INT | Crop width |
| `height` | INT | Crop height |
| `csv` | STRING | `left,top,right,bottom,width,height` |
| `pretty` | STRING | Human-readable label string |

---

## ⚠️ Known Limitations

- **Wired inputs require one graph run to show the preview.** Paste and drop show the preview immediately without a run.
- Only a single crop / quad region per node.
- Coons-patch curved warping requires `opencv-python`. Without it, bows are ignored and the node uses a planar perspective transform.

---

## 💬 Notes

This extension is experimental and under active development. Functionality and behavior may change without notice. Back up your workflows frequently. Feedback, bug reports, and suggestions are welcome.

---

## Version History

- **1.3.0** Shared paste/drop infrastructure refactored into `pasteDropUtils.js`; shared Python source-image priority helpers extracted.
- **1.2.0** Added `Ctrl+V` paste and drag-and-drop image support to **OlmDragCrop** (matching OlmDragPerspective). Image input is now optional for both nodes.
- **1.1.2** Fix: remove unused import and no-op call in perspective executed handler.
- **1.1.1** Added `CROP_JSON` output and `OlmCropInfoInterpreter` helper node.
- **1.1.0** Added **OlmDragPerspective** node with corner handles, bow/curve handles, canvas extend, rotation, and Coons-patch warp. Added `Ctrl+V` and drag-and-drop image support to OlmDragPerspective.
- **1.0 series** Initial OlmDragCrop releases — interactive crop box, snap, aspect ratio lock, mask pass-through, color presets, numeric widget sync, persistence.

---

## License & Usage Terms

Copyright (c) 2025 Olli Sorjonen

This project is source-available, but not open-source under a standard open-source license, and not freeware.  
You may use and experiment with it freely, and any results you create with it are yours to use however you like.  
However:

Redistribution, resale, rebranding, or claiming authorship of this code or extension is strictly prohibited without explicit written permission.

Use at your own risk. No warranties or guarantees are provided.

The only official repository for this project is: 👉 https://github.com/o-l-l-i/ComfyUI-Olm-DragCrop

---

## Author

Created by [@o-l-l-i](https://github.com/o-l-l-i)


---

## ✨ What Is This?

**Olm DragCrop** is a lightweight and very responsive real-time cropping node for ComfyUI, with emphasis on smooth UX. It enables you to define a crop area by dragging and resizing a box directly on your image preview within the node graph. Perfect for quickly isolating regions of interest, preparing data for complex image-based workflows, or refining image compositions.

No need to calculate pixel offsets manually or jump to external image editors – you can visually select, adjust, and apply crops without leaving ComfyUI or evaluating the graph until you're ready.

Use it for:
* Precise visual cropping of images
* Preparing source images for inpainting/outpainting
* Streamlining workflows that require image dimension control

---

## 🎨 Features
* **Real-time:** Fast and fluid crop box movement within the node, making it enjoyable to test different compositions.
* **Real-time Feedback:** Statistics are updated instantly as you drag, with pixel dimensions and percentage displayed on the box.
* **Interactive Crop Box:** Drag, move, and resize a crop box directly on the image preview within the node.
* **Visual Handles:** Clearly visible handles on corners and edges for intuitive resizing.
* **Color presets:** Multiple preset colors for the crop box to suit your content and taste.
* **Numeric Input Synchronization:** Fine-tune crop values using synchronized numeric input widgets for `Left`, `Right`, `Top`, and `Bottom` offsets. Changes in the UI update the box, and dragging the box updates the UI.
* **Flexible Cropping:** Define crop regions by drawing a new box, or by resizing/moving an existing one.
* **Mask Support:** Basic mask data to pass through.
* **Aspect Ratio Locking:** Define aspect ratio with numerical value (0.5, 1, 2.0) or aspect ratio (4:3, 16:9).
* **Pixel snap:** Align crop edges to a grid by selecting a snap value (2-64) from the "Snap to" dropdown - select "none" to disable snapping.
* **Image Handling:**
    * Loads and displays images from upstream nodes.
    * Automatically adjusts internal dimensions to match the loaded image.
    * Resets crop to full image on new image load or resolution change from backend.
* **Customization:** Change the crop box color from a predefined set of options.
* **Informative Display:** Toggle on/off the display of percentage and pixel dimensions directly on the crop box.
* **Smart UX:**
    * Node auto-resizes to reasonably fit the image preview.
    * Handles are designed to be easily clickable, scaling with zoom for consistent interaction.
* **Persistence:** Crop box position and image dimensions persist across UI and backend restarts, maintaining your last used crop settings.
* **Reset Functionality:** Easily reset the crop box to the full image dimensions with a dedicated button.

---

## 📦 Installation

Clone this repository into your `custom_nodes` folder.

```bash
git clone https://github.com/o-l-l-i/ComfyUI-Olm-DragCrop.git
```

Your folder should look like:

```bash
ComfyUI/
└── custom_nodes/
    └── ComfyUI-Olm-DragCrop/
        ├── __init__.py
        ├── olm_dragcrop.py
        └── ... (other files)
```

Restart ComfyUI to load the new node.

There are no extra dependencies - it works out of the box.

---

## 🧪 Basic Usage

1. Add the Olm DragCrop node from the node search menu.
2. Connect an image source (e.g., Load Image) to the input.
3. Run the graph once.
4. Once an image is loaded, a transparent overlay with a crop box will appear.
5. To define a new crop: Click and drag anywhere inside the image preview but outside the existing crop box (if any) to draw a new rectangle.
6. To move an existing crop: Click and drag the center area of the crop box.
7. To resize an existing crop: Click and drag one of the corner or edge handles.
8. Use the crop_left, crop_right, crop_top, crop_bottom numeric widgets to fine-tune your crop coordinates.
9. The node's output will be the cropped image, ready for further processing in your workflow.

---

⚠️ Known Limitations
- **You need to run the graph once to get an image preview from upstream.**
  - This is a technical limitation I could not get around.
  - I had realtime update for Load Image node as a special case, but I dropped it to avoid ambiguity/confusion.
- Only supports a single crop region per node.

---

## 💬 Notes

This extension is experimental and under active development. Functionality, file formats, and behavior may change without notice, and compatibility with future updates is not guaranteed. Use at your own risk, especially in production workflows.

Back up your projects frequently. Feedback, bug reports, and suggestions are always welcome - but expect breakage, quirks, and rough edges. This tool does what I need right now; future updates may be irregular depending on available time.

---

## Version History

- **1.1.1** Added crop data output, and a helper node to extract INT values from JSON data.
- **1.1** Refactor/rewrite the code for maintainability and more modular structure. Various small improvements.
- **1.0.1.1**
  - Chain original mouse event handlers to maintain subgraph header button functionality in ComfyUI frontend 1.24.4 and later.
  - Fix mask pass-through issue (None type crash.)
- **1.0.1** Added snap feature
- **1.0.0** Initial release

---


## License & Usage Terms

Copyright (c) 2025 Olli Sorjonen

This project is source-available, but not open-source under a standard open-source license, and not freeware.
You may use and experiment with it freely, and any results you create with it are yours to use however you like.
However:

Redistribution, resale, rebranding, or claiming authorship of this code or extension is strictly prohibited without explicit written permission.

Use at your own risk. No warranties or guarantees are provided.

The only official repository for this project is: 👉 https://github.com/o-l-l-i/ComfyUI-Olm-DragCrop

---

## Author

Created by [@o-l-l-i](https://github.com/o-l-l-i)