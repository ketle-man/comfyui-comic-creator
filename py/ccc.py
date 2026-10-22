import asyncio
import base64
import json
import math
import os
import re
import subprocess
import threading
import time
import urllib.request
import urllib.error
import uuid
from datetime import datetime

import aiohttp
from aiohttp import web
from server import PromptServer

from pathlib import Path as _Path
from urllib.parse import urlparse as _urlparse
from urllib.parse import quote as _urlquote

from .config import (
    PLUGIN_DIR,
    TEMPLATES_DIR, STATIC_DIR, ASSETS_DIR, ASSETS_JSON,
    OUTPUT_NANOBANANA_DIR, OUTPUT_AUTO_DIR, GMIC_TEMP_DIR, OUTPUT_VIDEO_DIR,
    SETTINGS_FILE,
    VALID_EXTENSIONS, GMIC_SERVER_URL,
    VALID_VIDEO_EXTENSIONS, MAX_VIDEO_UPLOAD_BYTES,
    MAX_JSON_IMAGE_UPLOAD_BYTES, MAX_PSD_UPLOAD_BYTES,
)

# ─── Security helpers ─────────────────────────────────────────────────────────

def _safe_path(base_dir, untrusted: str):
    """ファイル名をサニタイズし、base_dir 外への書き込みを防ぐ。"""
    name = os.path.basename(untrusted)
    if not name:
        raise ValueError(f"無効なファイル名: {untrusted!r}")
    dest = (_Path(base_dir) / name).resolve()
    base = _Path(base_dir).resolve()
    if not str(dest).startswith(str(base) + os.sep) and dest != base:
        raise ValueError(f"パストラバーサルを検出: {untrusted!r}")
    return dest

_ALLOWED_LOCALHOST = {'localhost', '127.0.0.1', '::1', '[::1]'}

def _validate_local_url(url: str, param_name: str = 'url') -> str:
    """URL がローカルホストを指しているか検証する。"""
    try:
        p = _urlparse(url)
        if p.scheme not in ('http', 'https'):
            raise CCCError('url_invalid_scheme', f"{param_name}: スキームは http/https のみ許可", param=param_name)
        if p.username or p.password:
            raise CCCError('url_has_credentials', f"{param_name}: 認証情報つきURLは禁止", param=param_name)
        host = (p.hostname or '').lower()
        if host not in _ALLOWED_LOCALHOST:
            raise CCCError('url_not_localhost', f"{param_name}: ローカルホスト以外への接続は禁止", param=param_name)
    except CCCError:
        raise
    except Exception:
        raise CCCError('url_invalid', f"{param_name}: 無効なURL", param=param_name)
    return url

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

_local_opener = urllib.request.build_opener(_NoRedirect)

def _local_urlopen(req, timeout):
    """ローカルサービス(Unsloth/Eagle/G'MIC)宛て用のurlopen。リダイレクトは追従しない（3xxはHTTPErrorになる）。
    ローカルサービスが返したLocationで外部ホストへ接続させない（SSRF対策。Workflow Studioのurl_guardと同じ方針）。"""
    return _local_opener.open(req, timeout=timeout)

def _validate_local_exe_path(path: str, param_name: str = 'gmicQtPath') -> str:
    """ローカル実行ファイルパスを検証する（UNC/ネットワークパスを拒否し、実在するファイルであることを要求）。
    任意のパスをそのまま subprocess.Popen の実行ファイルとして使う設定値は、保存前に必ずこれを通すこと
    （さもないと未検証の値が後で任意プロセス起動に使われ、リモートコード実行につながる）。"""
    if not path:
        return path
    if path.startswith('\\\\') or path.startswith('//'):
        raise CCCError('exe_path_unc_forbidden', f"{param_name}: ネットワークパス（UNC）は指定できません", param=param_name)
    if not os.path.isfile(path):
        raise CCCError('exe_path_not_found', f"{param_name}: 指定されたファイルが見つかりません: {path}", param=param_name, path=path)
    return path

# ─── i18n対応エラー ─────────────────────────────────────────────────────────
# フロントエンドは error_code を i18n.js の t('err.<camelCaseコード>') にマッピングして
# 多言語表示する（message はサーバーログ用の日本語のまま。フロント表示には使わない）。

class CCCError(Exception):
    """機械可読な error_code / error_params を持つ例外。
    _error_response() で JSON レスポンスに変換され、フロントの t() 経由で多言語表示される。"""
    def __init__(self, code: str, message: str, **params):
        self.code = code
        self.params = params
        super().__init__(message)

def _error_response(e: Exception, status: int = 500, key: str = 'message') -> web.Response:
    """例外から統一形式のエラーレスポンスを作る。CCCErrorなら error_code/error_params も含める。
    key='message' なら {'status':'error','message':...}、key='detail' なら {'detail':...} 形式（既存ルートの形式に合わせる）。"""
    payload = {'status': 'error', key: str(e)} if key == 'message' else {key: str(e)}
    if isinstance(e, CCCError):
        payload['error_code'] = e.code
        payload['error_params'] = e.params
    return web.json_response(payload, status=status)

_GEMINI_MODEL_RE = re.compile(r'^[A-Za-z0-9._-]{1,100}$')

def _validate_gemini_model(model: str) -> str:
    """Gemini APIのモデル名を検証する。URLパスへ直接f-string埋め込みするため、
    '/'や'?'等を許すとリクエスト先パス・クエリを操作されAPIキーの不正流用につながる。"""
    if not model or not _GEMINI_MODEL_RE.match(model):
        raise CCCError('nanobanana_invalid_model', f'不正なモデル名です: {model!r}', model=model)
    return model

_FONT_WEIGHT_RE = re.compile(r'^\d{1,3}$')

def _validate_font_weight(weight: str) -> str:
    """Google Fonts CSS2 APIのweightクエリ値を検証する。URLクエリへ直接f-string埋め込みするため、
    '&'等を許すとクエリインジェクションにつながる。"""
    if not _FONT_WEIGHT_RE.match(weight):
        raise CCCError('font_invalid_weight', f'不正なweightです: {weight!r}', weight=weight)
    return weight

async def _read_json_limited(request, max_bytes: int) -> dict:
    """request.json() の代替。ボディサイズを上限チェックしてからパースする。
    base64画像等を含むJSONは request.json() だと無制限に読み込まれメモリDoSになるため、
    base64.b64decode する全ハンドラはこれを経由すること。"""
    if request.content_length is not None and request.content_length > max_bytes:
        raise CCCError('payload_too_large', f'リクエストサイズが大きすぎます（上限 {max_bytes // (1024 * 1024)}MB）', max_mb=max_bytes // (1024 * 1024))
    raw = await request.read()
    if len(raw) > max_bytes:
        raise CCCError('payload_too_large', f'リクエストサイズが大きすぎます（上限 {max_bytes // (1024 * 1024)}MB）', max_mb=max_bytes // (1024 * 1024))
    return json.loads(raw)

# ─── Jinja2 ──────────────────────────────────────────────────────────────────

_jinja_env = None

def _get_jinja_env():
    global _jinja_env
    if _jinja_env is None:
        try:
            from jinja2 import Environment, FileSystemLoader
            _jinja_env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))
        except ImportError:
            pass
    return _jinja_env

# ─── Settings ────────────────────────────────────────────────────────────────

_app_settings: dict = {}

def _load_settings():
    global _app_settings
    if SETTINGS_FILE.exists():
        try:
            _app_settings = json.loads(SETTINGS_FILE.read_text(encoding='utf-8'))
        except Exception:
            _app_settings = {}

def _save_settings():
    SETTINGS_FILE.write_text(
        json.dumps(_app_settings, indent=2, ensure_ascii=False), encoding='utf-8'
    )

_load_settings()

def _load_env_file():
    """PLUGIN_DIR/.env を KEY=VALUE 形式で読み込み、未設定の環境変数にのみ取り込む
    （実際の環境変数が常に優先）。python-dotenv 非依存の最小実装。
    メモ帳保存で付きがちな BOM 付き UTF-8 も許容する。"""
    env_path = PLUGIN_DIR / '.env'
    if not env_path.is_file():
        return
    try:
        for line in env_path.read_text(encoding='utf-8-sig').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    except Exception as e:
        print(f"[comic-creator] .env の読み込みに失敗しました: {e}")

_load_env_file()

# APIキーの優先順位: 環境変数 > .env（上で環境変数に取り込み済み） > settings.json
NANOBANANA_API_KEY: str = os.getenv('NANOBANANA_API_KEY', _app_settings.get('nanobananaApiKey', ''))

# ─── G'MIC jobs ──────────────────────────────────────────────────────────────

_gmic_jobs: dict = {}
_gmic_jobs_lock = threading.Lock()

def _sniff_image_ext(b: bytes):
    """先頭バイトから実画像形式を判定する。
    data: URLのMIMEは実体と食い違うことがある（例: Nanobanana生成画像は
    image/pngを名乗るJPEG）。拡張子が実体と違うとG'MIC-Qtが読み込めず
    即終了してGUIが起動しないため、実バイトを優先する。"""
    if b[:8] == b'\x89PNG\r\n\x1a\n':
        return '.png'
    if b[:2] == b'\xff\xd8':
        return '.jpg'
    if b[:4] == b'RIFF' and b[8:12] == b'WEBP':
        return '.webp'
    if b[:6] in (b'GIF87a', b'GIF89a'):
        return '.gif'
    if b[:2] == b'BM':
        return '.bmp'
    return None

def _gmic_run_gui(job_id: str, input_path: str, output_path: str):
    gmic_exe = _app_settings.get('gmicQtPath', '')
    args = [gmic_exe, '-o', output_path, input_path]
    try:
        if not gmic_exe:
            raise CCCError('gmic_qt_not_configured', "G'MIC Qtの実行ファイルパスが設定されていません（設定でgmicQtPathを指定してください）")
        with _gmic_jobs_lock:
            _gmic_jobs[job_id]['status'] = 'processing'
            _gmic_jobs[job_id]['message'] = "G'MIC GUIで編集中..."
            _gmic_jobs[job_id]['message_code'] = 'gmic_editing'
        proc = subprocess.Popen(args, creationflags=subprocess.CREATE_NEW_CONSOLE)
        proc.wait()
        time.sleep(0.5)
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            with _gmic_jobs_lock:
                _gmic_jobs[job_id]['status'] = 'completed'
                _gmic_jobs[job_id]['result_path'] = output_path
                _gmic_jobs[job_id]['message'] = '完了'
        else:
            raise CCCError('gmic_cancelled', "G'MIC GUIがキャンセルされました")
    except Exception as e:
        with _gmic_jobs_lock:
            _gmic_jobs[job_id]['status'] = 'failed'
            _gmic_jobs[job_id]['error'] = str(e)
            _gmic_jobs[job_id]['error_code'] = getattr(e, 'code', None)
            _gmic_jobs[job_id]['error_params'] = getattr(e, 'params', {})

# ─── PSD (Photoshop) 対応 ─────────────────────────────────────────────────────
# Canvas2D の globalCompositeOperation 文字列 <-> psd_tools.constants.BlendMode 名の相互変換テーブル
# (Imageタブの Layer.blendMode はCanvas2Dの合成モード文字列をそのまま保持している)
_PSD_BLEND_MODE_MAP = {
    "source-over": "NORMAL",
    "multiply": "MULTIPLY",
    "screen": "SCREEN",
    "overlay": "OVERLAY",
    "darken": "DARKEN",
    "lighten": "LIGHTEN",
    "color-dodge": "COLOR_DODGE",
    "color-burn": "COLOR_BURN",
    "hard-light": "HARD_LIGHT",
    "soft-light": "SOFT_LIGHT",
    "difference": "DIFFERENCE",
    "exclusion": "EXCLUSION",
    "hue": "HUE",
    "saturation": "SATURATION",
    "color": "COLOR",
    "luminosity": "LUMINOSITY",
}
# 逆引き: psd_tools.constants.BlendMode 名 -> Canvas2D 文字列（PSDインポート用）。
# CSSに対応物が無いPSD側のブレンドモード（Dissolve, Linear Burn/Dodge等）は "source-over" にフォールバックする。
_CSS_BLEND_MODE_REVERSE = {v: k for k, v in _PSD_BLEND_MODE_MAP.items()}

