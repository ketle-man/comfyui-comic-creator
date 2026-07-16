from pathlib import Path
import folder_paths

PLUGIN_DIR = Path(__file__).resolve().parent.parent

TEMPLATES_DIR = PLUGIN_DIR / "templates"
STATIC_DIR    = PLUGIN_DIR / "static"
ASSETS_DIR    = PLUGIN_DIR / "assets"
ASSETS_JSON   = ASSETS_DIR / "assets.json"

# Nanobananaタブの生成画像は、プラグイン内ではなくComfyUI本体のoutputフォルダ配下に保存する
# （例: .../ComfyUI/output/cc_nanobanana）。ComfyUI起動時に無ければ自動作成される。
OUTPUT_NANOBANANA_DIR = Path(folder_paths.get_output_directory()) / "cc_nanobanana"
GMIC_TEMP_DIR         = PLUGIN_DIR / "output" / "gmic-temp"

SETTINGS_FILE = PLUGIN_DIR / "settings.json"

VALID_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.webp', '.svg')

GMIC_SERVER_URL = 'http://127.0.0.1:8005'
