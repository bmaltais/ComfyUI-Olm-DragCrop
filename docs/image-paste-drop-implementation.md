# Image Drag-Drop & Ctrl+V Paste in a Custom ComfyUI Node

This document describes in detail how `OlmDragPerspective` implements direct image input via drag-and-drop and Ctrl+V paste, alongside a normal optional wired `IMAGE` input. It is written as a guide for implementing the same pattern in a new custom node project.

---

## Overview

The goal is to allow a node to:

1. Accept an image via **drag-and-drop** from the OS or browser onto the node body.
2. Accept an image via **Ctrl+V** when the node is selected.
3. Continue accepting images from a **wired `IMAGE` input** as normal.
4. **Intelligently resolve conflicts** between these three sources across multiple executions.

---

## Architecture

The solution has three layers:

| Layer | Role |
|---|---|
| **Python backend** (`olm_dragcrop.py`) | Declares a hidden `pasted_image` upload widget; decides which image source to use; signals the frontend when the wired input has taken over |
| **JavaScript frontend** (`olm_dragperspective.js`) | Handles drag-over, drop, and paste events; uploads the file to the server; updates the hidden widget and shows a preview |
| **Executed handler** (`onExecutedPerspHandler.js`) | After a run, receives backend signals and clears stale `pasted_image` state when needed |

---

## Part 1 — Backend (Python)

### 1.1 Declare the `pasted_image` upload widget

In `INPUT_TYPES`, add `pasted_image` to the `optional` section. The value is a combo widget seeded with files from the root `input/` directory, plus an empty string as default, with `image_upload: True` which makes ComfyUI render the standard upload button.

```python
@classmethod
def INPUT_TYPES(cls):
    input_dir = folder_paths.get_input_directory()
    files = [f for f in os.listdir(input_dir)
             if os.path.isfile(os.path.join(input_dir, f))]
    files = folder_paths.filter_files_content_types(files, ["image"])
    return {
        "required": { ... },
        "optional": {
            "image": ("IMAGE",),
            "pasted_image": ([""] + sorted(files), {"image_upload": True}),
        },
    }
```

> **Important:** The combo list only contains files in the root `input/` directory. Files uploaded via drop/paste land in `input/pasted/` (a subfolder), so they will **not** be in this list. This causes ComfyUI's prompt validator to reject them. See §1.2.

### 1.2 Override `VALIDATE_INPUTS` to accept subfolder paths

ComfyUI validates every combo widget value against its declared list before running a node. Because `pasted/image.png` is not in the list built at definition time, validation fails. Add `VALIDATE_INPUTS` to bypass the list check and instead verify the file actually exists:

```python
@classmethod
def VALIDATE_INPUTS(cls, pasted_image=None, **kwargs):
    if pasted_image and pasted_image != "":
        try:
            fp = folder_paths.get_annotated_filepath(pasted_image)
            if not os.path.isfile(fp):
                return f"pasted_image file not found: {pasted_image}"
        except Exception as e:
            return f"Invalid pasted_image path '{pasted_image}': {e}"
    return True
```

`folder_paths.get_annotated_filepath` handles subfolder-qualified paths like `pasted/image (3).png` correctly.

### 1.3 Source image priority logic

The node can receive images from two sources simultaneously: the `image` wire and `pasted_image`. The correct source depends on what changed since the last run, tracked via two module-level dicts keyed by `node_id`:

```python
_last_wire_hashes: dict   = {}  # node_id → sha256 of wired tensor last run
_last_pasted_images: dict = {}  # node_id → pasted_image filename last run
```

In `correct()`, pass `node_id` as a `hidden` input (`"node_id": "UNIQUE_ID"` in `INPUT_TYPES`). Then apply:

