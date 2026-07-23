# ComfyUI Comic Creator

**日本語** | [English](README_en.md) | [中文](README_zh.md)

ComfyUI 上で動作するマンガページ作成 SPA（シングルページアプリケーション）です。作品（ページグループ）単位でページを管理し、テンプレートからページを作成してコマに画像・フキダシ・テキスト・図形・3D ポーズを配置し、JPEG/PNG/WebP/PDF/EPUB 形式で出力できます。レイヤーベースの画像エディタ、フォント管理、AI 画像生成（Nanobanana）、脚本管理まで、マンガ制作に必要な作業をこのノード一つで完結することを目的としています。

![ComfyUI Comic Creator](docs/1_top.png)

## 主な機能

### ページ・作品管理

- **作品（ページグループ）単位の管理** — 幅・高さを持つ「作品」でページをまとめて管理。テンプレート挿入時に作品サイズへ自動リサイズ
- **テンプレート機能** — SVG インポートまたはウィザード（線を引いてコマを分割）でコマ割りテンプレートを作成・登録
- **出力** — JPEG/PNG/WebP/PDF/EPUB 形式で出力。複数ページの一括出力・連番ファイル名にも対応。ライブラリ（jsPDF/JSZip）は同梱のため全形式がオフラインでも出力可
- **解像度指定の出力サイズ自動計算** — 「解像度」セレクト（72〜600dpi）で作品サイズ（mm）から出力 px 値を自動計算（手動入力も可）。PDF は選択 dpi で換算され物理サイズ（A4 等）が維持される
- **出力メタデータ** — タイトル・著者・件名・キーワードを全形式に埋め込み（PDF=文書プロパティ / EPUB=Dublin Core / PNG=iTXt / JPEG・WebP=XMP）。解像度（dpi）も PNG=pHYs / JPEG=JFIF density / WebP=EXIF として常に埋め込まれ、3 形式で表示 dpi が一致する
- **一括バックアップ／復元** — 全作品・ページ・テンプレート・設定を 1 つの zip に保存し、いつでも復元（同名は上書きのマージ方式）

### レイアウトタブ

