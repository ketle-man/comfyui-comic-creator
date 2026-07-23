# 作業計画バックログ

更新日: 2026-07-23（レイアウトのドローに「ベクター曲線」追加、テクスチャ塗りの追従・位置指定・PNG変換時の欠落を修正）

過去の計画書・調査・コード内 TODO を棚卸しし、未着手の作業を一元管理するためのファイル。
着手時は該当項目の「実装メモ」を出発点にし、完了したら「完了済み」へ移動して DEVLOG.md に詳細を記録する。

---

## 次回作業予定（この順で着手）

現在、次回着手予定の項目はなし。新しい依頼が来たらここに追記する。

---

## 未着手

現在、未着手の項目はなし。

---

## 完了済み（記録）

- **レイアウトのドローに「ベクター曲線」追加、テクスチャ塗りの追従・位置指定・PNG変換時の欠落を修正**（2026-07-23 完了・承認済み）: 依頼「ImageタブのMask Vectorのようにベクター曲線を描きたい」を受け、既存の多角形ペンツール（直線で結ぶ）と対になる、Catmull-Romスプラインでなめらかに結ぶベクター曲線ツールを追加（クリックでノード追加、始点付近クリックで閉じたシェイプ、Enterキーで開いた線として確定）。ユーザーの検証過程で3件の既存不具合が連鎖的に見つかり同じ流れで修正: ①矩形・楕円・多角形はSVG属性を直接書き換えて移動するため、`patternUnits="userSpaceOnUse"`のテクスチャパターンが絶対座標に固定されシェイプに対して滑って見える問題（曲線・ベクター曲線は`transform`移動のため元々問題なし）→ 生座標→現在bboxへのアフィン変換を`patternTransform`として適用し統一、あわせてテクスチャ位置X/Yの手動指定にも対応。②`convertShapeToImage`（フキダシ「画像に変換」/ドロー「図形をPNG変換」共通処理）でクローンしたSVGに`<defs>`が複製されておらず`fill="url(#...)"`の塗りが消える不具合を修正。③同関数の余白計算が要素自身の`stroke-width`しか見ておらず、フキダシの枠線（子要素側にある）を大幅に下回る固定余白でクリッピングされる不具合を修正。詳細は DEVLOG 2026-07-23。ヘルプ・README 3言語更新済み。