def _build_psd_from_layers(width: int, height: int, layers: list) -> bytes:
    """Imageタブのレイヤー配列(dataURL+メタデータ)から1つのPSDを組み立て、バイナリを返す。
    各レイヤー画像はフロントエンド側で回転・反転・拡縮をベイクしたキャンバス全体サイズの
    PNGとして渡される前提のため位置は常に(0,0)。opacity/blendModeはPSDレイヤー属性として渡す。"""
    try:
        from psd_tools import PSDImage
        from psd_tools.api.layers import PixelLayer
        from psd_tools.constants import BlendMode
    except ImportError as e:
        raise RuntimeError(
            "psd-tools がインストールされていません。ComfyUIのpython環境で "
            "`pip install psd-tools` を実行してください。"
        ) from e
    from PIL import Image
    import io

    if not layers:
        raise ValueError("書き出すレイヤーがありません")
    if width <= 0 or height <= 0:
        raise ValueError("キャンバスサイズが不正です")

    base = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    psd = PSDImage.frompil(base)

    added = 0
    for layer_data in layers:
        data_url = layer_data.get("imageData", "")
        m = re.match(r"^data:image/\w+;base64,(.+)$", data_url)
        if not m:
            continue
        try:
            im = Image.open(io.BytesIO(base64.b64decode(m.group(1)))).convert("RGBA")
        except Exception as e:
            print(f"[ccc] PSD書き出し: レイヤー画像のデコードに失敗しました: {e}")
            continue

        name = str(layer_data.get("name") or "Layer")[:255]
        opacity = int(max(0.0, min(1.0, float(layer_data.get("opacity", 1.0)))) * 255)
        visible = bool(layer_data.get("visible", True))
        blend_key = _PSD_BLEND_MODE_MAP.get(layer_data.get("blendMode", "source-over"), "NORMAL")
        blend_mode = getattr(BlendMode, blend_key)

        pixel_layer = PixelLayer.frompil(im, psd, name=name, top=0, left=0)
        pixel_layer.opacity = opacity
        pixel_layer.blend_mode = blend_mode
        pixel_layer.visible = visible
        added += 1

    if added == 0:
        raise ValueError("有効なレイヤー画像がありません")

    buf = io.BytesIO()
    psd.save(buf)
    return buf.getvalue()

def _extract_psd_layers(psd) -> dict:
    """PSDImageインスタンスからレイヤー配列(dataURL+メタデータ)を抽出する。
    グループ自体・ラスタ化できないレイヤー(調整レイヤー等)はスキップする。
    戻り値のlayersはImageタブのLayer配列規約(先頭=最前面)に合わせて並べる。"""
    from psd_tools.constants import BlendMode
    import io

    layers_out = []
    for layer in psd.descendants():
        if layer.is_group():
            continue
        try:
            im = layer.topil()
        except Exception as e:
            print(f"[ccc] PSDインポート: レイヤー {layer.name!r} のラスタ化に失敗しました: {e}")
            continue
        if im is None:
            continue
        im = im.convert("RGBA")

        left, top, right, bottom = layer.bbox
        w, h = right - left, bottom - top
        if w <= 0 or h <= 0:
            continue

        buf = io.BytesIO()
        im.save(buf, format="PNG")
        data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

        blend_value = layer.blend_mode
        try:
            blend_name = BlendMode(blend_value.value if hasattr(blend_value, "value") else blend_value).name
        except ValueError:
            blend_name = "NORMAL"
        css_blend = _CSS_BLEND_MODE_REVERSE.get(blend_name, "source-over")

        layers_out.append({
            "name": layer.name or "Layer",
            "x": left, "y": top, "width": w, "height": h,
            "opacity": (layer.opacity if layer.opacity is not None else 255) / 255.0,
            "visible": bool(layer.visible),
            "blendMode": css_blend,
            "imageData": data_url,
        })

    if not layers_out:
        raise ValueError("インポート可能なレイヤーが見つかりませんでした")

    # descendants()は背面→前面(下から上)の順で返るため、
    # Imageタブのレイヤー配列規約(先頭=最前面)に合わせて反転する
    layers_out.reverse()

    return {"width": psd.width, "height": psd.height, "layers": layers_out}

def _import_psd_bytes(psd_bytes: bytes) -> dict:
    """アップロードされたPSDファイル(バイト列)をレイヤー配列(dataURL+メタデータ)に分解する。"""
    try:
        from psd_tools import PSDImage
    except ImportError as e:
        raise RuntimeError(
            "psd-tools がインストールされていません。ComfyUIのpython環境で "
            "`pip install psd-tools` を実行してください。"
        ) from e
    import io

    try:
        psd = PSDImage.open(io.BytesIO(psd_bytes))
    except Exception as e:
        raise ValueError(f"PSDファイルの読み込みに失敗しました: {e}") from e

    return _extract_psd_layers(psd)

# ─── Assets ──────────────────────────────────────────────────────────────────

def _generate_assets_json() -> dict:
    folders_data = []
    if ASSETS_DIR.is_dir():
        for folder_name in sorted(os.listdir(ASSETS_DIR)):
            folder_path = ASSETS_DIR / folder_name
            if folder_path.is_dir() and not folder_name.startswith('.'):
                assets = []
                for file_name in sorted(os.listdir(folder_path)):
                    if file_name.lower().endswith(VALID_EXTENSIONS):
                        asset_entry = {
                            "name": file_name,
                            "path": f"/ccc_assets/{folder_name}/{file_name}",
                        }
                        # Imageタブの「プロジェクト保存」: 同名の .json（レイヤー編集状態）が
                        # 存在する .png はプロジェクトアセットとして projectPath を付与する
                        if folder_name == "image" and file_name.lower().endswith(".png"):
                            json_name = file_name[:-4] + ".json"
                            if (folder_path / json_name).is_file():
                                asset_entry["projectPath"] = f"/ccc_assets/{folder_name}/{json_name}"
                        assets.append(asset_entry)
                folders_data.append({
                    "name": folder_name,
                    "displayName": folder_name.capitalize(),
                    "assets": assets,
                })
    result = {"folders": folders_data}
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_JSON.write_text(json.dumps(result, indent=4, ensure_ascii=False), encoding='utf-8')
    return result

# ─── HTTP handlers ────────────────────────────────────────────────────────────

async def serve_index(request):
    env = _get_jinja_env()
    if env:
        tmpl = env.get_template('index.html')
        return web.Response(text=tmpl.render(), content_type='text/html', charset='utf-8')
    html_path = TEMPLATES_DIR / 'index.html'
    if html_path.exists():
        return web.Response(text=html_path.read_text(encoding='utf-8'), content_type='text/html', charset='utf-8')
    return web.Response(text='<h1>Comic Creator - index.html not found</h1>', content_type='text/html')

async def handle_refresh_assets(request):
    data = _generate_assets_json()
    return web.json_response(data)

async def handle_nanobanana_key(request):
    # APIキー本体は返さず、設定済みかどうかのみ通知する
    has_key = bool(NANOBANANA_API_KEY)
    masked = ('*' * (len(NANOBANANA_API_KEY) - 4) + NANOBANANA_API_KEY[-4:]) if has_key else ''
    return web.json_response({'status': 'ok' if has_key else 'no_key', 'masked': masked})

async def handle_save_nanobanana_image(request):
    try:
        data = await _read_json_limited(request, MAX_JSON_IMAGE_UPLOAD_BYTES)
        img_b64 = data.get('image', '')
        filename = data.get('filename', '')
        if not img_b64:
            return web.json_response({'status': 'error', 'message': 'image field required'}, status=400)
        if img_b64.startswith('data:'):
            img_b64 = img_b64.split(',', 1)[1]
        img_bytes = base64.b64decode(img_b64)
        OUTPUT_NANOBANANA_DIR.mkdir(parents=True, exist_ok=True)
        if not filename:
            filename = datetime.now().strftime('Nanobanana_%Y%m%d_%H%M%S_%f')[:-3] + '.png'
        dest = _safe_path(OUTPUT_NANOBANANA_DIR, filename)
        dest.write_bytes(img_bytes)
        return web.json_response({'status': 'ok', 'url': f'/ccc_nanobanana_output/{dest.name}'})
    except CCCError as e:
        return _error_response(e, status=413)
    except Exception as e:
        return web.json_response({'status': 'error', 'message': str(e)}, status=500)

async def handle_save_group_asset(request):
    try:
        data = await _read_json_limited(request, MAX_JSON_IMAGE_UPLOAD_BYTES)
        group_name = (data.get('group') or '').strip()
        svg_content = data.get('svg', '')
        image_data_url = data.get('image', '')
        filename = (data.get('filename') or '').strip()
        if not group_name:
            return web.json_response({'status': 'error', 'message': 'group field required'}, status=400)
        if not svg_content and not image_data_url:
            return web.json_response({'status': 'error', 'message': 'svg or image field required'}, status=400)
        safe_group = re.sub(r'[\\/:*?"<>|]', '_', group_name)
        if safe_group in ('', '.', '..'):
            return web.json_response({'status': 'error', 'message': 'invalid group name'}, status=400)
        out_dir = (ASSETS_DIR / safe_group).resolve()
        base = ASSETS_DIR.resolve()
        if out_dir != base and not str(out_dir).startswith(str(base) + os.sep):
            return web.json_response({'status': 'error', 'message': 'invalid group name'}, status=400)
        out_dir.mkdir(parents=True, exist_ok=True)

        if image_data_url:
            # レイヤーパネルで画像1件だけをチェックして登録した場合、SVGグループでラップせず
            # 画像そのものをラスター/SVGファイルとして直接保存する（コマへの挿入時、画像1枚だけ
            # なのに <g data-group-id> が余分に作られてしまうのを避けるため）
            mime = 'image/png'
            b64_part = image_data_url
            if image_data_url.startswith('data:'):
                header, _, b64_part = image_data_url.partition(',')
                m = re.match(r'data:([^;]+);base64', header)
                if m:
                    mime = m.group(1)
            ext = {
                'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg',
                'image/webp': '.webp', 'image/svg+xml': '.svg',
            }.get(mime, '.png')
            try:
                img_bytes = base64.b64decode(b64_part)
            except Exception:
                return web.json_response({'status': 'error', 'message': 'invalid image data'}, status=400)
            if not filename:
                filename = datetime.now().strftime('image_%Y%m%d_%H%M%S') + ext
            else:
                filename = re.sub(r'[\\/:*?"<>|]', '_', filename)
                if not filename.lower().endswith(ext):
                    filename += ext
            dest = _safe_path(out_dir, filename)
            dest.write_bytes(img_bytes)
        else:
            if not filename:
                filename = datetime.now().strftime('group_%Y%m%d_%H%M%S') + '.svg'
            else:
                filename = re.sub(r'[\\/:*?"<>|]', '_', filename)
                if not filename.lower().endswith('.svg'):
                    filename += '.svg'
            dest = _safe_path(out_dir, filename)
            dest.write_text(svg_content, encoding='utf-8')

        _generate_assets_json()
        return web.json_response({'status': 'ok', 'path': f'ccc_assets/{safe_group}/{dest.name}'})
    except CCCError as e:
        return _error_response(e, status=413)
    except Exception as e:
        return web.json_response({'status': 'error', 'message': str(e)}, status=500)

async def handle_save_image_project(request):
    """Imageタブのレイヤー編集状態（LayerManager.toJSON()）をサムネイルPNGとペアで
    assets/image/ に保存する。assets.json 生成時にこのペアが projectPath 付きの
    プロジェクトアセットとして認識される（_generate_assets_json 参照）。"""
    try:
        data = await _read_json_limited(request, MAX_JSON_IMAGE_UPLOAD_BYTES)
        filename    = (data.get('filename') or '').strip()
        thumb_b64   = data.get('thumbnail', '')
        project_str = data.get('project', '')
        if not thumb_b64:
            return web.json_response({'status': 'error', 'message': 'thumbnail field required'}, status=400)
        if not project_str:
            return web.json_response({'status': 'error', 'message': 'project field required'}, status=400)
        if thumb_b64.startswith('data:'):
            thumb_b64 = thumb_b64.split(',', 1)[1]
        img_bytes = base64.b64decode(thumb_b64)

        if not filename:
            filename = datetime.now().strftime('image_%Y%m%d_%H%M%S')
        safe_name = re.sub(r'[\\/:*?"<>|]', '_', filename)

        out_dir = ASSETS_DIR / "image"
        out_dir.mkdir(parents=True, exist_ok=True)
        png_path  = _safe_path(out_dir, safe_name + '.png')
        json_path = _safe_path(out_dir, safe_name + '.json')
        png_path.write_bytes(img_bytes)
        json_path.write_text(project_str, encoding='utf-8')

        _generate_assets_json()
        return web.json_response({'status': 'ok', 'path': f'ccc_assets/image/{safe_name}.png'})
    except CCCError as e:
        return _error_response(e, status=413)
    except Exception as e:
        return web.json_response({'status': 'error', 'message': str(e)}, status=500)

