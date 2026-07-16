import traceback

WEB_DIRECTORY = "./web/comfyui"
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

try:
    from .py.ccc import ComicCreater
    ComicCreater.add_routes()
except Exception as _e:
    print(f"[ccc] ERROR: {_e}")
    traceback.print_exc()