- **3Dポーズ機能拡張（視線ターゲット/揺れ物理）**（2026-07-23 完了・承認済み）:
  対象ライブラリ `comfyui-vrm-pose-editor`（別カスタムノード、`comfyui-comic-creator`の3Dポーズタブが動的importで再利用）が同梱する `three-vrm.module.js`（three-vrm, three.js r160同梱）を調査。
  `VRMLoaderPlugin`（`pose_editor_core.js`が使用している完全版）は `springBonePlugin` と `lookAtPlugin` を内包しており、VRMロード時点で `vrm.lookAt`（VRMLookAt）と `vrm.springBoneManager`（VRMSpringBoneManager、VRMアセット自体に定義された髪・スカート等の揺れボーンがあれば生成）が**既に生成済み**、`VRM.update(delta)` が内部で両方を毎フレーム自動更新していることが判明。揺れ物理・視線追従は元々「配線されていないだけで中身は実装済み」の状態だった。
  - **① 視線ターゲット（LookAt）**: `pose_editor_core.js`にドラッグ可能なシアン色の3Dマーカー(`lookAtHelperMesh`)を追加。ON時は`vrm.lookAt.target`にこのマーカーを割り当て、目・頭が追従する。マーカーはcapture()時に自動非表示化。新モデル読込時にVRM0/VRM1の正面向きに応じた初期位置へ再配置。API: `hasLookAt()` / `getLookAtEnabled()` / `toggleLookAt()`。Kaptureで実機VRM相手にトグル・マーカー表示/非表示を確認済み。
  - **② 揺れ物理（SpringBone）**: 既存の自動シミュレーションはそのまま活かしつつ、(a) ポーズの瞬間切替（リセット/ポーズ読込/ミラー）直後に揺れボーンが「一瞬跳ねる」問題を、`springBoneManager.setInitState()`で新ポーズを基準に再アンカーして解消。(b) ON/OFFトグルは`capture()`で既に使われている「delta=0で一時停止」と同じ手法をアニメーションループに適用して実現（`_springBoneEnabled`フラグ）。API: `hasSpringBones()` / `getSpringBoneEnabled()` / `toggleSpringBoneEnabled()`。Kaptureで`hasSpringBones:true`のモデルにてトグル動作・エラー無しを確認済み。
  - **UI配線**: ComfyUIノード側（`pose_editor_3d.js`）に「👁 視線」「🎐 揺れ」トグルボタンを追加。SPA側（`templates/index.html`の3Dポーズサブタブ + `static/js/main/23-pose3d-bridge.js`）にも同等のボタンを追加し、i18n（`i18n.js`）に日英中3言語のタイトル文言を追加済み。
  - **擬似HDRI環境ライティングは不採用（実装後に削除）**: 当初、上空/地平線/足元の3色グラデーションをcanvas手続き生成→`THREE.PMREMGenerator`でIBL環境マップ化する方式（スタジオ/屋外/夕焼け/なしの4プリセット）を実装し`light_editor.js`にUIも追加したが、Kapture実機検証で**キャンバス全体に渡って1ピクセルも変化しないバグ**を発見。原因切り分けの結果、ユーザーの実ブラウザ環境で`OES_texture_half_float_linear`（half-floatテクスチャの線形フィルタリング）拡張が未対応で、`PMREMGenerator`がエラー無く空の環境マップを生成してしまうことが判明した（GPU/ドライバ依存で壊れやすい実装だった）。さらにVRMのMToonシェーダーは元々`envMap`/`scene.environment`を一切参照せずキャラ本体には影響しないため、直しても効果は Ground/BG Wall の反射のみに限定される。ユーザーが「Comic Creatorの用途にあまり効果がない」と判断し、機能ごと削除した（`pose_editor_core.js`のEnvironment lighting セクション・API、`light_editor.js`のEnvセレクトUI・プリセット永続化を全て除去）。**教訓**: [[vrm-pose-editor-architecture]] に記録済み。同種の環境マップ機能を将来検討する際は、まずGPU拡張(`OES_texture_half_float_linear`等)の実機確認から始めること。
  - **開発元フォルダへの反映**: `comfyui-vrm-pose-editor`のリリース用ソースは `C:\Users\statsu-11\Desktop\now_work\vrmpose_light_plus_2\3dpose_light_editor` で管理されており、ComfyUI実行環境の `custom_nodes/comfyui-vrm-pose-editor` とは別ディレクトリ（シンボリックリンクではない）。今回の変更3ファイル（`js/pose_editor_core.js` / `js/pose_editor_3d.js` / `js/light_editor.js`）をこちらへコピーしリリース準備を完了。なお反映作業中に、この3ファイル以外にも `js/pose_library.js` と `js/vendor/`（GLTFLoader.js / OrbitControls.js / three-vrm.module.js）が実行環境側とdev側で既に差分があることが判明したが、今回のタスク範囲外のため対象外とし、コピーしていない（別途ユーザー側で要確認）。詳細は DEVLOG 2026-07-23。ヘルプ・README 3言語・DEVLOG 更新済み。