async def handle_psd_import_layers(request):
    """POST /api/ccc/psd/import-layers - アップロードされたPSDをレイヤー配列(JSON)に分解して返す"""
    try:
        reader = await request.multipart()
        field = await reader.next()
        if field is None:
            return web.json_response({'status': 'error', 'message': 'file field required'}, status=400)

        # 数十MBになり得るため、一括read()ではなくチャンク読み込みでサイズ上限超過を早期検出する
        chunks = []
        size = 0
        while True:
            chunk = await field.read_chunk(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_PSD_UPLOAD_BYTES:
                return _error_response(CCCError('psd_too_large', f'PSDファイルが大きすぎます（上限 {MAX_PSD_UPLOAD_BYTES // (1024 * 1024)}MB）'), status=413)
            chunks.append(chunk)
        psd_bytes = b''.join(chunks)

        # PSDのラスタ化はCPU負荷が高く同期実行するとイベントループ全体をブロックするため
        # executorで実行する
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _import_psd_bytes, psd_bytes)
        return web.json_response({'status': 'ok', **result})
    except RuntimeError as e:
        return _error_response(CCCError('psd_dependency_missing', str(e)), status=500)
    except ValueError as e:
        return _error_response(CCCError('psd_invalid_file', str(e)), status=400)
    except Exception as e:
        return _error_response(e, status=500)

async def handle_psd_export_layers(request):
    """POST /api/ccc/psd/export-layers - Imageタブのレイヤー配列を1つのPSDにして返す（ダウンロード用）"""
    try:
        data = await request.json()
        width  = int(data.get('width', 0))
        height = int(data.get('height', 0))
        layers = data.get('layers', [])

        # PSD組み立て(PIL合成・保存)はCPU負荷が高く同期実行するとイベントループ全体を
        # ブロックするためexecutorで実行する
        loop = asyncio.get_event_loop()
        psd_bytes = await loop.run_in_executor(None, _build_psd_from_layers, width, height, layers)

        return web.Response(
            body=psd_bytes,
            content_type='image/vnd.adobe.photoshop',
            headers={'Content-Disposition': 'attachment; filename="comic-creator-image.psd"'},
        )
    except RuntimeError as e:
        return _error_response(CCCError('psd_dependency_missing', str(e)), status=500)
    except ValueError as e:
        return _error_response(CCCError('psd_invalid_layers', str(e)), status=400)
    except Exception as e:
        return _error_response(e, status=500)

async def handle_upload_video(request):
    """POST /api/ccc/video/upload - MP4ファイルをアップロードし、参照用URLを返す。
    動画本体はIndexedDBへ複製保存せず、この保存先を唯一の永続化先としてURL参照する
    （レイアウトタブの動画ツール、SVG側のdata-video-src属性が指すURL）。"""
    try:
        reader = await request.multipart()
        field = await reader.next()
        if field is None or field.name != 'file':
            return web.json_response({'status': 'error', 'message': 'file field required'}, status=400)

        orig_name = field.filename or 'video.mp4'
        ext = os.path.splitext(orig_name)[1].lower()
        if ext not in VALID_VIDEO_EXTENSIONS:
            return web.json_response({'status': 'error', 'message': 'only .mp4 is supported'}, status=400)

        OUTPUT_VIDEO_DIR.mkdir(parents=True, exist_ok=True)
        safe_name = datetime.now().strftime('video_%Y%m%d_%H%M%S_%f')[:-3] + ext
        dest = _safe_path(OUTPUT_VIDEO_DIR, safe_name)

        # 数百MB級になり得るため、一括read()ではなくチャンク書き込みでサイズ上限超過を早期検出する
        size = 0
        try:
            with open(dest, 'wb') as f:
                while True:
                    chunk = await field.read_chunk(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_VIDEO_UPLOAD_BYTES:
                        raise ValueError(f'file too large (max {MAX_VIDEO_UPLOAD_BYTES // (1024 * 1024)}MB)')
                    f.write(chunk)
        except ValueError as e:
            dest.unlink(missing_ok=True)
            return web.json_response({'status': 'error', 'message': str(e)}, status=413)

        return web.json_response({'status': 'ok', 'url': f'/ccc_video_assets/{dest.name}', 'filename': orig_name})
    except Exception as e:
        return web.json_response({'status': 'error', 'message': str(e)}, status=500)

async def handle_delete_asset(request):
    try:
        data = await request.json()
        folder_name = (data.get('folder') or '').strip()
        file_name = (data.get('name') or '').strip()
        if not folder_name or not file_name:
            return web.json_response({'status': 'error', 'message': 'folder and name fields required'}, status=400)

        # folder/name とも basename のみを許可し、ASSETS_DIR 外への到達を防ぐ
        safe_folder = os.path.basename(folder_name)
        folder_path = (ASSETS_DIR / safe_folder).resolve()
        base = ASSETS_DIR.resolve()
        if folder_path != base and not str(folder_path).startswith(str(base) + os.sep):
            return web.json_response({'status': 'error', 'message': 'invalid folder'}, status=400)

        target = _safe_path(folder_path, file_name)
        if not target.is_file():
            return web.json_response({'status': 'error', 'message': 'asset not found'}, status=404)

        target.unlink()
        _generate_assets_json()
        return web.json_response({'status': 'ok'})
    except Exception as e:
        return web.json_response({'status': 'error', 'message': str(e)}, status=500)

async def handle_nanobanana_generate(request):
    try:
        if not NANOBANANA_API_KEY:
            return _error_response(CCCError('nanobanana_api_key_missing', 'Gemini APIキーが設定されていません。プラグインフォルダ直下の .env に NANOBANANA_API_KEY=... を記載し、ComfyUIを再起動してください。'), status=400)
        data = await request.json()
        model = _validate_gemini_model(data.get('model', 'gemini-3.1-flash-lite-image'))
        prompt = data.get('prompt', '')
        negative_prompt = data.get('negative_prompt', '')
        num_images = data.get('num_images', 1)
        width = data.get('width', 1024)
        height = data.get('height', 1024)
        # Gemini API の ImageConfig.imageSize（'1K'/'2K'/'4K'、未指定時は'1K'相当）。
        # aspectRatioは維持したまま出力解像度のみ引き上げる用途（例: 選択解像度を2倍で生成）。
        image_size = data.get('image_size')

        def get_aspect_ratio(w, h):
            ratio = w / h
            for ar, rval in [("1:1",1.0),("2:3",2/3),("3:2",3/2),("3:4",3/4),("4:3",4/3),
                              ("9:16",9/16),("16:9",16/9),("21:9",21/9),("4:5",4/5),("5:4",5/4),
                              ("1:4",1/4),("4:1",4/1),("1:8",1/8),("8:1",8/1)]:
                if abs(ratio - rval) < 0.05:
                    return ar
            return "1:1"

        aspect_ratio = get_aspect_ratio(width, height)

        i2i_images = []
        images_list = data.get('images')
        if images_list:
            for img_item in images_list:
                raw = img_item.get('data', '')
                mime = img_item.get('mime', 'image/png')
                if ',' in raw: raw = raw.split(',', 1)[1]
                if raw: i2i_images.append({'mime_type': mime, 'data': raw})
        else:
            image_b64 = data.get('image')
            if image_b64:
                if ',' in image_b64: image_b64 = image_b64.split(',', 1)[1]
                i2i_images.append({'mime_type': 'image/png', 'data': image_b64})

        images = []
        loop = asyncio.get_event_loop()

        if model.startswith('gemini-') or 'nano-banana' in model:
            # APIキーはURLクエリではなくヘッダーで送る（URLはログ・プロキシに残りやすいため）
            api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            full_prompt = prompt + (f"\n\nNEGATIVE_PROMPT: {negative_prompt}" if negative_prompt else '')
            parts = [{"text": full_prompt}]
            for img in i2i_images:
                parts.insert(0, {"inline_data": {"mime_type": img['mime_type'], "data": img['data']}})
            image_config = {"aspectRatio": aspect_ratio}
            if image_size:
                image_config["imageSize"] = image_size
            payload = {
                "contents": [{"parts": parts}],
                "generationConfig": {"imageConfig": image_config},
            }
            req_body = json.dumps(payload).encode('utf-8')
            def _call():
                results = []
                for _ in range(num_images):
                    req = urllib.request.Request(api_url, data=req_body, headers={'Content-Type': 'application/json', 'x-goog-api-key': NANOBANANA_API_KEY}, method='POST')
                    with urllib.request.urlopen(req, timeout=120) as resp:
                        rd = json.loads(resp.read().decode('utf-8'))
                    for cand in rd.get('candidates', []):
                        for part in cand.get('content', {}).get('parts', []):
                            inline = part.get('inlineData') or part.get('inline_data')
                            if inline and inline.get('data'):
                                results.append(inline['data'])
                return results
            images = await loop.run_in_executor(None, _call)
        else:
            api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:predict"
            instance = {"prompt": prompt}
            if i2i_images:
                instance["image"] = {"bytesBase64Encoded": i2i_images[0]['data']}
            if negative_prompt:
                instance["negativePrompt"] = negative_prompt
            payload = {"instances": [instance], "parameters": {"sampleCount": num_images, "aspectRatio": aspect_ratio}}
            req_body = json.dumps(payload).encode('utf-8')
            def _call():
                req = urllib.request.Request(api_url, data=req_body, headers={'Content-Type': 'application/json', 'x-goog-api-key': NANOBANANA_API_KEY}, method='POST')
                with urllib.request.urlopen(req, timeout=120) as resp:
                    rd = json.loads(resp.read().decode('utf-8'))
                return [p['bytesBase64Encoded'] for p in rd.get('predictions', []) if p.get('bytesBase64Encoded')]
            images = await loop.run_in_executor(None, _call)

        return web.json_response({'status': 'ok', 'images': images})

    except CCCError as e:
        return _error_response(e, status=400)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        return _error_response(Exception(f'Google API Error ({e.code}): {error_body}'), status=500)
    except Exception as e:
        return _error_response(e, status=500)

async def handle_nanobanana_list_models(request):
    url = "https://generativelanguage.googleapis.com/v1beta/models"
    try:
        if not NANOBANANA_API_KEY:
            return _error_response(CCCError('nanobanana_api_key_missing', 'Gemini APIキーが設定されていません。プラグインフォルダ直下の .env に NANOBANANA_API_KEY=... を記載し、ComfyUIを再起動してください。'), status=400)
        loop = asyncio.get_event_loop()
        def _get():
            req = urllib.request.Request(url, headers={'x-goog-api-key': NANOBANANA_API_KEY})
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode('utf-8'))
        data = await loop.run_in_executor(None, _get)
        return web.json_response({'status': 'ok', 'models': data.get('models', [])})
    except Exception as e:
        return _error_response(e, status=500)