```python
nid = str(node_id) if node_id is not None else "__unknown__"
wire_hash   = _compute_input_image_hash(image) if image is not None else ""
last_wire   = _last_wire_hashes.get(nid, None)
last_pasted = _last_pasted_images.get(nid, "")

pasted_fresh = bool(pasted_image) and (pasted_image != last_pasted)
wire_changed = bool(image is not None) and (wire_hash != last_wire)

clear_pasted_on_frontend = False

if not pasted_image:
    # No paste at all — use wire
    source_image = image
elif pasted_fresh:
    # User just dropped/pasted a new file — paste wins
    source_image = _load_uploaded_image_tensor(pasted_image)
    if source_image is None:
        source_image = image
elif wire_changed:
    # Stale paste, but wire content changed — wire wins
    source_image = image
    clear_pasted_on_frontend = True
else:
    # Stale paste, wire unchanged — keep using paste (last user intent)
    source_image = _load_uploaded_image_tensor(pasted_image)
    if source_image is None:
        source_image = image

# Store for next run
effective_pasted = pasted_image if not clear_pasted_on_frontend else ""
_last_wire_hashes[nid]   = wire_hash
_last_pasted_images[nid] = effective_pasted
```

**Decision table:**

| `pasted_fresh` | `wire_changed` | Source used | Frontend action |
|:-:|:-:|---|---|
| ✓ | any | Paste | — |
| ✗ | ✓ | Wire | Clear `pasted_image` widget |
| ✗ | ✗ | Paste | — |
| — | — (no paste) | Wire | — |

### 1.4 Signal the frontend to clear stale state

Include `clear_pasted_image` in the UI payload returned from the node:

```python
persp_payload = {
    ...
    "clear_pasted_image": clear_pasted_on_frontend,
}
return {
    "ui": { "persp_info": [persp_payload], ... },
    "result": (...),
}
```

### 1.5 Load the uploaded file

```python
def _load_uploaded_image_tensor(image_name: str):
    image_path = folder_paths.get_annotated_filepath(image_name)
    pil = Image.open(image_path).convert("RGB")
    arr = np.array(pil).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None,]  # (1, H, W, C)
```

---

## Part 2 — Frontend (JavaScript)

All frontend code lives inside `app.registerExtension({ beforeRegisterNodeDef })`.

### 2.1 Enable Ctrl+V routing to the node

ComfyUI's paste handler (`usePaste.ts`) checks whether the selected node is an "image node" using `isImageNode()`. That function looks for `node.previewMediaType === "image"`. Without this, Ctrl+V creates a new `LoadImage` node instead:

```javascript
function initNodeState(node) {
    node.image = new Image();
    node.image.src = "";
    node.imageLoaded = false;
    node.previewMediaType = "image"; // ← makes Ctrl+V route here
}
```

> **Do NOT set `node.imgs`** (the array ComfyUI uses for its own image renderer). Setting it causes ComfyUI to draw the image a second time on top of your custom `onDrawForeground`, breaking the overlay layout.

### 2.2 Drag-over visual feedback

Return `true` from `onDragOver` to show ComfyUI's blue highlight border. Check only `kind === "file"` (not MIME type) because MIME is often empty during OS-level drags:

```javascript
function hasImageItems(e) {
    const items = e?.dataTransfer?.items;
    if (!items) return false;
    for (const item of items) {
        if (item?.kind === "file") return true;
    }
    return false;
}

node.onDragOver = function (e) {
    const handled = originalOnDragOver?.call(this, e);
    if (handled) return true;
    return hasImageItems(e);
};
```

### 2.3 Handling drop and paste events

ComfyUI routes image events through **multiple hooks** simultaneously once `previewMediaType = "image"` is set. You must register all of them and use a **deduplication guard** to prevent uploading the same file twice:

```javascript
// Called for OS drag-and-drop
node.onDragDrop = function (...args) {
    const file = extractFirstImageFile(args);
    if (!file || !isImageFile(file)) return false;
    setPastedImageFromFile(node, file).catch(console.warn);
    return true;  // ← returning true prevents ComfyUI's default handler
};

// Legacy paste hook (older ComfyUI versions)
node.onPasteFile = function (...args) {
    const file = extractFirstImageFile(args);
    if (!file || !isImageFile(file)) return false;
    setPastedImageFromFile(node, file).catch(console.warn);
    return true;
};

// Primary paste hook (current ComfyUI, called by usePaste.ts)
node.pasteFile = function (file) {
    if (!file || !isImageFile(file)) return;
    setPastedImageFromFile(node, file).catch(console.warn);
};

// Multi-file paste variant
node.pasteFiles = function (files) {
    const file = Array.isArray(files) ? files.find(isImageFile) : null;
    if (!file) return;
    setPastedImageFromFile(node, file).catch(console.warn);
};
```

