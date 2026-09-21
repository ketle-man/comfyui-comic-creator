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

# Autoタブ（AIマンガ自動作成）のチャットから生成した画像は、ComfyUI本体のoutputフォルダ配下に
# 保存する（例: .../ComfyUI/output/cc_auto）。ComfyUI起動時に無ければ自動作成される。
OUTPUT_AUTO_DIR = Path(folder_paths.get_output_directory()) / "cc_auto"

# 動画ツール（PixiJS FXと違いComfyUI外部ノードではなく本体機能）の動画ファイルは、
# IndexedDBに複製保存せず常にこのフォルダ上のファイルをURL参照する
# （例: .../ComfyUI/output/cc_video_assets）。ComfyUI起動時に無ければ自動作成される。
OUTPUT_VIDEO_DIR = Path(folder_paths.get_output_directory()) / "cc_video_assets"

SETTINGS_FILE = PLUGIN_DIR / "settings.json"

VALID_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.webp', '.svg')
VALID_VIDEO_EXTENSIONS = ('.mp4',)
MAX_VIDEO_UPLOAD_BYTES = 300 * 1024 * 1024  # 300MB（暫定値。実運用のファイルサイズに応じて調整）

# base64画像を含むJSONボディ（nanobanana画像保存、Imageプロジェクトサムネイル、G'MIC入力画像）の上限。
# 無制限のbase64.b64decodeによるメモリDoSを防ぐ。高解像度PNGでも十分な余裕を見込んだ値。
MAX_JSON_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024  # 20MB
# PSDインポート（multipart）の上限。レイヤー数の多い実用PSDは数十MBになり得るため画像系より大きめ。
MAX_PSD_UPLOAD_BYTES = 50 * 1024 * 1024  # 50MB

GMIC_SERVER_URL = 'http://127.0.0.1:8005'