# ─── Nano Banana: ComfyUI ネイティブAPIノード経路 ───────────────────────
# ComfyUI本体のパートナーAPIノード（GeminiNanoBanana2V2 = "Nano Banana 2.1"）を、このプラグインから
# ComfyUI自身の /prompt へ投入して実行する（Gemini API直叩き経路とは別の、併用用の経路）。
# 認証はプラグインフォルダ直下の .env の COMFY_API_KEY（platform.comfy.org で発行するAPIキー。
# 課金はComfyクレジット）を extra_data.api_key_comfy_org としてサーバー側から渡す（ブラウザへは出さない）。
# 出力はSaveImageがプロンプト/設定をPNGへ埋め込むため、history.jsonl への記録は不要。
_NATIVE_NB_RESOLUTIONS = {
    'Gemini Nano Banana 2.1': ('1K', '2K', '4K'),
    'Nano Banana 2 (Gemini 3.1 Flash Image)': ('1K', '2K', '4K'),
    'Nano Banana 2 Lite': ('1K',),
}
_NATIVE_NB_THINKING = {   # 既定のthinking_level（ノード側の既定値に合わせる。MEDIUMは追加料金あり）
    'Gemini Nano Banana 2.1': 'MEDIUM',
    'Nano Banana 2 (Gemini 3.1 Flash Image)': 'MINIMAL',
    'Nano Banana 2 Lite': 'MINIMAL',
}
# 半自動マンガ・Autoタブ等は Gemini API のモデルIDで指定してくるため、ネイティブノードの選択肢へ対応づける。
# gemini-3-pro-image（Nano Banana Pro）は別ノード（GeminiImage2Node）になるため、現状は未対応。
_NATIVE_NB_GEMINI_IDS = {
    'gemini-nano-banana-2.1': 'Gemini Nano Banana 2.1',
    'gemini-3.1-flash-image': 'Nano Banana 2 (Gemini 3.1 Flash Image)',
    'gemini-3.1-flash-lite-image': 'Nano Banana 2 Lite',
}
_NATIVE_NB_UNSUPPORTED_IDS = ('gemini-3-pro-image',)
_NATIVE_NB_PREFIX = 'cc_nanobanana_native/NB'
_NATIVE_NB_MAX_REFS = 14
_NATIVE_NB_TIMEOUT_S = 300

def _native_comfy_key() -> str:
    return (os.getenv('COMFY_API_KEY') or '').strip()

def _comfy_local_base_url() -> str:
    """ComfyUI自身の /prompt 等へ接続するベースURL（起動引数の --listen / --port から組み立てる）。"""
    try:
        from comfy.cli_args import args as _a
        port = getattr(_a, 'port', None) or 8188
        host = str(getattr(_a, 'listen', '') or '127.0.0.1').split(',')[0].strip()
        if host in ('', '0.0.0.0', '::'):
            host = '127.0.0.1'
        elif ':' in host:
            host = f'[{host}]'
    except Exception:
        host, port = '127.0.0.1', 8188
    return f'http://{host}:{port}'

def _nb_aspect_ratio(w, h) -> str:
    try:
        ratio = w / h
    except Exception:
        return '1:1'
    for ar, rval in [("1:1", 1.0), ("2:3", 2/3), ("3:2", 3/2), ("3:4", 3/4), ("4:3", 4/3),
                     ("9:16", 9/16), ("16:9", 16/9), ("21:9", 21/9), ("4:5", 4/5), ("5:4", 5/4),
                     ("1:4", 1/4), ("4:1", 4/1), ("1:8", 1/8), ("8:1", 8/1)]:
        if abs(ratio - rval) < 0.05:
            return ar
    return "1:1"

def _native_nb_workflow(prompt, model, aspect_ratio, resolution, seed, ref_names, preview=False):
    """API形式のワークフロー（Nano Banana 2.1ノード + SaveImage）を組み立てる。
    DynamicComboの子入力は "model.<名前>"、参考画像（Autogrow）は "model.images.image_<n>" のドット結合キー。"""
    wf = {}
    inputs = {
        'prompt': prompt,
        'model': model,
        'model.aspect_ratio': aspect_ratio,
        'model.resolution': resolution,
        'model.thinking_level': _NATIVE_NB_THINKING[model],
        'seed': seed,
        'response_modalities': 'IMAGE',
    }
    for i, name in enumerate(ref_names, 1):
        node_id = str(100 + i)
        wf[node_id] = {'class_type': 'LoadImage', 'inputs': {'image': f'{name} [temp]'}}
        inputs[f'model.images.image_{i}'] = [node_id, 0]
    wf['1'] = {'class_type': 'GeminiNanoBanana2V2', 'inputs': inputs, '_meta': {'title': 'Nano Banana 2.1'}}
    if preview:
        # 呼び出し側が自前の保存先へ保存する用途（半自動マンガ・Auto等）。PreviewImageはtempへ書き出すだけで
        # 再起動で消えるため、outputに重複ファイルを残さない（埋め込みメタデータはSaveImageと同様に付く）
        wf['2'] = {'class_type': 'PreviewImage', 'inputs': {'images': ['1', 0]}, '_meta': {'title': 'Preview Image'}}
    else:
        wf['2'] = {'class_type': 'SaveImage', 'inputs': {'images': ['1', 0], 'filename_prefix': _NATIVE_NB_PREFIX},
                   '_meta': {'title': 'Save Image'}}
    return wf

def _native_nb_resolve_model(model):
    """GeminiモデルID または ネイティブノードの選択肢名 → ネイティブノードの選択肢名。"""
    model = model or 'Gemini Nano Banana 2.1'
    if model in _NATIVE_NB_RESOLUTIONS:
        return model
    if model in _NATIVE_NB_GEMINI_IDS:
        return _NATIVE_NB_GEMINI_IDS[model]
    if model in _NATIVE_NB_UNSUPPORTED_IDS:
        raise CCCError('nanobanana_native_unsupported_model', f'{model} はネイティブノード方式では未対応です', model=model)
    raise CCCError('nanobanana_native_invalid_model', f'不正なモデル名です: {model!r}', model=str(model)[:100])

async def _native_nb_fetch_b64(sess, base, im):
    params = {'filename': im['filename'], 'subfolder': im.get('subfolder', ''), 'type': im.get('type', 'output')}
    async with sess.get(f'{base}/view', params=params) as r:
        if r.status != 200:
            raise CCCError('nanobanana_native_failed', f'生成画像の取得に失敗しました (HTTP {r.status})', detail=f'view HTTP {r.status}')
        return base64.b64encode(await r.read()).decode('ascii')

async def _native_nb_upload_ref(sess, base, b64, mime, index):
    raw = base64.b64decode(b64)
    ext = {'image/jpeg': '.jpg', 'image/webp': '.webp'}.get(mime, '.png')
    form = aiohttp.FormData()
    form.add_field('image', raw, filename=f'cc_nb_ref_{uuid.uuid4().hex[:10]}_{index}{ext}', content_type=mime or 'image/png')
    form.add_field('type', 'temp')
    form.add_field('overwrite', 'true')
    async with sess.post(f'{base}/upload/image', data=form) as r:
        if r.status != 200:
            raise CCCError('nanobanana_native_failed', f'参考画像のアップロードに失敗しました (HTTP {r.status})', detail=f'upload HTTP {r.status}')
        return (await r.json(content_type=None))['name']

async def _native_nb_run(sess, base, key, wf, out_node='2', client_id='ccc-nanobanana-native', timeout_s=None):
    """ワークフローを /prompt へ投入し、/history で完了を待って出力ノード(out_node)の画像情報を返す。
    keyが空ならパートナーAPIキーは付けない（ローカル生成のMOSS-Image等）。"""
    extra = {'extra_pnginfo': {'workflow': wf}}
    if key:
        extra['api_key_comfy_org'] = key
    payload = {'prompt': wf, 'client_id': client_id, 'extra_data': extra}
    async with sess.post(f'{base}/prompt', json=payload) as r:
        body = await r.json(content_type=None)
        if r.status != 200:
            detail = json.dumps(body, ensure_ascii=False)[:500]
            raise CCCError('nanobanana_native_failed', f'ComfyUIが実行要求を拒否しました: {detail}', detail=detail)
    pid = body['prompt_id']
    deadline = time.monotonic() + (timeout_s or _NATIVE_NB_TIMEOUT_S)
    while time.monotonic() < deadline:
        await asyncio.sleep(1.5)
        async with sess.get(f'{base}/history/{pid}') as r:
            hist = await r.json(content_type=None)
        entry = hist.get(pid)
        if not entry:
            continue
        st = entry.get('status') or {}
        if st.get('completed') and st.get('status_str') != 'error':
            return pid, (entry.get('outputs', {}).get(out_node, {}).get('images') or [])
        msg = next((m[1].get('exception_message') for m in st.get('messages', []) if m[0] == 'execution_error'), None) or 'unknown error'
        msg = str(msg).strip()
        if 'unauthorized' in msg.lower() or 'login' in msg.lower():
            raise CCCError('nanobanana_native_unauthorized', f'Comfy APIキーが認証されませんでした: {msg}', detail=msg)
        raise CCCError('nanobanana_native_failed', f'生成に失敗しました: {msg}', detail=msg)
    raise CCCError('nanobanana_native_failed', '生成がタイムアウトしました', detail='timeout')

async def handle_nanobanana_native_status(request):
    # APIキー本体は返さず、設定済みかどうかのみ通知する
    key = _native_comfy_key()
    masked = ('*' * (len(key) - 4) + key[-4:]) if len(key) > 4 else ('*' * len(key))
    return web.json_response({'status': 'ok' if key else 'no_key', 'masked': masked if key else ''})

async def handle_nanobanana_native_generate(request):
    try:
        key = _native_comfy_key()
        if not key:
            raise CCCError('nanobanana_native_key_missing', 'Comfy APIキーが設定されていません。プラグインフォルダ直下の .env に COMFY_API_KEY=... を記載し、ComfyUIを再起動してください。')
        data = await _read_json_limited(request, MAX_JSON_IMAGE_UPLOAD_BYTES)
        model = _native_nb_resolve_model(data.get('model'))
        return_b64 = bool(data.get('return_b64'))
        prompt = (data.get('prompt') or '').strip()
        if not prompt:
            raise CCCError('nanobanana_native_failed', 'プロンプトが空です', detail='empty prompt')
        negative = (data.get('negative_prompt') or '').strip()
        full_prompt = prompt + (f"\n\nNEGATIVE_PROMPT: {negative}" if negative else '')
        resolution = data.get('image_size') or '1K'
        if resolution not in _NATIVE_NB_RESOLUTIONS[model]:
            raise CCCError('nanobanana_native_resolution_unsupported', f'{model} は {resolution} に対応していません', model=model, resolution=str(resolution))
        aspect = _nb_aspect_ratio(data.get('width', 1024), data.get('height', 1024))
        num_images = min(max(int(data.get('num_images', 1) or 1), 1), 4)
        base_seed = data.get('seed')
        base_seed = int(base_seed) if isinstance(base_seed, (int, float)) and base_seed >= 0 else uuid.uuid4().int % 1_000_000

        refs = []
        for item in (data.get('images') or [])[:_NATIVE_NB_MAX_REFS]:
            raw = item.get('data', '')
            if ',' in raw:
                raw = raw.split(',', 1)[1]
            if raw:
                refs.append((raw, item.get('mime', 'image/png')))

        base = _comfy_local_base_url()
        results, prompt_ids = [], []
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None, connect=10)) as sess:
            ref_names = [await _native_nb_upload_ref(sess, base, b64, mime, i) for i, (b64, mime) in enumerate(refs, 1)]
            for i in range(num_images):
                # seedはGeminiへは送られずComfyUIのキャッシュキーとして働く。同じ入力の再実行はキャッシュが返る
                # （新しい画像にならない）ため、枚数ごとにseedをずらす
                wf = _native_nb_workflow(full_prompt, model, aspect, resolution, base_seed + i, ref_names, preview=return_b64)
                pid, imgs = await _native_nb_run(sess, base, key, wf)
                prompt_ids.append(pid)
                for im in imgs:
                    if return_b64:
                        results.append(await _native_nb_fetch_b64(sess, base, im))   # Gemini直叩き経路と同じ「base64文字列の配列」
                    else:
                        results.append({'filename': im['filename'], 'subfolder': im.get('subfolder', ''), 'type': im.get('type', 'output')})
        if not results:
            raise CCCError('nanobanana_native_failed', '画像が生成されませんでした', detail='no images')
        return web.json_response({'status': 'ok', 'images': results, 'prompt_ids': prompt_ids,
                                  'model': model, 'seed': base_seed, 'resolution': resolution, 'aspect_ratio': aspect})
    except CCCError as e:
        return _error_response(e, status=400)
    except Exception as e:
        return _error_response(e, status=500)