### 2.4 Deduplication guard

Because multiple hooks fire for the same user action, deduplicate on `name + size + lastModified`:

```javascript
async function setPastedImageFromFile(node, file) {
    if (!isImageFile(file)) return false;

    const dedupeKey = `${file.name}:${file.size}:${file.lastModified}`;
    if (node._pasteDedupeKey === dedupeKey) return false;
    node._pasteDedupeKey = dedupeKey;
    setTimeout(() => {
        if (node._pasteDedupeKey === dedupeKey) node._pasteDedupeKey = null;
    }, 1000);

    // ... proceed with upload
}
```

### 2.5 Uploading the file to the server

Use `POST /upload/image`. Paste events from the clipboard produce a generic `image.png` file — detect this and route it to a `pasted/` subfolder to keep it separate from regular uploads:

```javascript
async function uploadImageToInput(file) {
    const isPasted =
        file?.name === "image.png" &&
        typeof file?.lastModified === "number" &&
        Math.abs(file.lastModified - Date.now()) < 2000;

    const body = new FormData();
    body.append("image", file, file.name || "pasted_image.png");
    body.append("type", "input");
    body.append("overwrite", "false");
    if (isPasted) body.append("subfolder", "pasted");

    const res = await app.api.fetchApi("/upload/image", { method: "POST", body });
    if (!res?.ok) throw new Error(`Upload failed (${res?.status})`);

    const payload = await res.json();
    // Return "subfolder/name" or just "name"
    if (payload?.subfolder) {
        return `${payload.subfolder}/${payload.name || payload.filename || file.name}`;
    }
    return payload?.name || payload?.filename || file.name;
}
```

The upload response includes `{ name, subfolder }`. Always reconstruct the full relative path as `subfolder/name` since `folder_paths.get_annotated_filepath` on the backend handles this format.

### 2.6 Updating the widget and showing a preview

After uploading:

```javascript
const pastedWidget = getWidget(node, "pasted_image");

// Add to combo options list so it's a valid selection
const values = pastedWidget.options?.values;
if (Array.isArray(values) && !values.includes(uploadedName)) {
    values.push(uploadedName);
}

pastedWidget.value = uploadedName;
pastedWidget.callback?.(uploadedName); // trigger any widget reactivity

// Load the image into node.image for custom rendering
showUploadedPreview(node, uploadedName);
```

For `showUploadedPreview`, construct the `/api/view` URL using `URLSearchParams` to handle filenames with spaces or special characters properly:

```javascript
function showUploadedPreview(node, uploadedPath) {
    const { subfolder, filename } = splitUploadedPath(uploadedPath);

    const params = new URLSearchParams({
        filename,
        type: "input",
        subfolder,
        rand: String(Date.now()),  // cache-busting
    });

    node.image.onload = () => {
        node.imageLoaded = true;
        node.properties.actualImageWidth  = node.image.naturalWidth;
        node.properties.actualImageHeight = node.image.naturalHeight;

        // Resize node to match new image aspect ratio
        node._previewAreaCache = null;
        const newSize = node.computeSize();
        if (newSize?.[0] > 0) node.size = newSize;

        // Reset perspective/crop handles for new image
        const preview = getPreviewAreaCached(node);
        resetCorners(node, preview);

        // Prime dimension widgets so backend doesn't see a "resolution change"
        // on first run (which would cause it to reset corners again)
        const lwWidget = getWidget(node, "last_width");
        if (lwWidget) lwWidget.value = node.image.naturalWidth;
        const lhWidget = getWidget(node, "last_height");
        if (lhWidget) lhWidget.value = node.image.naturalHeight;

        // Tell the onExecuted handler NOT to reset corners on first run,
        // since the user may have already adjusted them after the drop
        node.properties._preserveCorners = true;

        node.setDirtyCanvas(true, true);
    };

    node.image.src = app.api.apiURL(`/view?${params.toString()}`);
}
```