- **フキダシ内包テキストの統合・縦書き対応・尻尾幅デフォルト変更**（2026-07-22 完了・承認済み）: 前日追加した「フキダシ+テキスト作成」（四角/角丸/楕円限定の新規シンプル形状）を、既存の尻尾付きフキダシ全形状（通常/角丸矩形/思考/バクダン/雲もこもこ/雲なみなみ）にも統合。「フキダシ形状の作成・調整」と「テキストの詳細設定（モーダル）」の導線は2つのまま維持し、ボタンは「テキストを内包」に役割変更（形状選択は削除、選択中フキダシへの内包・再編集専用）。縦書き対応を追加する過程で、`writing-mode="tb"`というSVG1.1属性値が現行ブラウザでは無効で機能していなかったバグを発見・修正（単独テキストツールの縦書きも同時に修正）。追加依頼でモーダルに文字色セレクト・Google/システム/カテゴリのフォントタブを追加、縦書き上下寄せの向き逆転バグを修正、尻尾幅パラメータのデフォルトを30°→13°に変更。詳細は DEVLOG 2026-07-22。ヘルプ・README 3言語更新済み。

- **@imgly/background-removal のローカル同梱可否の判断**（2026-07-21 完了・承認済み）: 実測の結果、CDN依存を解消するにはWASMランタイム＋ONNXモデルで最大約326MB（現行デフォルト設定の維持だけでも約95MB）が必要と判明。本リポジトリはGitHub公開リポジトリで単一ファイル100MB上限（largeモデル168MBは超過）もあるため、**同梱は見送りCDN依存を維持**し、代わりに**背景除去のモデル品質（小/中/大）をアプリ上で選べるセレクトを追加**する方針にユーザーと合意して実装した。レイアウトタブ（画像サブタブ）・Imageタブ（BG Removeツール）の両方に品質セレクトを追加し、`removeBackground()` の `model` オプションに反映。デフォルトは既存動作と同じ "medium" のため後方互換。詳細は DEVLOG 2026-07-21。ヘルプ（画像サブタブ・Imageタブのツール、日本語のみ）・README更新は対象外（ヘルプのみ）。

- **ドロー/シェイプの塗り拡張（塗り拡張フェーズ2）**（2026-07-21 完了・承認済み）: レイアウトタブのドロー図形（矩形・楕円・直線・曲線・多角形・鎖・ロープ・My曲線）とImageタブのシェイプツール（矩形・楕円）に、フェーズ1と同じ塗り設定（グラデーション・テクスチャ・塗りなし）を追加した。SVG側は `_fontMgrApplyFillPaintToEl`（09e-text-tool.js）をそのまま再利用し、選択中図形からの塗り状態再抽出は新設の `_drawShapeExtractFillState`（17c-layer-draw-handles.js）で行う。Canvas側（Imageタブ）は `ShapeTool.js` に `_fillStyleFor` を新設（`_textFillStyle` と同型、基準は図形自身のバウンディングボックス）。図形にはフォントサイズ相当の基準がないため、スケール係数は k=1固定（テクスチャのスケール%がそのままタイルサイズ）とした。詳細は DEVLOG 2026-07-21。ヘルプ（レイアウトの形状描画・Imageタブのツール、日本語のみ）・README 3言語更新済み。

