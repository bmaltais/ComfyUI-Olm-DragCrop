from .olm_dragcrop import NODE_CLASS_MAPPINGS as _dc_classes
from .olm_dragcrop import NODE_DISPLAY_NAME_MAPPINGS as _dc_names
from .olm_dragcrop import WEB_DIRECTORY as WEB_DIRECTORY

from .image_editor import NODE_CLASS_MAPPINGS as _ie_classes
from .image_editor import NODE_DISPLAY_NAME_MAPPINGS as _ie_names

NODE_CLASS_MAPPINGS = {**_dc_classes, **_ie_classes}
NODE_DISPLAY_NAME_MAPPINGS = {**_dc_names, **_ie_names}