# ─── MOSS-Image: ローカル生成（ComfyUIネイティブ対応済みのDiT。標準ノードで /prompt へ直接投入）────
# manga_base ワークフローと同じ構成: UNETLoader→(LoRA)→(SkipLayerGuidance)→KSampler、CLIPLoader(type=moss_image)。
# レイアウトJSON（物体/キャラ/文字をbboxで指定）は ComfyUI 標準の MOSSImageLayoutPrompt と同じ形式で自前生成する
# （bboxは「キャンバス中心原点・[y0,x0,y1,x1]・ピクセル」= abs_centralized / yxyx）。
_MOSS_PREFIX = 'cc_moss/MOSS'
_MOSS_TIMEOUT_S = 900          # 50step・4MPでも収まる余裕。生成中はComfyUIキューに積まれる
_MOSS_OUT_NODE = '10'
_MOSS_LABELS = ('object', 'panel', 'character', 'text')   # panel は学習時のlabel（公開コンパイラは object/character/text のみ）。コマの使い分け用
_MOSS_MAX_ITEMS = 200
_MOSS_VERTICAL_HINT = 'Vertical text, written top to bottom, columns from right to left.'

def _moss_layout_prompt(summary, items, width, height, meta=None, canvas=None):
    """レイアウト要素（ピクセル・左上原点の x,y,w,h）からMOSS-Imageのレイアウトプロンプト(JSON文字列)を作る。
    itemsの並びは「背景→前景」。要素が空なら通常のプロンプト文字列（summary）をそのまま返す。"""
    summary = (summary or '').strip()
    if not isinstance(items, list) or not items:
        return summary
    out = []
    for it in items[:_MOSS_MAX_ITEMS]:
        if not isinstance(it, dict):
            continue
        label = it.get('type') if it.get('type') in _MOSS_LABELS else 'object'
        try:
            x, y, w, h = (float(it.get(k, 0)) for k in ('x', 'y', 'w', 'h'))
        except (TypeError, ValueError):
            continue
        if w < 0:
            x, w = x + w, -w
        if h < 0:
            y, h = y + h, -h
        if w < 1 or h < 1:
            continue
        # 文字が空（空白のみ）の text item は送らない。モデルが「文字を書く領域」と解釈して、その領域に
        # 紙のようなものを描いてしまうため（公式コンパイラも空の text を拒否する）
        if label == 'text' and not str(it.get('text') or '').strip():
            continue
        item = {'label': label, 'caption': str(it.get('caption') or '').strip()}
        if label == 'text':
            item['text'] = str(it.get('text') or '')
            if it.get('vertical'):
                # レイアウト形式に書字方向の項目は無いため、captionの英文で縦書き（改行=列、右から左）を指示する
                item['caption'] = (item['caption'] + ' ' + _MOSS_VERTICAL_HINT).strip()
        palette = it.get('palette')
        if isinstance(palette, list) and palette:
            item['palette'] = [str(c)[:16] for c in palette[:5]]
        # 画像座標(左上原点) → 中心原点の整数ピクセル。外へはみ出す枠も許可（「両端で切れる」表現に使える）
        item['bbox'] = [math.floor(y) - height // 2, math.floor(x) - width // 2,
                        math.ceil(y + h) - height // 2, math.ceil(x + w) - width // 2]
        out.append(item)
    if not out:
        return summary
    head = {'caption': summary}
    if isinstance(meta, list) and meta:
        head = {'meta': [str(m)[:60] for m in meta[:12]], **({'canvas': str(canvas)[:30]} if canvas else {}), 'caption': summary}
    layout = {'summary': head, 'items': out, 'bbox_coord_space': 'abs_centralized', 'bbox_format': 'yxyx'}
    return json.dumps(layout, ensure_ascii=False, separators=(',', ':'))

def _moss_workflow(p):
    """MOSS-Image T2Iの API形式ワークフロー。pは検証済みパラメータdict。出力ノードIDは _MOSS_OUT_NODE。"""
    wf = {
        '1': {'class_type': 'UNETLoader', 'inputs': {'unet_name': p['unet'], 'weight_dtype': 'default'}},
        '2': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': p['clip'], 'type': 'moss_image', 'device': 'default'}},
        '3': {'class_type': 'VAELoader', 'inputs': {'vae_name': p['vae']}},
        '5': {'class_type': 'CLIPTextEncode', 'inputs': {'text': p['prompt'], 'clip': ['2', 0]}},
        '6': {'class_type': 'CLIPTextEncode', 'inputs': {'text': p['negative'], 'clip': ['2', 0]}},
        '7': {'class_type': 'EmptyFlux2LatentImage', 'inputs': {'width': p['width'], 'height': p['height'], 'batch_size': 1}},
    }
    model = ['1', 0]
    if p.get('lora'):
        wf['4'] = {'class_type': 'LoraLoaderModelOnly',
                   'inputs': {'model': model, 'lora_name': p['lora'], 'strength_model': p['lora_strength']}}
        model = ['4', 0]
    if p.get('slg'):
        # 公式既定: ネガ側ではなくモデル側のレイヤースキップ（single層22、前半50%）。CFG>1のときのみ意味を持つ
        wf['12'] = {'class_type': 'SkipLayerGuidanceDiTSimple',
                    'inputs': {'model': model, 'double_layers': '', 'single_layers': '22', 'start_percent': 0.0, 'end_percent': 0.5}}
        model = ['12', 0]
    wf['8'] = {'class_type': 'KSampler', 'inputs': {
        'model': model, 'seed': p['seed'], 'steps': p['steps'], 'cfg': p['cfg'],
        'sampler_name': p['sampler'], 'scheduler': p['scheduler'],
        'positive': ['5', 0], 'negative': ['6', 0], 'latent_image': ['7', 0], 'denoise': 1.0}}
    wf['9'] = {'class_type': 'VAEDecode', 'inputs': {'samples': ['8', 0], 'vae': ['3', 0]}}
    wf[_MOSS_OUT_NODE] = {'class_type': 'SaveImage', 'inputs': {'images': ['9', 0], 'filename_prefix': _MOSS_PREFIX}}
    return wf

def _moss_str(data, key, default='', limit=300):
    v = data.get(key)
    return (str(v).strip()[:limit] if v is not None else default) or default

async def handle_moss_generate(request):
    try:
        data = await _read_json_limited(request, MAX_JSON_IMAGE_UPLOAD_BYTES)
        width = min(max(int(data.get('width') or 1024), 256), 4096) // 16 * 16
        height = min(max(int(data.get('height') or 1024), 256), 4096) // 16 * 16
        if (data.get('layout') or {}).get('items'):
            lay = data['layout']
            prompt = _moss_layout_prompt(data.get('prompt'), lay.get('items'), width, height, lay.get('meta'), lay.get('canvas'))
        else:
            prompt = (data.get('prompt') or '').strip()
        if not prompt:
            raise CCCError('moss_failed', 'プロンプトが空です', detail='empty prompt')
        unet, clip, vae = (_moss_str(data, k) for k in ('unet', 'clip', 'vae'))
        if not (unet and clip and vae):
            raise CCCError('moss_failed', 'モデル（拡散モデル/テキストエンコーダ/VAE）を選択してください', detail='model missing')
        base_seed = data.get('seed')
        base_seed = int(base_seed) if isinstance(base_seed, (int, float)) and base_seed >= 0 else uuid.uuid4().int % (2 ** 32)
        num_images = min(max(int(data.get('num_images') or 1), 1), 4)
        params = {
            'prompt': prompt, 'negative': (data.get('negative_prompt') or '').strip(),
            'width': width, 'height': height, 'unet': unet, 'clip': clip, 'vae': vae,
            'steps': min(max(int(data.get('steps') or 50), 1), 150),
            'cfg': min(max(float(data.get('cfg') if data.get('cfg') is not None else 3.0), 0.0), 30.0),
            'sampler': _moss_str(data, 'sampler', 'euler'), 'scheduler': _moss_str(data, 'scheduler', 'simple'),
            'lora': _moss_str(data, 'lora'), 'lora_strength': min(max(float(data.get('lora_strength') if data.get('lora_strength') is not None else 1.0), -2.0), 2.0),
            'slg': bool(data.get('slg')),
        }
        base = _comfy_local_base_url()
        results, prompt_ids = [], []
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None, connect=10)) as sess:
            for i in range(num_images):
                wf = _moss_workflow({**params, 'seed': base_seed + i})
                pid, imgs = await _native_nb_run(sess, base, '', wf, out_node=_MOSS_OUT_NODE,
                                                 client_id='ccc-moss', timeout_s=_MOSS_TIMEOUT_S)
                prompt_ids.append(pid)
                for im in imgs:
                    # 画像本体は返さず /view 用の参照のみ（ブラウザは同一オリジンの /view?... から取得する）
                    results.append({'filename': im['filename'], 'subfolder': im.get('subfolder', ''),
                                    'type': im.get('type', 'output'), 'seed': base_seed + i})
        if not results:
            raise CCCError('moss_failed', '画像が生成されませんでした', detail='no images')
        return web.json_response({'status': 'ok', 'images': results, 'prompt_ids': prompt_ids, 'seed': base_seed,
                                  'width': width, 'height': height, 'prompt': prompt})
    except CCCError as e:
        return _error_response(e, status=400)
    except (ValueError, TypeError) as e:
        return _error_response(CCCError('moss_failed', f'パラメータが不正です: {e}', detail=str(e)), status=400)
    except Exception as e:
        return _error_response(e, status=500)

async def handle_moss_layout_prompt(request):
    """レイアウト要素 → レイアウトJSON文字列（生成せずプレビュー・コピー用）。"""
    try:
        data = await _read_json_limited(request, MAX_JSON_IMAGE_UPLOAD_BYTES)
        width, height = int(data.get('width') or 1024), int(data.get('height') or 1024)
        lay = data.get('layout') or {}
        text = _moss_layout_prompt(data.get('prompt'), lay.get('items'), width, height, lay.get('meta'), lay.get('canvas'))
        return web.json_response({'status': 'ok', 'prompt': text})
    except (ValueError, TypeError) as e:
        return _error_response(CCCError('moss_failed', f'パラメータが不正です: {e}', detail=str(e)), status=400)
    except Exception as e:
        return _error_response(e, status=500)

_NANOBANANA_HISTORY_FILENAME = 'history.jsonl'
_MAX_HISTORY_FIELD_CHARS = 4000
_MAX_HISTORY_FILENAMES = 50

def _nanobanana_history_path():
    return OUTPUT_NANOBANANA_DIR / _NANOBANANA_HISTORY_FILENAME

def _clip_history_field(value, max_chars: int) -> str:
    s = str(value or '').strip()
    return s if len(s) <= max_chars else s[:max_chars] + '…'

async def handle_nanobanana_history_get(request):
    """生成履歴（JSON Lines、1行1件）を読み、行ごとにパースしたentriesと生のテキストの両方を返す。
    手編集等で壊れた行は無視せず、parse_error付きでそのままentriesに含める（Workflow Studio等の
    外部連携で読み取りやすいよう、1行1エントリのJSONL形式を採用）。"""
    try:
        path = _nanobanana_history_path()
        text = path.read_text(encoding='utf-8') if path.is_file() else ''
        entries = []
        for i, line in enumerate(text.splitlines()):
            if not line.strip():
                continue
            try:
                entries.append(json.loads(line))
            except Exception as e:
                entries.append({'line': i + 1, 'raw': line, 'parse_error': str(e)})
        return web.json_response({'status': 'ok', 'text': text, 'entries': entries, 'path': str(path).replace('\\', '/')})
    except Exception as e:
        return _error_response(e, status=500)

async def handle_nanobanana_history_append(request):
    """生成1回分の記録をJSON Lines（history.jsonl）へ1行追記する
    （編集・削除はユーザーがファイルを直接操作する前提。1行=1件のJSONのため、該当行を削除するだけで良い）。"""
    try:
        data = await request.json()
        filenames = data.get('filenames')
        if not filenames and data.get('filename'):
            filenames = [data['filename']]
        if not filenames:
            return _error_response(CCCError('nanobanana_history_no_filename', 'ファイル名が指定されていません。'), status=400)

        entry = {
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'engine': _clip_history_field(data.get('engine', 'gemini'), 20) or 'gemini',
            'model': _clip_history_field(data.get('model', ''), 100),
            'width': data.get('width'),
            'height': data.get('height'),
            'image_size': _clip_history_field(data.get('image_size', ''), 20),
            'seed': data.get('seed'),
            'filenames': [_clip_history_field(fn, 300) for fn in filenames[:_MAX_HISTORY_FILENAMES]],
            'prompt': _clip_history_field(data.get('prompt', ''), _MAX_HISTORY_FIELD_CHARS),
            'negative_prompt': _clip_history_field(data.get('negative_prompt', ''), _MAX_HISTORY_FIELD_CHARS),
        }

        OUTPUT_NANOBANANA_DIR.mkdir(parents=True, exist_ok=True)
        with open(_nanobanana_history_path(), 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry, ensure_ascii=False) + '\n')
        return web.json_response({'status': 'ok', 'entry': entry})
    except CCCError as e:
        return _error_response(e, status=400)
    except Exception as e:
        return _error_response(e, status=500)

