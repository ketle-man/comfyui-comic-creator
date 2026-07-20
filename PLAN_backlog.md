# 作業計画バックログ

更新日: 2026-07-20（フォントタブのスタイル編集への塗り拡張UI追加 完了反映）

過去の計画書・調査・コード内 TODO を棚卸しし、未着手の作業を一元管理するためのファイル。
着手時は該当項目の「実装メモ」を出発点にし、完了したら「完了済み」へ移動して DEVLOG.md に詳細を記録する。

---

## 次回作業予定（この順で着手）

1. ドロー/シェイプの塗り拡張（下記「未着手 1」＝塗り拡張フェーズ2）
2. @imgly/background-removal のローカル同梱可否の判断（下記「未着手 2」。急ぎではない）

---

## 未着手

### 1. ドロー/シェイプの塗り拡張（塗り拡張フェーズ2）【次回作業】

- **出典**: 2026-07-20 依頼「塗りのグラデーション・テクスチャ・塗りなし対応」の後半。テキスト向けのフェーズ1は完了済み（下記「完了済み」参照）。
- **内容**: レイアウトタブのドロー図形（矩形・楕円・多角形等）と Imageタブのシェイプツールにも、同じ塗り設定（グラデーション・テクスチャ、可能なら塗りなし）を追加する。
- **実装メモ**: フェーズ1の資産を再利用する。
  - SVG側の適用は `09e-text-tool.js` の `_fontMgrApplyFillPaintToEl(el, svgEl, styleObj, k)` が text 以外の要素にもそのまま使える設計（第1引数は任意の要素）。ドロー図形はフォントサイズがないため、スケール係数 k の基準（図形サイズ比例か固定か）を決めること。
  - 保存時の defs 持ち回りは `_collectReferencedFilters`（`07-pages.js`）が fill/stroke の url() 参照対応済みのため追加作業不要。
  - Canvas側（Imageタブのシェイプ）は `image-tab.js` の `_textFillStyle` / `_getTextureImage` と同型のヘルパーを ShapeTool 向けに用意（または共通化）。
  - UI はスタイルモーダルの塗りセクション（`text-style-modal.js` の fillState＋ランプ＋テクスチャ選択）を部品化してドロー/シェイプのオプションパネルへ組み込むのが理想。最小構成ならドロー側に簡易版（モード切替＋ランプ）を複製でも可。
- **規模感**: 中

### 2. @imgly/background-removal のローカル同梱可否の判断 【要判断】

- **出典**: 「CDN 依存ライブラリのローカル同梱」（jsPDF/JSZip は 2026-07-20 同梱済み）の残件。
- **現状**: `static/js/main/16-processing-edit-tabs.js` / `static/js/image-tab.js` が `@imgly/background-removal@1.5.7` を esm.sh から動的 import（モデルデータは staticimgly.com から取得）。BG Remove（軽量モデル）で使用。
- **実装メモ**: 同梱するにはバンドル済みJSに加えてモデルデータ（数十MB）の同梱が必要でリポジトリが肥大化する。対応するか・ヘルプ明記のままにするかは別途判断（BiRefNet 連携（comfyui-mask-editor-one）でローカル背景除去は既にカバーされている点も考慮）。
- **規模感**: 中

---

## 完了済み（記録）