### 2.7 Clearing `pasted_image` when a wire is connected

When the user connects a wire to the `IMAGE` input, clear `pasted_image` immediately so the backend uses the wire on the next run. Handle two cases:

**Live connection** (user drags a wire):
```javascript
nodeType.prototype.onConnectionsChange = function (type, index, connected, link_info) {
    const node = this;
    const inputSlot = node.inputs?.[index];
    if (type === LiteGraph.INPUT && inputSlot?.type === "IMAGE" && connected) {
        const pastedWidget = getWidget(node, "pasted_image");
        if (pastedWidget && pastedWidget.value) {
            pastedWidget.value = "";
            node.imageLoaded = false;
            node.image.src = "";
            node.setDirtyCanvas(true, true);
        }
    }
};
```

**Page reload with an existing wire** (`onConnectionsChange` does not fire on load):
```javascript
nodeType.prototype.onConfigure = function () {
    // ... other restore logic ...

    const imageInputConnected = node.inputs?.some(
        (inp) => inp.type === "IMAGE" && inp.link != null
    );
    if (imageInputConnected) {
        const pastedWidget = getWidget(node, "pasted_image");
        if (pastedWidget && pastedWidget.value) {
            pastedWidget.value = "";
        }
    }
};
```

---

## Part 3 — Executed Handler

When a run completes, `onExecuted` fires with the backend's UI payload. Handle the `clear_pasted_image` signal here:

```javascript
export function handleOnExecutedPersp(node, message) {
    const backendData = message?.persp_info?.[0] || null;

    // ... load preview image from message?.images_custom[0] ...

    node.image.onload = () => {
        node.imageLoaded = true;

        // ... update dimensions, resize node, reset corners if needed ...

        // Backend says the wire changed and took over — clear the stale paste widget.
        // Do NOT blank node.image here; the backend preview was just loaded successfully.
        if (backendData?.clear_pasted_image) {
            const pastedWidget = node.widgets?.find((w) => w.name === "pasted_image");
            if (pastedWidget) pastedWidget.value = "";
        }

        node.setDirtyCanvas(true);
    };
}
```

> **Pitfall:** Do not set `node.imageLoaded = false` or `node.image.src = ""` inside the `clear_pasted_image` block. The `onload` callback already fired successfully with the backend's preview image. Blanking these values at the end of `onload` leaves the node with no visible preview.

---

## Summary of Pitfalls and Their Fixes

| Pitfall | Symptom | Fix |
|---|---|---|
| Not setting `node.previewMediaType = "image"` | Ctrl+V creates a new `LoadImage` node | Set it in `initNodeState` |
| Setting `node.imgs = [node.image]` | Image drawn twice (raw + overlay broken) | Never set `node.imgs`; use custom `onDrawForeground` only |
| MIME check in `hasImageItems` | No blue border on drag-over | Check `kind === "file"` only, not MIME |
| Multiple hooks all firing | File uploaded twice | Dedup on `name:size:lastModified` with a 1s TTL |
| `pasted_image` combo list missing subfolder paths | "Value not in list" validation error | Add `VALIDATE_INPUTS` that checks file existence instead |
| `_last_wire_hashes` empty after server restart | First run after restart always uses paste | Acceptable — treated as first run; wire wins on second run |
| Clearing `node.image.src` inside `onload` | Blank preview after wire takes over | Only clear the widget value, not the loaded image |
| `onConnectionsChange` not firing on page reload | Stale paste persists over newly-loaded wire | Also clear in `onConfigure` by checking `inp.link != null` |
| `onExecutedPersp` resetting corners after a drop + adjust | User's perspective setup lost on first run | Set `node.properties._preserveCorners = true` in the preview loader; check and clear it in the executed handler |