# ─── Autoタブ（AIマンガ自動作成） ──────────────────────────────────────────────

async def handle_save_auto_image(request):
    """Autoタブで生成した画像を output/cc_auto に保存する（構成は cc_nanobanana の保存APIと同じ）。"""
    try:
        data = await _read_json_limited(request, MAX_JSON_IMAGE_UPLOAD_BYTES)
        img_b64 = data.get('image', '')
        filename = data.get('filename', '')
        if not img_b64:
            return web.json_response({'status': 'error', 'message': 'image field required'}, status=400)
        if img_b64.startswith('data:'):
            img_b64 = img_b64.split(',', 1)[1]
        img_bytes = base64.b64decode(img_b64)
        OUTPUT_AUTO_DIR.mkdir(parents=True, exist_ok=True)
        if not filename:
            filename = datetime.now().strftime('Auto_%Y%m%d_%H%M%S_%f')[:-3] + '.png'
        dest = _safe_path(OUTPUT_AUTO_DIR, filename)
        dest.write_bytes(img_bytes)
        return web.json_response({'status': 'ok', 'url': f'/ccc_auto_output/{dest.name}', 'filename': dest.name})
    except CCCError as e:
        return _error_response(e, status=413)
    except Exception as e:
        return web.json_response({'status': 'error', 'message': str(e)}, status=500)

async def handle_auto_gemini_text(request):
    """Gemini APIでテキストを生成する（Autoタブのストーリー・脚本生成とChat用）。
    APIキーはサーバー側（NANOBANANA_API_KEY、Nanobananaタブと共通）にのみ置き、ブラウザへは出さない。
    body: { model, messages:[{role:'system'|'user'|'assistant', content}], json?:bool, temperature?, max_tokens? }"""
    try:
        if not NANOBANANA_API_KEY:
            return _error_response(CCCError('nanobanana_api_key_missing', 'Gemini APIキーが設定されていません。プラグインフォルダ直下の .env に NANOBANANA_API_KEY=... を記載し、ComfyUIを再起動してください。'), status=400)
        data = await request.json()
        model = _validate_gemini_model(data.get('model', ''))
        system_parts = []
        contents = []
        for m in (data.get('messages') or []):
            text = str(m.get('content', ''))
            role = m.get('role')
            if role == 'system':
                system_parts.append({'text': text})
            else:
                contents.append({'role': 'model' if role == 'assistant' else 'user', 'parts': [{'text': text}]})
        if not contents:
            return _error_response(CCCError('auto_gemini_no_messages', 'メッセージが空です'), status=400)

        generation_config = {}
        temperature = data.get('temperature')
        if isinstance(temperature, (int, float)):
            generation_config['temperature'] = temperature
        max_tokens = data.get('max_tokens')
        if isinstance(max_tokens, int) and max_tokens > 0:
            generation_config['maxOutputTokens'] = max_tokens
        if data.get('json'):
            generation_config['responseMimeType'] = 'application/json'
        payload = {'contents': contents}
        if system_parts:
            payload['systemInstruction'] = {'parts': system_parts}
        if generation_config:
            payload['generationConfig'] = generation_config

        # APIキーはURLクエリではなくヘッダーで送る（URLはログ・プロキシに残りやすいため）
        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        req_body = json.dumps(payload).encode('utf-8')
        def _call():
            req = urllib.request.Request(api_url, data=req_body, headers={'Content-Type': 'application/json', 'x-goog-api-key': NANOBANANA_API_KEY}, method='POST')
            with urllib.request.urlopen(req, timeout=180) as resp:
                return json.loads(resp.read().decode('utf-8'))
        loop = asyncio.get_event_loop()
        rd = await loop.run_in_executor(None, _call)
        texts = []
        for cand in rd.get('candidates', [])[:1]:
            for part in cand.get('content', {}).get('parts', []):
                if part.get('text') and not part.get('thought'):
                    texts.append(part['text'])
        return web.json_response({'status': 'ok', 'text': ''.join(texts)})
    except CCCError as e:
        return _error_response(e, status=400)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        return _error_response(Exception(f'Google API Error ({e.code}): {error_body}'), status=500)
    except Exception as e:
        return _error_response(e, status=500)

# Unslothはローカルでも原則APIキー(UNSLOTH_API_KEY、.envから読込)が必要なため、ブラウザから直接叩かず
# サーバーが中継してAuthorizationヘッダーを付与する（キーをフロントへ渡さない）。
# キーが未設定ならヘッダー無しで中継する（Unsloth側の Keyless API access →「Chat and inference」が
# オンなら動く。Workflow Studio の unsloth_routes.py と同じ挙動）。
# /v1/systemone は意思決定モデル（Decision API、static/js/decision-client.js）。
# キーを含むリクエストを任意ホストへ送らせないため、宛先はループバックに限定する（SSRF対策）。
_AUTO_UNSLOTH_ALLOWED_PATHS = {'/v1/models', '/v1/chat/completions', '/v1/systemone'}
_AUTO_UNSLOTH_ALLOWED_HOSTS = {'localhost', '127.0.0.1', '::1'}
_AUTO_UNSLOTH_KEYLESS_REJECTED = (
    'Unsloth rejected the request without an API key (HTTP 401). Either add UNSLOTH_API_KEY=... to the .env '
    'file in the plugin folder and restart ComfyUI, or turn on Keyless API access -> "Chat and inference" '
    "in Unsloth Desktop's Settings -> API."
)

async def handle_auto_unsloth_proxy(request):
    """body: { baseUrl, path: '/v1/models'|'/v1/chat/completions'|'/v1/systemone', method: 'GET'|'POST', payload }"""
    try:
        body = await request.json()
        base_url = (body.get('baseUrl') or 'http://localhost:8888').rstrip('/')
        path = body.get('path') or '/v1/models'
        method = (body.get('method') or 'GET').upper()
        payload = body.get('payload')
        if path not in _AUTO_UNSLOTH_ALLOWED_PATHS or method not in ('GET', 'POST'):
            return web.json_response({'message': 'Unsupported proxy target'}, status=400)
        parsed = _urlparse(base_url)
        if (parsed.scheme not in ('http', 'https') or parsed.hostname not in _AUTO_UNSLOTH_ALLOWED_HOSTS
                or parsed.username or parsed.password):
            return web.json_response({'message': 'Unsloth backend URL must be http(s)://localhost|127.0.0.1|::1[:port] (no credentials)'}, status=400)
        api_key = os.environ.get('UNSLOTH_API_KEY', '').strip()

        def _fetch():
            data = json.dumps(payload).encode('utf-8') if payload is not None else None
            headers = {'Authorization': f'Bearer {api_key}'} if api_key else {}
            if data is not None:
                headers['Content-Type'] = 'application/json'
            req = urllib.request.Request(f'{base_url}{path}', data=data, headers=headers, method=method)
            with _local_urlopen(req, timeout=180) as resp:
                return json.loads(resp.read().decode('utf-8'))
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _fetch)
        return web.json_response(result)
    except urllib.error.HTTPError as e:
        if e.code == 401 and not os.environ.get('UNSLOTH_API_KEY', '').strip():
            return web.json_response({'message': _AUTO_UNSLOTH_KEYLESS_REJECTED}, status=401)
        # Unsloth自身のエラー本文の先頭も返す（Decision APIの質問形式エラーや
        # 「The Decision API is off」(404) はこれが無いとフロントから原因が分からない）
        detail = e.read().decode('utf-8', errors='replace') if e.fp else ''
        return web.json_response({'message': f'Unsloth API error: HTTP {e.code} {detail[:300]}'.strip()}, status=e.code)
    except urllib.error.URLError as e:
        return web.json_response({'message': f'Could not reach Unsloth: {e.reason}'}, status=502)
    except Exception as e:
        return web.json_response({'message': str(e)}, status=500)


async def handle_google_font_ttf(request):
    """Google Fonts の指定ファミリーのフォントバイナリを取得してそのまま返す。
    Google Fonts CSS2 API はリクエストの User-Agent によって返す形式を切り替えており、
    ブラウザ標準UAには woff2、非ブラウザ的なUA（本サーバーのように明示しない/独自UA）には
    ttf を返す。ブラウザの fetch() は User-Agent を偽装できないため、3Dテキスト機能で
    opentype.js が直接パースできる ttf を得るにはサーバー側で取得する必要がある。"""
    family = request.query.get('family', '').strip()
    if not family:
        return _error_response(CCCError('font_family_required', 'family パラメータが必要です'), status=400)
    try:
        weight = _validate_font_weight(request.query.get('weight', '400'))
    except CCCError as e:
        return _error_response(e, status=400)
    italic = request.query.get('italic', '0') == '1'

    try:
        loop = asyncio.get_event_loop()
        def _fetch():
            family_param = _urlquote(family)
            spec = f"{family_param}:ital,wght@{1 if italic else 0},{weight}"
            css_url = f"https://fonts.googleapis.com/css2?family={spec}&display=swap"
            req = urllib.request.Request(css_url, headers={'User-Agent': 'ComicCreator-FontFetch/1.0'})
            with urllib.request.urlopen(req, timeout=15) as resp:
                css_text = resp.read().decode('utf-8')
            m = re.search(r'url\((https://fonts\.gstatic\.com/[^)]+)\)', css_text)
            if not m:
                raise CCCError('font_not_found', f'フォントが見つかりません: {family}', family=family)
            font_url = m.group(1)
            req2 = urllib.request.Request(font_url, headers={'User-Agent': 'ComicCreator-FontFetch/1.0'})
            with urllib.request.urlopen(req2, timeout=15) as resp2:
                return resp2.read(), font_url

        font_bytes, font_url = await loop.run_in_executor(None, _fetch)
        if font_url.endswith('.woff2'):
            content_type = 'font/woff2'
        elif font_url.endswith('.ttf'):
            content_type = 'font/ttf'
        else:
            content_type = 'application/octet-stream'
        return web.Response(body=font_bytes, content_type=content_type)
    except CCCError as e:
        return _error_response(e, status=404)
    except urllib.error.HTTPError as e:
        return _error_response(Exception(f'Google Fonts取得エラー ({e.code})'), status=502)
    except Exception as e:
        return _error_response(e, status=500)

async def handle_eagle_add(request):
    try:
        data = await request.json()
        raw_eagle_url = data.get('eagleUrl', 'http://localhost:41595').rstrip('/')
        eagle_url = _validate_local_url(raw_eagle_url, 'eagleUrl')
        image_url = data.get('url', '')
        name = data.get('name', 'image.png')
        tags = data.get('tags', [])
        loop = asyncio.get_event_loop()
        def _post():
            if image_url.startswith('/') and not image_url.startswith('//'):
                # ローカルパスの場合: PLUGIN_DIR 配下に限定
                rel = image_url.lstrip('/')
                local_path = _safe_path(PLUGIN_DIR, rel)
                if not os.path.isfile(local_path):
                    raise CCCError('eagle_file_not_found', f'ファイルが見つかりません: {local_path}', path=str(local_path))
                payload = json.dumps({'path': str(local_path), 'name': name, 'tags': tags}).encode('utf-8')
                endpoint = f'{eagle_url}/api/item/addFromPath'
            else:
                payload = json.dumps({'url': image_url, 'name': name, 'tags': tags}).encode('utf-8')
                endpoint = f'{eagle_url}/api/item/addFromURL'
            req = urllib.request.Request(endpoint, data=payload, headers={'Content-Type': 'application/json'}, method='POST')
            with _local_urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode('utf-8'))
        result = await loop.run_in_executor(None, _post)
        return web.json_response(result)
    except urllib.error.URLError as e:
        return _error_response(CCCError('eagle_connection_error', f'Eagle接続エラー: {e.reason}', reason=str(e.reason)), status=502)
    except Exception as e:
        return _error_response(e, status=500)

