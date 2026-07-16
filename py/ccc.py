import asyncio
import base64
import json
import os
import re
import subprocess
import threading
import time
import urllib.request
import urllib.error
import uuid
from datetime import datetime

from aiohttp import web
from server import PromptServer

from pathlib import Path as _Path
from urllib.parse import urlparse as _urlparse

from .config import (
    PLUGIN_DIR,
    TEMPLATES_DIR, STATIC_DIR, ASSETS_DIR, ASSETS_JSON,
    OUTPUT_NANOBANANA_DIR, GMIC_TEMP_DIR,
    SETTINGS_FILE,
    VALID_EXTENSIONS, GMIC_SERVER_URL,
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
        host = (p.hostname or '').lower()
        if host not in _ALLOWED_LOCALHOST:
            raise CCCError('url_not_localhost', f"{param_name}: ローカルホスト以外への接続は禁止", param=param_name)
    except CCCError:
        raise
    except Exception:
        raise CCCError('url_invalid', f"{param_name}: 無効なURL", param=param_name)
    return url

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
        print(f"[comic-creater] .env の読み込みに失敗しました: {e}")

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
    return web.Response(text='<h1>Comic Creater - index.html not found</h1>', content_type='text/html')

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
        data = await request.json()
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
    except Exception as e:
        return web.json_response({'status': 'error', 'message': str(e)}, status=500)

async def handle_save_group_asset(request):
    try:
        data = await request.json()
        group_name = (data.get('group') or '').strip()
        svg_content = data.get('svg', '')
        filename = (data.get('filename') or '').strip()
        if not group_name:
            return web.json_response({'status': 'error', 'message': 'group field required'}, status=400)
        if not svg_content:
            return web.json_response({'status': 'error', 'message': 'svg field required'}, status=400)
        safe_group = re.sub(r'[\\/:*?"<>|]', '_', group_name)
        if safe_group in ('', '.', '..'):
            return web.json_response({'status': 'error', 'message': 'invalid group name'}, status=400)
        out_dir = (ASSETS_DIR / safe_group).resolve()
        base = ASSETS_DIR.resolve()
        if out_dir != base and not str(out_dir).startswith(str(base) + os.sep):
            return web.json_response({'status': 'error', 'message': 'invalid group name'}, status=400)
        out_dir.mkdir(parents=True, exist_ok=True)
        if not filename:
            filename = datetime.now().strftime('group_%Y%m%d_%H%M%S') + '.svg'
        else:
            filename = re.sub(r'[\\/:*?"<>|]', '_', filename)
            if not filename.lower().endswith('.svg'):
                filename += '.svg'
        dest = _safe_path(out_dir, filename)
        dest.write_text(svg_content, encoding='utf-8')
        _generate_assets_json()
        return web.json_response({'status': 'ok', 'path': f'ccc_assets/{safe_group}/{filename}'})
    except Exception as e:
        return web.json_response({'status': 'error', 'message': str(e)}, status=500)

async def handle_save_image_project(request):
    """Imageタブのレイヤー編集状態（LayerManager.toJSON()）をサムネイルPNGとペアで
    assets/image/ に保存する。assets.json 生成時にこのペアが projectPath 付きの
    プロジェクトアセットとして認識される（_generate_assets_json 参照）。"""
    try:
        data = await request.json()
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
        model = data.get('model', 'gemini-3.1-flash-lite-image')
        prompt = data.get('prompt', '')
        negative_prompt = data.get('negative_prompt', '')
        num_images = data.get('num_images', 1)
        width = data.get('width', 1024)
        height = data.get('height', 1024)

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
            payload = {
                "contents": [{"parts": parts}],
                "generationConfig": {"imageConfig": {"aspectRatio": aspect_ratio}},
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
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode('utf-8'))
        result = await loop.run_in_executor(None, _post)
        return web.json_response(result)
    except urllib.error.URLError as e:
        return _error_response(CCCError('eagle_connection_error', f'Eagle接続エラー: {e.reason}', reason=str(e.reason)), status=502)
    except Exception as e:
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
        data = await request.json()
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

async def handle_gmic_start_server(request):
    try:
        bat_path = PLUGIN_DIR / 'app_server' / 'start_gmic_server.bat'
        if not bat_path.exists():
            return web.json_response({'detail': f'バッチファイルが見つかりません: {bat_path}'}, status=404)
        subprocess.Popen(
            ['cmd.exe', '/c', str(bat_path)],
            cwd=str(bat_path.parent),
            creationflags=subprocess.CREATE_NEW_CONSOLE,
        )
        return web.json_response({'status': 'ok', 'message': "G'MICサーバーを起動しました"})
    except Exception as e:
        return web.json_response({'detail': str(e)}, status=500)

async def handle_proxy_gmic(request):
    sub_path = str(request.rel_url)[len('/api/ccc/gmic'):]
    # start-server はプロキシではなくローカル処理
    if sub_path.startswith('/start-server'):
        return await handle_gmic_start_server(request)
    target_url = GMIC_SERVER_URL + '/api' + sub_path
    try:
        body = await request.read() if request.method == 'POST' else None
        loop = asyncio.get_event_loop()
        def _do():
            req = urllib.request.Request(target_url, data=body, headers={'Content-Type': 'application/json'}, method=request.method)
            with urllib.request.urlopen(req, timeout=310) as resp:
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
        "nanobanana/models":      handle_nanobanana_list_models,
        "app-server/settings":    handle_get_app_server_settings,
        "local-gmic/settings":    handle_get_local_gmic_settings,
    }
    _DISPATCH_POST = {
        "save-nanobanana-image":       handle_save_nanobanana_image,
        "save-group-asset":            handle_save_group_asset,
        "save-image-project":          handle_save_image_project,
        "delete-asset":                handle_delete_asset,
        "nanobanana/generate":         handle_nanobanana_generate,
        "eagle/add":                   handle_eagle_add,
        "app-server/settings":         handle_post_app_server_settings,
        "local-gmic/settings":         handle_post_local_gmic_settings,
        "local-gmic/open_in_gui_b64":  handle_local_gmic_open_b64,
        "local-gmic/result_b64":       handle_local_gmic_result_b64,
        "gmic/start-server":           handle_gmic_start_server,
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

class ComicCreater:
    @classmethod
    def add_routes(cls):
        app = PromptServer.instance.app

        # Ensure directories exist
        for d in [STATIC_DIR, ASSETS_DIR, OUTPUT_NANOBANANA_DIR, GMIC_TEMP_DIR]:
            d.mkdir(parents=True, exist_ok=True)

        # Static mounts
        app.router.add_static("/ccc_static",           str(STATIC_DIR))
        app.router.add_static("/ccc_assets",           str(ASSETS_DIR))
        app.router.add_static("/ccc_nanobanana_output", str(OUTPUT_NANOBANANA_DIR))
        app.router.add_static("/ccc_gmic_temp",        str(GMIC_TEMP_DIR))

        # SPA entry
        app.router.add_get("/ccc", serve_index)

        # GET APIs
        app.router.add_get("/api/ccc/refresh-assets",         handle_refresh_assets)
        app.router.add_get("/api/ccc/nanobanana/key",         handle_nanobanana_key)
        app.router.add_get("/api/ccc/nanobanana/models",      handle_nanobanana_list_models)
        app.router.add_get("/api/ccc/app-server/settings",    handle_get_app_server_settings)
        app.router.add_get("/api/ccc/local-gmic/settings",    handle_get_local_gmic_settings)
        app.router.add_get("/api/ccc/local-gmic/status/{job_id}", handle_local_gmic_status)
        app.router.add_get("/api/ccc/gmic/{tail:.*}",         handle_proxy_gmic)

        # POST APIs
        app.router.add_post("/api/ccc/save-nanobanana-image",    handle_save_nanobanana_image)
        app.router.add_post("/api/ccc/save-group-asset",         handle_save_group_asset)
        app.router.add_post("/api/ccc/save-image-project",       handle_save_image_project)
        app.router.add_post("/api/ccc/delete-asset",             handle_delete_asset)
        app.router.add_post("/api/ccc/nanobanana/generate",      handle_nanobanana_generate)
        app.router.add_post("/api/ccc/eagle/add",                handle_eagle_add)
        app.router.add_post("/api/ccc/app-server/settings",      handle_post_app_server_settings)
        app.router.add_post("/api/ccc/local-gmic/settings",      handle_post_local_gmic_settings)
        app.router.add_post("/api/ccc/local-gmic/open_in_gui_b64", handle_local_gmic_open_b64)
        app.router.add_post("/api/ccc/local-gmic/result_b64",    handle_local_gmic_result_b64)
        app.router.add_post("/api/ccc/gmic/start-server",        handle_gmic_start_server)
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

        print("[ccc] Comic Creater loaded → http://127.0.0.1:8189/ccc")
