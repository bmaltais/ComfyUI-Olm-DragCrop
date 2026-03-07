import torch
import numpy as np
from PIL import Image
import os
from folder_paths import get_temp_directory
import json

DEBUG_MODE = False

def debug_print(*args, **kwargs):
    if DEBUG_MODE:
        print(*args, **kwargs)

class OlmDragCrop:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "drawing_version": ("STRING", {"default": "init"}),
                "image": ("IMAGE",),
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
                "mask": ("MASK",)
            },
            "hidden": {
                "node_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("IMAGE", "MASK", "CROP_JSON")
    FUNCTION = "crop"
    CATEGORY = "image/transform"

    def crop(
        self,
        drawing_version,
        image: torch.Tensor,
        crop_left: int,
        crop_right: int,
        crop_top: int,
        crop_bottom: int,
        crop_width: int,
        crop_height: int,
        last_width: int,
        last_height: int,
        node_id=None,
        mask=None,
    ):
        debug_print("=" * 60)
        print(f"[OlmDragCrop] Node {node_id} executed (Backend)")

        batch_size, current_height, current_width, channels = image.shape

        debug_print("\n[OlmDragCrop] [Input Image Info]")
        debug_print(f"[OlmDragCrop] - Current image size: {current_width}x{current_height}")
        debug_print(f"[OlmDragCrop] - Last image size:    {last_width}x{last_height}")
        debug_print(f"[OlmDragCrop] - Batch size: {batch_size}, Channels: {channels}")

        resolution_changed = (current_width != last_width or current_height != last_height)
        reset_frontend_crop = False

        if resolution_changed:
            debug_print("\n[OlmDragCrop] [Resolution Change Detected]")
            debug_print("[OlmDragCrop] → Forcing full image crop and signaling frontend reset.")
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

        if (crop_left < 0 or crop_top < 0 or
            computed_crop_right > current_width or computed_crop_bottom > current_height or
            crop_width <= 0 or crop_height <= 0):
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

        cropped_image = image[:, crop_top:computed_crop_bottom, crop_left:computed_crop_right, :]

        def _make_zero_mask(bs, h, w, device):
            return torch.zeros((bs, h, w), dtype=torch.float32, device=device)

        cropped_mask = None
        if mask is None or not torch.is_tensor(mask) or mask.numel() == 0:
            cropped_mask = _make_zero_mask(batch_size, crop_height, crop_width, image.device)
        else:
            m = mask

            if m.dim() == 4 and m.shape[1] == 1:
                m = m.squeeze(1)
            elif m.dim() == 2:
                m = m.unsqueeze(0)

            if m.dim() != 3:
                cropped_mask = _make_zero_mask(batch_size, crop_height, crop_width, image.device)
            else:
                if m.shape[0] != batch_size:
                    if m.shape[0] == 1 and batch_size > 1:
                        m = m.repeat(batch_size, 1, 1)
                    else:
                        if m.shape[0] > batch_size:
                            m = m[:batch_size]
                        else:
                            m = m.repeat(int(np.ceil(batch_size / m.shape[0])), 1, 1)[:batch_size]

                mh, mw = m.shape[1], m.shape[2]

                cl = max(0, min(crop_left, mw))
                cr = max(0, min(computed_crop_right, mw))
                ct = max(0, min(crop_top, mh))
                cb = max(0, min(computed_crop_bottom, mh))

                if cr <= cl or cb <= ct:
                    cropped_mask = _make_zero_mask(batch_size, crop_height, crop_width, image.device)
                else:
                    region = m[:, ct:cb, cl:cr]
                    cropped_mask = _make_zero_mask(batch_size, crop_height, crop_width, image.device)
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

        original_filename = None
        if batch_size > 0:
            img_array = (image[0].cpu().numpy() * 255).astype(np.uint8)
            pil_image = Image.fromarray(img_array)
            temp_dir = get_temp_directory()
            filename_hash = hash(f"{node_id}_{current_width}x{current_height}")
            original_filename = f"dragcrop_original_{filename_hash}.png"
            filepath = os.path.join(temp_dir, original_filename)
            os.makedirs(temp_dir, exist_ok=True)
            try:
                pil_image.save(filepath)
            except Exception as e:
                print(f"[OlmDragCrop] Error saving preview image: {e}")
                original_filename = None

        crop_payload = {
            "left": crop_left,
            "top": crop_top,
            "right": crop_right,
            "bottom": crop_bottom,
            "width": crop_width,
            "height": crop_height,
            "original_size": [current_width, current_height],
            "cropped_size": [crop_width, crop_height],
            "reset_crop_ui": reset_frontend_crop
        }

        crop_json = json.dumps(crop_payload)

        crop_info_for_frontend = {
            **crop_payload,
        }

        return {
            "ui": {
                "images_custom": [{
                    "filename": original_filename,
                    "subfolder": "",
                    "type": "temp"
                }] if original_filename else [],
                "crop_info": [crop_info_for_frontend]
            },
            "result": (cropped_image, cropped_mask, crop_json),
        }


class OlmCropInfoInterpreter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "crop_json": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("INT","INT","INT","INT","INT","INT","STRING","STRING")
    RETURN_NAMES = ("left","top","right","bottom","width","height","csv","pretty")
    FUNCTION = "interpret"
    CATEGORY = "image/transform"

    def interpret(self, crop_json: str):
        try:
            data = json.loads(crop_json) if crop_json else {}
        except Exception:
            data = {}

        left   = int(data.get("left",   0))
        top    = int(data.get("top",    0))
        right  = int(data.get("right",  left))
        bottom = int(data.get("bottom", top))
        width  = int(data.get("width",  max(0, right - left)))
        height = int(data.get("height", max(0, bottom - top)))

        csv = f"{left},{top},{right},{bottom},{width},{height}"
        pretty = f"left={left}, top={top}, right={right}, bottom={bottom}, width={width}, height={height}"

        return (left, top, right, bottom, width, height, csv, pretty)



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
        A.append([dx, dy, 1, 0,  0, 0, -dx * sx, -dy * sx])
        b.append(sx)
        A.append([0,  0, 0, dx, dy, 1, -dx * sy, -dy * sy])
        b.append(sy)
    A = np.array(A, dtype=np.float64)
    b = np.array(b, dtype=np.float64)
    coeffs, _, _, _ = np.linalg.lstsq(A, b, rcond=None)
    return coeffs.tolist()


class OlmDragPerspective:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "drawing_version": ("STRING", {"default": "init"}),
                "image": ("IMAGE",),
                "tl_x": ("INT", {"default": 0,   "min": 0, "max": 8192}),
                "tl_y": ("INT", {"default": 0,   "min": 0, "max": 8192}),
                "tr_x": ("INT", {"default": 512, "min": 0, "max": 8192}),
                "tr_y": ("INT", {"default": 0,   "min": 0, "max": 8192}),
                "br_x": ("INT", {"default": 512, "min": 0, "max": 8192}),
                "br_y": ("INT", {"default": 512, "min": 0, "max": 8192}),
                "bl_x": ("INT", {"default": 0,   "min": 0, "max": 8192}),
                "bl_y": ("INT", {"default": 512, "min": 0, "max": 8192}),
                "last_width":  ("INT", {"default": 0}),
                "last_height": ("INT", {"default": 0}),
            },
            "hidden": {
                "node_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("IMAGE", "PERSP_JSON")
    FUNCTION = "correct"
    CATEGORY = "image/transform"

    def correct(
        self,
        drawing_version,
        image: torch.Tensor,
        tl_x: int, tl_y: int,
        tr_x: int, tr_y: int,
        br_x: int, br_y: int,
        bl_x: int, bl_y: int,
        last_width: int,
        last_height: int,
        node_id=None,
    ):
        print(f"[OlmDragPerspective] Node {node_id} executed (Backend)")

        batch_size, current_height, current_width, channels = image.shape

        resolution_changed = (current_width != last_width or current_height != last_height)
        reset_quad_ui = False

        if resolution_changed:
            tl_x, tl_y = 0, 0
            tr_x, tr_y = current_width, 0
            br_x, br_y = current_width, current_height
            bl_x, bl_y = 0, current_height
            reset_quad_ui = True

        # Clamp all corners to image bounds
        def clamp_pt(x, y):
            return max(0, min(x, current_width)), max(0, min(y, current_height))

        tl_x, tl_y = clamp_pt(tl_x, tl_y)
        tr_x, tr_y = clamp_pt(tr_x, tr_y)
        br_x, br_y = clamp_pt(br_x, br_y)
        bl_x, bl_y = clamp_pt(bl_x, bl_y)

        src_pts = [
            [tl_x, tl_y],
            [tr_x, tr_y],
            [br_x, br_y],
            [bl_x, bl_y],
        ]

        # Compute output dimensions from the edge lengths of the quad
        top_w    = np.sqrt((tr_x - tl_x) ** 2 + (tr_y - tl_y) ** 2)
        bottom_w = np.sqrt((br_x - bl_x) ** 2 + (br_y - bl_y) ** 2)
        left_h   = np.sqrt((bl_x - tl_x) ** 2 + (bl_y - tl_y) ** 2)
        right_h  = np.sqrt((br_x - tr_x) ** 2 + (br_y - tr_y) ** 2)

        out_w = max(1, int(max(top_w, bottom_w)))
        out_h = max(1, int(max(left_h, right_h)))

        dst_pts = [
            [0,     0],
            [out_w, 0],
            [out_w, out_h],
            [0,     out_h],
        ]

        try:
            coeffs = _compute_perspective_coeffs(src_pts, dst_pts)
        except Exception as e:
            print(f"[OlmDragPerspective] Error computing perspective coefficients: {e}")
            coeffs = None

        try:
            resample = Image.Resampling.BICUBIC
        except AttributeError:
            resample = Image.BICUBIC  # Pillow < 9.1

        warped_frames = []
        for i in range(batch_size):
            frame = image[i].cpu().numpy()
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

        # Save preview of the original (unwarped) frame 0 for the frontend
        original_filename = None
        if batch_size > 0:
            img_array = (image[0].cpu().numpy() * 255).astype(np.uint8)
            pil_preview = Image.fromarray(img_array)
            temp_dir = get_temp_directory()
            filename_hash = hash(f"persp_{node_id}_{current_width}x{current_height}")
            original_filename = f"dragpersp_original_{filename_hash}.png"
            filepath = os.path.join(temp_dir, original_filename)
            os.makedirs(temp_dir, exist_ok=True)
            try:
                pil_preview.save(filepath)
            except Exception as e:
                print(f"[OlmDragPerspective] Error saving preview image: {e}")
                original_filename = None

        persp_payload = {
            "tl": [tl_x, tl_y],
            "tr": [tr_x, tr_y],
            "br": [br_x, br_y],
            "bl": [bl_x, bl_y],
            "out_width": out_w,
            "out_height": out_h,
            "original_size": [current_width, current_height],
            "reset_quad_ui": reset_quad_ui,
        }

        persp_json = json.dumps(persp_payload)

        return {
            "ui": {
                "images_custom": [{
                    "filename": original_filename,
                    "subfolder": "",
                    "type": "temp"
                }] if original_filename else [],
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
    "OlmDragPerspective": "Olm Drag Perspective",
}


WEB_DIRECTORY = "./web"