- **フォントタブのスタイル編集への塗り拡張UI追加**（2026-07-20 完了・承認済み）: 塗り拡張フェーズ1ではフォントタブのフォームが単色のみ対応（拡張塗りはモーダル側でのみ編集・保存時に持ち回るだけ）だった点を解消。`text-style-modal.js` と同じ塗りUI（塗りチェック/モードセレクト/グラデーションパネル/テクスチャパネル）を `templates/index.html` のフォントタブに追加し、`19-font-manager.js` に `_fontMgrFillState` ベースの実装（`_fontMgrSyncFillUI`/`_fontMgrDrawGradRamp`/`_fontMgrLoadFillState` 等）を移植。レイアウト/Image タブとフォントタブのどちらで編集・保存しても同じ `fontmgr_text_styles`（v2）を読み書きするため一覧・見た目が一致する。詳細は DEVLOG 2026-07-20。ヘルプ3言語更新済み。
- **テキスト塗りのグラデーション・テクスチャ・塗りなし対応（塗り拡張フェーズ1）**（2026-07-20 完了・承認済み）: スタイルモーダルに「塗り」チェックボックス（OFF=塗りなし）とモード切替（単色/グラデーション/テクスチャ）を追加。グラデーションは線形/円形・角度・カラーランプ、テクスチャは画像選択（最大512px縮小）＋スケール%。レイアウトのSVGテキスト（defs の linearGradient/radialGradient/pattern + fill=url）と Imageタブのテキストレイヤー（Canvas gradient/pattern）の両対応で、タイル・グラデ区間はサイズ相対の共通式により両者の見た目が一致。`_collectReferencedFilters` を fill/stroke の url() 参照にも一般化して保存・移動・PNG変換で定義を持ち回る。スタイルオブジェクトは `fillEnabled`/`fillMode`/`fillGradient`/`fillTexture` を追加（後方互換）。詳細は DEVLOG 2026-07-20。ヘルプ（レイアウトのテキスト・フォントのスタイル作成、3言語）・README 3言語更新済み。
- **CDN 依存ライブラリのローカル同梱（jsPDF/JSZip）**（2026-07-20 完了・承認済み）: cdnjs 配布物の jsPDF 2.5.1 / JSZip 3.10.1 min.js を `static/js/vendor/` に同梱し（cdnjs API の SRI ハッシュ照合で無改変を検証）、`templates/index.html` の `<script>` src をローカルパスへ差し替え。オフラインでも PDF/EPUB 出力・zip 保存・一括バックアップが動作する。出所・ライセンス・更新手順は `static/js/vendor/README.md` に記録。@imgly は残件（上記「未着手 1」）。ヘルプ「オフライン環境について」3言語・README 3言語・DEVLOG（2026-07-20）更新済み。

- **カスタムフキダシSVGの配置後 fill・stroke 変更**（2026-07-20 完了・承認済み）: アセット由来SVGは `<image href="data:image/svg+xml...">` として配置されるため、hrefのSVGテキストを書き換える方式で実現。適用ルールは「実効値が `none` 以外の要素の fill / stroke を一括置換（`none`＝穴・透明と `url()`＝グラデーション参照は維持）」。documentに一時追加して getComputedStyle で解決するため、CorelDRAW出力等のCSSクラス指定（`.fil0`/`.str0`）の色にも効く。実装: `static/js/main/08-panels-images.js`（`_isSvgImageEl` / `getSvgImageColors` / `applySvgImageColors` ＋ renderImageHandles でのピッカー同期）、`static/js/main/09a-balloon-init.js`（box-color / border-color 系4入力へのフック。フキダシ選択中は従来動作優先）。ヘルプ（フキダシSVG仕様の3言語）・README 3言語・DEVLOG（2026-07-20）更新済み。
- **BiRefNet 背景除去**: comfyui-mask-editor-one カスタムノード連携で実装済み（2026-07-19 確認・完了扱い）。Image タブのマスクツールは同ノードのツール構成（SAM3 セグメンテーション・ABR ブラシ等）を利用しており、BiRefNet による背景除去もこの連携でカバーされる。`static/js/main/16-processing-edit-tabs.js:201-206` のスタブ（`_procRemoveBackgroundBiRefNet`）は旧計画の名残であり、独立実装は行わない（UI から参照されていないか確認のうえ、いずれ削除してよい）。
- **多角形ペンツール共通化 → テンプレート作成優先実装**（`PLAN_polygon_pen_tool.md`）: 全フェーズ完了（テンプレート作成 2026-07-01 ライン分割方式 / レイアウトタブ多角形 2026-07-03 頂点クリック式）。計画書は経緯の記録として残置。
- **既存ライブラリで追加可能な機能の調査**（2026-07 中旬のセッションで実施）: 候補だった「jsPDF による PDF メタデータ設定」「JSZip によるプロジェクト一括バックアップ」の2件は **v1.4.0（2026-07-19）で実装完了**。実装時にメタデータは全形式対応（EPUB/PNG/JPEG/WebP）へ、さらに解像度指定による出力サイズ自動計算まで拡張した。詳細は DEVLOG 2026-07-19 の項を参照。