# ─── VRAM調整（Ollamaのモデルをアンロードして画像生成用の空きVRAMを作る） ───────────────
# ComfyUI-LiveChatStream の vram_prepare と同じ方式。ComfyUIの空きVRAM（get_free_memory / system_stats の
# vram_free）は、環境によってOllamaのロード/アンロードに反応しない（ComfyUI_5でも9Bモデルのロード前後で
# 8462MBのまま、nvidia-smiは6530→469MBと実測）。そのためドライバの実測（nvidia-smi）に
# ComfyUI自身のtorch未使用キャッシュ分を足して空きとし、取れなければ get_free_memory に戻す。

_MB = 1024 * 1024
_OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434'
_VRAM_MAX_URLS = 4                      # 既定URLを含む。1件ごとに接続待ちが発生するため上限を設ける
_vram_lock = asyncio.Lock()             # 同時に走らせない（アンロードと空きの計測が干渉するため）

def _smi_free_mb(ident):
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    out = subprocess.run(
        ['nvidia-smi', '-i', str(ident), '--query-gpu=memory.free', '--format=csv,noheader,nounits'],
        capture_output=True, text=True, timeout=5, creationflags=flags,
    )
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip() or 'nvidia-smi failed')
    return float(out.stdout.strip().splitlines()[0])

def _free_vram_mb():
    """画像生成で使える空きVRAM(MB)と取得元（'nvidia-smi' / 'comfy'）を返す。"""
    import torch
    import comfy.model_management as mm
    dev = mm.get_torch_device()
    if getattr(dev, 'type', 'cpu') == 'cuda':
        try:
            st = torch.cuda.memory_stats(dev)
            cached = max(0, st['reserved_bytes.all.current'] - st['active_bytes.all.current'])
            try:
                free = _smi_free_mb(f"GPU-{torch.cuda.get_device_properties(dev).uuid}")
            except Exception:
                free = _smi_free_mb(dev.index or 0)
            return free + cached / _MB, 'nvidia-smi'
        except Exception as e:
            print(f"[ccc] nvidia-smi free VRAM unavailable, falling back to ComfyUI: {e}")
    return mm.get_free_memory(dev) / _MB, 'comfy'

def _wait_vram_settled(prev_mb, timeout_s=6.0):
    """アンロード後、Ollamaのランナー終了で空きが増えて頭打ちになるまで待ち、実測の空き(MB)を返す。"""
    now = prev_mb
    last = None
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        time.sleep(0.4)
        now, _ = _free_vram_mb()
        if last is not None and abs(now - last) < 32 and now > prev_mb + 32:
            break
        last = now
    return now

def _ollama_json(base, path, payload=None, timeout=60):
    data = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(base + path, data=data, headers={'Content-Type': 'application/json'},
                                 method='POST' if data is not None else 'GET')
    with _local_urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read()

def _ollama_loaded_names(base):
    _, raw = _ollama_json(base, '/api/ps', timeout=5)
    return {m.get('name') for m in json.loads(raw.decode('utf-8')).get('models', [])}

def _ollama_unload(base, name):
    """keep_alive=0 でアンロード。意思決定モデルなど /api/generate を受け付けないモデルは /api/chat で再試行。
    応答がエラーでも、Ollamaは少し遅れてアンロードしていることがある（実機で1回発生）ため、
    最後に /api/ps でまだロードされているかを確かめて判定する。"""
    errors = []
    for path, payload in (('/api/generate', {'model': name, 'keep_alive': 0}),
                          ('/api/chat', {'model': name, 'messages': [], 'keep_alive': 0})):
        try:
            status, _ = _ollama_json(base, path, payload)
            if status == 200:
                return True
            errors.append(f"{path}: HTTP {status}")
        except Exception as e:
            errors.append(f"{path}: {e}")
    for _ in range(5):
        time.sleep(0.5)
        try:
            if name not in _ollama_loaded_names(base):
                return True
        except Exception:
            pass
    print(f"[ccc] vram: unload failed for {name}: {'; '.join(errors)}")
    return False

def _ollama_bases(urls):
    """検証済み・重複なしのOllama URL一覧。localhost / 127.0.0.1 / ::1 は同じサーバーとみなす。"""
    if urls is None:
        urls = []
    if not isinstance(urls, list):
        raise CCCError('vram_invalid_urls', 'urls は配列で指定')
    bases, seen = [], set()
    for raw in [_OLLAMA_DEFAULT_URL, *urls]:
        if not isinstance(raw, str) or not raw.strip():
            continue
        base = _validate_local_url(raw.strip().rstrip('/'), 'urls')
        p = _urlparse(base)
        key = (p.scheme, p.port or (443 if p.scheme == 'https' else 80))
        if key in seen:
            continue
        seen.add(key)
        bases.append(base)
        if len(bases) > _VRAM_MAX_URLS:
            raise CCCError('vram_too_many_urls', f'接続先は{_VRAM_MAX_URLS}件まで')
    return bases

def _vram_prepare(mode, target_mb, bases):
    free_before, free_src = _free_vram_mb()
    cands, unreachable = [], []
    for base in bases:
        try:
            _, raw = _ollama_json(base, '/api/ps', timeout=5)
            for m in json.loads(raw.decode('utf-8')).get('models', []):
                if m.get('name'):
                    cands.append({'base': base, 'name': m['name'], 'vram_mb': int(m.get('size_vram', 0) / _MB)})
        except Exception as e:
            # Ollamaが起動していない等。既定URLが無いのは普通なので失敗扱いにはしないが、原因はログに残す
            # 応答には理由を含めない（呼び出し側が指定したローカルホストのポートの状態を知らせないため）
            print(f"[ccc] vram: {base}/api/ps failed: {e!r}")
            unreachable.append({'url': base})
    unloaded, failed = [], []
    free_after = free_before
    if mode == 'auto':
        # Ollamaの size_vram はKVキャッシュ等を含まず実際に増える空きより小さい。見込みで選ぶと余分に
        # 解放しかねないので、大きいモデルから1台ずつアンロードし、そのつど実測の空きで止める
        cands.sort(key=lambda c: c['vram_mb'], reverse=True)
        for c in cands:
            if free_after >= target_mb:
                break
            if _ollama_unload(c['base'], c['name']):
                unloaded.append(c)
                free_after = _wait_vram_settled(free_after)
            else:
                failed.append(c)
    else:
        for c in cands:
            (unloaded if _ollama_unload(c['base'], c['name']) else failed).append(c)
        if unloaded:
            free_after = _wait_vram_settled(free_after)
    strip = lambda cs: [{'name': c['name'], 'vram_mb': c['vram_mb']} for c in cs]
    return {
        'status': 'ok', 'mode': mode, 'target_gb': target_mb / 1024, 'free_source': free_src,
        'free_before_mb': round(free_before), 'free_after_mb': round(free_after),
        'unloaded': strip(unloaded), 'failed': [c['name'] for c in failed],
        'unreachable': unreachable,
        'reached': free_after >= target_mb,
    }

async def handle_vram_prepare(request):
    """POST {mode:'auto'|'all', target_gb, urls:[OllamaのURL]}。
    auto: 空きVRAMが target_gb 未満のときだけ、VRAM使用量の大きいモデルから必要な分だけアンロード。
    all: ロード中のモデルをすべてアンロード（「モデルをアンロード」ボタンもこれを使う）。
    接続先はローカルホストに限る（既定の127.0.0.1:11434も常に対象）。"""
    # 他サイトからの単純リクエスト（text/plain等、CORSのプリフライト無し）でモデルを外されないよう、JSONのみ受け付ける
    if request.content_type != 'application/json':
        return _error_response(CCCError('vram_bad_content_type', 'Content-Type は application/json のみ'), status=415)
    try:
        data = await request.json()
        if not isinstance(data, dict):
            raise CCCError('vram_invalid_body', '本文はJSONオブジェクトで指定')
        mode = data.get('mode')
        if mode not in ('auto', 'all'):
            raise CCCError('vram_invalid_mode', 'mode は auto / all のみ')
        target_gb = float(data.get('target_gb', 8) or 0)
        if not math.isfinite(target_gb):
            raise CCCError('vram_invalid_target', 'target_gb は有限の数値で指定')
        target_mb = min(max(target_gb, 0.0), 64.0) * 1024
        bases = _ollama_bases(data.get('urls'))
    except Exception as e:
        return _error_response(e, status=400)
    if _vram_lock.locked():
        return _error_response(CCCError('vram_busy', 'VRAM調整は実行中'), status=409)
    try:
        async with _vram_lock:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, _vram_prepare, mode, target_mb, bases)
        return web.json_response(result)
    except Exception as e:
        print(f"[ccc] vram prepare error: {e}")
        return _error_response(e, status=500)

async def handle_get_app_server_settings(request):
    return web.json_response({'status': 'ok', 'autoStart': _app_settings.get('appServerAutoStart', False)})

async def handle_post_app_server_settings(request):
    try:
        data = await request.json()
        _app_settings['appServerAutoStart'] = bool(data.get('autoStart', False))
        _save_settings()
        return web.json_response({'status': 'ok'})
    except Exception as e:
        return web.json_response({'detail': str(e)}, status=500)

async def handle_get_local_gmic_settings(request):
    gmic_path = _app_settings.get('gmicQtPath', '')
    return web.json_response({
        'status': 'ok',
        'gmicQtPath': gmic_path,
        'exists': bool(gmic_path) and os.path.isfile(gmic_path),
    })

async def handle_post_local_gmic_settings(request):
    try:
        data = await request.json()
        gmic_path = str(data.get('gmicQtPath', '')).strip()
        gmic_path = _validate_local_exe_path(gmic_path)
        _app_settings['gmicQtPath'] = gmic_path
        _save_settings()
        return web.json_response({
            'status': 'ok',
            'exists': bool(gmic_path) and os.path.isfile(gmic_path),
        })
    except CCCError as e:
        return _error_response(e, status=400, key='detail')
    except Exception as e:
        return web.json_response({'detail': str(e)}, status=500)

async def handle_local_gmic_open_b64(request):
    import mimetypes
    try:
        data = await _read_json_limited(request, MAX_JSON_IMAGE_UPLOAD_BYTES)
        image_b64 = data.get('image_b64', '')
        if not image_b64:
            return _error_response(CCCError('gmic_image_required', 'image_b64 フィールドがありません'), status=400, key='detail')
        ext = '.png'
        if image_b64.startswith('data:'):
            header, image_b64 = image_b64.split(',', 1)
            mime = header.split(';')[0].split(':')[1]
            guessed = mimetypes.guess_extension(mime)
            if guessed:
                ext = '.jpg' if guessed == '.jpe' else guessed
        img_bytes = base64.b64decode(image_b64)
        # MIMEより実バイトを信頼する（PNGを名乗るJPEG等への対策）
        sniffed = _sniff_image_ext(img_bytes)
        if sniffed:
            ext = sniffed
        # G'MIC-Qt(スタンドアロン)はPNG以外（JPEG含む）を開けず無音で即終了する
        # ため、PNG以外はPILでPNGに変換してから渡す
        if ext != '.png':
            try:
                import io
                from PIL import Image
                im = Image.open(io.BytesIO(img_bytes))
                if im.mode not in ('RGB', 'RGBA', 'L', 'LA', 'P'):
                    im = im.convert('RGB')
                buf = io.BytesIO()
                im.save(buf, format='PNG')
                img_bytes = buf.getvalue()
                ext = '.png'
            except Exception as conv_err:
                print(f"[ccc] gmic入力のPNG変換に失敗（そのまま渡します）: {conv_err}")
        GMIC_TEMP_DIR.mkdir(parents=True, exist_ok=True)
        fname = datetime.now().strftime(f'gmic_input_%Y%m%d_%H%M%S{ext}')
        input_path = str(GMIC_TEMP_DIR / fname)
        with open(input_path, 'wb') as f:
            f.write(img_bytes)
        ts = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
        output_path = str(GMIC_TEMP_DIR / f'out_{ts}{ext}')
        job_id = str(uuid.uuid4())
        with _gmic_jobs_lock:
            _gmic_jobs[job_id] = {
                'status': 'pending', 'message': "G'MIC GUIを起動中...", 'message_code': 'gmic_starting',
                'result_path': None, 'error': None, 'error_code': None, 'error_params': {},
            }
        t = threading.Thread(target=_gmic_run_gui, args=(job_id, input_path, output_path), daemon=True)
        t.start()
        return web.json_response({'job_id': job_id, 'status': 'pending', 'message': '起動中'})
    except CCCError as e:
        return _error_response(e, status=413, key='detail')
    except Exception as e:
        return _error_response(e, status=500, key='detail')

