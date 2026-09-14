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

# 動画ツール（PixiJS FXと違いComfyUI外部ノードではなく本体機能）の動画ファイルは、
# IndexedDBに複製保存せず常にこのフォルダ上のファイルをURL参照する
# （例: .../ComfyUI/output/cc_video_assets）。ComfyUI起動時に無ければ自動作成される。
OUTPUT_VIDEO_DIR = Path(folder_paths.get_output_directory()) / "cc_video_assets"

SETTINGS_FILE = PLUGIN_DIR / "settings.json"

VALID_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.webp', '.svg')
VALID_VIDEO_EXTENSIONS = ('.mp4',)
MAX_VIDEO_UPLOAD_BYTES = 300 * 1024 * 1024  # 300MB（暫定値。実運用のファイルサイズに応じて調整）

GMIC_SERVER_URL = 'http://127.0.0.1:8005'