- **フォントタブのスタイル編集への塗り拡張UI追加**（2026-07-20 完了・承認済み）: 塗り拡張フェーズ1ではフォントタブのフォームが単色のみ対応（拡張塗りはモーダル側でのみ編集・保存時に持ち回るだけ）だった点を解消。`text-style-modal.js` と同じ塗りUI（塗りチェック/モードセレクト/グラデーションパネル/テクスチャパネル）を `templates/index.html` のフォントタブに追加し、`19-font-manager.js` に `_fontMgrFillState` ベースの実装（`_fontMgrSyncFillUI`/`_fontMgrDrawGradRamp`/`_fontMgrLoadFillState` 等）を移植。レイアウト/Image タブとフォントタブのどちらで編集・保存しても同じ `fontmgr_text_styles`（v2）を読み書きするため一覧・見た目が一致する。詳細は DEVLOG 2026-07-20。ヘルプ3言語更新済み。
- **テキスト塗りのグラデーション・テクスチャ・塗りなし対応（塗り拡張フェーズ1）**（2026-07-20 完了・承認済み）: スタイルモーダルに「塗り」チェックボックス（OFF=塗りなし）とモード切替（単色/グラデーション/テクスチャ）を追加。グラデーションは線形/円形・角度・カラーランプ、テクスチャは画像選択（最大512px縮小）＋スケール%。レイアウトのSVGテキスト（defs の linearGradient/radialGradient/pattern + fill=url）と Imageタブのテキストレイヤー（Canvas gradient/pattern）の両対応で、タイル・グラデ区間はサイズ相対の共通式により両者の見た目が一致。`_collectReferencedFilters` を fill/stroke の url() 参照にも一般化して保存・移動・PNG変換で定義を持ち回る。スタイルオブジェクトは `fillEnabled`/`fillMode`/`fillGradient`/`fillTexture` を追加（後方互換）。詳細は DEVLOG 2026-07-20。ヘルプ（レイアウトのテキスト・フォントのスタイル作成、3言語）・README 3言語更新済み。
- **CDN 依存ライブラリのローカル同梱（jsPDF/JSZip）**（2026-07-20 完了・承認済み）: cdnjs 配布物の jsPDF 2.5.1 / JSZip 3.10.1 min.js を `static/js/vendor/` に同梱し（cdnjs API の SRI ハッシュ照合で無改変を検証）、`templates/index.html` の `<script>` src をローカルパスへ差し替え。オフラインでも PDF/EPUB 出力・zip 保存・一括バックアップが動作する。出所・ライセンス・更新手順は `static/js/vendor/README.md` に記録。@imgly は残件（上記「未着手 1」）。ヘルプ「オフライン環境について」3言語・README 3言語・DEVLOG（2026-07-20）更新済み。

- **カスタムフキダシSVGの配置後 fill・stroke 変更**（2026-07-20 完了・承認済み）: アセット由来SVGは `<image href="data:image/svg+xml...">` として配置されるため、hrefのSVGテキストを書き換える方式で実現。適用ルールは「実効値が `none` 以外の要素の fill / stroke を一括置換（`none`＝穴・透明と `url()`＝グラデーション参照は維持）」。documentに一時追加して getComputedStyle で解決するため、CorelDRAW出力等のCSSクラス指定（`.fil0`/`.str0`）の色にも効く。実装: `static/js/main/08-panels-images.js`（`_isSvgImageEl` / `getSvgImageColors` / `applySvgImageColors` ＋ renderImageHandles でのピッカー同期）、`static/js/main/09a-balloon-init.js`（box-color / border-color 系4入力へのフック。フキダシ選択中は従来動作優先）。ヘルプ（フキダシSVG仕様の3言語）・README 3言語・DEVLOG（2026-07-20）更新済み。
- **BiRefNet 背景除去**: comfyui-mask-editor-one カスタムノード連携で実装済み（2026-07-19 確認・完了扱い）。Image タブのマスクツールは同ノードのツール構成（SAM3 セグメンテーション・ABR ブラシ等）を利用しており、BiRefNet による背景除去もこの連携でカバーされる。`static/js/main/16-processing-edit-tabs.js:201-206` のスタブ（`_procRemoveBackgroundBiRefNet`）は旧計画の名残であり、独立実装は行わない（UI から参照されていないか確認のうえ、いずれ削除してよい）。
- **多角形ペンツール共通化 → テンプレート作成優先実装**（`PLAN_polygon_pen_tool.md`）: 全フェーズ完了（テンプレート作成 2026-07-01 ライン分割方式 / レイアウトタブ多角形 2026-07-03 頂点クリック式）。計画書は経緯の記録として残置。
- **既存ライブラリで追加可能な機能の調査**（2026-07 中旬のセッションで実施）: 候補だった「jsPDF による PDF メタデータ設定」「JSZip によるプロジェクト一括バックアップ」の2件は **v1.4.0（2026-07-19）で実装完了**。実装時にメタデータは全形式対応（EPUB/PNG/JPEG/WebP）へ、さらに解像度指定による出力サイズ自動計算まで拡張した。詳細は DEVLOG 2026-07-19 の項を参照。