async def handle_local_gmic_status(request):
    job_id = request.match_info['job_id']
    with _gmic_jobs_lock:
        job = _gmic_jobs.get(job_id)
    if job is None:
        return _error_response(CCCError('gmic_job_not_found', 'ジョブが見つかりません'), status=404, key='detail')
    return web.json_response({
        'job_id': job_id,
        'status': job['status'],
        'message': job.get('message', ''),
        'message_code': job.get('message_code'),
        'result_path': job.get('result_path'),
        'error': job.get('error'),
        'error_code': job.get('error_code'),
        'error_params': job.get('error_params', {}),
    })

async def handle_local_gmic_result_b64(request):
    import mimetypes
    try:
        data = await request.json()
        result_path = data.get('result_path', '')
        if not result_path:
            return _error_response(CCCError('gmic_result_path_required', '結果パスが必要です'), status=400, key='detail')
        # GMIC_TEMP_DIR 内のファイルのみ許可
        try:
            resolved = _Path(result_path).resolve()
            if not str(resolved).startswith(str(GMIC_TEMP_DIR.resolve()) + os.sep):
                return _error_response(CCCError('gmic_invalid_path', '無効なパスです'), status=400, key='detail')
        except Exception:
            return _error_response(CCCError('gmic_invalid_path', '無効なパスです'), status=400, key='detail')
        if not resolved.exists():
            return _error_response(CCCError('gmic_result_file_not_found', f'結果ファイルが見つかりません: {result_path}', path=result_path), status=400, key='detail')
        with open(resolved, 'rb') as f:
            img_bytes = f.read()
        ext = os.path.splitext(result_path)[1].lower()
        mime_map = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.bmp':'image/bmp','.tiff':'image/tiff'}
        mime = mime_map.get(ext, 'image/png')
        b64 = base64.b64encode(img_bytes).decode('ascii')
        return web.json_response({'image_b64': f'data:{mime};base64,{b64}'})
    except Exception as e:
        return _error_response(e, status=500, key='detail')

_GMIC_SEGMENT_RE = re.compile(r'^[A-Za-z0-9._-]+$')

async def handle_proxy_gmic(request):
    rel = request.rel_url
    # rel.path はパーセントデコード済み。セグメント単位で許可文字＋トラバーサル(., ..)を検証し、
    # ローカルG'MICサーバーへの意図しないパスでの転送（open-proxy的形状）を防ぐ。
    sub_path = rel.path[len('/api/ccc/gmic'):]
    segments = [s for s in sub_path.split('/') if s]
    if any(s in ('.', '..') or not _GMIC_SEGMENT_RE.match(s) for s in segments):
        return _error_response(CCCError('gmic_invalid_path', "G'MIC API: 不正なパスです", path=sub_path), status=400, key='detail')
    normalized_path = ('/' + '/'.join(segments)) if segments else ''
    query = ('?' + rel.query_string) if rel.query_string else ''
    target_url = GMIC_SERVER_URL + '/api' + normalized_path + query
    try:
        body = await request.read() if request.method == 'POST' else None
        loop = asyncio.get_event_loop()
        def _do():
            req = urllib.request.Request(target_url, data=body, headers={'Content-Type': 'application/json'}, method=request.method)
            with _local_urlopen(req, timeout=310) as resp:
                return resp.read(), resp.status
        raw, status = await loop.run_in_executor(None, _do)
        return web.Response(body=raw, status=status, content_type='application/json')
    except urllib.error.HTTPError as e:
        return web.Response(body=e.read(), status=e.code, content_type='application/json')
    except Exception as e:
        return web.json_response({'detail': f"G'MICサーバーに接続できません: {e}"}, status=503)

# ─── API catch-all dispatchers ────────────────────────────────────────────────
# PlainResource が resource_index で見つからない場合の DynamicResource フォールバック

_DISPATCH_GET: dict = {}
_DISPATCH_POST: dict = {}

def _build_dispatch_tables():
    global _DISPATCH_GET, _DISPATCH_POST
    _DISPATCH_GET = {
        "refresh-assets":         handle_refresh_assets,
        "nanobanana/key":         handle_nanobanana_key,
        "nanobanana/native/status": handle_nanobanana_native_status,
        "nanobanana/models":      handle_nanobanana_list_models,
        "nanobanana/history":     handle_nanobanana_history_get,
        "app-server/settings":    handle_get_app_server_settings,
        "local-gmic/settings":    handle_get_local_gmic_settings,
    }
    _DISPATCH_POST = {
        "save-nanobanana-image":       handle_save_nanobanana_image,
        "save-auto-image":             handle_save_auto_image,
        "auto/gemini-text":            handle_auto_gemini_text,
        "auto/unsloth-proxy":          handle_auto_unsloth_proxy,
        "save-group-asset":            handle_save_group_asset,
        "save-image-project":          handle_save_image_project,
        "delete-asset":                handle_delete_asset,
        "psd/import-layers":           handle_psd_import_layers,
        "psd/export-layers":           handle_psd_export_layers,
        "nanobanana/generate":         handle_nanobanana_generate,
        "nanobanana/native/generate":  handle_nanobanana_native_generate,
        "moss/generate":               handle_moss_generate,
        "moss/layout-prompt":          handle_moss_layout_prompt,
        "nanobanana/history/append":   handle_nanobanana_history_append,
        "eagle/add":                   handle_eagle_add,
        "vram/prepare":                handle_vram_prepare,
        "app-server/settings":         handle_post_app_server_settings,
        "local-gmic/settings":         handle_post_local_gmic_settings,
        "local-gmic/open_in_gui_b64":  handle_local_gmic_open_b64,
        "local-gmic/result_b64":       handle_local_gmic_result_b64,
        "video/upload":                handle_upload_video,
    }

async def _api_get_dispatch(request):
    tail = request.match_info.get("tail", "")
    handler = _DISPATCH_GET.get(tail)
    if handler:
        return await handler(request)
    return web.HTTPNotFound(reason=f"[ccc] unknown GET /api/ccc/{tail}")

async def _api_post_dispatch(request):
    tail = request.match_info.get("tail", "")
    handler = _DISPATCH_POST.get(tail)
    if handler:
        return await handler(request)
    return web.HTTPNotFound(reason=f"[ccc] unknown POST /api/ccc/{tail}")

# ─── Route registration ───────────────────────────────────────────────────────

class ComicCreator:
    @classmethod
    def add_routes(cls):
        app = PromptServer.instance.app

        # Ensure directories exist
        for d in [STATIC_DIR, ASSETS_DIR, OUTPUT_NANOBANANA_DIR, OUTPUT_AUTO_DIR, GMIC_TEMP_DIR, OUTPUT_VIDEO_DIR]:
            d.mkdir(parents=True, exist_ok=True)

        # Static mounts
        app.router.add_static("/ccc_static",           str(STATIC_DIR))
        app.router.add_static("/ccc_assets",           str(ASSETS_DIR))
        app.router.add_static("/ccc_nanobanana_output", str(OUTPUT_NANOBANANA_DIR))
        app.router.add_static("/ccc_auto_output",       str(OUTPUT_AUTO_DIR))
        app.router.add_static("/ccc_gmic_temp",        str(GMIC_TEMP_DIR))
        app.router.add_static("/ccc_video_assets",     str(OUTPUT_VIDEO_DIR))

        # SPA entry
        app.router.add_get("/ccc", serve_index)

        # GET APIs
        app.router.add_get("/api/ccc/refresh-assets",         handle_refresh_assets)
        app.router.add_get("/api/ccc/nanobanana/key",         handle_nanobanana_key)
        app.router.add_get("/api/ccc/nanobanana/native/status", handle_nanobanana_native_status)
        app.router.add_get("/api/ccc/nanobanana/models",      handle_nanobanana_list_models)
        app.router.add_get("/api/ccc/nanobanana/history",     handle_nanobanana_history_get)
        app.router.add_get("/api/ccc/google-font-ttf",        handle_google_font_ttf)
        app.router.add_get("/api/ccc/app-server/settings",    handle_get_app_server_settings)
        app.router.add_get("/api/ccc/local-gmic/settings",    handle_get_local_gmic_settings)
        app.router.add_get("/api/ccc/local-gmic/status/{job_id}", handle_local_gmic_status)
        app.router.add_get("/api/ccc/gmic/{tail:.*}",         handle_proxy_gmic)

        # POST APIs
        app.router.add_post("/api/ccc/save-nanobanana-image",    handle_save_nanobanana_image)
        app.router.add_post("/api/ccc/save-auto-image",          handle_save_auto_image)
        app.router.add_post("/api/ccc/auto/gemini-text",         handle_auto_gemini_text)
        app.router.add_post("/api/ccc/auto/unsloth-proxy",       handle_auto_unsloth_proxy)
        app.router.add_post("/api/ccc/save-group-asset",         handle_save_group_asset)
        app.router.add_post("/api/ccc/save-image-project",       handle_save_image_project)
        app.router.add_post("/api/ccc/delete-asset",             handle_delete_asset)
        app.router.add_post("/api/ccc/psd/import-layers",        handle_psd_import_layers)
        app.router.add_post("/api/ccc/psd/export-layers",        handle_psd_export_layers)
        app.router.add_post("/api/ccc/nanobanana/generate",      handle_nanobanana_generate)
        app.router.add_post("/api/ccc/nanobanana/native/generate", handle_nanobanana_native_generate)
        app.router.add_post("/api/ccc/moss/generate",            handle_moss_generate)
        app.router.add_post("/api/ccc/moss/layout-prompt",       handle_moss_layout_prompt)
        app.router.add_post("/api/ccc/nanobanana/history/append", handle_nanobanana_history_append)
        app.router.add_post("/api/ccc/eagle/add",                handle_eagle_add)
        app.router.add_post("/api/ccc/vram/prepare",             handle_vram_prepare)
        app.router.add_post("/api/ccc/app-server/settings",      handle_post_app_server_settings)
        app.router.add_post("/api/ccc/local-gmic/settings",      handle_post_local_gmic_settings)
        app.router.add_post("/api/ccc/local-gmic/open_in_gui_b64", handle_local_gmic_open_b64)
        app.router.add_post("/api/ccc/local-gmic/result_b64",    handle_local_gmic_result_b64)
        app.router.add_post("/api/ccc/video/upload",              handle_upload_video)
        app.router.add_post("/api/ccc/gmic/{tail:.*}",           handle_proxy_gmic)

        # DynamicResource catch-all フォールバック
        # PlainResource がリソースインデックスで見つからない場合、walk-up でここに到達する
        # /ccc{tail} は "/" にインデックスされるため walk-up が必ず到達できる
        _build_dispatch_tables()
        app.router.add_get(r"/ccc{tail:(?:/.*)?}", serve_index)
        # /api/ccc/{tail:.*} は "/api/ccc" にインデックスされる
        app.router.add_get("/api/ccc/{tail:.*}", _api_get_dispatch)
        app.router.add_post("/api/ccc/{tail:.*}", _api_post_dispatch)

        # Initial asset scan
        try:
            if ASSETS_DIR.is_dir():
                _generate_assets_json()
        except Exception as e:
            print(f"[ccc] assets scan error: {e}")

        # ポートは固定値ではなく、ComfyUI の起動引数（--listen / --port）から取得する
        try:
            from comfy.cli_args import args as _comfy_args
            _port = getattr(_comfy_args, "port", None) or 8188
            _host = str(getattr(_comfy_args, "listen", "") or "127.0.0.1").split(",")[0].strip()
            if _host in ("", "0.0.0.0", "::"):
                _host = "127.0.0.1"
            elif ":" in _host:
                _host = f"[{_host}]"
        except Exception:
            _host, _port = "127.0.0.1", 8188
        print(f"[ccc] Comic Creator loaded → http://{_host}:{_port}/ccc")
