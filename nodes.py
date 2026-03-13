import json
import os

import numpy as np
import torch
from PIL import Image, ImageOps

import folder_paths
from aiohttp import web
from server import PromptServer


MAX_SINGLE_OUTPUTS = 32


def _is_subpath(path: str, root: str) -> bool:
    p_abs = os.path.abspath(path)
    r_abs = os.path.abspath(root)
    try:
        return os.path.commonpath([p_abs, r_abs]) == r_abs
    except ValueError:
        return False


def _resolve_input_path(item: str) -> str:
    cleaned = (item or "").strip().strip('"').strip("'")
    if not cleaned:
        return ""
    input_dir = os.path.abspath(folder_paths.get_input_directory())
    if os.path.isabs(cleaned):
        path = os.path.abspath(cleaned)
    else:
        path = os.path.abspath(os.path.join(input_dir, cleaned))
    if not _is_subpath(path, input_dir):
        raise ValueError(
            "Invalid image path. Please use files in ComfyUI input directory "
            "(CP compatible)."
        )
    return path


def _delete_input_image(path_value: str) -> bool:
    resolved = _resolve_input_path(path_value)
    if os.path.isfile(resolved):
        os.remove(resolved)
        return True
    return False


def _load_rgb_tensor(path: str, target_size=None) -> torch.Tensor:
    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img).convert("RGB")
        if target_size is not None and img.size != target_size:
            img = img.resize(target_size, Image.Resampling.LANCZOS)
        arr = np.array(img).astype(np.float32) / 255.0
        return torch.from_numpy(arr)


def _blank_tensor(width: int, height: int) -> torch.Tensor:
    return torch.zeros((height, width, 3), dtype=torch.float32)


class RH_MultiImageLoaderUI:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images_json": (
                    "STRING",
                    {
                        "default": "[]",
                        "multiline": True,
                    },
                ),
            }
        }

    _single_types = tuple("IMAGE" for _ in range(MAX_SINGLE_OUTPUTS))
    _single_names = tuple(f"image_{idx + 1}" for idx in range(MAX_SINGLE_OUTPUTS))

    RETURN_TYPES = ("IMAGE",) + _single_types
    RETURN_NAMES = ("image_list",) + _single_names
    FUNCTION = "load_images"
    CATEGORY = "CP/Image"

    def load_images(self, images_json):
        try:
            items = json.loads(images_json or "[]")
            if not isinstance(items, list):
                items = []
        except Exception:
            items = []

        items = [str(x).strip() for x in items if str(x).strip()]
        items = items[:MAX_SINGLE_OUTPUTS]

        if not items:
            blank = _blank_tensor(64, 64)
            batch = blank.unsqueeze(0)
            singles = [batch for _ in range(MAX_SINGLE_OUTPUTS)]
            return (batch, *singles)

        paths = []
        for raw in items:
            resolved = _resolve_input_path(raw)
            if os.path.isfile(resolved):
                paths.append(resolved)

        if not paths:
            # Keep workflow running even if files were externally removed.
            blank = _blank_tensor(64, 64)
            batch = blank.unsqueeze(0)
            singles = [batch for _ in range(MAX_SINGLE_OUTPUTS)]
            return (batch, *singles)

        # Always align all images to the first image size, so batch stack is stable.
        with Image.open(paths[0]) as f:
            target_size = ImageOps.exif_transpose(f).convert("RGB").size

        images = [_load_rgb_tensor(p, target_size=target_size) for p in paths]
        batch = torch.stack(images, dim=0)

        blank_ref = _blank_tensor(batch.shape[2], batch.shape[1]).unsqueeze(0)
        singles = []
        for idx in range(MAX_SINGLE_OUTPUTS):
            if idx < len(images):
                singles.append(images[idx].unsqueeze(0))
            else:
                singles.append(blank_ref)

        return (batch, *singles)


NODE_CLASS_MAPPINGS = {
    "RH_MultiImageLoaderUI": RH_MultiImageLoaderUI,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RH_MultiImageLoaderUI": "CP Multi Image Loader",
}


@PromptServer.instance.routes.post("/cp/multi_image_loader/delete")
@PromptServer.instance.routes.post("/rh/multi_image_loader/delete")
async def cp_multi_image_loader_delete(request):
    try:
        payload = await request.json()
        path_value = str(payload.get("path", "")).strip()
        if not path_value:
            return web.json_response({"ok": False, "error": "path is required"}, status=400)
        deleted = _delete_input_image(path_value)
        return web.json_response({"ok": True, "deleted": deleted})
    except ValueError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)