- **画像配置** — ドラッグ＆ドロップでコマに画像を挿入。ハンドルでリサイズ（通常は縦横比固定、Alt＋ドラッグで固定解除の自由変形）・回転
- **フキダシ** — 楕円・角丸矩形・思考・バクダン・雲（もこもこ／なみなみ）の形状をコマ内に配置。8 点リサイズハンドル対応。**テキストを内包**ボタンで、いずれの形状にもテキストを自動折返しで内包（縦書き対応、文字色、Google/システム/カテゴリのフォント選択、既存の内包テキストはダブルクリックで再編集）。アセットのカスタムSVGフキダシも配置後に塗り色・枠色を変更可能
- **テキスト** — 縦書き・横書き、Google Fonts / システムフォント、塗り・線・袋文字・影を設定できるスタイルモーダル。塗りは単色に加えグラデーション・テクスチャ・塗りなしに対応（レイアウト/Image タブ共通）
- **形状描画（ドロー）** — 矩形・楕円・直線・曲線・多角形・ベクター曲線・鎖・ロープ・My 曲線を SVG レイヤーに直接描画。多角形はクリックで頂点追加＋始点付近クリックで確定、ベクター曲線はクリックでノード追加してなめらかな曲線（スプライン）で結び、始点付近クリックで閉じたシェイプ、Enter キーで開いた線として確定。塗り（矩形・楕円・多角形・ベクター曲線等）は単色に加えグラデーション・テクスチャ（位置 X/Y 指定可、シェイプの移動・リサイズに追従）・塗りなしに対応。図形の PNG 変換もこれらの塗りをそのまま反映
- **3D ポーズ** — VRM/GLB/GLTF モデルをコマ内に配置してポーズを付け画像に焼き込み。視線ターゲット追従・揺れボーン物理にも対応（[comfyui-vrm-pose-editor](#依存関係任意) 連携）
- **グループ機能・レイヤーパネル** — オブジェクトのグループ化、重ね順、表示切替、ロック、**Delete / Backspace キーでの削除**
- **下書きレイヤー** — オーバーレイのさらに前面・ページ全体を覆う下書き専用レイヤー（画像のみ）。選択中（編集モード）のときだけプレビュー上でクリック・ドラッグ操作でき、それ以外は下のオーバーレイ／コマ／オブジェクトへクリックが透過。出力（JPEG/PNG/WebP/PDF/EPUB）には一切含まれない。Image タブの「下書き」ボタンで作品と同じ縦横比・72dpi 換算のキャンバスを作成し、「レイアウトに送る」で自動的にこのレイヤーへページ全面サイズで挿入される
- **I2I 連携** — 選択画像を Workflow Studio の Generate UI へ送信し、生成結果を呼び戻せる（[ComfyUI-Workflow-Studio](#依存関係任意) 連携）
- **PixiJS FX** — 「画像」サブタブから選択画像にパーティクル・フィルタ効果を適用（[comfyUI-particle-pixijs](#依存関係任意) 連携）
- **マンガツール** — 「ハーフトーン」（選択画像を網点変換する「画像を変換」、コマ/オーバーレイサイズの網点パターンのみ生成する「パターンを作成」の2モード）と「マンガ効果」（ヴィネット・スクリーントーンノイズ・集中線（放射状／ウニフラ／ウニ（輪）／線形の4種）をコマサイズの透過オブジェクトとして生成・挿入）の2モーダルを搭載。どちらも選択画像／デフォルト／白でプレビュー背景を切り替えて確認しながら調整可能

### Image タブ（レイヤーベース Canvas 2D エディタ）

- **Select / Text / Draw / Shape / Fill / Mask / Blur / Filter / BG Remove / Upscale** の各ツール
- **下書きキャンバス作成** — 「下書き」ボタン（New の右隣）で、サイズ入力ダイアログなしに、作業中の作品と同じ縦横比・72dpi 換算サイズのキャンバスを新規作成（ラフスケッチ用途）。「レイアウトに送る」でレイアウトタブの下書きレイヤーへページ全面サイズで挿入される
- **Draw ツールのスポイト** — カラーピッカー横のボタンでキャンバス上の色を直接ブラシカラーに設定
- **Shape ツールの Same Layer モード** — 図形を描くたびに新規レイヤーを作らず、同じレイヤーに重ね描き。矩形・楕円の塗りは単色に加えグラデーション・テクスチャに対応
- **Fill ツール** — 単色塗り／線形・円形グラデーション塗り（カラーランプ・方向パッド）
- **Mask ツール** — Paint/Color/Alpha/Text/Vector/Shape の各サブツール、SAM3 セグメンテーション・ABR ブラシにも対応（[comfyui-mask-editor-one](#acknowledgements) のツール構成を参考に実装）
- **PixiJS FX** — ツールバーのボタンからアクティブレイヤーにパーティクル・フィルタ効果を適用（[comfyUI-particle-pixijs](#依存関係任意) 連携）
- **レイヤーパネル** — 追加・複製・削除・重ね順変更・不透明度・調整レイヤー（明度/コントラスト/彩度など 12 種）
- **プロジェクト保存** — レイヤー構成をまるごと保存し、いつでも再編集を再開可能

### フォント管理

- Google Fonts・システムフォントのプレビュー、カテゴリ管理
- 塗り・線・袋文字・影をまとめた「スタイル」と、フォント＋サイズ＋スタイルの「プリセット」を作成・保存し、レイアウト/Image タブから即座に呼び出し

### Nanobanana（AI 画像生成）

- Gemini API を使った画像生成（Positive/Negative プロンプト・モデル・解像度指定）
- 生成画像は ComfyUI 本体の `output/cc_nanobanana` フォルダへ自動保存

### スクリプトタブ

- 作品名 → あらすじ → プロット［ページ → コマワリ（シーン・要素・セリフ/説明等）］の階層構造で脚本を管理
- コマワリの内容をワンクリックでレイアウトタブのテキストとして挿入

### 外部連携

- **Workflow Studio** — ギャラリーの埋め込み表示、I2I（画像→ワークフロー）双方向送受信
- **Eagle** — 生成・編集した画像を Eagle へ自動／手動保存
- **G'MIC** — G'MIC Qt GUI と連携したフィルタ編集

### その他

- **多言語 UI（i18n）** — 日本語・英語・中国語を設定タブで切り替え（ヘルプタブの全解説も 3 言語対応）
- **ヘルプタブ** — 全機能を網羅した検索可能なリファレンス

## インストール

### 手動インストール

ComfyUI の `custom_nodes/` 配下にこのフォルダを配置してください。

```
ComfyUI/
└── custom_nodes/
    └── comfyui-comic-creator/
        ├── __init__.py
        ├── py/
        ├── templates/
        ├── static/
        ├── web/
        └── assets/
```

このノードは追加の Python パッケージを必要としません（`aiohttp` / `Pillow` は ComfyUI 本体に同梱済み）。`requirements.txt` は不要です。

ComfyUI を再起動すると、トップバーに **CC** ボタンが追加されます。クリックすると新しいタブで Comic Creator（`/ccc`）が開きます。

<img src="docs/10_cc_topbar.png" width="400" alt="ComfyUI トップバーの CC ボタン">

### ComfyUI Manager

ComfyUI Manager の「Install via Git URL」から以下の URL を入力してインストールできます：

```
https://github.com/ketle-man/comfyui-comic-creator
```

## 任意設定

### Nanobanana（Gemini API）を使う場合

このフォルダ直下に `.env` ファイルを作成し、Gemini API キーを記載してください。

```
NANOBANANA_API_KEY=あなたのAPIキー
```

設定後は ComfyUI の再起動が必要です。

### G'MIC を使う場合

設定タブの「G'MIC設定」で、G'MIC Qt 実行ファイル（`gmic_qt.exe`）のフルパスを指定してください。保存後すぐに反映され、ComfyUI の再起動は不要です。

### Eagle 連携を使う場合

設定タブの「Eagle設定」で Eagle の API URL（デフォルト: `http://localhost:41595`）を確認・変更できます。Eagle アプリが起動している必要があります。

### 依存関係（任意）

以下のカスタムノードがインストールされていると、対応する機能が有効になります。未インストールでも他の機能には影響しません。

| 連携先                            | 有効になる機能                                     |
| --------------------------------- | -------------------------------------------------- |
| **comfyui-vrm-pose-editor** | レイアウトタブの 3D ポーズサブタブ                 |
| **ComfyUI-Workflow-Studio** | I2I 連携、workflow studio タブのギャラリー埋め込み |
| **comfyUI-particle-pixijs** | レイアウトタブ「画像」サブタブ・Image タブの PixiJS FX（パーティクル／フィルタ効果モーダル） |

## 使い方

1. トップバーの **CC** ボタンから Comic Creator を開く
2. 「ページ」タブの「作品管理」で作品名とサイズを入力して「新規作成」（レイアウトタブへ自動遷移）
3. レイアウトタブ左のアセットパネル「テンプレート」からテンプレートを選び「ページとして挿入」
4. コマに画像・フキダシ・テキストを配置して編集し、「保存」
5. ◀▶ のページ送りとテンプレート挿入を繰り返して複数ページを作成
6. 「ページ」タブの「出力」で形式・範囲を指定して保存

詳しい使い方はアプリ内の「ヘルプ」タブ（日本語・英語・中国語対応、検索機能あり）を参照してください。

## スクリーンショット

<p>
  <img src="docs/2_layout.png" width="260" alt="レイアウトタブ">
  <img src="docs/3_image.png" width="260" alt="Imageタブ">
  <img src="docs/4_font.png" width="260" alt="フォント管理タブ">
</p>
<p>
  <img src="docs/5_nanobanana.png" width="260" alt="Nanobananaタブ">
  <img src="docs/6_script.png" width="260" alt="スクリプトタブ">
  <img src="docs/7_help.png" width="260" alt="ヘルプタブ">
</p>
<p>
  <img src="docs/8_template_create.png" width="260" alt="テンプレート作成ウィザード">
  <img src="docs/9_wfmgallery.png" width="260" alt="workflow studio ギャラリータブ">
</p>

## アーキテクチャ

```
comfyui-comic-creator/
├── __init__.py              # ComfyUI拡張エントリ（WEB_DIRECTORY, ルート登録）
├── py/
│   ├── ccc.py                # aiohttp ルートハンドラ本体
│   └── config.py             # パス・定数定義
├── templates/
│   └── index.html            # SPA本体（静的HTML、data-i18n属性付き）
├── static/
│   ├── js/
│   │   ├── main/              # main.js分割ファイル群（状態管理・各タブロジック）
│   │   ├── image-tab.js       # Imageタブ コントローラ
│   │   ├── image-tab/         # Imageタブ専用ツール（DrawTool/ShapeTool/FillTool/MaskTool 等）
│   │   ├── i18n.js            # 多言語辞書（ja/en/zh）+ t()
│   │   ├── nanobanana.js      # Nanobanana（Gemini API）連携
│   │   ├── pixifx.js          # PixiJS FX連携
│   │   └── vendor/            # 同梱ライブラリ（jsPDF/JSZip、オフライン対応）
│   └── css/
├── web/comfyui/
│   └── ccc_menu.js            # ComfyUIトップバーへの起動ボタン登録
├── assets/                    # 同梱テンプレート・フキダシ・素材フォルダ
└── docs/                      # README用スクリーンショット
```

### API エンドポイント（抜粋）

| メソッド | パス                                    | 用途                         |
| -------- | --------------------------------------- | ---------------------------- |
| GET      | `/ccc`                                | SPA エントリポイント         |
| GET      | `/api/ccc/refresh-assets`             | アセット一覧の再生成         |
| POST     | `/api/ccc/nanobanana/generate`        | Nanobanana 画像生成          |
| POST     | `/api/ccc/save-image-project`         | Image タブのプロジェクト保存 |
| POST     | `/api/ccc/eagle/add`                  | Eagle への画像保存           |
| POST     | `/api/ccc/local-gmic/open_in_gui_b64` | G'MIC Qt GUI 起動            |
| GET      | `/api/ccc/local-gmic/status/{job_id}` | G'MIC ジョブ状態取得         |

## ライセンス

MIT License — 詳細は [LICENSE](LICENSE) を参照。

## Acknowledgements

- **[comfyui-vrm-pose-editor](https://github.com/ketle-man/comfyui-vrm-pose-editor)** — 3D ポーズ編集機能を提供するコンパニオンノード
- **[ComfyUI-Workflow-Studio](https://github.com/ketle-man/ComfyUI-Workflow-Studio)** — I2I 連携・ギャラリー埋め込み機能を提供するコンパニオンノード
- **[comfyUI-particle-pixijs](https://github.com/ketle-man/comfyUI-particle-pixijs)** — PixiJS FX（パーティクル・フィルタ効果）機能を提供するコンパニオンノード
- **[comfyui-mask-editor-one](https://github.com/ketle-man/comfyui-mask-editor-one)** — Image タブの Mask ツール・レイヤー機構の実装時に参考にしたノード
- [G&#39;MIC](https://gmic.eu/) — フィルタ編集機能（G'MIC Qt GUI、外部実行ファイル連携）
