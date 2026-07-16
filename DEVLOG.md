# DEVLOG — comfyui-comic-creater

---

## 2026-07-16（PixiJS FXモーダルのi18n対応）

ユーザーからの「レイアウトタブ・イメージタブのPixiJS FXのi18n化を確認して」という依頼を受けて調査→修正を実施。

**調査結果**: レイアウトタブ側のブリッジ処理（`main/15-pixifx-bridge.js`）は既にt()経由で完全対応済みだった一方、以下2点が未対応と判明した。
1. `pixifx.js`（レイアウト/Imageタブ共通で使われるPixiJS FXモーダル本体、940行）が**ファイル全体を通してt()呼び出しが一つも無く**、パーティクル種類の選択肢・ラベル・トグルボタン・アラート・キャンバス描画テキストまで全て日本語ハードコードだったため、言語設定を英語/中国語にしてもモーダルだけ常に日本語表示になっていた。
2. `image-tab.js`の`_openPixiFx()`のトースト文言が英語ハードコードで、既存の`image.pixifxNotLoaded`/`image.pixifxApplyError`キーが定義済みなのに使われていなかった（同ファイルの他メソッドはt()を使っているのにこの関数だけ取り残されていたパターン、G'MICブロックの取りこぼしと同種）。

**実装**: `i18n.js`に新規`pixifx.*`名前空間（52キー）をja/en/zh 3言語に追加し、`pixifx.js`の全ハードコード文字列をt()呼び出しに置換。`image-tab.js`の`_openPixiFx()`は既存キーへの置換＋不足していた`image.noImageLoaded`/`image.noActiveLayer`/`image.pixifxApplied`を新規追加。`index.html`のPixiJS FXボタン（レイアウト/Image両方）は可視ラベルにも`data-i18n`を付与し、他の同種ボタン（G'MIC等）と表記を統一（値自体は「✨ PixiJS FX」でブランド表記のため全言語共通）。

**検証**: `node --check`で3ファイルとも構文エラーなし。Node vmで`LANGUAGES`オブジェクトを読み込み、`pixifx.*`関連52キーがja/en/zh間で欠落なく完全一致することと、コード内の全`t('...')`呼び出しキーがja辞書に存在することを機械検証。

**How to apply**: 複数タブから共通で開かれる大きめのモーダル（今回のpixifx.jsのような外部カスタムノード連携UI）は、実装時にi18n対応を後回しにしたまま放置されがちなので、新規モーダルを追加した際は完成時に必ずi18n対応をチェックリストに含めること。トースト/アラート文言を追加する際は、まず既存の近い意味のキー（`image.pixifx*`等）が無いか確認してから再利用し、無ければ命名規則（タブ/機能単位のドット区切り）に従って新規キーをja/en/zh同時に追加すること。

---

## 2026-07-16（リリース前最終チェック: メモリリーク修正・セキュリティ再監査・スクリーンショット/ファビコン準備）

近日リリースに向けた最終セッション。ページタブのメモリリーク修正、セキュリティ再監査、README整備、スクリーンショット・ファビコン作成をまとめて実施した。

**README依存関係の整理**: `comfyUI-particle-pixijs`（実行時に動的import、PixiJS FX機能を提供）と`comfyui-mask-editor-one`を3言語README（README.md/README_en.md/README_zh.md）に追加。当初「依存関係（任意）」テーブルに両方載せたが、コードを確認したところ`mask-editor-one`は実行時の外部依存ではなく、Imageタブの Mask ツール（`MaskEditorOneTools.js`ほか）実装時にコードを参考にした移植元（ソース内コメントに"Inspired by"と明記）だったため、テーブルから外しAcknowledgementsのみに整理し直した。「依存関係（任意）」テーブルは「インストールで機能が有効になるもの」に限定する方針。

**ページサムネイルの重大メモリリーク修正**（9ページ程度の作品を切り替えると "Not enough memory to open this page" でクラッシュ、というユーザー報告を受けて調査）: `dbPut()`（`00-db.js`）がページ保存時に生成する「サムネイル」の実体が、`buildMergedSvg()`で挿入画像（base64込み）を全部合成したページ全体のSVGを、リサイズも圧縮もせずそのまま`data:image/svg+xml`のURLにしていただけだったことが判明。作品を切り替えるたびにブラウザがフルサイズ画像入りSVGを何枚もデコードし直すことになり、画像デコードキャッシュとGCが追いつかずメモリが枯渇していた。
- 対応: `_rasterizeSvgThumb(svgText, width, height)`を新設し、canvas経由で長辺320px・JPEG品質0.75（透過部分は白背景合成）にラスタ化してから`data.thumb`へ保存する方式に変更。`dbPut`を非同期化。
- 既存データのマイグレーション: `_getOrBuildPageThumb`（`11a-work-manager.js`）が、キャッシュ済み`thumb`が旧形式（`data:image/svg+xml`始まり）かどうかを判定し、旧形式なら再生成・書き戻す。ページを一度表示するだけで自動的に軽量なJPEGへ移行する。
- Kaptureで実機確認済み（保存後・タブ切替後も一貫してJPEG形式のサムネイルが維持されること、新規JSエラーが無いこと）。

**image-tab.jsのカテゴリ名i18n対応**: Imageタブのテキストツール「カテゴリ」セレクトが`localStorage`を直接読むため、予約カテゴリ「お気に入り」がen/zh UIでも日本語の生キーのまま表示されていた問題を修正。`_fontCatLabel(cat)`ヘルパーを追加し、`window._fontMgrCatLabel`（main.js側、function宣言なのでwindow経由で呼べる）があれば通す方式（`window._fontMgrGoogleList`と同じ既存パターン踏襲）。Kaptureで日英切替の実機確認済み（予約カテゴリのみ翻訳され、ユーザー定義カテゴリ名はそのまま表示）。

**セキュリティ再監査**: リリース前の再チェック依頼を受け実施。このプロジェクトはgitリポジトリではないため`/security-review`がそのままでは動かず、`comfyui-comic-creater/`配下で`git init`→空コミットをbase originとしてpush→現状全体を差分としてdiffベースを作る、という一時リポジトリ手順（レビュー後`.git`削除）で実施した。同梱予定の素材アセット（`assets/`配下のsvg/png/rar）は別配布のため`.gitignore`へ除外パターンを追加してから対象にした。マルチエージェントで検証し、confidence 8-9/10の2件を検出・修正:
1. **G'MICパス未検証によるRCE**（`py/ccc.py`）: `POST /api/ccc/local-gmic/settings`が`gmicQtPath`を無検証で保存し、`subprocess.Popen(args, ...)`の`args[0]`としてそのまま使われていた。認証もCSRF対策も無いため、LAN攻撃者や「ComfyUI起動中に開いた悪意サイト」（`Content-Type: text/plain`のfetchはCORSプリフライトを回避でき、aiohttpの`request.json()`はContent-Typeを見ずボディをJSONパースするため盲目的書き込みが成立する）からUNCパスを設定させ`open_in_gui_b64`を叩くだけでRCEに直結する経路だった。`_validate_local_exe_path()`ヘルパーを新設（`_validate_local_url`と同じ並びに配置）し、UNCパス拒否＋`os.path.isfile()`による実在確認を必須化。`CCCError`として`_error_response(e, status=400, key='detail')`で返す（同ファイルの既存local-gmic系ハンドラの形式に合わせた）。クライアント側（`14-integrations.js`）はcatchで`e.message`（サーバーの具体的な理由）を優先表示するよう変更。curlで実機確認済み（UNCパス→400 `exe_path_unc_forbidden`、不存在パス→400 `exe_path_not_found`、実在パス→200 `exists:true`、空文字→200許可）。
2. **Stored XSS（アセットファイル名未サニタイズ）**（`py/ccc.py` + `02-assets.js`）: `handle_save_group_asset`は`group`名は`re.sub(r'[\\/:*?"<>|]', '_', ...)`でサニタイズするが`filename`には同じ処理がなく（兄弟関数`handle_save_image_project`は正しく適用済みで実装漏れ）、`_safe_path()`は`os.path.basename()`＋トラバーサルチェックのみで`<`/`>`/`"`等は素通りしていた。結果がアプリ起動時に無条件で呼ばれる`renderAssetTree()`で`asset.name`/`asset.path`をエスケープなしで`innerHTML`テンプレートリテラルに直接埋め込んでいたため、POSIXファイルシステム上では属性脱出→スクリプト注入が可能だった（Windows/NTFSでは`<`/`>`/`"`がファイル名に使えないため無効化されるが、ComfyUIはLinux/Docker運用も一般的）。`handle_save_group_asset`の`filename`にも同じサニタイズを追加し、多層防御として`02-assets.js`側で既存の`_escHtml`ヘルパー（`21-script-tab.js`定義）を使いエスケープしてから`innerHTML`に埋め込むよう変更。

**How to apply（メモリリーク）**: サムネイル・プレビュー用途で画像やSVGをdata URL化する新規実装をする際は、必ず実際にラスタ化・縮小してから保存すること（「SVGだから軽い」とは限らない——中に埋め込まれたラスタ画像の解像度がそのまま効いてくる）。

**How to apply（セキュリティ）**: `subprocess.Popen`/`subprocess.run`に渡す実行ファイルパスを設定として受け付ける新機能は必ず`_validate_local_exe_path()`を通すこと。ユーザー入力由来のファイル名を新規保存するハンドラは兄弟関数のサニタイズパターンを必ず踏襲すること。クライアント側で`innerHTML`にサーバー由来の文字列を埋め込む新規UIは`_escHtml`（`21-script-tab.js`）または`_esc`（`19-font-manager.js`）を必ず通すこと（このアプリはReact/Angular等の自動エスケープ機構を持たない素のJS+`innerHTML`実装のため埋め込み側の対策が必須）。

**リリース準備: スクリーンショット・ファビコン作成**:
- `demo-capture`スキルの手順（Kaptureでの撮影＋`curl.exe`でpreview URLを保存）に沿って、英語UIで10枚のスクリーンショットを`docs/`配下に作成: `1_top.png`〜`7_help.png`（README記載済みの7タブ）に加え、`8_template_create.png`（テンプレート作成ウィザードモーダル）・`9_wfmgallery.png`（workflow studioギャラリータブ）・`10_cc_topbar.png`（ComfyUIトップバーのCCボタン）を追加し3言語READMEに反映。
- モーダル単体のクロップはKaptureの`selector`指定キャプチャでは座標がずれる不具合を確認（`elements`で取得した`bounds`とスクリーンショットの実ピクセル座標が一致しなかった）。フルスクリーンショットを取得し、Pillow（`numpy`併用）でエッジ検出して実測ピクセル境界を特定→`ffmpeg`の`crop`フィルタで正確にクロップする方式に切り替えて解決。
- 作業中に発見: Nanobananaタブの画像プレビューが`alt="生成結果プレビュー"`という日本語ハードコードのままだった（他のalt属性は無かったため見落とされていたi18n対象）。`i18n.js`の`applyI18nToHtml()`に`[data-i18n-alt]`のサポートを新設（`data-i18n`/`data-i18n-placeholder`/`data-i18n-title`と同じパターン）し、`nb.resultPreviewAlt`キーを3言語追加して対応。
- ファビコン: ComfyUI（黒地・白"C"）ともWorkflow Studio（青地・白"W"）とも衝突しない色・同じ「角丸バッジ＋白抜きロゴ」の作法を踏襲する方針で6候補（"CC"モノグラム×4色＋吹き出しモチーフ＋コマ割りグリッドモチーフ）をSVGで作成し、Artifactでタブモック付きプレビューページを作ってユーザーに選定してもらった（マゼンタ`#dd4592`の"CC"モノグラムを採用）。
  - **ハマった点**: ImageMagickの`-background none`でSVG→PNGレンダリングすると1-bitアルファ（透明/不透明の2値）になり、角丸のアンチエイリアス部分が不透明な白として焼き込まれ、favicon表示で「角が白い」症状になった。`-background transparent`に変更し、PillowでPNG→ICO変換（`Image.save(..., sizes=[...])`）することで正しいフルアルファのマルチサイズICOを生成し解決。SVG本体にも`width`/`height`属性を明示（`viewBox`のみだとブラウザ間で解釈がブレる場合があるため）。
  - `static/favicon.svg`（メイン）・`static/favicon.ico`（16/32/48/64/128/256pxマルチサイズ、レガシー互換）・`static/apple-touch-icon.png`（180px）を配置し、`templates/index.html`の`<head>`にlinkタグ3種を追加。

**教訓（画像クロップ・透過検証）**: KaptureのDOM要素`bounds`とスクリーンショットの実ピクセル座標は必ずしも一致しない（原因未特定、DPRやレンダリングタイミングの可能性）。要素単位の正確なクロップが必要な場合は、フルスクリーンショットを撮ってPillow/numpyでエッジのピクセル値を直接スキャンし実測するのが確実。透過PNG/ICOの検証も同様に、目視やImageMagickの`-composite`合成では判断を誤ることがあるため（本セッションでも`-composite`の結果がおかしく見えるケースがあった）、Pillowで`getpixel()`によりアルファ値を直接読むのが最も確実。

**GitHub公開（初回リリース）**: 上記の修正・準備が完了した後、ユーザー承認のもと`comfyui-comic-creater`を`git init`→初回コミット→`gh repo create ketle-man/comfyui-comic-creater --public --source=. --remote=origin --push`でGitHub公開（他の姉妹プロジェクトと同じpublic設定）。`.gitignore`により`.env`/`settings.json`/`__pycache__`等が正しく除外されていることを`git status`で確認してからコミットした。公開直後、3言語READMEの`<your-repo-url>`プレースホルダーを実URL（`https://github.com/ketle-man/comfyui-comic-creater`）に置き換え、Acknowledgements内の4つのコンパニオンノード名（comfyui-vrm-pose-editor/ComfyUI-Workflow-Studio/comfyUI-particle-pixijs/comfyui-mask-editor-one）も実在する公開リポジトリへのリンクに変更する追いコミットをpush。

**How to apply（今後の公開作業）**: このプロジェクトのようにgitリポジトリ化されていない状態からGitHub公開する際は、`git init`直後に必ず`git status`で除外ファイル（APIキー・ローカルパス設定・実行時生成物）が意図通り除外されているか確認してからコミットすること。公開設定（public/private）は不可逆に近い意思決定のためユーザー確認必須。

**GitHub Release作成**: リポジトリ公開直後は`git tag`/`gh release`をまだ作っておらず「Releases」タブが空の状態だった（`git push`しただけではGitHub Releaseは作成されない）ため、ユーザー指摘を受けて追加対応。`git tag -a v1.0.0 -m "..."` → `git push origin v1.0.0` → `gh release create v1.0.0 --title "..." --notes "..."`で作成（https://github.com/ketle-man/comfyui-comic-creater/releases/tag/v1.0.0 ）。リリースノートは機能一覧をREADMEから要約し、日本語本文＋英語summaryを併記。

**ComfyUI Manager PR提出**: `comfyui-registry`スキルのステップ1に従い、`ltdrdata/ComfyUI-Manager`をフォーク済み（`ketle-man/ComfyUI-Manager`）→上流に同期→シャロークローンでブランチ作成→`custom-node-list.json`の既存ketle-manエントリ群（comfyui-mask-editor-one等）の直後にPythonの文字列置換で新規エントリを挿入（`json.dump`での全体再フォーマットは差分が巨大になるため避けた）→JSON妥当性を`json.load`で検証→PR作成。PR: https://github.com/Comfy-Org/ComfyUI-Manager/pull/3086 。**ユーザー方針でPR承認をしばらく待ってからComfyUI Registry（registry.comfy.org）公開のステップ2に進む**（`pyproject.toml`新設・GitHub Actions・`REGISTRY_ACCESS_TOKEN`のSecret登録が必要、詳細は`comfyui-registry`スキル参照）。

**How to apply（Manager PR）**: `custom-node-list.json`のような巨大JSONに1エントリ追加する際は、既存の同一authorのエントリ群の直後に文字列置換で挿入すると差分が最小かつ可読性も良い。挿入後は必ず`json.load`で構文検証してからコミットすること。

---

## 2026-07-15（requirements.txt要否調査 + README/LICENSE/docs新設、3言語対応）

**requirements.txt調査**: `py/ccc.py`・`py/config.py`の全importを洗い出し、標準ライブラリ／ComfyUI本体同梱済み（`aiohttp`, `PIL`）／ComfyUI内部モジュール（`server`, `folder_paths`）のいずれかであることを確認。唯一のサードパーティ任意依存`jinja2`も`ImportError`を捕捉するフォールバック実装済みな上、`templates/index.html`にJinja構文（`{{ }}`）が一切存在せず現状無意味な依存であることが判明。同環境の`comfyui-workflow-studio`（本当に追加依存があるノード）の`requirements.txt`と比較し、comic-createrには追加依存が無く**requirements.txt不要**と結論。

**README/LICENSE/docs新設**: `comfyUI-mask-editor-one`のREADME構成（`README.md`/`README_en.md`/`README_zh.md`の3ファイル分割、`docs/`フォルダへのスクリーンショット配置、機能一覧→インストール→任意設定→使い方→スクリーンショット→アーキテクチャ→ライセンスの章立て）を参考に、comic-creater初のREADME一式を作成。

- ライセンスはユーザー確認の上MIT（Copyright: Statsu）。`LICENSE`ファイルを新設
- gitリポジトリ未作成・GitHub未公開のため、「ComfyUI Manager経由インストール」節は`<your-repo-url>`のプレースホルダーとし、実在しないURLを記載しないよう配慮（`comfyui-vrm-pose-editor`/`ComfyUI-Workflow-Studio`への言及も実URL不明のためリンク無しの太字表記に留めた）
- `docs/`フォルダを新設（空、スクリーンショットはユーザーが別途配置予定）。README内では`docs/1_top.png`〜`docs/7_help.png`の連番命名でプレースホルダー参照
- 機能一覧はこれまでのセッションで実装・翻訳してきたヘルプタブ内容（レイアウト/Image/フォント/Nanobanana/スクリプト/外部連携）を基に、README向けに簡潔な箇条書きへ再構成

**How to apply:** README内で言及する外部リポジトリ（コンパニオンノードや自身のリポジトリ）のURLが未確定の場合は、実在しない/推測のURLを記載しないこと（プレースホルダーは`<...>`形式か、リンクなしの太字表記に留める）。公開・URL確定後にプレースホルダー2箇所（インストール節・Acknowledgements節）を更新すること。requirements.txtの要否は「ComfyUI本体が保証する依存かどうか」で判断でき、同環境の他カスタムノードのrequirements.txtと見比べる（`aiohttp`/`Pillow`/`numpy`等は書かない、が典型パターン）。

---

## 2026-07-15（i18n Phase 4完了: G'MIC/Eagle/Nanobananaのバックエンドエラーメッセージを多言語化）

前回セッションで見積もった「方式1（エラーコード方式）」でPhase 4に着手・完了した。バックエンドはユーザー向け文言を持たず機械可読な`error_code`のみを返し、表示文言は既存の`i18n.js`の`t()`で組み立てる設計。

**スコープの絞り込み**: 当初`py/ccc.py`内には日本語/英語混在のユーザー向け文言が多数見つかったが、実際にフロントエンドまで到達し画面に表示されるものだけに対象を絞った。調査の結果、以下が判明:
- `handle_proxy_gmic`/`handle_gmic_start_server`（リモートG'MICサーバー用プロキシ）は、現行フロントに呼び出し元が一切なく**完全に到達不能なデッドコード**（`/api/ccc/gmic/*`をfetchする箇所がゼロ）。翻訳対象から除外。
- `saveToEagle()`は現状`data.status === 'success'`の真偽値だけを返し、**バックエンドの`message`は握りつぶされて画面に一切出ていなかった**（Eagle接続エラー等は事実上サイレント失敗）。合わせて修正（後述）。
- アセット/グループ/プロジェクト保存系ハンドラの「〜field required」「invalid folder」等は、フロントが常に正しいデータを送るため通常操作では到達しない防御的ガードのため対象外。

**実装（`py/ccc.py`）**: `CCCError(code, message, **params)`例外クラスと`_error_response(e, status, key)`ヘルパーを新設。`message`フィールドは日本語のまま残し（サーバーログ・APIデバッグ用、ja基準というプロジェクト全体の方針を踏襲）、`error_code`/`error_params`を追加するだけの最小差分にした。対象14箇所: URL検証3種（`_validate_local_url`）、G'MIC Qt未設定・キャンセル・画像必須・ジョブ未検出・結果パス必須・無効パス（×2）・結果ファイル未検出、Eagle接続エラー・ファイル未検出、Nanobanana APIキー未設定（×2箇所）。G'MICジョブの進行中メッセージ（「編集中...」「起動中...」）にも`message_code`を追加し、`_gmic_jobs`辞書・`handle_local_gmic_status`のレスポンスに`error_code`/`error_params`/`message_code`を含めた。

**実装（フロントエンド）**: `i18n.js`に`err.*`名前空間で15キー×3言語（45文字列）追加し、`resolveBackendError(errorCode, errorParams)`ヘルパーを新設（`error_code`のsnake_caseを`err.xxxCamelCase`キーに変換し`t()`へ委譲、paramsはオブジェクトの値を位置引数として展開）。呼び出し側は`resolveBackendError(...) || 既存の日本語フォールバック`の形でチェーンし、コードが無い（＝未対応の例外）場合は自然に既存の多言語化済みフォールバック文言に落ちる設計。修正箇所: `14-integrations.js`（`gmicWaitForJob`のstatus.error/message、`gmicOpenGui`/`gmicInsertResult`のerr.detail、`saveToEagle`の戻り値を`boolean`から`{ok, message}`に変更）、`image-tab.js`（同型の重複G'MIC実装`_gmicWaitForJob`/`_gmicOpenGui`、`_saveToEagle`の呼び出し元更新）、`nanobanana.js`（生成失敗時のエラー表示）。

**検証**: Python構文チェック（`py_compile`）、JS構文チェック（`node --check`、i18n.js/image-tab.js/nanobanana.js/14-integrations.js）、Node vmで`py/ccc.py`が発行する全15 error_code（`grep CCCError`で洗い出し）がja/en/zh全言語のi18nキーとして存在することを機械検証（不足ゼロ）、`resolveBackendError()`をNode上で実際に呼び出しparams付き/無し・言語切替・未知コードのフォールバック動作を確認。**ただしPythonコードの変更はComfyUI再起動後に反映されるため、実機（G'MICダイアログ・Eagle接続エラー等の実表示）確認はユーザー再起動後に持ち越し**。

**残タスク**: なし（元々のPhase 4スコープは完了）。ただし調査中に副次的に発見した既存の問題2件は今回のスコープ外として見送った: (1) `image-tab.js`のG'MICセクション（`_gmicOpenGui`/`_gmicApplyResult`）は元々多数のトースト文言がハードコード英語のままで`t()`化されておらず、Phase 2④（Image連携）が完了したはずの時点でこのG'MICブロックだけ取りこぼされていたと見られる（Fillツール同様の「後から追加され翻訳されなかった」パターン）。(2) `saveToEagle()`のfire-and-forget呼び出し3箇所（`image-tab.js`のG'MIC自動保存、`nanobanana.js`、`14-integrations.js`のG'MIC自動保存）は戻り値を見ていないため、Eagle保存失敗時にユーザーへは何も通知されない（今回`{ok,message}`を返すようにしたので、通知したければ各呼び出し元で`.ok`をチェックするだけで対応可能）。

**How to apply:** 今後`py/ccc.py`に新しいユーザー向けエラーを追加する際は、`raise CCCError('snake_case_code', '日本語メッセージ', param1=val1, ...)`のパターンに従い、`i18n.js`のja/en/zh 3箇所に`'err.snakeCaseCodeのcamelCase版'`キーを追加すること（Node vmでの機械検証スクリプトを再利用すれば取りこぼしを防げる）。フロント側で新たにエラーレスポンスを表示する箇所を書く際は、常に`resolveBackendError(data.error_code, data.error_params) || data.message || 既存の翻訳済みフォールバック`の順でチェーンする。「到達可能かどうか」の判断（デッドコードか、実際に画面に表示されるか）を最初に済ませてから着手すると、翻訳すべき対象を無駄なく絞り込める。

---

## 2026-07-15（機能追加4件 + i18n Phase 3完全完了: ヘルプ訳抜け修正・付録4件翻訳）

前回セッション（7/14 I2I連携）以降のユーザー要望に対応する形で、Imageタブ・レイアウトタブ・Nanobananaタブに小粒の機能を4件追加し、その後i18n（多言語化）の残作業を確認して着手した。

**機能追加（詳細は各コード参照、ヘルプ22-help-tab.jsのja版は都度更新済み）**:
- Imageタブ Drawツール: カラーピッカー右隣に**スポイトボタン**を追加（`image-tab.js`）。押下でカーソルがスポイト形状（インラインSVGのカスタムカーソル）になり、キャンバスクリックで合成表示キャンバス（`ie-canvas-draw`）から`getImageData`で色を取得しブラシカラーに設定。クリック後・Escキーで自動的にOFFに戻る。
- レイアウトタブ: 選択中オブジェクト（画像・フキダシ・テキスト・図形・グループ）を**Delete/Backspaceキーで削除**できるように（`05-groups-move.js`に`deleteSelectedObject()`/`initLayoutDeleteShortcut()`新設、`01-state.js`から呼び出し）。`duplicateSelectedObject()`と同じ優先順位判定ロジックを流用し、`_isObjectLocked()`でロック中は無効化。
- Imageタブ Shapeツール: **Same Layerトグル**（オプションバー左端、Shapeドロップダウンの左隣、デフォルトON）を追加。ONだと同一シェイプレイヤーへの重ね描きを継続し、OFF（または別レイヤーに切替後）だと従来通り描画のたびに新規レイヤーを作成（`image-tab.js`）。
- Nanobananaタブ: 生成画像の保存先を、プラグイン内`output/nanobanana`から**ComfyUI本体のoutputフォルダ配下`cc_nanobanana`**（`folder_paths.get_output_directory()`基準）に変更（`py/config.py`の`OUTPUT_NANOBANANA_DIR`のみ変更、ルート・保存処理は無改修）。既存生成画像8件を新フォルダへ移動済み。設定はComfyUI再起動後に反映（ユーザーがStabilityMatrix経由で再起動）。
- 不要フォルダの削除: 上記変更で不要になった`comfyui-comic-creater/output/nanobanana`（空）、コード上どこからも参照されていなかった`comfyui-comic-creater/output/comfyui`（空）・`comfyui-comic-creater/data/`（`workflows/flux2Klein9BImageEdit_v10.json`等、未参照）をユーザー確認の上で削除。

**i18n Phase 3の「訳抜け」発覚と修正**: 上記4機能のヘルプ追記後、ユーザーから「i18n化作業の残りを確認して順に作業したい」と依頼があり調査したところ、Phase 3（2026-07-12、ヘルプタブ主要12セクション翻訳）のアーキテクチャ上の弱点が判明した。`_getHelpData()`は`_HELP_I18N[lang][id]`が存在すればセクション配列をまるごと差し替える設計のため、**Phase 3完了後に日本語版（`_HELP_DATA`）へ追記された内容はEN/ZH側に自動反映されない**。具体的には、Fillツールの説明（2026-07-13追加）が`image-tab`のEN/ZHから丸ごと欠落しており、翻訳者がPhase 3当時取りこぼしていたことが判明。加えて今回追加した4機能のヘルプ文言もEN/ZH未反映だった。`layout`（Delete/Backspaceキー）・`nanobanana`（保存先）・`image-tab`（スポイト・Same Layer・Fillツール一式）のEN/ZHセクションを修正し、Kaptureで英語・中国語UIに実際に切り替えて表示を確認した。

**i18n Phase 3残タスクの完了**: Phase 3で意図的に対象外としていた付録4セクション（`appendix-svg-template`/`appendix-balloon`/`appendix-inkscape-template`/`appendix-inkscape-balloon`、計約3,300文字、Inkscapeでのテンプレート/フキダシ作成手順を含む）をEN/ZHに翻訳し追加。これでヘルプタブ全16セクションがja/en/zh完全一致となり、**Phase 3が完全に完了**。機械検証（Node vmでファイルを評価し、`_HELP_DATA`と`_HELP_I18N.en`/`.zh`のid集合・セクション数を突合）でja/en/zh間の不一致ゼロを確認。

**残タスク**: Phase 4（`py/ccc.py`のG'MIC/Eagle関連バックエンドエラーメッセージの多言語化。フロントの`t()`とは別の仕組みが必要、未着手）。

**How to apply:** `_HELP_I18N`方式（セクション単位で丸ごと差し替え）を使う限り、**日本語版`_HELP_DATA`に既存セクションへの追記・修正を行った際は、同じセッション内で`_HELP_I18N.en`/`.zh`の対応セクションも必ず更新すること**（今回のような訳抜けの再発防止）。機械検証スクリプト（Node vmで`_HELP_DATA`と`_HELP_I18N`のid集合・セクション数を突合）はこの用途に再利用できるので、ヘルプ文言を触った際は都度実行するとよい。フォルダ削除等の破壊的操作は、削除前に必ず参照有無を`grep`で確認し、既存データがあれば移動要否をユーザーに確認してから実施すること。

**How to apply（機能面）**: Imageタブでピクセル色を扱う新機能を追加する際は、常に表示用の合成キャンバス`#ie-canvas-draw`が最新の合成結果を保持している前提で`getImageData`すればよい（DrawTool自身のオフスクリーンキャンバスとは別物）。レイアウトタブでキーボードショートカットを新設する際は、`_isObjectLocked(el)`（`03-layers-panel.js`）と`duplicateSelectedObject()`の優先順位判定パターン（`state.selectedGroupId → selectedShapeId → selectedImageEl → selectedTextEl → selectedDrawId`）が既存の参考実装として再利用できる。

---

## 2026-07-14（レイアウト/Image: I2I連携機能を新規実装 — Workflow Studio経由）

SPA化時に削除済みだった旧web版（`eagle_comic_creater_web`）のI2I機能（ComfyUI直結の画像生成）を、Workflow Studio（`ComfyUI-Workflow-Studio`カスタムノード）とのiframe連携という新設計で復活させた。ユーザーは選択肢のうち「半自動連携」（Comic Creater側は画像送信のみ担当し、ワークフロー選択・生成実行はWorkflow Studio側で行う）を選んだ。

**アーキテクチャ**: comic-creater側の`py/ccc.py`にはComfyUIのプロンプトキューを叩くAPIが無いため、Workflow Studio（同一ComfyUIプロセス・同一オリジンで動作、`/wfm`）とのiframe連携を採用。既存の双方向連携パターン（Comic Creater→WSはGalleryをiframe埋め込み済み`14-integrations.js`、WS→Comic CreaterはGalleryタブの「Send CC」ボタンが`window.parent.insertImageFromUrl()`を直接呼ぶ実績）を踏襲・拡張した。

- **送信**（Comic Creater→WS）: レイアウトタブ・Imageタブに「I2Iへ送る」ボタンを新設。画像をBlob化→`iframe.contentWindow._wfmReceiveImageForI2I(blob, name)`（WS側`gallery-tab.js`に新規追加）を呼ぶ→WSの「workflow studio」タブへ自動切替＋Generate UI Input/Imageタブへ自動切替＋画像スロットへ自動セット。共通送信関数`sendImageToWorkflowStudioI2I`（14-integrations.js）を新設し、レイアウトタブ（15-pixifx-bridge.js `sendSelectedImageToI2I`）・Imageタブ（image-tab.js `_sendToI2I`）の両方から呼ぶ。
- **受信**（WS→Comic Creater）: 既存のSend CCボタンを拡張。`window._ccI2ITargetMode`（`'layout'|'image'`、送信元が記録）を見て、レイアウトタブへの挿入（`insertImageFromUrl`）かImageタブへの読み込み（`window._ccImageTab.loadFromUrl`）かを分岐。
- **プレビューのURLキャッシュ問題**: 同一ファイル名で続けて送信すると、ComfyUIサーバー上では正しく上書きされるのに、WS側のプレビュー`<img src="/view?filename=...">`がURL文字列不変のためブラウザキャッシュで古い画像を表示し続ける不具合があった（「合成結果（shape/draw等）が反映されていないように見えるが、実際に生成すると反映されている」という診断が難しい症状として発現）。送信のたびにファイル名へミリ秒精度のタイムスタンプを付与してユニーク化し解決（WS側は無改修）。
- **デフォルトI2Iワークフロー機能**: 設定タブに「I2I設定」ブロック（チェックボックス＋ワークフローファイル名、`localStorage: ccc_i2i_settings`）を新設。有効時、送信前にWS独自API `GET /api/wfm/workflows/raw?filename=X`（対象は`ComfyUI_5/user/default/workflows/`、WS自身も同じ仕組みで自身の「起動時デフォルトワークフロー自動読込」機能を持つ）でワークフローJSONを取得し、`_wfmReceiveImageForI2I`の第3・第4引数として渡す。WS側は`loadWorkflowIntoEditor(workflowData, filename)`（generate-tab.js既存export）を画像スロットセット前に呼ぶだけで、これが`comfyUI.currentAnalysis`の再解析・UI再描画まで行うため、直後の`applyImageToSlot`が新しいワークフローのLoadImageノードを正しく参照できる。
- **モデルリスト未取得バグ**: iframe初回ロード直後など、WS内部の`comfyEditor.models`（Checkpoint/VAE等の一覧、`init()`時に1回だけ非同期取得）がまだ空のタイミングで`loadWorkflowIntoEditor`を呼ぶと、Model/生成UIタブのドロップダウンが空のままレンダリングされ、ドロップダウンでの変更もできなくなる不具合があった（ユーザー報告「ComfyUI再起動しても直らない」）。`_wfmReceiveImageForI2I`内でワークフローロード前に`comfyUI.checkConnection()`→（`comfyEditor.models.checkpoints`が空なら）`comfyEditor.loadModelLists()`を保証するよう修正。

**教訓（プロジェクト構成・要注意）**: Workflow Studioのコードは実行環境（`ComfyUI_5\custom_nodes\comfyui-workflow-studio`）と開発元ソース（`comfyUI-wf-maneger\ComfyUI-Workflow-Studio`）が別ディレクトリで存在し自動同期されない。**WS側のファイル（`gallery-tab.js`）を編集する際は必ず両方に同じ変更を適用すること**（PixiJS連携ノードの`web/particle_engine.js`と同様の運用、上記「PixiJS FX連携」節参照）。今回一度この二重更新をユーザーに指摘されて気づいた。

**教訓（Kapture経由のiframe内操作は座標クリックに頼るしかなく不安定）**: KaptureのelementsツールやCSSセレクタ指定のclickはトップレベルdocumentのみが対象で、埋め込みiframe内部（別オリジンでなくても）の要素には到達できない。座標(x,y)クリックはiframe内にも転送されるため唯一の操作手段になるが、スクリーンショットからの目視座標読み取りは誤差が大きく、タブ切り替えのような大きなボタンは数回の試行で成功する一方、密集したヘッダーボタン行は何十回試しても安定してヒットしないことがあった。iframe内操作を伴う機能の自動検証はコストが高いため、コードの静的な正しさを確認できた時点で見切りをつけ、実機での最終確認はユーザーに依頼するのが現実的。

ヘルプ（22-help-tab.js）のレイアウト／Image／設定タブに、I2I連携・I2I設定の説明を3言語（日本語・英語・中国語）で追加。

**Why:** ユーザー要望「レイアウトタブ、ImageタブにI2I機能を追加したい。SPA化前のEagle Comic Createrにあった機能」。ComfyUIタブ削除に伴いWorkflow Studioとの連携が必要という制約があり、事前調査（旧web版のI2I実装・現SPA版の既存連携パターン）を経て半自動連携方式で合意した。

**How to apply:** I2I関連の追加修正時は、Comic Creater側（`static/js/main/14-integrations.js`の`sendImageToWorkflowStudioI2I`／`image-tab.js`の`_sendToI2I`／`15-pixifx-bridge.js`の`sendSelectedImageToI2I`）とWorkflow Studio側（`gallery-tab.js`の`window._wfmReceiveImageForI2I`、実行環境・開発元の両方）を意識すること。デフォルトワークフローの読み込み元は`ComfyUI_5/user/default/workflows/`固定（WS独自API経由）。

---

## 2026-07-13（レイアウト: ドロー/画像/フキダシの回転ハンドル・選択枠のズレを修正）

ユーザー報告「ドローツールのフレームシェイプとずれる回転ハンドルが逆方向に動く」。実機再現すると、回転させた図形に対して選択枠（点線のバウンディングボックス）と実際の図形の見た目がだんだんズレていき、回転ハンドルの表示位置も実際の回転方向と逆にズレていく問題だった。

**原因（3つ、17c-layer-draw-handles.jsのドローツールで発見）**:
1. **回転ハンドルの位置計算式で`Math.sin(rad)`の符号が逆**: 図形本体は標準の回転行列（SVGの`transform="rotate(angle,cx,cy)"`、x'=cx+lx·cos−ly·sin, y'=cy+lx·sin+ly·cos）で回転するのに対し、`renderDrawShapeHandles`/`updateDrawShapeHandles`内のハンドル位置計算はこの行列から逸脱した符号になっていた
2. **選択枠(bbox)がtransformを持たず常に無回転のまま描画**されていた（図形本体だけが回転し、点線の選択枠は元の位置に取り残される）
3. **8点リサイズハンドルも回転を考慮せず軸並行位置に配置**されていたため、回転時に選択枠の角とハンドルの丸がズレる

**修正**: 回転を考慮した8点ハンドル位置を計算する`_drawShapeGetRotatedHandlePositions`、回転ハンドル位置を計算する`_drawShapeGetRotateHandlePos`を新設し、bbox（`rotate(angle,cx,cy)`のtransformを付与）・8点ハンドル・回転ハンドルの3つを統一的に回転行列で配置。リサイズドラッグ処理（`initDrawShapeManipulation`）も、マウス移動量を図形のローカル座標系へ逆回転してからリサイズ計算し、回転中心のズレをグローバル座標系に変換して補正するロジックに変更（回転していない図形と同じ操作感になるように）。

ユーザー確認の上、**同じ3点のバグが画像(08-panels-images.js、SVG画像挿入も同じ`inserted-image`実装を共有するため同時に解消)・フキダシ(09c-balloon-handles.js/09d-balloon-tools.js)にも存在**すると判明し、同じパターンで修正。フキダシはさらに「尻尾ハンドル」「カーブハンドル」も無回転のローカル座標のまま計算されており、回転したフキダシで尻尾の操作が混乱するとの追加報告を受けて対応：`_h2CalcCurveHandlePos`をローカル座標系で計算した後にフキダシの回転角を適用して絶対座標に変換する方式に変更し、尻尾ドラッグのマウス角度計算もローカル座標系への逆回転を挟むように修正。

**検証**: Kaptureで実際に-13.3度／26.3度／-47.4度回転させた図形・画像・フキダシに対し、DOM属性を数値検証。bboxのtransformが図形本体と完全一致、8点ハンドルの対角ペア（nw⇔se、ne⇔sw）の中点が理論値と一致、回転ハンドル位置も理論式と一致することを確認。フキダシの尻尾ハンドルは、パスのローカル座標をPythonで実際に回転行列変換した値とハンドルの実測値が小数点以下15桁まで完全一致した。

ヘルプ（22-help-tab.js）は既存の「黄色ハンドルで回転できます」等の説明がそのまま正しい記述のため変更なし。

**How to apply:** SVGの`transform="rotate(angle,cx,cy)"`で回転する要素に対し、別要素として描画する選択枠・ハンドル類を実装する際は、必ず同じ回転行列（x'=cx+lx·cos−ly·sin, y'=cy+lx·sin+ly·cos）で位置計算するか、選択枠自体に同じtransformを付与すること。ドラッグ操作（リサイズ・尻尾等の角度計算）でグローバル座標のマウス位置を扱う場合も、回転している要素のローカル座標系に逆回転してから計算しないと、回転量に応じて操作感がズレていく。

---

## 2026-07-13（Imageタブ: バケツ（Fill）ツールを新規実装 — 単色/グラデーション塗り）

Imageタブに塗りつぶし機能が無かったため新規追加。単色フラッドフィルに加え、線形・円形グラデーション塗りにも対応（`comfyUI-particle-pixijs`のパーティクルカラーランプUIを参考にした複数カラーストップ編集・方向/強さのミニコンパスUI）。ユーザー選択により、グラデーションはバケツツールの塗りモード（Solid/Gradient切替）として統合し、独立ツールにはしていない。

- **新規ファイル `image-tab/FillTool.js`**: スキャンライン式のスタックベースflood fill、`evalGradient`（`particle_engine.js`のロジックを移植、pos昇順ソート→区間線形補間）、ストップ追加/削除ヘルパー
- **`image-tab.js`統合**: `TOOL_DEFS`に`fill`追加（ショートカット`G`）、ツールオプションパネルに単色/グラデーション切替・カラーランプ（横長canvas、ストップのドラッグ編集）・方向パッド（linear=角度+強さ、radial=半径）を実装
- **カラーランプUIで踏んだ不具合2件**:
  - **幅が変わる**: canvas幅を`clientWidth`に動的同期する実装が原因。canvas要素はreplaced element特有の挙動でwidth属性変更がflexレイアウトの基準サイズにも影響し、再測定のたびに幅がズレて縮んでいった。固定値(130px、パネル内側幅約148pxに収まる安全マージン)に戻して解消
  - **ハンドルが消える**: ストップをmousedownで選択した際に`_renderFillProps()`（DOM全体再構築）を呼んでおり、`<canvas id="ie-fill-ramp">`要素ごと新しいものに置き換わっていた。ドラッグ中の`mousemove`/`mouseup`ハンドラはDOMから切り離された古い`canvas`変数を参照し続けるため`getBoundingClientRect()`が0を返し、座標計算がNaN化してハンドルが描画されなくなっていた。DOM全体再構築をやめ、ランプの再描画と色input欄の値更新だけの部分更新に変更して解消
- ヘルプ（22-help-tab.js）のImageタブ「ツール」セクションにFillの説明を追加

**検証**: Kaptureで実機確認。単色フラッドフィル・線形/円形グラデーション塗り・ストップ追加/削除・Undo・幅固定後の色変更でcanvas幅が変わらないことを確認。

**How to apply:** テキスト/Shapeツールの塗りへのグラデーション適用は今回のスコープ外（将来課題）。`FillTool.evalGradient`とランプUIの実装パターンはツール非依存にしてあるので、将来グラデーション塗りを他ツールに広げる際に再利用できる。またSelectツールへの矩形/円形「領域選択」も別途要望あり（未着手）だが、`floodFill`のマスク生成と`_fillMaskWithGradient(mask, bbox)`の塗り適用を分離しておいたので、選択マスクができれば同じ塗り適用ロジックを再利用できる設計にしてある。

---

## 2026-07-13（レイアウト/Image: 図形・フキダシ・SVGのPNG変換を「元の位置・サイズを保った複製挿入」に統一）

一連のユーザー要望に対応。要点は「PNG変換系の機能はすべて、コマ幅いっぱいに拡大するのではなく、元のオブジェクトと同じ位置・表示サイズで複製挿入する」という仕様に統一したこと。

- **`insertImage`/`insertImageToOverlay`に`placement`引数を追加**（08-panels-images.js）: `{x, y, width, height}`を渡すと、従来のデフォルト挙動（コマ幅いっぱいに拡大 / ページ幅40%で中央配置）の代わりにその位置・サイズで挿入する。省略時は完全に従来通りなので既存呼び出し元（3Dポーズ確定等）は無改修。
- **ドロータブに「図形をPNG変換」ボタンを新設**（17b-layer-draw-commit.js）: 選択中の`draw-shape`（矩形/楕円/線/曲線/多角形/鎖/ロープ/My曲線）を、元図形を残したままPNG化して複製挿入。
- **「SVG→PNG」ボタン**（18-svg-color-png.js）も同様に、変換元SVG画像要素の`x/y/width/height`をそのまま`placement`として渡すよう変更。従来はコマ幅いっぱいに拡大されていた。
- **フキダシ・図形共通の`convertShapeToImage(el, svgEl)`を複製方式に刷新**（09c-balloon-handles.js）。フキダシメニュー（「挿入」ボタン右隣）に専用の「画像に変換」ボタンを新設し、レイヤーパネルの🖼ボタン（フキダシ・図形どちらも）は撤去。

**ハマった点1（座標変換）**: `el.getCTM()`は「最も近いviewport祖先の**viewport座標系**」への変換を返す仕様で、これはSVGのuser space座標系（`viewBox`適用**前**の座標系）ではなく、`viewBox`によるスケーリングまで含んでしまう。複製先の単独SVG（親のviewBoxを持たない）にこの変換を適用すると、座標系のスケールが数十倍〜数百倍ズレて図形が描画範囲外に飛び出し、**生成されるPNGが完全に透明になる**という分かりにくい形で症状が出た。対策は、`el.transform.baseVal.consolidate().matrix`で**要素自身のtransform属性のみ**を反映する方式に変更（回転`rotate(angle,cx,cy)`やpath/g用の`matrix(...)`はそのまま使えるが、祖先のviewBoxスケーリングは含まれない）。
**ハマった点2（Canvasサイズ上限）**: レイアウトのSVG座標系はページ全体で`viewBox="0 0 21000 29700"`という大きな数値系のため、図形のバウンディングボックスをそのままCanvas幅/高さに使うとブラウザのCanvasサイズ上限を超え、これも透明画像として出力される。出力解像度に`MAX_DIM=2000`の上限を設けて縮小することで解決（挿入時は`insertImage`がplacementの表示サイズに再フィットさせるため画質への実害はない）。
**ハマった点3（同名関数の重複定義・今回最大の詰まりどころ）**: `convertShapeToImage`をフキダシ用に新規実装した際、09b-balloon-shapes.jsの末尾に「実装コメントのみ残って本体が無い」箇所を見つけたため「分割時に本体が失われた」と判断し実装を追加した。しかし実際には**09c-balloon-handles.jsに別の実装（旧仕様・要素を削除して画像に置き換える方式、i18n化済みで正常に動作する状態）が既に存在**しており、スクリプト読み込み順（09b→09c）でJSの関数宣言は後勝ちのため、**常に09c側の実装だけが有効**になっていた。ブラウザの複数回リロード・アプリ再起動でも再現し続けたため、「サーバーが配信するファイル内容」と「ブラウザが実際に実行している関数の中身」を`convertShapeToImage.toString()`で突き合わせて初めて発覚。**教訓: 関数が「実装が無い」ように見えても、同名の別定義が他ファイルに無いか`grep -rn "function <name>"`で必ず確認してから実装を追加すること**（コメントだけ残っているのは分割時の実装移動の痕跡である可能性がある）。最終的に09b側の重複定義を削除し、09c側を新方式（複製・元要素は残す）に書き換えて解消。

検証はKaptureの`evaluate`でテスト用のSVG/図形/フキダシをDOM注入し、変換結果の位置・サイズ・非透明ピクセル比率を直接確認、`undo()`でテストデータを都度ロールバックする方式で実施（実データを汚さないまま繰り返し検証）。作業中Kapture側の`evaluate`が一時的に切断される場面があり、その間はファイルシステム上のコードと`curl`によるサーバー配信内容の突き合わせで代替した。

ヘルプ（22-help-tab.js、レイアウトタブの「フキダシ」「形状描画（ドロー）」セクション）を3言語で更新し、上記の新ボタン・モード構成を反映。ドローサブタブの編集モードタブ名も「ボックス」→「ドロー」に変更（i18n `layout.editModeBox`、3言語）。

**How to apply:** 今後PNG変換系の機能を増やす場合は`insertImage(base64, w, h, extraAttrs, placement)`の`placement`引数をそのまま使えばよい。SVG要素のtransform関連を扱う新機能では、`getCTM()`ではなく`el.transform.baseVal`から要素自身の変換行列のみを取り出す方式を基本にすること（祖先のviewBoxやCSSズームを巻き込まないため）。またグローバル関数を新設する際は、必ず対象の関数名で全体grepしてから着手する。

---

## 2026-07-12（i18n Phase 3: ヘルプタブの主要12セクションを翻訳）

`22-help-tab.js`の`_HELP_DATA`長文プローズ（16セクション・約15,800文字）のうち、ユーザー選定の主要12セクション（about/page-template/layout/nanobanana/font/page-export/page-work/project/settings/image-tab/assetpanel/wfmgallery）を英語・中国語に翻訳。付録4件（SVG仕様・Inkscape手順、計約3,300文字）は使用頻度が低いため今回は対象外（ja自動フォールバックのため未着手でも問題なし）。810キー×3言語（i18n.js側は`help.appendixDivider`/`help.jumpToTab`の2件のみ追加、716→810は主にこのヘルプ翻訳データ自体のボリューム）。

- **アーキテクチャ**: 他のPhase 2までと違い、この長文プローズは`i18n.js`のフラットな`t()`キーには馴染まない（見出し・本文のペアが複数ネストする構造）ため、`22-help-tab.js`内に専用の`_HELP_I18N = { en: {...}, zh: {...} }`（`id`→`{label, sections}`）を新設。`_getHelpData()`ヘルパーが現在言語のデータを`_HELP_DATA`（ja基準）とマージし、翻訳が無いid（付録4件）は自動的にja版にフォールバックする。`_HELP_DATA`を直接参照していた4箇所（`_helpSorted`/`_helpFilterNav`×2/`_helpShowItem`）を`_getHelpData()`に置き換え済み。`kana`（ふりがな検索用）は翻訳対象外の既存方針を踏襲し、ja版のまま全言語で共用（検索の副次的な補助のため実害なし）。
- 固定UI文字列（付録区切り「付録」、詳細画面の「タブを開く →」ボタン）は通常の`t()`キー化で対応。
- **作業方法**: 巨大な1回のEdit挿入だと出力トークン制限に達するため、セクション単位（ときに2〜3件まとめて）で`en`側→`zh`側の順に小分けのEdit呼び出しを繰り返し、都度`node --check`で構文確認する方式で進めた。最後に`vm`モジュールでファイルを安全に評価し、ja/en/zhの id集合一致・各セクション数の一致を機械的に検証（12件×2言語、不一致ゼロ）。

**How to apply:** 付録4セクション（appendix-svg-template/appendix-balloon/appendix-inkscape-template/appendix-inkscape-balloon）を翻訳する際は、同じ`_HELP_I18N.en`/`.zh`に`id`キーで追記するだけでよい（`_getHelpData()`のフォールバック判定は「idがtr内に存在するか」なので、追加すれば自動的に有効になる）。長文コード例（`<pre class="help-code">`）はHTMLごとそのまま流用し、コメント部分（`&lt;!-- ... --&gt;`）のみ翻訳すること。

---

## 2026-07-12（i18n Phase 2⑥: 3Dポーズ/G'MIC・Eagle連携/残りファイル全対応でPhase 2完全完了）

Phase 2ロードマップの最終区分（3Dポーズ23／G'MIC・Eagle連携14／その他00-03,05,12-14,16,18）に対応し、**Phase 2を完全に完了**。808キー×3言語（前回716→+92キー）。対象11ファイル: 00-db.js/01-state.js/02-assets.js/03-layers-panel.js/05-groups-move.js/12-text-png-export.js/13-export-pdf-epub.js/14-integrations.js/16-processing-edit-tabs.js/18-svg-color-png.js/23-pose3d-bridge.js。`t`変数のシャドウは事前grepで全ファイルなしを確認済み。

- **重複キー混入を発見・修正**: 前回セッション（Phase 2⑤スクリプトタブ）で新設した`script.noSavedWorks`/`script.noPageWorks`が、実は既存の`asset.noSavedWorks`/`asset.noPageWorks`（Phase 1でアセットパネル「S」タブ用に作成済み）と文言が完全一致する重複だった。21-script-tab.js側の参照を`asset.*`に差し替え、`script.*`の重複キーを3言語×2キー削除。**教訓: 新規キー追加前に同名・同義の既存キーがないか名前空間を跨いで`grep`する習慣が必要**（今回は`asset.*`パネルの空状態メッセージという別機能のキーだったため見落とした）
- **image-tab.jsとの表現統一**: G'MIC関連の一部メッセージ（`画像をサーバーへ送信中...`/`G'MIC GUIがキャンセルされました`/`G'MIC GUIで編集中...`）はImageタブ側（Phase 2④で作成済みの`image.gmic*`）と文言が完全一致したためそのまま再利用。レイアウトタブ独自の文言（自動保存版の編集中ヒント等）のみ`layout.gmic*`として新設
- **軽微な副次修正**: 14-integrations.jsの`gmicWaitForJob`内`e.message.includes('タイムアウト')`という日本語部分文字列チェックが、実際にはtry/catchの外で投げられるタイムアウトエラーには到達しない**元から機能していないデッドコード**だったと判明。翻訳に合わせて`e.message === t('layout.gmicTimeoutError')`への置き換えついでに気づいたが、元々無害な死んだ分岐のため動作への影響はない
- **image-tab/\*.js系（LayerManager/DrawTool/TextTool/SelectTool/ShapeTool/MaskTool/MaskEditorOneTools）は対象ゼロを確認済み**（Phase 2④で判明、再確認不要）

**検証方法**: 前回までと同様、`node --check`＋全.jsファイル横断でのt()呼び出しキー全数照合（438種類、ja辞書への存在確認）＋ja/en/zh 3言語のキー集合完全一致チェック。ユーザーが使用量節約のため実機確認を担当する方針のため、Kaptureでの目視確認はPhase 2全体を通じて省略。

**How to apply:** 次はPhase 3（`22-help-tab.js`の`_HELP_DATA`長文プローズ翻訳）またはPhase 4（`py/ccc.py`のG'MIC/Eagleエラーメッセージ、バックエンドのためフロント`t()`とは別の仕組みが必要）。新規キー追加時は必ず`grep`で同名・同義キーの重複を確認すること（今回の教訓）。

---

## 2026-07-12（i18n Phase 2⑤: スクリプトタブを翻訳）

`main/21-script-tab.js`に対応。716キー×3言語（前回697→+19キー）。プロットテーブルの見出し（シーン/コマ番/セリフ番/セリフ・説明等）、保存済み作品一覧の空メッセージ、セリフ行・ページ・作品の追加/削除/保存/読込に伴うalert/confirm文言を`script.*`名前空間に追加。「要素」列見出しは既存の`script.subtabElements`（Phase1でサブタブラベルとして追加済み）をそのまま再利用。`t`のシャドウは無し。前回同様、`node --check`＋t()キー全数照合＋3言語キー集合一致チェックのみで検証（実機確認はユーザー側）。

**How to apply:** 次回はPhase 2⑥（3Dポーズ23／G'MIC・Eagle連携14／その他00-03,05,12-14,16,18）。14は今回`layout.msgSelectImageFirst`等いくつかのキーを先取りで用意済みなので、着手時に14側の同一文言をそのキーに差し替えること。

---

## 2026-07-12（i18n Phase 2④: Image連携/Nanobanana/PixiFX を翻訳）

多言語化Phase 2の④（`image-tab.js`・`image-tab/*.js`・`nanobanana.js`・`15-pixifx-bridge.js`・`text-style-modal.js`）に対応。697キー×3言語（前回630→+67キー）。ユーザーが使用量節約のため実機検証を担当する方針だったので、`node --check`＋全ファイル横断でのt()呼び出しキー全数照合（ja辞書に対する存在チェック）＋ja/en/zh 3言語のキー集合完全一致チェックのみで完了とした（Kaptureでの目視確認は省略）。

- **image-tab/\*.js（LayerManager/DrawTool/TextTool/SelectTool/ShapeTool/MaskTool/MaskEditorOneTools）は対象ゼロ**: 事前調査で日本語を含む行を洗い出したが、全てコード内コメント（`this.x = 0; // 左上X`等）で、ユーザー向け文字列は皆無だった。翻訳不要と判断し変更なし
- **`image-tab.js`**: 調整レイヤー12種のラベルは既存`image.adj*`キー（HTML側Phase1で既存）をそのまま再利用。新規追加は約35キー（G'MIC進捗文言、Close確認ダイアログ、レイヤー複製・統合のtoast/confirm、Upscaleのstatus文言、Textツールのスタイルボタン等）
  - **ハマった点**: Shapeツールの`_renderToolOptions`分岐内で`const t = this._shapeTool;`と、i18nの`t()`関数をシャドウする変数が既に存在していた。この中の4箇所（間隔ラベル・mychain選択option・画像選択ボタン・未選択フォールバック・mychainロード失敗toast）は`window.t(...)`で明示参照する必要があった（見逃すと`t.spacing`のような呼び出しと衝突してSyntaxErrorではなく誤動作するため要注意）
- **`text-style-modal.js`**: フォント管理タブの「スタイル」タブ（Phase 2③で既に翻訳済み）とほぼ同一内容のモーダルのため、新規キーはタイトル・スタイル名検証・削除確認の4個のみで、残りは`font.*`/`common.*`の既存キーを全面再利用
- **`nanobanana.js`**: 接続ステータス3種・I2I枚数上限アラート（関数値キーで枚数を補間）・生成フロー中のstatus文言を`nb.*`に追加
- **`15-pixifx-bridge.js`**: PixiFXモジュール未読込・画像未選択のアラート文言を追加。「画像を選択してください。\nレイアウトタブで...」は`14-integrations.js`のG'MIC連携でも同一文言が使われているため`layout.msgSelectImageFirst`として汎用キー化した（14はPhase 2⑥で未着手のため、着手時にこのキーを再利用すること）
- 新設の汎用キー: `common.close`/`common.apply`/`common.done`/`common.errorPrefix`（`(m) => \`エラー: ${m}\``形式、"エラー: "+message パターンが複数ファイルに散在していたため統一）

**How to apply:** 次回はPhase 2⑤スクリプトタブ(21-script-tab.js)から。Shapeツールのような「ローカル変数`t`によるシャドウ」は他のタブでも起こりうるパターンなので、置換前に対象スコープで`t`という名前の変数・パラメータが使われていないか確認すること。

---

## 2026-07-12（レイアウトタブ ドローツール: 線幅初期値の変更＋鎖/ロープのプレビューと確定の太さ統一）

ユーザー要望2件。

**1. 形状選択時の線幅初期値**（17a-layer-draw-input.js の形状change時）: 直線・曲線・多角形を5→**50**に変更（鎖・ロープ=80、My曲線=5は従来通り）。多角形は従来初期値の自動設定自体が無かったため分岐を追加（線幅のみ設定、塗り/線の有無は維持）。

**2. 鎖・ロープの「描画時の太さ」と「確定後の太さ」のズレを修正**。プレビュー(17a)と確定(17b)の数式自体は等価だったが、ズレの真因は**確定直後のUI同期**: 確定後に`_layerDrawSelectShape`→`_drawShapeSyncProps`(17c)が走り、鎖/ロープの`<g>`はstroke属性を持たないため「線なし・線幅0」をUIへ書き戻していた。次に描画するとプレビューは`0→フォールバック5`で細く描かれ、確定は`線なし→0`扱いで解釈が割れる。修正内容（17b-layer-draw-commit.js）:
- 鎖/ロープの確定時の太さ・色を、プレビューと同一の解釈（`parseFloat(線幅)||5`、色は線カラーピッカー値を線なしチェックに関わらず使用）で計算する`cellW`/`cellColor`に統一
- 確定した`<g>`自体に`stroke`/`stroke-width`（論理値）と`fill="none"`を付与し、UI同期が正しい値を読み戻せるようにした。セルは個別のstroke-widthを持つため見た目には影響しない。**ロープのベース矩形(rect1)だけstroke属性が無く親から継承してしまうため、明示的に`stroke="none"`を追加**（これを忘れると全セルに枠線が付く）

Kaptureで形状ボタン切替時の初期値（直線50/曲線50/多角形50/鎖80）を実機確認済み。ドラッグ描画はKaptureで再現不可のため、鎖/ロープの太さ統一はコードパスの検証（プレビューと確定の式の同一化）による。

---

## 2026-07-12（ページタブ: テンプレートカードにサイズとコマ枠幅を表示）

ユーザー要望。テンプレートサブタブの各カードに、テンプレート名の下（グループ名の上）に「サイズ / 枠幅」（例: `21000×29700 / 枠幅 63`）を表示するようにした。

- サイズは保存済みの`template.width/height`（viewBox由来、表示は整数丸め）
- コマ枠幅は保存データに無いため、`_tmplGetFrameWidth()`（06c-template-wizard.js）で`svgContent`の2番目のpolygon（1番目=panel_0はページベースのため除外）の`stroke-width`属性/styleから抽出。取得できない場合（外部SVGでCSSクラス指定等）はサイズのみ表示
- i18nキー`tmpl.cardInfo`（関数値、fw=nullで枠幅省略）を3言語追加

---

## 2026-07-12（Imageタブ: Textツールでも既存テキストをダブルクリックで再編集できるように）

ユーザー要望「Textツール時の編集オーバーレイを開く操作を、Selectツールと同じダブルクリックにしたい」。従来はTextツールでシングルクリックすると位置を問わず新規テキスト入力が開き、既存テキストの上でも「再編集」ではなく新規入力になっていた（再編集はSelectツールに切り替えてダブルクリックする必要があった）。

- `image-tab.js`に`_findTextLayerAt(x, y)`を新設（最前面から可視テキストレイヤーをヒットテスト、`SelectTool._isPointInLayer`を再利用）
- Textツールのmousedown: 既存テキストレイヤー上ではシングルクリックで新規入力を開かない（入力オーバーレイ表示中は従来通りクリックで閉じる挙動を維持）
- `_onOverlayDblClick`をTextツール対応に拡張: 座標上のテキストレイヤーをアクティブ化して`_openTextEditForLayer`（Selectツールの再編集と同じ経路）で開く
- **ハマりポイント**: dblclickリスナーは`#ie-canvas-overlay`にしか無かったが、overlayは`pointer-events:none`（SelectTool.activate()時のみauto）のため、Textツール時のイベントは`#ie-canvas-draw`に落ちる。drawCanvas側にもdblclickリスナーを追加して解決
- **検証時の注意（キャッシュ）**: `/ccc_static`はCache-Control未設定のためブラウザのヒューリスティックキャッシュで**古いJSが通常リロードでも使われることがある**。検証時はJSのURLを直接開いてリロード→戻る、またはハード再読み込み（Ctrl+F5）が必要だった

Kaptureで検証済み: Textツールで既存テキスト上のシングルクリックが抑止されること、空白クリックで従来通り新規入力が開くこと（ダブルクリック発火はKapture非対応のため、Selectツールで実証済みの`_openTextEditForLayer`経路とイベント配線の確認をもって代替）。

---

## 2026-07-12（テキストスタイルv2: フォントサイズ相対値化＋3タブの描画基準統一）

ユーザー報告「フォントタブで作ったスタイルがレイアウトタブではまったく異なる見た目になる。フォントタブとImageタブの表示も違う」。調査の結果、共通のスタイルデータ（`fontmgr_text_styles`）を3箇所が異なる単位・異なる描画基準で解釈していたことが原因。

**旧仕様の問題点**:
1. **単位**: スタイル値が絶対値で、フォントタブ=プレビューpx(150px基準)、Imageタブ=Canvas px(64px基準)、レイアウトタブ=SVG単位(150pt=529単位基準)。同じ線幅4でも文字サイズ比が最大13倍違い、レイアウトでは「ほぼ効いていない」見た目になっていた
2. **描画基準**: 線=Imageタブだけ2倍太い(lineWidth=S×2)、袋文字帯=フォントタブだけ半分(B/2)、影ぼかし=レイアウトだけ2倍ぼける(feDropShadowのstdDeviationはσ直指定、CSS/Canvasのblurはσ≈blur/2)、影の対象=レイアウトは袋文字込み/他は線+塗りのみ
3. **プレビュー**: スタイルモーダルはSVG（レイアウトと一致）だが、フォントタブのスタイル/プリセットプレビューはCSS2枚重ねでどちらとも不一致

**新仕様（v2、ユーザー合意: 既存スタイルは破棄・既存作品内の適用済みテキストは無変更）**:
- スタイル値は**「フォントサイズ100pxあたりのpx」の相対値**。適用時に対象のfont-sizeに比例スケール（k=fontSize/100）するため、どのタブ・どの文字サイズでも同じ比率になる
- 描画基準はSVG（レイアウト）側に統一: 線=中央基準（外側S/2）、袋文字=線の外にBの帯（Canvas側はlineWidth=(stroke有効時S+B×2)×k、stroke無効時はSを含めない）、影ぼかし=SVG側をstdDeviation=(blur/2)×kに補正、影=最背面シルエット（袋文字込み）に1回だけ（Canvas側は最初に描くパスにのみshadow設定、従来の線+塗り両方に掛かって影が濃くなる問題も解消）
- 保存データに`v: 2`を付与し、load時に`v===2`のみ読み込む（19-font-manager.jsの`_fontMgrLoadStyles`とtext-style-modal.jsの`loadStyles`の2箇所）。旧スタイルは一覧から消える
- フォントタブのスタイル/プリセットプレビューをCSS2枚重ね→**モーダルと同じSVG方式**（新設`_fontMgrRenderStylePreviewSvg`、実適用と同じ`_fontMgrApplyStyleAttrsToTextEl`を通す）に置き換え。index.htmlの`#style-preview-back/front`divは`#style-preview-svg`に差し替え。CSS版`_fontMgrRenderTextStylePreview`はアセットパネルFタブのミニサムネ専用として残し、スケール補正＋基準補正を適用
- `_fontMgrExtractStyleFromTextEl`（モーダルを開く際の逆変換）はfont-sizeで割り戻すため、**旧仕様の絶対値で作られた既存テキストも「現在の見た目」を正しく相対値として取り出せる**（再編集時に見た目が変わらない）
- レイアウトタブでフォントサイズ変更時（09aのfont-sizeハンドラ）にスタイルを抽出→再適用し、線・袋文字・影がサイズに追従するようにした（旧仕様では固定のままだった）
- Imageタブは`textProps`に相対値が入り`_rerenderTextLayer`がk倍して描画（サイズ変更に自動追従）。`_textExtraPad`もスケール対応

**変更ファイル**: 09a-balloon-init.js / 09e-text-tool.js / 19-font-manager.js / 20-font-presets.js / image-tab.js / text-style-modal.js / templates/index.html

**検証**: Kaptureでスタイル（線4白・袋文字8黒・影4/4/4）を作成→フォントタブSVGプレビュー・レイアウトタブ挿入（font-size529でstroke-width=21.16、feMorphology radius=42.32、stdDeviation=10.58と正しくスケール）・Imageタブ挿入（同比率で描画）を確認。既存の適用済みテキスト（セイセイスルモノ等）の属性は無変更のまま。検証データは削除済み。

**注意**: 見た目の完全一致の唯一の例外は袋文字の角の形状（SVGのfeMorphologyは矩形カーネルで角ばる、Canvasはround join）。また旧仕様時代にImageタブの保存済みプロジェクト（.json）に入っているtextPropsの絶対値は、再編集時に相対値として再解釈される（フォントサイズ64なら約1.5倍太くなる）。

---

## 2026-07-12（レイアウトタブ: 画像によってG'MIC GUIが起動しない問題を修正）

ユーザー報告「レイアウトタブの画像ツールで画像によってG'MIC GUIが起動したりしなかったりする（同じ画像でもImageタブ経由なら起動する）」。Kaptureで実機再現し、失敗画像の送信ボディを捕捉して原因を特定した。

**原因（2つの複合）**:
1. **Nanobanana生成画像のMIME偽装**: Gemini APIは実体JPEGのbase64を返すことがあるが、`nanobanana.js`が無条件に`data:image/png;base64,`を付与していた。サーバー側`handle_local_gmic_open_b64`はMIMEを信じて`.png`拡張子で一時ファイルを保存する
2. **gmic_qt.exe（3.6.5スタンドアロン版）はJPEGを開けない**: 拡張子を正しい`.jpg`にしてもJPEG入力ではエラーも出さず終了コード0で即終了する（GUIが出ない）。System.Drawing製の単純JPEGでも再現＝JPEG全般が非対応。PNG入力なら正常にGUIが開く。フロント側にはジョブ`failed: G'MIC GUIがキャンセルされました`としか見えない

Imageタブで動いていたのは、送信前に`layer.canvas.toDataURL("image/png")`で常に本物のPNGへ再エンコードしていたため。

**修正**:
- `py/ccc.py`: `_sniff_image_ext()`（マジックバイトによる実形式判定）を追加し、`handle_local_gmic_open_b64`でMIMEより実バイトを優先。さらに**PNG以外（JPEG/WebP/GIF/BMP）はPILでPNGに変換してから**gmic-qtに渡す（変換失敗時は従来どおりそのまま渡すフェイルセーフ）。既存作品に保存済みの偽ラベル画像もこれで救済される
- `static/js/nanobanana.js`: 生成画像のbase64先頭から実形式を判定して正しいMIME・拡張子で保存するように修正（`/9j/`=JPEG, `UklGR`=WebP, `R0lGOD`=GIF, それ以外はPNG扱い）

PILでの変換後にgmic_qtのGUIが正常に開くことを事前検証済み。ユーザー環境で修正後の動作確認済み。ccc.pyの変更はComfyUI再起動が必要。

**教訓**: gmic-qtへ画像ファイルを渡す機能は必ずPNGで渡すこと。外部API由来の画像はMIMEラベルを信用せずマジックバイトで実形式を確認すること。

---

## 2026-07-11（Imageタブ: レイヤー複製機能を追加）

ユーザー要望。レイヤーパネル下部のOpacityスライダーの下に「レイヤー複製」ボタン（`#ie-layer-duplicate-btn`）を追加。

- **LayerManager.js**: `duplicateLayer(id)`を新設。canvas内容（drawImage）と全プロパティ（visible/opacity/blendMode/位置/サイズ/回転/反転/textProps=ディープコピー/locked/maskApply/operation/adjType/adjValue）をコピーし、名前は`{元名} copy`、idは新規。**layers配列は先頭=最前面のため元のindexに挿入すると元の直上に来る**。複製をアクティブに切り替え
- **image-tab.js**: ボタンリスナーを`ie-flatten-btn`の並びに追加。`_syncActiveLayerFromCanvas()`（描画途中の内容を同期）→`_saveUndo()`→複製→合成ビュー/レイヤーリスト更新→toast。テキスト・調整・マスクレイヤーも複製可能（textPropsコピーで複製後の再編集も機能する）
- ボタン行は既存`.ie-adj-add-row`クラスを再利用（border-top付きの行スタイル）。i18nキー`image.duplicateLayer`/`image.duplicateLayerTitle`を3言語追加

### 追記: ヘルプタブを本日分の変更に合わせて更新（同日）

`_HELP_DATA`（22-help-tab.js）の4セクションを更新: ①設定＝「言語」「G'MIC設定」（パス設定・要再起動不要）を追加 ②Image＝Textツールの縦書きチェック・スタイル一本化（B/I/Align廃止）・ダブルクリック再編集でスタイル保持・レイヤー複製ボタン・FilterのG'MICパス参照先 ③レイアウト「テキスト」＝縦チェックの即時反映・色プリセット化（任意色はスタイルの塗り）・☆ボタン廃止・スタイルモーダルの項目拡大とSVGプレビュー ④フォント「スタイルの作成・保存」＝太字・文字寄せの追記。

---

## 2026-07-11（Imageタブ: スタイルの「下線」対応＋テキスト再編集でスタイルが消えるバグを修正）

前エントリの既知の制約だった「スタイルのunderlineEnabledがImageタブで効かない」を解消（ユーザー依頼）。

- **下線の自前描画**: Canvas2Dにはtext-decorationが無いため、`_rerenderTextLayer`の塗りパスの後にfillRectで描画する。横書きは各行の下（上端から0.95em、太さ0.06em、行幅はmeasureText＋align考慮）、**縦書きは列の右側の傍線**（列中心+0.5emの位置に列高さ分）。影の設定が残った状態で描くので文字と同様に影が付く。色は塗り色（text-decorationと同じ挙動）
- `TextTool.js`の`layoutVerticalText()`の戻り値に`cols: [{cx, h}]`（列ごとの中心x・高さ）を追加（傍線の描画に使用）。単体テスト（scratchpadのtest-vertical.mjs）にcols検証を追加して全通過（※既存テストの句読点アサーションが0.5em時代のまま古くて落ちたので0.3emに更新した——実装の回帰ではない）
- `_fontStyleAttrsFromStyle()`に`underline`、`getSelectedTextStyleInfo()`に`underlineEnabled`を追加（スタイル⇔textPropsの双方向変換）
- **既存バグ修正: テキスト再編集（ダブルクリック→OK）でスタイルが全部消えていた**。`_editingTextLayer`パスが`layer.textProps = props`（完全置換）＋`data.canvas`（スタイル無し描画）だったため、線・袋文字・影・太字斜体・下線が失われていた。`{ ...layer.textProps, ...props }`で既存スタイル系プロパティを保持し`_applyTextPropsToLayer()`（スタイル余白込み再計測＋中心保持＋スタイル込み再描画）を通す方式に変更

### 追記: 下線にも線・袋文字を付ける（同日、ユーザー指摘）

モーダル（SVG）では下線もtext-decorationとしてstroke・feMorphologyフィルタの対象になり縁取りが付くが、Canvas側は塗り＋影のパスでしかfillRectしていなかったため、下線だけ縁取りなしでズレていた。下線矩形を事前計算して`drawPass()`に組み込み、**袋文字（strokeRect太）→線（strokeRect）→塗り（fillRect）の3パスすべてで文字と一緒に描く**方式に変更（strokeTextとstrokeRectでlineWidth＝2倍・lineJoin=roundの扱いが同じため見た目が一貫する）。

---

## 2026-07-11（テキストスタイルに太字・文字寄せを追加、Imageタブへの斜体等の反映漏れを修正）

ユーザー要望「Imageタブのテキストで太字・斜体・文字寄せドロップダウンもスタイルに入れたい。スタイルで斜体にしても有効にならない原因と思う」。

**原因（斜体が効かない）**: スタイルには元々`italicEnabled`/`underlineEnabled`があるが、Imageタブへの変換`_fontStyleAttrsFromStyle()`（image-tab.js）がcolor/stroke/bukuro/shadowしか拾っておらず、斜体・下線は無視されていた（textPropsのitalicはオプションバーのIボタン専用だった）。

**変更内容**:
- **スタイルのデータ構造に`boldEnabled`（太字）と`align`（left/center/right）を追加**。既存スタイルは未定義→false/'left'扱いで後方互換
- **スタイル編集UI 2箇所に「太字」チェックと「文字寄せ」セレクトを追加**: ①テキストスタイルモーダル（text-style-modal.js、`#tsm-bold-enable`/`#tsm-align-select`）②フォントタブのスタイルタブ（index.html＋19-font-manager.js、`#style-bold-enable`/`#style-align-select`。**片方のUIにしか無い項目は既存スタイルの再保存で値が消えるため、両方同時に追加する必要がある**）。CSSプレビューにもfontWeight/textAlignを反映
- **image-tab.js**: `_fontStyleAttrsFromStyle()`に`bold`/`italic`/`align`を追加（スタイル適用でtextPropsに反映→`_rerenderTextLayer`は元々bold/italic/align対応済み）。`getSelectedTextStyleInfo()`にも追加し、モーダルを開くと選択レイヤーの現在値が初期表示される。**オプションバーのB/Iボタン・Alignセレクトは廃止**（スタイルモーダルに一本化。縦チェックは残置）
- **09e `_fontMgrApplyStyleAttrsToTextEl`**: `font-weight`適用を追加（レイアウトタブのSVGテキストにも太字が効く）。`_fontMgrExtractStyleFromTextEl`にboldEnabled抽出を追加。**alignはレイアウトタブのSVGテキストには適用しない**（tspan配置が左端基準のためImageタブ専用。コメントで明記）
- **i18n.js**: `font.boldLabel`/`font.alignLabel`/`font.alignLeft`/`font.alignCenter`/`font.alignRight`を3言語追加
- **既知の制約**: スタイルの`underlineEnabled`（下線）はImageタブでは未対応のまま（Canvas2Dに下線描画がなく`_rerenderTextLayer`に実装がない。レイアウトタブでは有効）

---

## 2026-07-11（レイアウトタブ: タブ切り替えで袋文字・影のスタイルフィルタが消えるバグを修正）

ユーザー報告「テキストにスタイルを適用して他のタブから戻ると袋文字の適用が消える」。

**原因**: 袋文字・影は`<defs>`内の`<filter>`＋`filter="url(#id)"`参照で実現されているが、`savePanelSvg`（07-pages.js）と`saveOverlaySvg`（09b）はdefsから**clipPathとmask（data-ccc-mask）だけ**を保存用SVGに持ち回っており、フィルタ定義が保存されなかった。タブを離れて戻ると`buildMergedSvg`が保存データからページを再構築するため、フィルタ参照が宙に浮き袋文字・影だけ消える（塗り・線・斜体・下線は要素属性なので無事＝「線は残るのに袋文字が消える」報告と一致）。

**修正**:
- `_collectReferencedFilters(targetSvg, sourceDefs)`を07-pages.jsに新設: コンテンツ内の`filter="url(#...)"`参照を解決してフィルタ定義をtargetSvgのdefsへ取り込む。`savePanelSvg`/`saveOverlaySvg`のシリアライズ直前に呼ぶ。復元側の`buildMergedSvg`は元々defsの子を全部マージ（重複IDスキップ）するので保存側の修正のみで完結
- **同種の漏れも修正**: ①異コマへの複製/移動（05-groups-move.js、`panelSvgContent`直接編集のため移動先defsにフィルタが入らなかった）の2箇所にも同ヘルパーを適用。移動元は要素削除後の再保存で参照されないフィルタが自然に落ちる。②テキスト→PNG（12-text-png-export.js）は defs丸ごと取り込みでフィルタ自体は描画されるが、`getBBox`がフィルタの膨張・影を含まないため固定余白20だと見切れる → stroke-width＋feMorphology radius＋feDropShadow(stdDeviation×3+dx/dy)を余白に加算
- Kaptureで実機確認: 袋文字適用→Imageタブ→レイアウトタブ復帰で袋文字が保持されること

---

## 2026-07-11（レイアウトタブ テキストオプションバーの整理: 色「手動」と★カテゴリボタンを削除）

ユーザー要望「色の手動はなくしスタイルで行いたい。フォント右横のカテゴリ追加/解除★ボタンも削除」。任意色の指定はスタイルモーダルの「塗り」に一本化した。

- **index.html**: `#color-preset`の`custom`オプション、`#text-color-custom`カラーピッカー、`#font-fav-add-btn`（☆/★）を削除。色プリセット（黒/白/赤/青）は残置
- **09a-balloon-init.js**: `text-color-custom`のリスナーとcustom分岐、`fontFavAddBtn`リスナー、`_updateFontFavAddBtn()`呼び出し3箇所を削除
- **09d-balloon-tools.js**: `_toggleFontFavorite`/`_updateFontFavAddBtn`関数を削除。`syncFontFamilyUI`の色同期はプリセット一致時のみセレクトを合わせる形に簡素化（プリセット外の色＝スタイル由来はセレクトを変更しない）
- **style.css**: `#font-fav-add-btn`ルール削除。**i18n.js**: `common.custom`/`layout.fontFavAddTitle`/`layout.customTextColorTitle`を3言語とも削除
- フォントのカテゴリ管理自体はフォントタブ（`FONTMGR_FAV_CAT`等は19/20で現役）とカテゴリ絞り込みセレクトで引き続き可能。Kaptureで★・手動・ピッカーの消滅とcolor-presetが4option（黒白赤青）であることを確認

---

## 2026-07-11（レイアウトタブ: 縦書きチェックの選択中テキストへの即時反映＋スタイルモーダルのプレビューをSVG化）

ユーザー報告2件。①テキスト選択中に「縦」チェックをON/OFFしても切り替わらない、②スタイルモーダルのプレビューとレイアウト上の実表示が違う。

### ① 縦書きチェックの即時反映
- 従来の`#text-vertical`のchangeは`state.balloon.isVertical`（新規作成時のデフォルト）を変えるだけだった。SVGテキストの縦書きは`writing-mode`属性＋tspan配置（縦: `x`が列ごとに左へ/`y`固定、横: `dy=1.2em`）の両方の切替が必要
- **09e-text-tool.js**: `_setTextElVertical(textEl, isVertical, keepCenter)`を新設し、`applyTextInput`の新規/再編集パスの縦横レイアウト構築をこれに統一（**再編集時にwriting-modeが切り替わらない既存バグも同時に解消**）。`keepCenter=true`で切替前後のBBox中心を保って全体シフト（縦書きは親x,yから左へ列が伸びるため、そのままだと行数の多いテキストがコマ外へ飛び出す。回転がある場合は回転中心も追従）
- **09a-balloon-init.js**: changeリスナーで選択中テキストに`_setTextElVertical(..., true)`→`renderTextHandles`→`savePanelSvg`（font-sizeの即時反映と同じパターン）
- **09d-balloon-tools.js**: `syncFontFamilyUI`で選択テキストの`writing-mode`をチェックボックスと`state.balloon.isVertical`に同期（再編集ダイアログで意図せず縦横が変わる既存の食い違いも解消）

### ② スタイルモーダルのプレビューをSVGレンダリングに変更
- ズレの原因は2つ: (a)プレビューがCSS（`-webkit-text-stroke`=中心線基準でfillを侵食＋`text-shadow`）、実表示がSVG（`paint-order: stroke fill`=外側のみ＋`feMorphology`袋文字＋`feDropShadow`）で描画方式が根本的に違う、(b)previewSizeをpt換算（÷3.528）で渡す一方スタイルの線幅等はSVG単位のまま適用されるため、線の相対太さが約3.5倍ズレる
- **text-style-modal.js**: プレビューを2枚重ねdiv→`<svg><text>`に変更し、実適用と同じ`_fontMgrApplyStyleAttrsToTextEl()`を通して描画（レンダリングパスが同一なので原理的に一致）。viewBoxはBBox＋スタイル余白（袋文字/線/影）でフィット、`document.fonts.ready`後に再フィット
- **09a-balloon-init.js**: previewSizeをSVG単位のまま渡すよう変更（選択テキストの`font-size`実値、未選択時は`state.balloon.fontSize×3.528`）。モーダルの「サイズ」欄もSVG単位になる
- フォントタブ本体のスタイルタブ・アセットパネルFタブのミニプレビューはCSSのまま（`_fontMgrRenderTextStylePreview`は残置）。Imageタブから開いた場合もSVGプレビューになる（ImageタブはCanvas描画のため厳密には別物だが、旧CSSプレビューより近い）
- Kaptureで実機確認: 縦⇔横往復（中心保持）、モーダルのサイズ欄529（=150pt）表示、線30/袋60/影の適用結果がプレビューと同構成であることを確認

---

## 2026-07-11（Imageタブ: テキストツールに縦書き機能＋G'MIC設定UI）

### G'mic起動不能の修正＋設定タブ「G'MIC 設定」
- 7/1のクリーンアップでハードコードパスを除去した際、`settings.json`（gitignore対象）への`gmicQtPath`の設定が漏れて空`{}`のままだったため、レイアウト/Imageタブ両方でG'MIC GUIが起動しなくなっていた（`gmic-temp`への入力書き出しまでは成功）
- 設定タブに「G'MIC 設定」ブロック（パス入力＋保存＋ファイル存在チェック警告）を追加。API: GET/POST `/api/ccc/local-gmic/settings`（通常ルート＋ディスパッチテーブル両方に登録）。`_gmic_run_gui`は実行時に`_app_settings`を読むため**パス変更の反映に再起動不要**（ルート追加自体は要再起動）
- `initGmicSettings()`（14-integrations.js）を設定タブ表示時に呼ぶ（01-state.js）。i18nキー`settings.gmic*`6個×3言語追加

### Imageタブ テキストツール縦書き
- オプションバーに「縦」チェックボックス（`#ie-text-vertical`）を追加。`textProps.vertical`として保存され、選択中レイヤーへの切替は`_applyTextToolChangeToSelection`経由で中心保持のまま即反映
- Canvas2Dに縦書きはないため、`TextTool.js`に`layoutVerticalText()`（行=列で右から左、長音・括弧類・半角文字は90°回転＋実測幅advance、句読点0.3em/小書き仮名0.1em右上寄せ）と`drawVerticalCells()`をexport。`createLayerData`/`_measureTextBox`/`_rerenderTextLayer`（袋文字/線/影/塗りを`drawPass()`で共通化）に縦分岐を追加
- フォントタブのプリセット適用/挿入も`preset.isVertical`を反映するように（スタイル単体適用は縦書き非変更のまま）。制約: 縦書き時はalign無視（全列上端揃え）

---

## 2026-07-11（Nanobanana: .env読込の実装とAPIキー取り扱いのセキュリティ改善）

ユーザー報告「APIキーの.envファイルをルートフォルダに置いているが読み込めない」。原因は**`.env`を読み込む処理がそもそも存在しなかった**こと（`os.getenv()`は実際の環境変数しか見ないため、ファイルを置くだけでは無効だった）。

### 実装内容（py/ccc.py）
- **`_load_env_file()`を新設**: `PLUGIN_DIR/.env`をKEY=VALUE形式でパースし、**未設定の環境変数にのみ**`os.environ`へ取り込む（優先順位: 実環境変数 > .env > settings.jsonの`nanobananaApiKey`）。python-dotenv非依存の最小実装。#コメント行・空行・値の引用符を許容し、メモ帳保存で付きがちな**BOM付きUTF-8**（`utf-8-sig`）にも対応
- **APIキーをURLクエリ→HTTPヘッダーに移行**: 従来は`?key={KEY}`をURLに埋めており、ログ・プロキシ・エラーメッセージにキーが残るリスクがあった。generateContent／predict／modelsの3エンドポイントすべて`x-goog-api-key`ヘッダー送信に変更
- **キー未設定時のガード**: generate/modelsの両ハンドラで、Google APIに投げる前に「.envにNANOBANANA_API_KEYを記載しComfyUIを再起動」という具体的な案内をエラー返却するようにした（従来はGoogleの403がそのまま出て原因が分かりにくかった）
- **`.gitignore`を新設**: `.env`・`settings.json`（ローカルパス設定）・`__pycache__/`・`output/`・`assets/assets.json`・`*.bak`
- 確認済みの安全性: 静的配信ルート（`/ccc_static`等）はstatic/assets/output配下のみで**`.env`はWeb経由で取得不可**。`/api/ccc/nanobanana/key`は従来どおりマスク値のみ返す

### 検証・注意
- `py_compile`OK。`_load_env_file`と同一ロジックで実`.env`のパースを検証し、`NANOBANANA_API_KEY`（39文字）が正しく取得されることを確認（キー本体はマスク表示で確認）
- **py側の変更はComfyUI再起動後に有効**。再起動後、Nanobananaタブのキー状態表示（マスク表示）で読み込みを確認できる

### 追記: 429エラーの顛末（同日解決）
実装後にユーザーから「新キー取得・従量課金購入済みなのに429」の報告。切り分けの結果、**`.env`が3月から未更新で旧キーのままだった**（429=旧キーの無料枠枯渇、その後旧キー無効化で400に変化）。OS環境変数には残存なし、指定3モデル名はモデル一覧APIで実在確認済み。ユーザーが`.env`を新キーに更新しComfyUI再起動後、`/api/ccc/nanobanana/key`のマスク値が新キー（53文字）に一致し、アプリ経由の`gemini-3.1-flash-lite-image`生成が成功（status ok・1枚）することをエンドツーエンドで確認。新実装（.envローダー＋ヘッダー認証＋新モデル名）の全経路が実運用で検証された。

---

## 2026-07-11（Nanobananaタブ: モデル一覧を更新）

旧一覧（gemini-3.1-flash-image-preview / gemini-3-pro-image-preview / gemini-2.5-flash-image）を、ユーザー指定の3モデルに更新。

- `templates/index.html` の `#nanobanana-model` セレクト: **gemini-3.1-flash-lite-image / gemini-3.1-flash-image / gemini-3-pro-image**（この順、先頭がデフォルト選択）
- `py/ccc.py` の `handle_nanobanana_generate` のフォールバック既定値も `gemini-3.1-flash-lite-image` に更新（フロントは常にmodelを送信するため実質は保険。**py側の変更はComfyUI再起動後に有効**）
- モデル選択の永続化は無し（nanobanana.jsはセレクト値を読むだけ）のため他に波及箇所なし。Kaptureでセレクトの3option反映を確認済み

---

## 2026-07-11（フォントタブ: 左パネルのフォント一覧をフラット表示化）

ユーザー要望「左のフォント一覧ペインの英語/ひら・カナ/数字…のフォルダ展開表示をやめたい（検索でフィルタリングできるため不要）」。従来の「大カテゴリ（英語A-Z/ひら・カナ/数字/その他）→頭文字（A〜Z/あ行〜わ行）」の2段階折りたたみツリーを廃止し、件数表示＋フォント項目の単純なフラット一覧に変更した。

- **19-font-manager.js**: `_fontMgrRenderList()`をフラット描画に書き換え。専用だった`_fontMgrClassify`（かな行分類）・`_FONTMGR_CATS`（大カテゴリ定義）・`_fontMgrSortSubs`を削除。**`_fontMgrGroupOpen`/`_fontMgrToggleGroup`はアセットパネル「F」タブ（09e `_fontAssetBuildGroup`）が共用しているため残置**（コメントを現状に合わせて更新）
- **i18n.js**: 前セッション（Phase 2③）で追加したばかりの`font.catEn`/`font.catJa`/`font.catOther`/`font.subOther`が未使用になったため削除（628キー×3言語）。`font.charNumbers`はHTML側チェックボックスで使用中のため残置
- **style.css**: サブグループヘッダー`.fontmgr-group-header`系3ルールを削除。`.fontmgr-cat-header`・`.fontmgr-group-arrow/label/count`は「F」タブが使用中のため残置（コメントを更新）
- 検証: node --check・キー突合・削除定義の残存参照ゼロを機械確認。Kapture実機でシステム506件のフラット表示、名前検索「meiryo」→「2件」に絞り込み、クリック選択→右パネル/プレビュー反映、コンソールエラーなしを確認

---

## 2026-07-11（フォントタブ: カテゴリ「お気に入り」を予約済みカテゴリ化）

ユーザー要望「Fontタブのグループ（カテゴリ）のお気に入りを、ページ管理のstock/ゴミ箱と同様の予約済みグループにしたい」。従来はお気に入りカテゴリが空のとき（全カテゴリ0件時）のみ自動作成され、他のカテゴリがあれば削除したまま復活しなかった。

### 実装内容
- **19-font-manager.js**: `FONTMGR_FAV_CAT = 'お気に入り'`（データキーはUI言語によらず固定）、`FONTMGR_RESERVED_CAT_NAMES`（3言語表示ラベル 'お気に入り'/'Favorites'/'收藏' を新規作成禁止）、`_fontMgrCatLabel(cat)`（予約カテゴリのみ`fontsel.defaultCategory`で表示翻訳）、`_fontMgrCatNames()`（予約カテゴリ先頭固定の一覧）を新設。`_fontMgrLoad()`で「無ければ復元して保存」する常設化（従来の「全カテゴリ0件時のみ`t()`名で作成」を置換——言語別キーが乱立する問題も同時に解消）
- **20-font-presets.js**: カテゴリ追加に予約名ガード（alert `font.reservedCategoryName`）、カテゴリ削除に予約カテゴリガード（alert `font.reservedCategoryDelete`）。カテゴリタブ・右パネル2セレクトを`_fontMgrCatNames()`/`_fontMgrCatLabel()`経由に変更（お気に入り先頭・表示翻訳）
- **09d-balloon-tools.js**: レイアウトタブの`#font-fav-cat-select`も同様に先頭固定＋表示翻訳。★ボタンの追加先が「すべて」選択時は従来の「先頭カテゴリ」から**予約済みカテゴリ「お気に入り」固定**に変更（挙動が予測可能になる）
- i18nキー+2（632×3言語）: `font.reservedCategoryName`/`font.reservedCategoryDelete`
- `_fontMgrLoad()`は09a（レイアウト初期化・DOMContentLoaded）でも呼ばれるため、フォントタブを開かなくても起動時に復元される

### 既知の制限
- Imageタブ（image-tab.js）はlocalStorage`fontmgr_favorites`を直接読んでカテゴリ名を生キーで表示するため、en/zh UIでは予約カテゴリが「お気に入り」のまま表示される（実害は表示のみ。Phase 2④のImage連携i18n時に`window._fontMgrCatLabel`経由に直すのが自然）
- 既存データに'Favorites'/'收藏'という名前のユーザーカテゴリが万一あっても統合はしない（新規作成のみ禁止）

### 検証
node --check 4ファイルOK・キー632×3言語一致・`t()`参照未定義ゼロ。Kapture実機: 削除済み状態から起動→「お気に入り (0)」がカテゴリタブ先頭に復元、削除ボタン→予約alert（en「"Favorites" is a reserved category...」）、「お気に入り」名での新規作成→予約名alert、日本語UIでも先頭表示・コンソールエラーなし。

---

## 2026-07-11（多言語化(i18n) Phase 2 第3弾：フォントマネージャー(19, 20)のt()化完了）

Phase 2第3グループ「フォントマネージャー」の2ファイル（19-font-manager.js / 20-font-presets.js）を完了。キー数は608→630×3言語（+22）。置換はPython完全一致replace（32ルール、全件一致）。`node --check`＋キー集合相互差分ゼロ＋`t()`参照221キー全定義済みを機械検証、Kapture実機で英語UI（フォントリストのカテゴリヘッダ「English A-Z」・件数「31 fonts」・右パネル「(No font selected)」・スタイル/プリセットセレクト「(New)」「(No style)」・スタイル削除alert）と日本語復帰・コンソールエラーなしを確認済み。

### 対応ファイルと内容
- **19-font-manager.js**: デフォルトお気に入りカテゴリ（`fontsel.defaultCategory`を計算プロパティキーで使用）、大カテゴリラベル`_FONTMGR_CATS`（`font.catEn`/`font.catJa`/`font.charNumbers`再利用/`font.catOther`）、「他」サブグループ、リスト空表示・件数、右パネルのフォント未選択・タグチップtitle、スタイル保存/削除のalert/confirm
- **20-font-presets.js**: スタイル/プリセットセレクトの先頭option（`font.newOption`/`font.noStyleOption`＝Phase 1定義済みキー再利用）、プリセット保存/削除、カテゴリタブ「すべて」（`layout.fontCatAll`再利用）、システムフォント読込ステータス（`common.loading`/`fontsel.fetchFailed`再利用）、カテゴリ追加/削除のprompt/alert/confirm、適用ボタンalert（`textTool.selectTextFirst`再利用）

### 設計判断
- **フォント見本テキストは翻訳対象外（意図的）**: `_FONTMGR_PREVIEW_TEXTS`（いろは・カタカナ・千字文）、`_FONTMGR_SENT_H/V`（イーハトーヴォ）、スタイルプレビュー既定文字「あ亜Aa1」は、日本語グリフの見本という目的そのものなので言語によらず据え置き
- **かな行ラベル（あ行〜わ行/ア行〜ワ行）も据え置き**: フォント名の頭文字分類という日本語固有概念であることに加え、`_fontMgrSortSubs`がラベル先頭文字の`order.indexOf`でソートしており翻訳すると並び順が壊れるため
- デフォルトカテゴリ名は永続化データだが、Phase 2の方針どおり「新規生成時のみ現在言語」（既存の保存済み`fontmgr_favorites`は移行しない）

### 残タスク（Phase 2続き）
④Image連携(image-tab.js, image-tab/*.js)/Nanobanana(nanobanana.js)/PixiFX(15) → ⑤スクリプト(21) → ⑥3Dポーズ(23)/G'MIC・Eagle(14)/その他（00-03, 05, 12-14, 16, 18）。その後Phase 3（ヘルプ`_HELP_DATA`）・Phase 4（バックエンド）。

---

## 2026-07-11（多言語化(i18n) Phase 2 第2弾：ページ/作品管理(07, 10, 11a, 11b)のt()化完了）

Phase 2第2グループ「ページ/作品管理」の4ファイル（07-pages.js / 10-output-pages.js / 11a-work-manager.js / 11b-page-manager-tab.js）を完了。キー数は538→608×3言語（+70）。置換はPython完全一致replace（91ルール、全件expected count一致）。`node --check`＋「3言語キー集合の相互差分ゼロ」「JS内`t()`参照194キー全定義済み」を機械検証、Kapture実機で英語UI（作品カード・グループ一覧・ゴミ箱表示・予約グループ名alert・出力ページ一覧・レイアウト空メッセージ）と日本語復帰・コンソールエラーなしを確認済み。

### 対応ファイルと内容
- **07-pages.js**: 保存/削除/作成のalert・confirm・prompt（コマの線幅）、ページセレクト先頭option、アセットパネル「P」タブ空メッセージ、レイアウトプレビューのエラー表示（`page.msg*` 16キー＋`layout.msgNoImageSelected`）
- **10-output-pages.js**: フィルタバーの作品/グループラベル、ページ一覧空表示（`asset.noPages`再利用）、番号入力title、画像取込のalert（`page.workLabel`/`page.orderInputTitle`/`page.msgNotImageFile`/`page.msgImportFailed`）
- **11a-work-manager.js**: `TRASH_GROUP_LABEL`（`page.trashLabel`）、`WORK_SIZE_PRESETS` 6種＋カスタムoption、作品新規作成ダイアログのalert/prompt/confirm、「作業中」ラベル・バッジ・作品カード情報行、グループ一覧の`(nページ)`、テンプレート挿入系alert（`page.preset*`/`page.activeWorkLabel`等 20キー）
- **11b-page-manager-tab.js**: グループ追加/リネーム/削除・作品削除・ページ移動/複製/一括削除/完全削除のalert/confirm、リネームモーダルHTML、連番リネームprompt/confirm、サイドパネル動的ボタン（復元/移動・完全削除/削除（ゴミ箱））、プロパティ表示、ゴミ箱バッジ`削除: 日時`（`page.*` 30キー）

### 設計判断・注意点
- **`TRASH_GROUP_LABEL`はロード時に`t()`で確定する**（i18n.jsが最初に読み込まれるため可能）。予約グループ名ガード`RESERVED_GROUP_NAMES`は、言語切替で別言語のラベル名グループが作れてしまわないよう3言語のラベル（'ゴミ箱'/'Trash'/'回收站'）をリテラルで全て含めた
- **確認ダイアログのラベル合成**: 単一選択`「名前」`と複数選択`選択中の N ページ`を`page.quotedName`/`page.selectedPagesLabel`で作り、`page.confirmTrash`/`page.confirmPermanentDelete`（label引数）に渡すネスト`t()`パターンを導入（削除系4箇所を2キーに集約）
- **既存キーの再利用**: `tmpl.selectTemplate`/`tmpl.notFound`/`tmpl.alreadyExists`/`tmpl.selectGroup`/`tmpl.newGroupNamePrompt`/`tmpl.renameOk`/`tmpl.enterName`/`tmpl.renameFailed`/`tmpl.groupLabel`/`tmpl.groupNone`/`common.cancel`/`asset.noPages`/`asset.noTemplates`/`page.noWorks`/`page.groupSelectOption`/`page.moveGroupOption`/`page.moveBtn`/`page.moveBtnTitle`/`page.deleteTrash`/`page.exportEmptyMessage`/`layout.notSelected`/`layout.msgImageLoadFailed`
- 11bの出力プレビュー空メッセージは旧文言が「**左**のリストから〜」でHTML静的側（`page.exportEmptyMessage`「**右**のリストから〜」）と不整合だったため、再利用により「右」に統一（ページ一覧は実際に右側にある）
- console.log/console.errorのログ文言は従来どおり翻訳対象外

### 残タスク（Phase 2続き）
③フォントマネージャー(19, 20) → ④Image連携(image-tab.js等)/Nanobanana/PixiFX(15) → ⑤スクリプト(21) → ⑥3Dポーズ(23)/G'MIC・Eagle(14)/その他（00-03, 05, 12-14, 16, 18）。その後Phase 3（ヘルプ`_HELP_DATA`）・Phase 4（バックエンド）。

---

## 2026-07-10（多言語化(i18n) Phase 2 第1弾：レイアウトタブ系JSのt()化完了）

Phase 1完了（下記エントリ）に続き、Phase 2（JS動的生成文言の`t()`化）に着手。計画の第1グループ「レイアウトタブ系」の全ファイルを完了した。キー数は538×3言語（Phase 1完了時437→+101）。JS内の`t('...')`参照116キーすべての定義をNodeスクリプトで機械検証、Kapture実機で英語UIでの動的描画（レイヤーパネル・コマセレクト・テンプレートグループフィルタ）とコンソールエラーなしを確認済み。

### 対応ファイルと内容
- **08-panels-images.js**: コマセレクト生成（`common.panelName`/`common.overlayFull`）、画像挿入系alert 7種（`layout.msg*`）
- **06b-template-manager.js / 06c-template-wizard.js**: テンプレート作成/削除/リネームのalert/confirm/prompt、リネームモーダルHTML、グループセレクト再構築、サイドパネル表示（`tmpl.*` 24キー）
- **04a-mask-core.js**: マスク対象ラベル・ステータス表示・alert/confirm、マスク既定名の生成（`mask.*` 14キー）
- **04b-layer-panel-render.js**: レイヤーパネルの全行テンプレート（オブジェクト既定名5種・ボタンtitle約20種・コマ/オーバーレイ行・マスク行、`layer.*`）
- **09a/09c/09d/09e**: テキスト保存・画像変換alert、フォント選択optgroup（システム/カテゴリ）、スクリプト挿入・スタイル適用のalert、Fタブ連携アセットグリッド（`textTool.*`/`fontsel.*`）
- **17a/17b**: レイヤー描画のステータス表示一式（`draw.*` 10キー）
- 06a/17cには対象文字列なし、09bは前回対応済み

### 設計判断（Phase 2で踏襲すること）
- **補間が必要な文言は関数値キー**（`'tmpl.created': (name) => \`テンプレート "${name}" を作成しました。\``）にし、呼び出し側は`t('tmpl.created', name)`。i18n.jsの`t()`が`typeof val === 'function'`で自動処理する（Phase 0からの仕様、今回初めて本格使用）
- **永続化されるデフォルト名**（レイヤーの`dataset.name`「フキダシ N」、マスクの`data-ccc-mask-name`「マスク N」、フォントカテゴリ既定名「お気に入り」等）も生成時に`t()`を通す方針にした。既存の保存済み名はそのまま表示され、新規作成分だけ現在のUI言語の名前になる（データ移行はしない）
- 置換は「元文字列の完全一致replace」をPythonスクリプトで一括実行し、置換漏れ（NOT FOUND）を検出する方式。長文・テンプレートリテラル内の置換も安全にできた
- 検証: `node --check`＋「JS内`t('key')`全抽出→ja辞書との突合」をNodeワンライナーで実施（HTML側`data-i18n`チェックと合わせて再利用可能）

### 残タスク（Phase 2続き）
計画の残りグループ: ②ページ/作品管理(07, 10, 11a, 11b) → ③フォントマネージャー(19, 20) → ④Image連携(image-tab.js等)/Nanobanana/PixiFX(15) → ⑤スクリプト(21) → ⑥3Dポーズ(23)/G'MIC・Eagle(14)/その他（00-03, 05, 12-14, 16, 18）。その後Phase 3（ヘルプ`_HELP_DATA`）・Phase 4（バックエンド）。

---

## 2026-07-10（多言語化(i18n) Phase 1完了：templates/index.html 静的部分の全面3言語対応）

前回（下記エントリ）の続き。`templates/index.html`の残り全セクションに`data-i18n`/`data-i18n-title`/`data-i18n-placeholder`属性を付与し、`static/js/i18n.js`のja/en/zh各ブロックに対応キーを追加した。**これでPhase 1（静的HTML）は完了**。最終キー数は3言語とも437キー（開始時点78キー→+359）。Node実行スクリプトで「3言語のキー集合が完全一致」「HTMLが参照する全キーが定義済み」を機械検証し、Kaptureブラウザ実機でja/en/zhの3言語切替表示・コンソールエラーなしを確認済み。

### 今回対応したセクションとキー名前空間
- **レイアウトタブ本体**（`layout.*`、最大ボリューム・約130キー）: ページコントロール／ドロー（ボックス・SVG色変更・SVG→PNG）／フキダシ（h2パラメータ含む）／テキスト／画像（Processing・G'MIC・PixiJS FX）／マスク／3Dポーズの全サブタブ
- **Imageタブ**（`image.*`）: 元々英語主体のため日本語箇所のみ（Close/Save系ボタンのtitle、統合、全体不透明度、調整レイヤー12種、レイアウトに送る）
- **フォントタブ**（`font.*`）: ソースタブ・検索・プレビュー5タブ（基本/文章/カスタム/カテゴリ一覧/スタイル）・スタイル/プリセット作成パネル・右パネル（タグ・カテゴリ管理）
- **ページタブ**（`page.*`）: 作品管理／テンプレート／出力の3サブタブ全体（サイドパネル群・出力コントロール・ページ一覧含む）
- **Nanobananaタブ**（`nb.*`）／**スクリプトタブ**（`script.*`）／**ヘルプ検索欄**（`help.searchPlaceholder`）
- **レイヤーサイドパネル**（`layer.*`）／**ダイアログ3種**（`dialog.*`: 作品新規作成・テキスト入力、`wiz.*`: テンプレートウィザード）
- 頻出語彙は`common.*`に集約（undo/flipH/flipV/black/white/red/blue/custom を今回追加）し、既存キー（`common.save`等）も積極的に再利用して重複キーを作らない方針を維持

### 実装上の注意点（今後の同種作業で必須の知識）
- **`applyI18nToHtml()`は`textContent`を丸ごと書き換える**ため、`<input>`を内包する`<label>`はテキスト部分を`<span data-i18n>`で包んでから属性を付ける必要がある（今回フォントタブ・マスクサブタブ・ウィザード等で多数実施）。子要素を持つ要素に直接`data-i18n`を付けると子要素が消える
- **JSが初期化時に上書きする箇所はdata-i18nだけでは不十分**。今回は最小限のJS側`t()`化を2箇所だけ実施: `09b-balloon-shapes.js`の`編集: ON/OFF`（`layout.editModeOn/Off`）と`06c-template-wizard.js`の分割モードヒント（`wiz.hintAll/hintSingle`）。それ以外のJS動的生成文言（ステータス表示、セレクト再構築、alert等）はPhase 2の対象として未着手
- `display:none`の互換用select（`#layer-draw-shape`・`#shape-type`）は不可視のため意図的にスキップ
- `<img alt>`は`applyI18nToHtml`が未対応（今回1箇所のみ・実害軽微のため見送り。必要になったら`data-i18n-alt`対応を追加する）
- 検証はNodeワンライナーでLANGUAGESをevalし、`ja/en/zh`キー集合の相互差分と`data-i18n(-title|-placeholder)`参照キーの未定義を機械チェックするのが確実（このセッションで3回実施し、都度ゼロを確認）

### 残タスク（Phase 2以降、計画は前回エントリ＋プランファイル参照）
- Phase 2: JS動的生成コンテンツの`t()`化（レイヤーパネル項目・alert/confirm・フォントマネージャー動的リスト・Nanobananaステータス・スクリプトタブのテーブル等、44ファイルに散在）
- Phase 3: `22-help-tab.js`の`_HELP_DATA`長文翻訳
- Phase 4: `py/ccc.py`のエラーメッセージ

---

## 2026-07-10（多言語化(i18n)着手：基盤構築 + Phase 1一部）

ユーザー要望「i18n化したい、作業計画を立ててほしい」。対象言語は英語＋中国語（日本語含め3言語）、翻訳文はClaudeが作成、**段階的に**進める方針で合意（プランファイル: `C:\Users\statsu-11\.claude\plans\purrfect-tumbling-ullman.md`）。

### 事前調査で判明した重要事項
- 姉妹プロジェクト ComfyUI-Workflow-Studio（`comfyUI-wf-maneger/ComfyUI-Workflow-Studio`）に完成済みのi18nシステム（`static/js/i18n.js`、en/ja/zh、`t()`関数、設定タブの言語セレクタ、`location.reload()`方式）が存在し、これを本プロジェクトの制約（classic `<script>`共有グローバルスコープ、ESモジュールではない）に合わせて移植する形にした。
- `templates/index.html`（1,658行）は静的な日本語文字列が300〜450以上（ボタン・ラベル・`option`・`title`・`placeholder`）。i18n機構は元々皆無だった。
- `static/js/main/*.js`ほか計44ファイルにも日本語が広く散在（特に`22-help-tab.js`の`_HELP_DATA`は長文プローズで別枠）。JS側の変換はPhase 2以降（今回は未着手）。

### 採用したアーキテクチャ
- 新規 `static/js/i18n.js`（classic `<script>`、他の全スクリプトより前に読み込み）: `LANGUAGES = {ja, en, zh}`（ドット区切り名前空間キー、例 `nav.layout`, `settings.eagleUrl`）、`t(key, ...args)`（フォールバック: 現在言語→ja→キー自身）、`getLang()`/`setLang()`（`localStorage`キー`ccc_ui_lang`に永続化まで内包）、`getLanguageOptions()`、`applyI18nToHtml(root)`（`[data-i18n]`/`[data-i18n-placeholder]`/`[data-i18n-title]`属性を走査して適用する汎用walker）
- 静的HTML（`templates/index.html`）は`data-i18n`系属性方式（参考実装のid対応表手書き方式ではなく、文字列数が多いため属性方式を採用）
- `static/js/main/01-state.js`の`DOMContentLoaded`冒頭で`applyI18nToHtml()`と`initI18nSettings()`（設定タブの言語セレクタ変更→`setLang()`→`location.reload()`）を呼ぶ
- 設定タブに言語セレクタ（日本語/English/中文）を新設

### 今回実施した範囲（Phase 0 + Phase 1の一部）
- **Phase 0（基盤+パイロット、完了）**: `i18n.js`基盤一式、トップナビ9タブボタン+ws関連2ボタン、設定タブ全体（新設の言語セレクタ含む既存Eagle設定一式）。ja/en/zh 3言語の翻訳を実際に作成し、`data-i18n`属性・`t()`関数の両方式が動くことをKaptureで実機検証済み（言語切替→リロード→表示反映→localStorage永続化まで確認）。
- **Phase 1一部（完了）**: 全タブ共通の左サイドバー「アセットパネル」と、レイアウトタブ専用の「ツールペイン」（ドロー/フキダシ/テキスト/画像/マスク/3Dポーズの切替ボタン）、計約30文字列をdata-i18n化・3言語翻訳。構文チェック・ブラウザロード確認（コンソールエラーなし）まで完了。

### 未着手（次回に持ち越し）
Phase 1の残り: レイアウトタブ本体（最大、約470行）・Imageタブ・フォントマネージャータブ・Nanobananaタブ・スクリプトタブ・設定タブ残り・ヘルプタブ静的UI部分・テンプレート作成ウィザード。その後のPhase 2（JS動的生成コンテンツのtabごとの`t()`化）・Phase 3（ヘルプ本文の翻訳）・Phase 4（バックエンドエラーメッセージ）は計画のみでまだ着手していない。詳細な分割案はプランファイル参照。

**Why:** ユーザーの明示的な「段階的に進めたい」意向を尊重し、1回のセッションで全体を変換しようとせず、基盤構築＋実証可能な最小範囲でまず完成させ、動作確認してから次に進む形にした。

**How to apply:** 次回i18n作業を再開する際は、まず`templates/index.html`のレイアウトタブ本体（`<section id="layout-tab">`、行136付近から）から着手する。手順は既に確立済み: ①対象セクションの日本語文字列に`data-i18n`/`data-i18n-placeholder`/`data-i18n-title`属性を付与、②`static/js/i18n.js`の`LANGUAGES.ja`/`.en`/`.zh`各ブロックに同じキーで追記（名前空間はタブ名を先頭に、例: `layout.xxx`）、③`node --check`で構文確認、④Kaptureまたは実機で言語切替検証。既存の`common.save`/`common.cancel`/`common.delete`など汎用キーは使い回すこと（新規に同義語キーを作らない）。

## 2026-07-10（重大バグ修正：レイアウトタブの継続利用でメモリリーク→クラッシュ）

ユーザー報告: Chromeタブのメモリが600MB→4000MB+まで際限なく増加し、フレーム表示がどんどん遅くなり、最終的に「Not enough memory / Out of Memory」でタブがクラッシュする。作品を開いてオブジェクトを選択するだけで発生。

### 原因

`renderLayoutTab()`（`07-pages.js`）は、Undo・ページ切替・パネル移動・画像挿入・フキダシパネル切替など**通常の編集操作のたびに呼ばれ**、そのたびに以下5つの`init*`系関数を再実行して新しいSVGを構築し直す：

- `initImageManipulation()`（`08-panels-images.js`）
- `initGroupManipulation()`（`06a-polygon-geometry.js`）
- `initDrawShapeManipulation()`（`17c-layer-draw-handles.js`）
- `initBalloonTools()`（`09d-balloon-tools.js`）
- `initTextTools()`（`09e-text-tool.js`）

これら5関数はいずれも内部で`document.addEventListener(...)`/`window.addEventListener(...)`（mousemove・mouseup、計10個）を登録していたが、**対応する`removeEventListener`が一切なかった**。`document`/`window`は再生成されないため、呼ばれるたびにリスナーが純粋に積み上がり、各リスナーのクロージャが「その回にレンダリングされた（もう画面から外れた）古いSVGツリー全体」を握ったまま解放されない。操作を続けるほどリスナー数とメモリ保持量が線形に増え続け、かつ毎回のmousemoveイベントで積み上がった全リスナーが実行されるため描画も徐々に重くなる——報告された症状と完全に一致する。

同じ「DOM移動+再初期化」パターンを使う`_layerDrawAttachOverlay`/`_maskAttachOverlay`/`_tmplWizAttachCanvasEvents`は、detach→attachの順で正しく`removeEventListener`していたため対象外（このパターンとの比較で問題箇所を特定）。

### 修正
5ファイルすべてで同じ形の修正: 各`document`/`window`リスナーを無名関数から名前付き変数に変更し、モジュールスコープの変数に保持。関数の先頭で「前回登録分があれば`removeEventListener`してから」新規登録するガードを追加した。

- `static/js/main/08-panels-images.js`: `_imgManipDocMouseMove`/`_imgManipDocMouseUp`/`_balloonManipDocMouseMove`/`_balloonManipDocMouseUp`
- `static/js/main/06a-polygon-geometry.js`: `_groupManipWinMouseUp`
- `static/js/main/17c-layer-draw-handles.js`: `_drawShapeManipWinMouseUp`
- `static/js/main/09d-balloon-tools.js`: `_balloonToolsDocMouseMove`/`_balloonToolsDocMouseUp`
- `static/js/main/09e-text-tool.js`: `_textToolsDocMouseMove`/`_textToolsDocMouseUp`

### 動作確認
全5ファイル構文チェック通過。ブラウザでの再読み込み・表示は正常（Kaptureの`domSize`メトリクスは今回の調査中に実DOM量と無関係な異常値を示すことが判明したため参考にせず、実機のタスクマネージャーでの確認をユーザーに依頼）。

**Why:** ユーザー報告の緊急バグ対応。同種のバグ（`init*`系関数を再入可能にする際、document/window等の永続オブジェクトへのイベント登録をdetach処理なしで追加する）が将来また混入しないよう、新規に同パターンの関数を書く際は必ずdetach-before-attachにすること。

### 追記（同日）: 上記修正だけでは改善せず、真因は別にあった

ユーザーがPC再起動まで行った上で再検証したが症状が改善しないとの報告。上記のイベントリスナー積み上がりは実在するバグで修正自体は正しいが、**主因は別にあった**。

#### 真因: 画像/フキダシの「クリック選択」だけで毎回ページ全体をディープクローンしていた

`08-panels-images.js`の画像本体・フキダシ本体の`mousedown`ハンドラが、実際にドラッグしたかどうかに関係なく**選択した瞬間に**`pushHistory()`を無条件で呼んでいた。`pushHistory()`（`07-pages.js`）は`state.activePage.panels`を`JSON.parse(JSON.stringify(...))`で丸ごとディープクローンして`state.history`に積む処理で、`panels`には画像がbase64データURLとして埋め込まれたSVG文字列（`panelSvgContent`）が含まれる。画像が多いページでは1回のクローンが数十MB規模になり得、`state.history`は20件で頭打ちにしているとはいえ、**クリックのたびに数十MB規模のstringify/parseが走る**ため、素早く連続してオブジェクトを選択・確認するだけで数百MB〜数GB規模のメモリ圧迫と処理遅延が発生していた。ユーザー報告「作品を開いてオブジェクトを選択しただけで重くなる」と完全に一致する。

比較のため他のオブジェクト種別（テキスト・グループ・図形描画）の選択ハンドラを確認したところ、いずれも選択だけではpushHistoryを呼んでおらず、画像とフキダシの2箇所だけがこのバグを持っていた。マスク編集の`_maskPointerDown`（`04a-mask-core.js:460`）は元々`if (!_maskState.historyPushed) { pushHistory(); _maskState.historyPushed = true; }`という「実際に描画し始めた最初の1回だけ積む」正しいパターンを使っており、今回はこれと同じパターンを画像・フキダシにも適用した。

#### 修正
`static/js/main/08-panels-images.js`:
- 画像ドラッグ: `mousedown`時の`pushHistory()`を削除し、`imgHistoryPushed`フラグを追加。実際に動いた最初の`mousemove`でのみ`pushHistory()`を呼ぶよう変更
- フキダシドラッグ: 同様に`balloonHistoryPushed`フラグを追加し、`mousedown`時の無条件`pushHistory()`を削除、最初の`mousemove`でのみ積むよう変更
- リサイズ/回転パス（`.image-handle`経由）はpushHistory自体を元々呼んでおらず未変更（Undo非対応は既知の別課題、今回はスコープ外）
- `mouseup`時の`savePanelSvg`（IndexedDB書き込み）は無条件のまま維持（リサイズ/回転との整合性を保つため、あえてガードしなかった）

### 動作確認
構文チェック通過、ブラウザでの起動・表示は正常。

**Why:** 「選択だけで重くなる」というユーザー報告の再現条件から、renderLayoutTab経由のリスナー積み上がり（レンダリング系操作で発生）よりも、画像/フキダシの単純クリック選択で毎回発生するこちらの方が主因である可能性が高いと判断し、両方を修正した。

---

## 2026-07-10（リリース前チェック：セキュリティ修正 + main.js モジュール分割）

### セキュリティ／不具合修正
- `py/ccc.py`: `PLUGIN_DIR` のimport漏れを修正（Eagle連携のローカルパス追加・G'MICサーバー起動がNameErrorでクラッシュしていた）
- `py/ccc.py` `handle_save_group_asset`: グループ名に単体の`..`を渡すことで`assets/`の1つ上へ書き込めるパストラバーサルを、`handle_delete_asset`と同様の`resolve()`ベース検証で修正
- `py/ccc.py` `_gmic_run_gui`: G'MIC実行ファイルパスのデフォルト値にハードコードされていた開発者のユーザー名パスを除去し、未設定時は明確なエラーメッセージを返すよう変更
- `static/js/nanobanana.js`: `refreshApiKey()`がバックエンドから返らない`data.key`を参照していたため、生成ボタンが常に「APIキー未設定」判定になり機能していなかったバグを修正（`status`で判定するよう変更）
- `static/js/main/`: 外部由来（共有アセット・テンプレート・プロジェクトファイル）のSVGをDOMに挿入する箇所（アセット挿入・ページ合成SVG描画）に`sanitizeSvgTree()`を追加し、`<script>`/`<foreignObject>`/`on*`属性/`javascript:`URLを除去してXSSを防止
- `static/js/main/`: レイヤーパネルの名前表示（画像・図形・テキスト・グループ・マスクレイヤー名、テンプレート名・グループバッジ）計8箇所の未エスケープ`innerHTML`挿入を`_escHtml()`でエスケープ

### main.js モジュール分割（18,313行 → 24ファイル）
保守性向上のため、`static/js/main.js`を責務ごとに`static/js/main/00-db.js`〜`23-pose3d-bridge.js`の24ファイルに分割。既存の`// ====`区切りコメントをそのまま分割点として採用し、内容の並び替え・変更は一切行っていない（分割後の再連結が原本と完全一致することをdiffで確認済み）。

- 引き続き`<script>`（非module）として読み込み、グローバルスコープ共有はそのまま維持（動作リスクを最小化するための意図的な選択。ESモジュール化はスコープ外）
- 読み込み順は`templates/index.html`の`<script>`タグ順に厳密依存（元main.js内のコード実行順序と同一になるよう分割）
- 各ファイル冒頭に「元main.jsの行範囲」「主なトップレベル定義一覧」をヘッダコメントとして付与。将来ESモジュール化する際の境界・importリストの土台として使える
- 旧`main.js`は`static/js/main.js.bak`として保持（ユーザー側バックアップに加えた保険）
- ファイル構成: `00-db`(IndexedDB) `01-state`(状態管理/初期化/タブ管理) `02-assets`(アセット管理) `03-layers-panel` `04-mask-layers` `05-groups-move` `06-template-wizard` `07-pages` `08-panels-images` `09-balloons`(フキダシ、最大3,119行) `10-output-pages` `11-works`(作品管理) `12-text-png-export` `13-export-pdf-epub` `14-integrations`(Eagle/G'MIC/WorkflowStudio) `15-pixifx-bridge` `16-processing-edit-tabs` `17-layer-draw` `18-svg-color-png` `19-font-manager` `20-font-presets` `21-script-tab` `22-help-tab` `23-pose3d-bridge`

### 動作確認
- 全24分割ファイル・`ccc.py`ともに構文チェック（`node --check` / `python -m py_compile`）通過
- 分割ファイルを再連結したものが元`main.js`と完全一致することをdiffで確認（欠落・重複・順序変更なし）
- Kaptureで実ブラウザ起動確認：起動ログが`DB connected`→`Plugin Initializing...`→`Plugin Initialized`→`NanobananaManager Initializing...`の順で正常出力、コンソールエラーなし（Kapture拡張自身の`Message exceeded maximum allowed size`ログを除く）
- 作品一覧→ページ選択→レイアウトタブ描画（コマ・吹き出し・レイヤーパネル）、Imageタブ切替、フォントタブ切替（プレビュー描画）まで一通り操作し、いずれも正常動作を確認

**Why:** 近日リリースに向けた全体チェックの一環。ユーザー要望「リファクタリングの必要性」「セキュリティチェック」への対応。バックアップ取得済みであることを確認の上でモジュール分割を実施。

### 追加クリーンアップ + さらなるファイル分割（同日追加作業）

上記の続きとして、リリース前クリーンアップと大きい分割ファイルのさらなる細分化を実施。

- **クリーンアップ**: `output/gmic-temp/`配下の蓄積一時ファイル（7.8MB、34件）を削除、`assets/test/`（テスト用SVG5枚）を削除、`__pycache__/`を削除。`assets/test`削除後は`/api/ccc/refresh-assets`を叩いて`assets.json`を再生成し、testフォルダのエントリが残らないことを確認
- **大きい分割ファイルのさらなる細分化**: 1,400行を超えていた5ファイルを、既存のセクション区切り/関数境界を安全な分割点としてさらに分割（内容の並び替え・変更は一切なし、各段階でdiffによる完全一致を確認）
  - `04-mask-layers.js`(1,553行) → `04a-mask-core.js`(マスク機能ロジック) + `04b-layer-panel-render.js`(renderLayerPanel本体)
  - `06-template-wizard.js`(1,713行) → `06a-polygon-geometry.js` + `06b-template-manager.js` + `06c-template-wizard.js`
  - `09-balloons.js`(3,119行) → `09a-balloon-init.js` + `09b-balloon-shapes.js` + `09c-balloon-handles.js` + `09d-balloon-tools.js` + `09e-text-tool.js`
  - `11-works.js`(1,462行) → `11a-work-manager.js` + `11b-page-manager-tab.js`
  - `17-layer-draw.js`(1,574行) → `17a-layer-draw-input.js` + `17b-layer-draw-commit.js` + `17c-layer-draw-handles.js`
  - 合計24ファイル→34ファイルに（`templates/index.html`の`<script>`タグ順も追従して更新）
- **ハマった点**: サブ分割時、分割元ファイル（例: `04-mask-layers.js`）自身が持っていた9行のヘッダーコメントが、最初のサブファイル（`04a-mask-core.js`等）の実コンテンツとして紛れ込み、存在しないファイル名を参照する重複ヘッダーが残っていた（動作への影響はないが紛らわしい）。5ファイルとも該当ブロック（8行）を削除して解消。**分割済みファイルをさらにサブ分割する際は、親ファイル自身のヘッダーが子ファイルの先頭に埋め込まれる点に注意すること**
- **未着手のまま残したもの**: `04b-layer-panel-render.js`の`renderLayerPanel()`は680行の単一巨大関数（画像/図形/テキスト/グループ/マスクレイヤーの描画ロジックを内部クロージャで実装）で、ファイル分割の安全な境界にできなかった。将来的に関数内部の構造化（レイヤー種別ごとの描画をヘルパー関数に切り出す等）をする場合は、動作リスクのあるリファクタリングになるため別途計画すること

### 動作確認（追加分）
- 34ファイル・`ccc.py`ともに構文チェック通過
- 34ファイル全ての再連結が元`main.js.bak`と完全一致することをdiffで再確認（クリーンアップ後の最終形）
- Kaptureで実ブラウザ再確認：起動ログ正常・コンソールエラーなし。作品一覧→ページ選択→開く→レイアウトタブでコマ・吹き出し・テキスト・レイヤーパネル（グループ/テキスト/マスクレイヤーオーバーレイ、全て名前表示含め正常）の描画を確認。テンプレート一覧タブの描画（`06b-template-manager.js`）も確認

**Why:** 前段のモジュール分割に続き、ユーザーが「はい、御願いします」で追加のクリーンアップとさらなる分割を承認。バックアップが既にある前提で作業。

---

## 2026-07-10（ヘルプ「スクリプト」項目を要素タブ・列名変更に合わせて更新）

- 「概要」: 階層構造の説明に「要素」を追加、コマワリ列名を「人物」→「要素」、「セリフ」→「セリフ/説明等」に更新
- 「プロット（ページ > コマワリ）」: 列名変更を反映し、「要素」列が要素タブ登録名を候補にした入力可能ドロップダウンである旨を追記
- 「プレビュー 横／縦」: 表示形式の説明を「人物：セリフ」→「要素：セリフ/説明等」に更新
- 新規セクション「要素」を末尾に追加（登録方法・削除ボタン・プロット列との連携・「削除してもプロット既入力値は残る」仕様を明記）
- レイアウトタブ「テキスト」項目のInsertボタン説明（「シーン／人物／セリフ」表記）は、要素機能追加時の一括置換で既に「シーン／要素／セリフ・説明等」に更新済みだったことを確認（今回の追加修正は不要）

### 動作確認
Kaptureでヘルプ「スクリプト」項目のDOMを取得し、「要素」セクションを含む全カードの内容が意図通りであることを確認。コンソールエラーはブラウザ拡張機能由来の定型メッセージのみ。

**Why:** ユーザー要望「ヘルプを更新してください」。

---

## 2026-07-10（プロット/要素タブの「要素」列表示幅を拡大）

プロットタブと要素タブの「要素」列見出しが同じCSSクラス（`.project-panel-th-char`、90px固定）を共有しており、どちらも狭くて表示しづらかった問題に対応。

- `static/css/style.css`: `.project-panel-th-char`を`8em`（プロット表側）に変更。要素タブ側は新規`.project-panel-th-element`（`12em`）を追加し、両テーブルで別々の幅を持てるようにした
- `templates/index.html`: 要素タブの「要素」見出し`<th>`のクラスを`project-panel-th-char`→`project-panel-th-element`に変更（プロット側`<th>`はmain.js内で動的生成のため無変更のまま`project-panel-th-char`を継続使用）
- px固定ではなく`em`単位にしたことで、フォントサイズが変わっても文字数ベースの目安幅が保たれる

### 動作確認
Kaptureで、プロット「要素」列・要素タブ「要素」列とも以前より幅が広がり、12文字程度の入力（「主人公・太郎・十二文字テスト」）がほぼ収まることを確認。

### 補足: 「要素に追加後、プロットの要素に反映できない」との報告について
ユーザーから一時的に「要素タブに追加してもプロット側のドロップダウン候補に反映されない」との指摘があったが、値を消したら表示されたとのことで、事象は解消・再現せず。`_scriptRenderElementsDatalist()`はinput時に毎回呼ばれる実装で、ブラウザのdatalistキャッシュ的な表示遅延だった可能性がある（コード上の不具合は見当たらず、追加調査は行っていない）。再発時は要調査。

**Why:** ユーザー要望。

---

## 2026-07-10（スクリプトタブに「要素」サブタブを新設、プロット列名変更・入力可能ドロップダウン化）

登場人物・固有名詞などを名前＋詳細設定として登録できる「要素」機能を追加。プロット表の「人物」列をこの要素一覧から選べる入力可能ドロップダウンに変更した。

### データモデル
`_script.data.elements = [{ name, detail }]`を追加（`_scriptBlankData()`/`_scriptNormalizeData()`）。作品ごとに保存され、`localStorage`のcccScriptCurrent/cccScriptWorksに同梱される（新規ストレージキーは不要）。

### UI
- `templates/index.html`: サブタブナビ「プレビュー縦」の右隣に「要素」ボタンを追加。中身は要素名(input)・詳細(textarea)・×削除ボタンの3列テーブル(`#script-elements-tbody`)＋「＋要素追加」ボタン。プロット表の「要素」列input用に空の`<datalist id="script-elements-datalist">`をグローバルに1つ配置
- プロット表ヘッダー: 「人物」→「要素」、「セリフ」→「セリフ/説明等」に変更（データ上のフィールド名`character`/`text`は無変更、表示ラベルのみ）
- プロット表の要素列input(`.script-character-input`)に`list="script-elements-datalist"`を付与し、自由入力もできるネイティブ`<input>`+`<datalist>`方式のドロップダウンにした（カスタムUIを実装せず標準機能で対応）

### JS（`static/js/main.js`）
- 新規`_scriptRenderElements()`: 要素タブのテーブル行を描画。行内input/textareaのinputイベントで`_script.data.elements[i]`を更新しオートセーブ、名前変更時は`_scriptRenderElementsDatalist()`も呼んで候補を即時反映。×ボタンで該当要素を削除（配列からsplice）
- 新規`_scriptRenderElementsDatalist()`: `_script.data.elements`の名前（重複除去・空文字除外）から`<datalist>`のoptionsを再構築
- `_scriptApplyData()`（作品の新規作成・保存・読込の共通経路）で`_scriptRenderElements()`・`_scriptRenderElementsDatalist()`を追加呼び出し。作品切替時に要素タブ・ドロップダウン候補とも追従する
- サブタブ切替ハンドラに`elements`分岐を追加（`_scriptRenderElements()`）
- 「＋要素追加」ボタンハンドラを`initProjectTab()`に追加。末尾に空行を足して名前inputにフォーカス
- 関連コメント・alert文言（「人物」→「要素」、「セリフ」→「セリフ・説明等」）も整合性のため更新（`_scriptGetSelectedDialogue`、`insertScriptDialogueText`まわり）

### 設計判断
- 要素一覧は「プロット列の入力候補を提供するだけ」の関係とした。要素タブで要素を削除しても、既にプロット表に入力済みの値（自由入力文字列として保存）は変更されない（参照ではなく文字列コピーのため、正規化・追跡は行わない）。動作確認でも削除後にプロット側の値がそのまま残ることを確認済み
- 詳細設定欄はまず自由記述のtextareaのみとし、構造化フィールド（年齢・性別等）は導入しない（YAGNI、必要になれば拡張）

### 動作確認
Kaptureで、要素追加→名前・詳細入力→プロット「要素」列のdatalistに候補反映（DOM確認）→プロット側で入力→要素タブで削除してもプロット側の値は保持、の一連を確認。コンソールエラーはブラウザ拡張機能由来の定型メッセージのみで、アプリ起因のエラーなし。

**Why:** ユーザー要望。プロット表だけでは登場人物・固有名詞の詳細設定を書く場所がなく、表記揺れも防ぎたいという課題に対応。

---

## 2026-07-10（ヘルプタブを最新のUI変更に合わせて更新）

直近のセッションで行ったUI変更（表示名変更・Sタブ新設）と、以前から古くなっていた記述をヘルプタブ（`_HELP_DATA`、main.js）に反映した。

### 「スクリプト」項目
- 新規セクション「アセットパネル『S』タブ」を追加（概要の直後）。保存済み作品（青枠選択）／ページ作品（オレンジ枠選択）の役割・折りたたみ操作・「2リストは独立選択のため同名が両方選択表示されうる」旨を明記
- 「作品の保存・読み込み」: 「ドロップダウンから選択して読込」という記述を「アセットパネル『S』タブの一覧からクリックして選択し読込」に修正
- 「作品名・あらすじ」: 廃止済みの「作品名の右のドロップダウン」の説明を削除

### 「はじめに」項目
- 見出し文言を「Eagle Comic Creater について」→「ComfyUI Comic Creator について」（本文中の言及漏れ、以前の表示名変更時にheading側のみ直っていた）
- 「画面構成」: タブバー一覧の「画像編集」を実際のタブ名「Image」に修正（imgeditタブは2026-07-06に削除済みで表記が古くなっていた）。アセットパネルの説明を「レイアウトタブ左、A/P/T/Fタブ」固定の記述から、タブごとに構成が変わる旨（レイアウト＝A/P/T/F、Image＝A/F/I、スクリプト＝S）に更新

### 動作確認
Kaptureでヘルプタブの「スクリプト」「はじめに」両項目の表示内容を確認。コンソールエラーなし。

**Why:** ユーザー要望「ヘルプを更新してください」。

---

## 2026-07-10（Sタブ「ページ作品」の選択色を「保存済み作品」と区別）

ユーザーから「保存済み作品とページ作品、同じ名前が両方選択状態に見えるが排他選択か？」との質問。調査の結果、`_script.selectedWorkName`（保存済み作品、読込/削除ボタンが参照）と`_script.selectedPageWorkName`（ページ作品、新規作成時の名前初期値）は元々独立した状態変数で、各リスト内では排他選択（コード確認済み）だが、2つのリストは互いに独立しているため両方に同名選択が同時に起こりうる**仕様通りの挙動**（表示遅延によるバグではない）と回答。ただし見た目が紛らわしいとの指摘を受け、色分けで対応。

- `static/css/style.css`: `#script-asset-page-work-list .script-asset-item.selected`にIDスコープの上書きルールを追加し、「ページ作品」側の選択色のみ`#0077ff`（青）→`#ff9800`（オレンジ）に変更。「保存済み作品」側は青のまま
- JS側の選択ロジックは無変更（CSSのみで対応）

### 動作確認
Kaptureで、保存済み作品＝青枠、ページ作品＝オレンジ枠と、同時選択時も視覚的に区別できることを確認。コンソールエラーなし。

**Why:** ユーザーからの指摘・要望。

---

## 2026-07-10（Sタブ「保存済み作品」「ページ作品」を折りたたみ可能に）

Aタブのフォルダ折りたたみ（`.asset-folder`/`.asset-folder-icon`回転/`.asset-list.collapsed`）と同じ見た目パターンで、Sタブの2セクションにも折りたたみを追加。

- `templates/index.html`: 各セクションの見出し(`.asset-panel-section-label`)を、アイコン付きのクリック可能な`.asset-panel-section-header`に変更（`#script-asset-work-header`/`#script-asset-page-work-header`）
- `static/css/style.css`: `.asset-panel-section-header.collapsed`でアイコンを`rotate(-90deg)`、`.script-asset-list.collapsed`で`display:none`
- `static/js/main.js`: `_script`状態に`workListCollapsed`/`pageWorkListCollapsed`（セッション中のみ保持、localStorage永続化はなし）を追加。新規`_scriptInitAssetPanelSectionToggle(headerId, listId, stateKey)`をヘッダーに1回だけバインド（`initAssetPanelTabs()`から呼び出し）。リストは`_scriptRenderWorkList`/`_scriptRenderPageWorkList`が呼ばれるたびに`innerHTML`ごと再構築されるため、両関数の先頭で`grid.classList.toggle('collapsed', _script.xxxCollapsed)`を毎回再適用し、再描画後も折りたたみ状態を保つようにした

### 動作確認
Kaptureで、両セクションのクリックで折りたたみ⇔展開、レイアウトタブへ切替後スクリプトタブに戻っても折りたたみ状態が維持されることを確認。コンソールエラーなし。

**Why:** ユーザー要望。

---

## 2026-07-10（スクリプトタブにアセットパネル「S」タブを新設し、作品選択用ドロップダウン2つを廃止）

Imageタブがアセットパネルの「I」タブのみを表示するのと同じパターンで、スクリプトタブにも専用の「S」タブを新設した。将来的に定型文などの管理もここに追加していく想定。

### 変更内容
- **`templates/index.html`**: アセットパネルに`#asset-panel-tab-script`（Sボタン、初期非表示）と`#asset-panel-view-script`（「保存済み作品」「ページ作品」の2セクション）を追加。スクリプトタブ本体からは`#script-work-select`（保存済み作品ドロップダウン）と`#script-page-work-select`（ページタブ作品名ドロップダウン）を削除し、「読込」「削除」「新規作成」「保存」ボタンのみを本体側に残した
- **`static/js/main.js`**:
  - `switchTab()`: `_hideAssetPanelTabs`から`'project'`を除去。`tabId === 'project'`のときA/P/T/F/Iタブを非表示にしてSタブへ強制切替、それ以外のタブでSタブがアクティブならAタブへ戻す処理を追加（Imageタブの既存パターンを踏襲）
  - `initAssetPanelTabs()`のクリックハンドラに`target === 'script'`分岐を追加（`_scriptRenderAssetPanelLists()`を呼ぶ）
  - `_script`状態に`selectedWorkName`/`selectedPageWorkName`を追加（クリックでの選択状態のみを保持、確定操作は本体側ボタン）
  - `_scriptRenderWorkSelect`/`_scriptRenderPageWorkSelect`（`<select>`再描画）を`_scriptRenderWorkList`/`_scriptRenderPageWorkList`（クリック選択式のリスト再描画）に置き換え
  - 「読込」「削除」ボタンは`_script.selectedWorkName`を参照するよう変更。「新規作成」ボタンは`_script.selectedPageWorkName`を作品名初期値として使うよう変更（いずれもクリックでは選択状態を更新するだけで、確定はボタン押下時）
  - `initProjectTab()`: 旧`focus`イベントによる再描画（ページ作品ドロップダウン用）を廃止。スクリプトタブを開くたびに`switchTab()`側の強制Sタブ切替経由で`_scriptRenderAssetPanelLists()`が自然に再実行されるため、他タブでの作品追加にも追従する
- **`static/css/style.css`**: `.script-asset-list`/`.script-asset-item`（既存`.work-group-item`と同一デザイン）、`.asset-panel-section-label`を追加

### 設計判断（ユーザー確認済み）
- 保存済み作品一覧のクリックは選択のみ（即読込ではない）。確定は本体側「読込」ボタン
- ページ作品一覧のクリックも選択のみ（現状維持）。「新規作成」ボタン押下時の名前初期値としてのみ使う
- 「新規作成」「保存」「読込」「削除」ボタンは本体側（編集エリア）に残す。アセットパネルは「選択・一覧表示」専用

### 動作確認
Kaptureで、Sタブの表示・保存済み作品クリック→選択ハイライト→「読込」ボタンで内容反映、ページ作品クリック→「新規作成」で名前欄に反映、レイアウトタブ切替でSタブが隠れAタブに戻る、をそれぞれ確認。コンソールエラーなし。「削除」ボタンは既存データ保護のため実クリックでの確認は行っていない（読込/新規作成と同じ参照変更パターンのためコードレビューで担保）。

**Why:** ユーザー要望。ImageタブのA/F/Iパターンに倣い、将来の定型文管理機能追加を見据えてスクリプト専用タブとして切り出した。

---

## 2026-07-10（レイアウトタブ アセットパネル「P」タブのサムネイル生成もキャッシュ化）

ページタブの作品一覧・グループ選択で対応した「サムネイルキャッシュ化」（本ファイル直前のエントリ参照）と同じ非効率パターンが、レイアウトタブ左のアセットパネル「P」（ページ）タブにも存在していたため、同じ方式で対応した。

### 問題
`renderPageThumbGrid()`（main.js、アセットパネル「P」タブの中身）が、作業中作品の全ページに対し`for...of`で1件ずつ`dbGet('pages', name)`→`buildMergedSvg()`→`svgTextToDataUrl()`を直列実行していた。呼び出し元の`renderPageSelector()`は14箇所から呼ばれており、**作品を開く・ページの追加/削除/複製/並べ替えのたび**に走るため、ページ数の多い作品ほど重かった（ページ切替自体は`_updatePageThumbGridActive()`でハイライト更新のみのため対象外）。

### 対応
`renderPageThumbGrid()`のサムネイル生成部を、既存の`_getOrBuildPageThumb(pageMeta, 'pages')`ヘルパー（`dbPut`側で保存時に計算・埋め込み済みの`.thumb`キャッシュを読むだけ、無ければ生成して書き戻す）に置き換え。ループの引数`workPages`は`state.pages`（`dbGetAllPagesMeta()`由来、`.thumb`込み）から作られているため、変更は該当箇所の数行のみで済んだ。

### 動作確認
Kaptureで、作品を開く→レイアウトタブ「P」タブでサムネイルが正しく表示されることを確認。コンソールエラーなし。

**Why:** ユーザーへ「ページタブと同じ改善が必要か」問われ、同一パターンと確認の上で対応。

---

## 2026-07-10（ページタブ「作品一覧」「グループ」選択時のサムネイル生成をキャッシュ化して高速化）

### 問題
ページタブの作品カード／グループを選択するたび、`renderPageMgrGrid()`がそのグループに属する**全ページ**に対して`dbGet('pages', name)`（フルSVGレコード取得）→`buildMergedSvg()`（本体/各コマ/オーバーレイの3種SVGをDOMParserでパースし合成）→`svgTextToDataUrl()`を**直列に**実行しており、ページ数の多い作品/グループほど選択のたびに顕著に重かった。作品一覧タブを開いた直後の`renderWorkList()`も、全作品の1ページ目に対して同様の処理を直列実行していた。

### 対応（案③: 保存時に事前計算してキャッシュ）
- `dbPut(storeName, data)`（main.js先頭のIndexedDB操作レイヤー）で`storeName`が`'pages'`または`'trash'`かつ`data.svgContent`がある場合、保存直前に`buildMergedSvg`+`svgTextToDataUrl`でサムネイルdata URLを計算し`data.thumb`に埋め込むように変更。18箇所超ある`dbPut('pages', ...)`呼び出し全てに手を入れず、一箇所の変更で全保存経路に自動適用されるようにした
- `dbGetAllPagesMeta()`（軽量メタ専用、svgContent等の重いフィールドは除外する設計）が返すオブジェクトに`thumb`フィールドを追加
- 新規ヘルパー`_getOrBuildPageThumb(pageMeta, storeName)`を追加。`pageMeta.thumb`があればそれを返すのみ、無ければ（保存済み旧データ）フルレコードを取得して`dbPut`し直すことで`.thumb`を計算・永続化してから返す（一度だけの移行コスト、以降はキャッシュヒット）
- `renderWorkList()`・`renderPageMgrGrid()`のサムネイル生成部を、上記ヘルパー経由でキャッシュを読むだけの処理に置き換え。選択のたびに走っていた`dbGet`+`buildMergedSvg`の直列実行が実質不要になった
- 出力（JPEG/PNG/PDF等のエクスポート）で使われている`buildMergedSvg`呼び出し（フォント埋め込み経由、`embedFontsInSvg`と併用）はキャッシュ対象外のまま据え置き。キャッシュされたサムネイルはプレビュー専用の簡易版であり、正式出力にそのまま使うのは不適切なため

### 動作確認
Kaptureで、リロード後を含め作品カード選択→ページ一覧のサムネイル表示、グループ（stock）選択→空グループの正常表示、コンソールエラーなしを確認。リロード後も初回選択でサムネイルが即座に表示されたことから、`.thumb`のIndexedDBへの永続化とキャッシュ読み込みが機能していることを確認済み。

**Why:** ユーザー要望「ページタブの作品一覧・グループの表示が重いため改善したい」。事前に処理内容を説明したところ、保存時キャッシュ方式（③）を選択。

**How to apply:** 今後、ページレコード（`pages`/`trash`ストア）のSVG内容を変更する処理を追加する際は、その保存が既存の`dbPut('pages'|'trash', record)`経由であれば`.thumb`は自動再計算される。`record`を直接IndexedDBに書き込む新しい保存経路を作る場合は`dbPut`ラッパーを通すこと（通さないとサムネイルが古いまま/生成されないまま放置される）。

---

## 2026-07-10（表示名を「Eagle Comic Creater」→「ComfyUI Comic Creator」に変更）

### 概要
アプリの表示名を「Eagle Comic Creater」から「ComfyUI Comic Creator」に変更した。DEVLOG過去分の記載（本ファイル）は変更対象外。

### 変更箇所
- `templates/index.html`: `<title>`、header内`<h1>`
- `static/js/main.js`: ヘルプ「はじめに」タブの見出し（`{ heading: 'Eagle Comic Creater について', ... }`）
- Eagle（外部画像管理アプリ）保存時のタグ文字列 `'eagle-comic-creater'` → `'comfyui-comic-creater'`（ユーザー確認の上で新名称に統一。既存Eagleライブラリ内の過去保存分とはタグが分断される）
  - `static/js/image-tab.js`（2箇所）、`static/js/main.js`（gmicオートセーブ）、`static/js/nanobanana.js`（オートセーブ）

### 影響調査（関連カスタムノード）
- `comfyui-vrm-pose-editor`（`static/js/pose3d.js`から動的import連携）: 参照は相手ノード側のフォルダ名によるURL（`/extensions/comfyui-vrm-pose-editor/`）のみで、本ノード側の名前・パスに依存していないため影響なし
- `comfyUI-particle-pixijs`: 連携先をそのDEVLOG内で`comfyui-comic-creater`という**フォルダ名**で言及しているが、今回変更したのは表示名のみでフォルダ名・`NODE_CLASS_MAPPINGS`・`WEB_DIRECTORY`は無変更のため影響なし
- ComfyUI `custom_nodes`全体を横断検索したが、本ノードのURLパス（`/ccc`）やフォルダ名に依存する外部コードは見つからなかった

### スコープ外
- フォルダ名（`comfyui-comic-creater`）、エンドポイント（`/ccc`）、ComfyUIメニュー登録名（`ComicCreater.TopBar`）は元々「Eagle」を含まない技術名のため無変更
- `PLAN_polygon_pen_tool.md`内のディレクトリ名`eagle_comic_creater_spa`への言及は実ディレクトリ名（未変更）を指す記述のためそのまま

---

## 2026-07-09（レイアウトタブ「3Dポーズ」をcomfyui-vrm-pose-editorへの依存に全面移行）

### 概要
レイアウトタブ「3Dポーズ」サブタブが独自に持っていたThree.js/VRM実装（`static/js/pose3d.js`、ライトエディタ・ポーズライブラリなしの簡易版）を廃止し、別途インストール済みのComfyUIカスタムノード「comfyui-vrm-pose-editor」（インストール先: `custom_nodes/comfyui-vrm-pose-editor`、開発元: `C:\Users\statsu-11\Desktop\now_work\vrmpose_light_plus_2\3dpose_light_editor`）へ依存する薄いブリッジ構成に全面移行した。ノードの現在のフル機能（ポーズライブラリ・ライトエディタ・ミラー・Ground/BGWall/シャドウ）をレイアウトタブから直接利用できるようになった。

### comfyui-vrm-pose-editor側の変更（開発元→インストール先の順に反映）
- `js/pose_editor_3d.js`（ComfyUIノードUIとComfyUI非依存のコア`initPoseEditor3D`が1934行の同一ファイルに同居していた）を分割。658〜1934行目を新規`js/pose_editor_core.js`に切り出し`export`化
- コアの戻り値に、SPA側が要求する6メソッド（`resizeRenderer`/`startLoop`/`stopLoop`/`forceReload`/`isContextLost`/`hasModel`。コマの実寸に合わせた動的リサイズ・非表示時のレンダリング停止用）と、第6引数`onModelReady`コールバックを追加。ノード本体の見た目・動作は不変（Kaptureで回帰確認済み）

### comic-creater側の変更
- `static/js/pose3d.js`を全面書き換え。`/extensions/comfyui-vrm-pose-editor/{pose_editor_core.js,light_editor.js,pose_library.js}`を起動時に動的import、成功後に`window.initPoseEditor3D`/`window.openPoseLibrary`/`window.openLightEditor`へ同期関数をセット。main.js側の既存「`typeof window.initPoseEditor3D!=='function'`なら300ms後リトライ」ロジックとそのまま噛み合うため、main.js初期化ロジックは無改造
- レイアウトタブの3Dポーズサブタブに「💾 poses/」「📚 ライブラリ」「↔ ミラー」「💡 ライト」の4ボタンを追加、`main.js`の`initPose3DTab()`に配線
- `static/vendor/`（three.module.js等の重複コピー、pose3d.js以外から参照なしと確認済み）は削除し、ノード側vendorに一本化

### 判明した誤解（vendorバージョン差分は実は誤り）
事前調査で「開発元/comic-creater側のvendorが新しくインストール先が古い」という前提を立てたが、実際に内容をdiff -bwで比較すると改行コード(CRLF/LF)の違いを除き実質完全一致（差分はOrbitControls.jsのズーム速度定数1箇所のみ）と判明し、この前提は誤りだった。vendorの上書きは行わなかった。**タイムスタンプだけで新旧を判断せず内容差分を確認すること。**

### 保存先・API
`/pose_library/*`・`/light_library/*`はComfyUIサーバーに直接ルート登録された絶対パスAPIのため無変更で到達可能。ポーズ・ライトプリセットはノードと共有保存（`custom_nodes/comfyui-vrm-pose-editor/poses/`・`.light_library/`）される仕様とした（ユーザー確認済み）。

### スコープ外（今回対応しなかったもの）
- タイマー自動キャプチャ（⏱）: ノード版は「IMAGE出力の定期更新」用途でSPAのワークフロー（コマへの確定）と意味が異なるため見送り
- アスペクト比フレーム（overlayCvs、ノードUI固有装飾）の移植
- comfyui-vrm-pose-editorの既知の差分ファイル（`js/pose_library.js`, `pose_library_server.py`, `__init__.py`, `pyproject.toml`）の開発元⇔インストール先同期

### 動作確認
Kaptureで、ノード側（Capture/ポーズライブラリ/ライトエディタ/ミラー、新規エラーなし）とSPA側（コマに配置→ポーズライブラリ→ライトエディタ→ミラー→コマに確定、新規エラーなし、`state.pose3d.wrapper`のモーダルへの退避・復元も正常）の両方を確認済み。

### 副次調査: ページ読み込み時にカーソルが回転し続ける現象（3Dポーズ機能とは無関係と判明）
上記実装完了後、ユーザーから「SPAを操作中、マウスカーソル横に回転する青いサークルがほぼずっと表示される」と報告あり。調査の結果:
- リロード直後からDOMサイズ（Kapture計測値）が 約104KB → 約59MB → 約183MB まで数秒〜十数秒かけて単調増加し、その間クリック操作がタイムアウトすることがある（＝体感的なビジーカーソルと一致）
- **検証**: `templates/index.html`の`pose3d.js`読み込みを一時的にコメントアウトし3Dポーズ機能を完全に無効化した状態でも、全く同じ増加パターン（数値までほぼ一致）が再現した。よって**今回の3Dポーズ機能の変更が原因ではない**と確定。pose3d.jsはすぐに元へ戻し済み
- 原因は、アプリ起動時にIndexedDBから全ページ・全作品データを読み込んでレンダリングする既存処理の重さと推測される（コンソールログ上「DB connected」自体は一瞬で完了するが、その後のSVG/サムネイル描画に時間がかかる）。今回の3Dポーズ動作確認で「コマに確定」を複数回実行してテスト画像データが増えたことが、データ量増加のきっかけになった可能性はあるが、根本原因は3Dポーズ機能側のコードではない
- ユーザーの意向により、ComfyUI再起動を挟んでしばらく様子見。原因の切り分け（page_groupsデータ量とロード時間の相関、どの処理が重いか）は未着手のまま次回以降の課題として残す
- **2026-07-10追記**: ユーザーより「VSCode（Claude Code）での作業セッション自体が原因ではないか。作業終了で症状が改善するため」との指摘あり。SPA/IndexedDB側の処理ではなく、VSCode拡張機能によるリソース消費が原因である可能性が高いと判明。SPA・comic-creater側のコード起因ではないため、この観点での追加調査は不要と判断

### 追加対応: comfyui-vrm-pose-editor側 v0.8.0リリース（ズームモード永続化）
上記実装のフォローアップとして、comfyui-vrm-pose-editor側にも対応を実施（詳細は当該プロジェクトのDEVLOG参照）。
- ライトエディタの「🖱 Ctrl+右ドラッグでズーム」トグルが、リロードのたびに既定値(wheel)へ戻ってしまう問題を修正。`localStorage`（キー`vrmPoseEditor_zoomMode`）に永続化し、comic-creater側・ComfyUIワークフロー上のノードの両方で設定を共有するようにした
- **トラブル**: 実装検証中、インストール先の`js/pose_editor_3d.js`が原因不明のタイミングで分割前の旧バージョンに巻き戻る現象が発生（ComfyUI Managerの自動更新等が疑われるが未確定）。`console.log`/`alert`でのデバッグ出力が一切実行されないことから発覚し、ファイルの中身を直接grepして判明。開発元から再コピーして復旧
- `pyproject.toml`のバージョンを`0.7.0→0.8.0`に更新し、GitHub（`ketle-man/comfyui-vrm-pose-editor`）へコミット・push。`.github/workflows/publish.yml`によりComfy Registryへ自動公開される
- comic-creater側のヘルプタブ（`_HELP_DATA`「3Dポーズサブタブ」項目）を更新し、poses/保存・ポーズライブラリ・ミラー・ライトエディタ（ズームモード永続化を含む）の説明を追記。Kaptureで表示内容を確認済み

---

## 2026-07-09（テキストスタイルモーダル新設・Imageタブ「レイアウトに送る」拡張・フキダシ尻尾/リサイズハンドル修正）

### 概要
フォントタブの「スタイル」設定（塗り・線・袋文字・影）を、レイアウトタブ・Imageタブのテキストツールから直接呼び出せる独立モーダルとして新設した。あわせてImageタブの「レイアウトに保存」ボタンを新規ドキュメントにも対応させて「レイアウトに送る」に改称し、フキダシ機能では尻尾接合部の見た目の不具合修正、思考フキダシの泡数調整機能追加、リサイズハンドルの重大なバグ修正を行った。

### テキストスタイルモーダルの新設
- 新規ファイル`static/js/text-style-modal.js`（非moduleのIIFE）を追加し、`window.openTextStyleModal({ fontFamily, previewText, initialStyle, previewSize, onApply })`を公開。pixifx.js（`window.pixiFxOpen`）と同じ「main.js/image-tab.js双方からwindow経由で呼べる独立スクリプト」パターンを踏襲
- 保存データはフォントタブと同じlocalStorageキー`fontmgr_text_styles`を直接読み書きするため、モーダルで保存したスタイルはフォントタブの一覧にも即座に反映される（データは共通、UIロジックのみモーダル内に複製実装）
- 適用ロジックは新規実装せず、既存の`applyStyleToSelectedText()`/`insertStylePlaceholderText()`（レイアウトタブ）、`applyFontStyleToSelection()`/`insertFontStylePlaceholder()`（Imageタブ）をそのまま呼ぶだけにした
- ボタン設置場所: レイアウトタブは「テキスト」サブタブに`#text-style-modal-btn`

### モーダルの初期値反映バグ修正
- 当初モーダルは選択中テキストの現在のスタイルを一切読み込まず常にデフォルト値から開始する作りだったため、既に線が設定されているテキストの色や幅だけ変えようとすると、線チェックボックスがOFFのまま適用され既存の線が消えてしまう不具合があった
- `main.js`に`_fontMgrExtractStyleFromTextEl(textEl, svgEl)`（`_fontMgrApplyStyleAttrsToTextEl`の逆変換、SVG属性・フィルタから現在のスタイルを復元）、`image-tab.js`に`getSelectedTextStyleInfo()`（textPropsから現在のフォント/サイズ/スタイルを返す）を追加し、モーダルが常に選択中テキストの現在の見た目から開始するよう修正
- あわせて`previewSize`オプションで選択中テキストの実際のフォントサイズをプレビューに反映。巨大なフォントサイズ（実例: SVG上2057px相当）に対して線幅のデフォルト値が相対的に細すぎて「線が見えない」ように見えるケースを、プレビューで視認できるようにした

### スタイルボタンの配置: Textツール→Selectツールへ方針転換
- 当初、Imageタブで複数のテキストレイヤーがある場合に既存テキストを選び直す手段として、Textツールのオプションバーに「選択」トグルボタン（`_textPickMode`/`_pickTextLayerAt`/`SelectTool.findLayerAt`）を実装したが、「Selectツールが元々キャンバス上の直接クリックでレイヤーを選択できるため、Textツール側に選択手段を重複実装する必要がない」というユーザー判断で全ロールバックした
- 代わりにSelectツールのオプションバーに`#ie-select-style-btn`（「スタイル」ボタン）を追加。クリック時`hasSelectedTextLayer()`で判定し、falseならトースト表示、trueなら`getSelectedTextStyleInfo()`→モーダル→`applyFontStyleToSelection()`という、Textツール側のスタイルボタンと同じロジックを再利用
- **教訓**: 機能追加の初期実装がユーザーの意図と違う方向性だった場合、中途半端な旧実装の残骸（未使用フラグやメソッド）を残さず全ロールバックしてから新方針を実装する方が明確

### Imageタブ「レイアウトに送る」機能拡張
- 従来の「レイアウトに保存」ボタンは、レイアウトタブの「画像タブで編集」から開いた画像（`_sourceImageEl`が存在するケース）でのみ有効で、New/Uploadで作成した新規ドキュメントでは使えなかった
- `_saveToLayout()`を拡張し、`_sourceImageEl`が無い場合はレイアウトタブの選択中コマ/オーバーレイへ合成結果を新規画像として挿入するようにした（既存の`insertImage(base64Data, width, height)`をそのまま再利用）
- `insertImage()`はコマ未選択時などにalertを出すだけで例外を投げない作りだったため、呼び出し元で成否を判定できるよう戻り値（成功時true/失敗時false）を追加。既存の呼び出し元はすべて戻り値未使用のため後方互換
- ボタン名を「レイアウトに保存」→「レイアウトに送る」に変更

### フキダシ: 尻尾接合部の細い線を解消
- フキダシの本体と尻尾は別々のSVG `<path>`要素として描画されており、尻尾の付け根を本体の内側へ食い込ませる量`overlap`が固定2pxだったため、枠線（`borderWidth`）が太い設定や尻尾が細い場合に、接合部の縁取りが噛み合わず隙間（細い線）が見えていた
- `generateBombPath`・rect分岐・normal分岐・`_h2CalcCurveHandlePos`の4箇所で`overlap`を`Math.max(2, borderWidth + 2)`に変更し、枠線の太さに応じて食い込みを確保するようにした

### 思考フキダシ: 泡の間隔→個数指定、本体から離すスライダー
- 従来`generateThoughtPath()`は尻尾の全長に沿って弧長を積分し、`gap`（次の泡の半径に対する割合）を加算しながら泡を配置する方式で、泡の数は結果的に決まる値だった。「間隔」スライダー（`thoughtBubbleGap`）を実装したが、ユーザーから「思い通りにならない」との指摘を受け、直接「泡の数」を指定できる方式（`thoughtBubbleCount`、1〜15、デフォルト5）に置き換えた。弧長上に指定個数を均等配置し、先端側が最小サイズ・本体側が最大サイズになるのは維持
- 個数を減らす（特に1個）と、本体側の泡が本体境界のちょうど上に中心が来るため本体に完全に埋もれて見えなくなる問題が判明。本体に近い（`t`が大きい）泡ほど尻尾方向へ半径分押し出す補正（`px += r * t * cos(tailAngleRad)`等）を追加し、本体の外側に完全に出るようにした
- この押し出し量をユーザー調整可能にする「離す」スライダー（`thoughtBubbleOffset`、0〜200%、デフォルト100%）を追加。0%で旧来の埋もれる見た目、200%でより大きく離れる
- **ヘルプ未更新**: 上記の間隔→個数・離すスライダーについては、ユーザーからヘルプ更新の指示が無かったため`_HELP_DATA`には反映していない

### フキダシ: リサイズハンドル(e/w/s/n)のバグ修正
- `initBalloonTools()`のリサイズドラッグ処理で、四隅（se/sw/ne/nw）は対角固定点との距離を`/2`して半径を正しく計算していたが、辺の中央4つのハンドル（e/w/s/n）だけ`/2`が抜けており、ドラッグを開始した瞬間から半径が本来の約2倍になり、対角（反対側の辺）が固定されずに意図しない方向へ広がって見える重大なバグがあった
- 4箇所すべてに`/2`を追加。修正後の式が「ドラッグ開始時点で値が変化しない」「反対側の辺が常に固定点のまま動かない」ことを数式で検証済み（Kaptureはmousedown保持中のmousemoveを再現する手段が無く実機ドラッグ確認はできないため、ユーザー自身のブラウザ操作で最終確認）

### ヘルプ更新
- レイアウト「テキスト」の項に「スタイル」ボタンの説明、Image「ツール」の項にSelect/Text双方のスタイルボタンの説明、フォント「レイアウトタブとの連携」の項にモーダル経由の相互適用・データ共有の説明を追記
- Image「アクションバー: 保存系ボタンの違い」の項を、新規ドキュメントでの選択中コマへの挿入にも対応した内容に更新
- レイアウト「フキダシ」の項に、8つのリサイズハンドルが対角/対辺固定で意図しない方向に広がらない旨を追記

### 動作確認
テキストスタイルモーダル・Imageタブのレイアウト送信・フキダシ尻尾の見た目改善・思考フキダシの泡数調整はKaptureで実機確認済み。リサイズハンドルのバグ修正のみ、ドラッグ操作をKaptureで再現できないためユーザー自身のブラウザ操作で確認（OK判定済み）。

### Imageタブ: 選択中テキストレイヤーの色/サイズ/フォント/太字/斜体/揃えが変更できない不具合を修正
- テキストツールのオプションバー（Color/Size/Font/Bold/Italic/Align）は、選択中のテキストレイヤーがあってもその`textProps`を一切更新せず、常に「次に新規作成するテキストのデフォルト値」（`this._textTool.xxx`）だけを書き換える作りだったため、既存テキストの見た目を後から変更する手段が無かった
- `image-tab.js`に`_applyTextToolChangeToSelection(partialProps)`を新設。選択中レイヤーがテキストであれば`_saveUndo()`→`textProps`を部分マージ→既存の`_applyTextPropsToLayer()`で再構築、という流れで各コントロールのイベントハンドラから呼ぶようにした
- オプションバーの表示値も、選択中テキストレイヤーがあればそのレイヤーの現在値、無ければツールのデフォルト値を表示するよう分岐（`const p = selLayerForOpts ? selLayerForOpts.textProps : this._textTool;`）。Bold/Italicのトグルは「ツールのデフォルト値を反転」する誤ったロジックだったため、選択中レイヤーがある場合はレイヤーの実際の値を反転するよう合わせて修正
- 上記修正後も実機確認でフォントセレクトの表示値だけ変わりキャンバスの見た目が変わらない事象が発生。原因は`_rerenderTextLayer()`がGoogle Fontsのダウンロード完了を待たずに`ctx.font`で即描画していたため、フォントファイル未取得時はフォールバック書体のまま描画されていたこと（`<link>`タグ自体はindex.htmlに事前設置済みでも、ブラウザは実際に使われるまでファイル本体の取得を遅延する）。`_ensureLayerFontLoaded(layer)`を新設し、`document.fonts.load()`でロード状況を確認・要求し、ロード完了後に自動で`_rerenderTextLayer()`を再実行するようにした
- Kaptureで実機確認: Hachi Maru Pop⇔Arial切替で字形が明確に変化すること、色・サイズ・太字トグルが選択中レイヤーへ即座に反映されることを確認済み
- ヘルプ更新: Image「ツール」のText項に、オプションバーの変更が選択中レイヤーへ即時反映される旨とGoogle Fonts遅延ロード時の自動再描画について追記

## 2026-07-08（Imageタブ: フォント選択のGoogle/System/カテゴリ対応・プロジェクト保存/再編集・Close・New時レイヤー自動追加）

### 概要
Imageタブに4つの改善を行った。①テキストツールのフォント選択をハードコード10種類からレイアウトタブと同じ「Google Fonts / システム / カテゴリ」切替方式に変更。②レイヤー編集状態（重ね順・各レイヤーのcanvas内容・テキスト設定等）をアセットパネルの新設「I」タブへサムネイル付きで保存し、後から読み込んで編集を再開できる「Save Project」機能を新設。③New右隣に、未保存確認ダイアログ付きの「Close」ボタンを追加。④New実行時に描画用レイヤーが1枚も無く即描画できない不便を解消するため、レイヤーを自動で1枚追加するようにした。

### テキストツールのフォント選択をGoogle/System/カテゴリに対応
- `image-tab/TextTool.js`のハードコード`TEXT_FONTS`配列（Arial/Georgia等10種）は廃止。`image-tab.js`側でフォントソース切替UI（`Google`/`System`/`Cat`ボタン＋カテゴリ絞り込みセレクト）を新設し、テキストツールのオプションバーに追加
- Google Fontsはmain.js（レイアウトタブ側）の`_fontMgrGoogleList()`をそのまま`window`経由で呼び出して再利用（`function`宣言のためImageタブのESMモジュールからも呼べる、既存の`pushHistory`等と同じパターン）
- システムフォントは`window.queryLocalFonts()`（Local Font Access API）を直接呼び出し、結果をインスタンスにキャッシュ
- カテゴリは`localStorage.getItem('fontmgr_favorites')`を直接読む方式で実装。main.js側の`_fontMgr`状態オブジェクトは`const`宣言でwindow経由参照できないため、DEVLOG既出の`_isEagleAutoSaveGmicEnabled()`と同じ「共通のlocalStorageキーを直接読む」パターンを踏襲した
- Kaptureで実機確認済み: 3ソースそれぞれのフォント一覧取得、カテゴリ切替による絞り込み（「お気に入り」24件など）、フォント選択→テキスト描画への反映

### プロジェクト保存・再編集機能（Save Project / アセットパネル「I」タブ / Open）
- `LayerManager.toJSON()`（既存のUndo/Redo機構がすでに使っていた、canvas内容をPNG dataURL化してレイヤー全体をシリアライズする仕組み）をそのまま流用し、`_saveProject()`でファイル名入力→サムネイルPNG＋レイヤーJSONのペアをサーバーへPOSTする方式で実装
- サーバー側（`py/ccc.py`）: 新規`POST /api/ccc/save-image-project`（`handle_save_image_project`）を追加。`assets/image/<name>.png`＋`<name>.json`のペアで保存。`_generate_assets_json()`に、`image`フォルダに限り同名`.json`の有無を見て`projectPath`をアセットエントリへ付与する専用分岐を追加
- アセットパネルに新設した**「I」タブ**（`data-panel-tab="images"`）は、**Imageタブがアクティブな時のみ表示**され、`image`フォルダの中身だけを表示する。既存の「A」タブ（全体アセット一覧）には`image`フォルダを表示しない（`_renderAssetFolders()`でfolders配列を分岐）。挿入ボタンは他タブと区別するため文言を最終的に「Open」に変更
- `switchTab()`に、Pタブ/Tタブと同じパターンでIタブの表示制御（Imageタブ以外では非表示、非表示化時にIタブがactiveならAタブへ強制切替）を追加
- 読み込み側は`loadProjectFromUrl(url, name)`を新設。`loadFromSvgElement()`と同じく`_layerMgr = null`にしてから`_initCanvases()`→`this._layerMgr.fromJSON(data)`（`fromJSON`はLayerManagerの**インスタンスメソッド**でstaticではない点に注意）で復元。常に新規キャンバスとして開き、既存の編集内容とは混在させない
- **既知の制約**: `Layer.toJSON()`は`contentW`/`contentH`（canvasのネイティブ解像度）を保存しておらず、`fromJSON`側は`displayW`/`displayH`にフォールバックする。アップスケール等でネイティブ解像度と表示サイズが異なるレイヤーを保存・復元すると解像度が表示サイズに落ちる可能性がある（今回は既存のLayerManager実装をそのまま踏襲し、この制約自体の修正はスコープ外とした）
- Kaptureで一連の流れ（3レイヤー作成→保存→ファイルシステムでpng/json確認→新規空キャンバス→Iタブから選択してOpen→3レイヤー完全復元）を実機確認済み

### Closeボタン（未保存確認ダイアログ付き）
- New右隣に追加。レイヤーが無い（何も開いていない）状態でクリックしても何もしない
- 標準`confirm()`はOK/Cancelの2択しかできないため、独自のモーダルオーバーレイ（`.ie-confirm-overlay`/`.ie-confirm-box`、`image-tab.css`に新規CSS追加）を実装し、「保存して閉じる」「保存せず閉じる」「キャンセル」の3択に対応
- 「保存して閉じる」を選ぶと`_saveProject()`を呼び、戻り値（成功/キャンセル/失敗をboolean化するよう`_saveProject()`自体も修正）がtrueのときだけ`_resetToEmpty()`でレイヤー・キャンバスを破棄してプレースホルダー表示に戻す。キャンセルや保存失敗時はドキュメントを閉じない
- Kaptureで3パターン（キャンセル／保存せず閉じる／保存して閉じる、いずれもファイルシステムでの保存結果込み）を実機確認済み

### New時のレイヤー自動追加
- 従来`_newCanvas()`はキャンバスとLayerManagerを初期化するだけで、レイヤーが1枚も無い状態だったため、描画するには手動で「+」ボタンを押す必要があった
- `ie-add-layer-btn`と同じ`addLayer("draw", "Layer 1")`呼び出しを`_initCanvases()`直後に追加し、New実行直後から描画を開始できるようにした

### ヘルプ更新
`_HELP_DATA`に新規「Image」ヘルプ項目（概要／アクションバーの開始・終了系ボタン／保存系ボタンの違い／プロジェクトの保存と再編集／ツール一覧／レイヤーパネル）を追加し、`_HELP_ORDER`にも登録。「アセットパネル」項目の概要とアセットタブ(A)の説明をIタブ新設に合わせて更新し、「Imageタブ (I)」セクションを追加。
- **ハマった点**: 追記した本文中の「G'MIC」がシングルクォート文字列リテラル内でエスケープされておらず、`main.js`全体が構文エラーで読み込めなくなった（`SyntaxError: Unexpected identifier 'MIC'`）。既存コード（画像サブタブの項）でも`G\'MIC`とエスケープされている前例に倣って修正。**ヘルプ本文にアポストロフィを含む固有名詞（G'MIC等）を書く際は必ずエスケープすること**

### 動作確認
各機能について、都度Kaptureまたはユーザー自身のブラウザ操作で確認済み。

## 2026-07-08（レイアウト: コマ内オブジェクトの一括ロック機能）

### 概要
レイアウトタブのレイヤーパネルで、コマ単位で内部の全オブジェクト（フキダシ・画像・テキスト・図形・グループ）を一括ロックできる機能を追加した。既存の個別オブジェクトロック（レイヤー行の🔓ボタン）とは独立した仕組みで、コマロックを解除すれば元の個別ロック状態にそのまま戻る。

### コマの一括ロック機能
- コマ行に🔓/🔒ボタンを新設（既存のマスクボタン・枠線表示切替ボタンと並び）。トグルで`g[data-clip-panel="panelId"]`要素に`data-panel-locked`属性を付与/削除し、`savePanelSvg()`でそのまま永続化（枠線非表示機能と同じ「プレビューDOM＋svgContentの両方を更新」パターン）
- `renderLayerPanel()`内でコマループ中に`_rlpPanelLocked`という一時変数を更新し、各オブジェクト生成ヘルパー（`makeShapeItem`/`makeImageItem`/`makeTextItem`/`makeDrawShapeItem`/`makeGroupItem`）の`isLocked`判定に「個別ロック || コマロック」を反映。コマロック中は個別の🔒ボタンをdisabled化し「コマが一括ロック中です」とツールチップ表示
- キャンバス上での直接クリック選択（レイヤーパネル経由ではない5箇所のmousedown/click）も、共通ヘルパー`_isObjectLocked(el)`（`el.dataset.locked`または`el.closest('g[data-clip-panel]')`の`data-panel-locked`を判定）に統一し、ロック中は選択・移動・編集・削除ができないようにした
- **追加で見つかった抜け穴**: テキストのダブルクリック再編集（`textSvgEl`の`dblclick`リスナー、`openTextInputDialog()`を呼ぶ経路）にロック判定が無く、コマロック中でもテキスト編集モーダルが開けてしまっていた。`_isObjectLocked(textEl)`チェックを追加して修正
- Kaptureで実機確認: コマロック→配下テキストが選択不可（ロック解除コマとの対照確認込み）、キャンバス直接クリックでの選択拒否、リロード後の永続化、テキストダブルクリックでの編集モーダル拒否、を確認済み
- **ハマった点**: Kaptureでの座標クリック検証中、SVG内の意図しない要素をクリックしてテキストが一時的に複製されコマが誤ロックされる事故が発生。レイヤーパネルの削除・ロック解除ボタンで手動修復し、実データを元の状態に復元した。**SVG座標系はビューポート座標と一致しないため、Kaptureでのクリック検証はselector指定を優先し、座標クリックは補助的に留めること**

### ヘルプ更新
ヘルプ「レイアウト」→「レイヤーパネル」の項に、コマ行の🔓ボタンによる一括ロックの説明（対象範囲・個別ロックとの関係・ダブルクリック編集も無効化される旨）を追記。

### 動作確認
Kaptureで一通り確認済み（詳細は上記）。サーバー側の変更は無く、ブラウザリロードのみで反映される。

## 2026-07-08（レイアウト: ツールペイン新設・フォントお気に入り連携・複製/移動の選択不具合修正・アセット削除機能）

### 概要
レイアウトタブのツール切替ボタン（ドロー/フキダシ/テキスト/画像/マスク/3Dポーズ）をアセットパネル右隣の専用「ツールペイン」に移設し、不要になった「テンプレートに追加」ボタンを廃止した。テキストのフォント選択をフォント管理タブと共通のGoogle Fonts一覧・お気に入り（カテゴリ）連携に対応させ、選択オブジェクトをコマ/ページ中央へ戻す「OC」ボタンを新設。あわせて、オブジェクトを別コマへ複製・移動した際に選択状態が正しく追従しない不具合と、その根本原因だった「排他選択されない」バグを修正した。最後にアセットパネルの素材をAlt+クリックで削除できる機能をサーバーAPIごと新設した。

### レイアウトタブ: ツールペイン新設・「テンプレートに追加」廃止
- `index.html`のアセットパネル(`#asset-panel`)と`<main>`の間に`<aside id="tool-panel">`を新設し、`.layout-tools-row`内にあったサブタブ切替ボタン（`.subtab-btn`）をそのまま移設。ボタンのクラス・`data-subtab`属性は変更していないため、既存の`initSubtabs()`は無改造で動作
- `switchTab()`にツールペインの表示制御を追加（レイアウトタブでのみ表示）
- ページタブの複製・グループ機能で代替可能という判断から、「テンプレートに追加」ボタン（`#page-to-template-btn`）と`savePageAsTemplate()`を削除。副産物として、この導線が原因だったアセットパネルTタブのサムネイル不整合（`renderAssetTemplateGrid()`が`buildMergedSvg()`を使わずコンテンツ抜きのSVGのみ表示していた問題）も解消

### フォント選択: レイアウトのテキストメニューをフォント管理タブと連携
- `#font-family`の「Google Fonts」optgroupがハードコードの6件だったのを`_loadGoogleFontsToSelect()`で`GOOGLE_FONT_FAMILIES`（フォント管理タブと共通）から動的生成するよう変更。スタイルサムネイル比較用に追加した「Zen Antique」（`index.html`のGoogle Fonts linkタグにも追加）も反映される
- 「Google」「システム」に加えて「カテゴリ」ソースを新設。カテゴリセレクトで絞り込み、☆ボタン（`_toggleFontFavorite()`）で選択中フォントを対象カテゴリへ追加/解除できる。データはフォント管理タブの`_fontMgr.favorites`（localStorage `fontmgr_favorites`）と共通
- ユーザー要望により「お気に入り」表記を「カテゴリ」に改称し、配色もオレンジ(`#ffb74d`)から赤み寄り(`#ff6e40`)に変更
- **副次バグ修正**: `activateFontTab()`が非アクティブタブに`#fff`、アクティブタブに`#e0e0e0`をインラインstyleで直接設定しており、CSS側のダークグレー配色（`.font-source-tab`の`#3a3a3a`等）を上書きしていた。インライン上書きをやめてCSSに委ねるよう修正
- テキストの初期フォントサイズを`state.balloon.fontSize`・`#font-size`入力欄とも150に統一（従来はstate側300・UI表示80で不一致だった）。フォント管理タブの「スタイル」サイズ・「プリセット」サイズの初期値も150に統一

### OCボタン（選択オブジェクトを中央へ移動）
- 上部メニュー「画像タブで編集」の右隣に追加。`moveSelectedObjectToCenter()`が画像/テキスト/フキダシ/グループ/draw-shapeそれぞれの移動方法（x/y属性、dataset.cx/cy、data-tx/ty等）に応じて中心座標へ移動し、`savePanelSvg()`で保存
- コマ内オブジェクトはそのコマの中心（`panel.points`のbbox中心）、オーバーレイ配下はページ全体の中心（`viewBox`中心）へ移動。コマ外にドラッグして操作不能になったオブジェクトをレイヤーパネルから選択→OCで復帰させる用途

### 複製・移動の選択不具合、および排他選択バグの修正
- **選択フレーム残留**: `duplicateSelectedObject()`/`moveSelectedObject()`の「異なるコマへ」分岐は、DB保存→`renderLayoutTab()`によるDOM再構築を経由するため、複製・移動先の新しいオブジェクトが選択状態にならず操作困難だった。再構築後に新IDでライブDOMから複製先オブジェクトを再取得し、`_selectClone()`で選択状態・ハンドル・パネル選択UIを復元するよう修正（同一コマ内複製・オーバーレイ複製は元々`_selectClone()`を使っており問題なかった）
- **フキダシ座標破損**: 上記修正で選択が復元されるようになったところ、フキダシ（`.balloon-shape`）を別コマへ移動すると形状が壊れて表示され、クリックすると消える不具合が判明。原因は`_applyCenterTranslate()`がフキダシを「その他の図形」向けの汎用ロジック（`transform="translate(dx,dy)"`を付与するだけ）で扱っており、フキダシが`dataset.cx`/`dataset.cy`から`d`属性を都度再構築する仕組みと矛盾していたため（`transform`で見た目だけ動かしても`cx`/`cy`は複製元のままで、後続の`_updateH2ShapePath()`呼び出しで位置が巻き戻り、新パネルのclip-path外に出て消えていた）。`_applyCenterTranslate()`にフキダシ専用分岐を追加し、`dataset.cx`/`cy`自体を移動して`_updateH2ShapePath()`で再構築するよう修正（ドラッグ移動と同じ方式に統一）
- **排他選択されない根本原因**: レイヤーパネルの行クリックによる選択は全種類のstateを正しくクリアしていたが、**キャンバス上で直接クリックして選択する経路**（`selectImage()`、フキダシmousedown、テキストmousedown）は一部のみクリアしており、他種類の選択が残留していた（特にテキストのcanvas mousedownは`selectedImageEl`等をまったくクリアしていなかった）。これが複製・移動時に「意図した対象と違うオブジェクトが操作される」不具合の実質的な原因でもあった。3箇所とも既存の包括的なクリア関数`_clearObjectSelection()`を呼ぶよう統一し、真の排他選択を実現

### アセット削除機能（Alt+クリック）
- 従来、アセットパネル（Aタブ）の素材ファイルを削除する手段が存在しなかった
- サーバー側（`py/ccc.py`）: `handle_delete_asset()`を新設し、`folder`/`name`から`ASSETS_DIR`配下の対象ファイルのみを`_safe_path`でパストラバーサル対策しつつ削除→`assets.json`再生成。`save-group-asset`と同じパターンで明示的POSTルートとディスパッチテーブル両方に登録
- フロントエンド: アセット項目のクリックハンドラで`e.altKey`を判定し、`confirm()`確認後に`deleteAssetItem()`が削除APIを呼び出して一覧を再描画
- ついでに「グループをアセットとして登録」成功後の一覧更新が`loadAssets(false)`（静的ファイル直接fetch）だったのを`loadAssets(true)`（`refresh-assets`経由）に統一し、追加・削除双方で確実にサーバー側の最新状態を反映するようにした
- **既知の注意点**: 新設した`/api/ccc/delete-asset`エンドポイントはComfyUIサーバー起動時にルーティングされるため、コード変更を反映するにはサーバー再起動が必要（未反映の状態で叩くとaiohttpの`HTTPNotFound`が返すプレーンテキストを`JSON.parse`しようとしてエラーになる）。エラー時のメッセージをその旨がわかるよう改善済み

### ヘルプ更新
`_HELP_DATA`の「はじめに」画面構成・「レイアウト」概要に新見出し「ツールペイン」を追加。「レイアウト」テキストの項にフォント選択（Google/システム/カテゴリ）とアセット削除（Alt+クリック）を追記。「アセットパネル」フォントタブ(F)の項にスタイルサムネイルのフォント統一（Zen Antique）を追記。

### 動作確認
各変更について、都度ユーザーがブラウザで表示・操作して確認済み（ツールペイン表示、フォントカテゴリ切替、OCボタンでの復帰、別コマへの複製/移動後の選択状態、フキダシの位置保持、排他選択、アセット削除は要サーバー再起動の説明込みで確認中）。

### 過去のペンディング項目の解消状況（2026-07-07以前からの持ち越し分）
- **プリセットのグループ機能**（2026-07-07から2回持ち越し）: 今回実装したレイアウトのテキストメニュー「カテゴリ」機能（`_fontMgr.favorites`をフォント単位で分類）で要件を満たしたと判断し、**完了扱いとする**。プリセット自体に個別のグループ属性を持たせる実装は行わない
- **BiRefNet背景除去**（Processingタブの`_procRemoveBackgroundBiRefNet`スタブ、未実装のまま放置）: Imageタブの「BG Remove」機能で背景除去自体は実装済みのため、**完了扱いとする**。`_procRemoveBackgroundBiRefNet`のスタブ関数自体は未使用のまま残置（削除はしていない）
- **ファイル保存構成の見直し**（IndexedDB完結型を維持するかサーバー永続化を追加するかの方針決定）: 引き続き**未検討のまま**とする

## 2026-07-08（スクリプトタブ: プロットにシーン/人物列を追加・横書き/縦書きプレビュー・Insertのセル選択対応）

### 概要
スクリプトタブのプロットテーブルを「コマ番｜セリフ番｜セリフ」の3列から「シーン｜コマ番｜セリフ番｜人物｜セリフ」の5列に拡張し、ページの説明（シーン）とセリフの発話者（人物）を記入できるようにした。あわせてプロットを台本形式のテキストとして閲覧できる「プレビュー 横」「プレビュー縦」サブタブを新設し、レイアウトタブの「Insert」ボタンをプロット側の任意セル（シーン／人物／セリフ）を選択して挿入できるよう拡張した。

### プロットのデータ構造変更（シーン・人物）
- ページに`scene`（文字列）、各セリフを文字列から`{character, text}`オブジェクトに変更（`main.js`の`_scriptBlankPage`/`_scriptBlankDialogue`）
- `_scriptNormalizeData()`で旧形式（文字列セリフのみ・sceneなし）から新形式へ自動変換する後方互換処理を追加。既存の保存済み作品データもロード時に壊れず移行される
- `_scriptRenderPage()`のテーブルを5列に拡張。シーン列はページ内の全セリフ行にまたがる`rowspan`セル（先頭行にのみ生成し`textarea`で編集、変更は`page.scene`に保存）、人物列は各セリフ行ごとの1行`input`
- **シーンtextareaの高さ不具合**: `rows="2"`固定のため、rowspanで縦に結合された背の高いセルの中でも上部2行分しか高さが埋まらず余白ができる問題が発生。`.project-panel-td-scene`に`height: 1px`（rowspanセルの実高さを子要素の`height:100%`に伝える定番ハック）を指定し、`.script-scene-textarea`に`height:100%`を設定して解消

### プレビュー 横／縦サブタブ（旧・仮1/仮2プレースホルダー）
- 「仮1」を「プレビュー 横」、「仮2」を「プレビュー縦」に改名し、それぞれ`_scriptRenderPreviewH()`/`_scriptRenderPreviewV()`で実装
- 全ページ分のプロットを「シーン：内容」→ページ内の各コマのセリフを「人物：セリフ」の順で並べたテキストとして、ページ番号・コマ番・セリフ番を表示せずにページ横断で一括表示
- 横は`writing-mode: horizontal-tb`の通常表示、縦は`writing-mode: vertical-rl`で縦書き・右から左の段組み表示（`overflow-x: auto`で列数が増えても横スクロール可）。DOM挿入順（1ページ目→2ページ目…）がそのままvertical-rlの右→左の読み順になることを利用し、横版と同じ生成ロジックを流用
- サブタブ切替クリック時に毎回最新のプロット内容で再生成する読み取り専用ビュー

### レイアウトタブ Insertボタン: セル単位の選択に対応
- 従来はプロットの行選択＝セリフ本文固定だったが、行クリック時にクリックされた要素（`.script-scene-textarea`/`.script-character-input`/それ以外）を判定して`_script.sel.field`に`'scene'`/`'character'`/`'text'`を記録するよう変更
- `_scriptGetSelectedDialogue()`が`field`に応じて`page.scene`/`dlg.character`/`dlg.text`のいずれかを返すよう変更。呼び出し元の`insertScriptDialogueText()`は無改造のまま、シーン欄・人物欄を選択した状態でもInsertで挿入できるようになった
- ヘルプ本文・Insertボタンのtitle属性も「セル（シーン／人物／セリフ）」の選択に対応した文言に更新

### 動作確認
各変更について、都度ユーザーがブラウザで表示・操作して確認済み（シーン列の高さ修正、プレビュー 横/縦の表示、Insertのセル選択挙動）。

## 2026-07-07（Imageタブ アセットパネル連携・レイアウトPタブの作品フィルタ・テンプレートウィザードのガイドグリッド）

### 概要
Imageタブ（Canvas 2Dレイヤーエディタ）にもレイアウトタブと同じアセットパネルのA/Fタブを追加し、アセットのレイヤー挿入とフォントタブのスタイル/プリセット適用・挿入を行えるようにした。あわせてレイアウトタブのアセットパネル「P」タブを作業中の作品のページのみに絞り込み、ページタブ「テンプレートを作成」ウィザードにガイドグリッド（表示ON/OFF・セル幅高さ・スナップ）を追加した。

### Imageタブ: アセットパネル(A/F)連携
- **A/Fのみ表示**: `main.js`の`switchTab()`で、Imageタブの時だけ`.asset-panel-tab-btn[data-panel-tab="pages"/"templates"]`を非表示にし、P/T選択中にImageタブへ移動した場合はAタブへ強制切替。アセットパネル自体を隠す`_hideAssetPanelTabs`からは`'image'`を削除。挿入ボタンの文言もタブに応じて「コマに挿入」⇔「レイヤーとして挿入」を切替
- **アセット(A)の挿入**: `handleInsertAsset()`の先頭でアクティブタブが`image`かを判定し、レイアウト用のコマ/オーバーレイ選択ロジックを完全にバイパスして既存の外部連携用公開API`window._ccImageTab.loadFromUrl(path, name)`を呼ぶだけにした。SVGグループアセットも含め常に1枚のラスター画像としてレイヤー化する方針（Imageタブはレイアウトのような複数SVG要素の概念を持たないため）
- **フォント(F)のスタイル/プリセット**: `image-tab.js`に`applyFontStyleToSelection`/`applyFontPresetToSelection`/`insertFontStylePlaceholder`/`insertFontPresetPlaceholder`を新設。レイアウトタブと同じ「テキスト選択中は適用、未選択なら新規挿入」の二役挙動を再現
- **Canvas 2Dでのスタイル再現**: レイアウトタブ（SVG）は塗り・線をネイティブ属性、袋文字・影を`<filter>`（feMorphology/feDropShadow）で実現しているが、Imageタブはラスターtextレイヤーのため`_rerenderTextLayer()`を拡張し`strokeText`/`shadowColor`等で同じ見た目を再現（①袋文字=太い`strokeText`を影なしで背面描画→②影ONで③通常線の`strokeText`→④`fillText`の順）。線/袋文字/影のぶんの追加余白は`_textExtraPad()`で計算し、`_measureTextBox()`でレイヤーの実寸に反映
- **選択中テキストへの適用時の再構築**: スタイル変更で余白（ひいてはレイヤー実寸）が変わるため、`_applyTextPropsToLayer()`で中心位置と表示倍率を保ったままレイヤーを再構築してから`_rerenderTextLayer()`を呼ぶ設計にした
- 手動タイプしたテキスト（TextTool.js経由）は`strokeEnabled`等が`undefined`のままなので`_rerenderTextLayer`は従来通り塗りのみ描画され、無改造・回帰なし
- Kaptureで動作確認: t1.png(mychain)をAタブから新規レイヤー挿入→800×600新規キャンバスでFタブのスタイル挿入（線・袋文字・影の合成表示）→同じテキストへ別スタイル適用（レイヤー数が増えずin-placeで見た目だけ変化）→プリセット適用（フォント/サイズ/色/線/影が同時反映）→レイアウトタブに戻してP/Tタブが復帰、いずれもコンソールエラーなし

### レイアウトタブ: アセットパネル「P」タブを作業中の作品のページに絞り込み
- `renderPageThumbGrid()`を変更し、`state.pages`全件ではなく`_pageMgrGroups.data[state.activeWork.name]`（作品内のページ順序を保持する既存データ）でフィルタするように変更。作品未選択時は「作品が選択されていません。ページタブで作業中の作品を選択してください。」と案内表示
- 作品切替（`_workSetActive`）時にもこの一覧が追従するよう、切替直後に`renderPageThumbGrid()`を呼ぶよう変更
- 作品へのページ追加・所属変更は引き続きページタブ（作品管理）側の機能に委ねる方針
- Kaptureで動作確認: 作業中の作品（1ページ）でPタブを開くと、ページタブの作品管理で確認できる他の多数のページ（ストック等）は表示されず、作品内の1ページのみ表示されることを確認

### ページタブ「テンプレートを作成」ウィザード: ガイドグリッド機能
- 「ベースを作成」後の分割画面に「ガイドグリッド」チェックボックス＋幅/高さの数値入力、「スナップ」チェックボックスを追加（`templates/index.html`の`#tmplwiz-step-cut`内）
- `_tmplWiz`状態に`gridEnabled`/`gridW`/`gridH`/`gridSnap`を追加し、`_tmplWizRender()`の最後で`_tmplWizRenderGrid()`が`<g pointer-events="none">`配下にダッシュ線を描画（`svg`要素自体がmousedown/moveリスナーのため、グリッド線がクリックを奪うことはない）
- **色調整**: 当初`rgba(255,255,255,0.6)`（白）で試したがキャンバス背景（白〜薄い水色パネル）に対して視認性が低く、`rgba(255,140,0,0.75)`（オレンジ）に変更。その後ユーザーから「見えなくはないが細い」との指摘を受け、線の太さも倍増（`width*0.0008`→`width*0.0016`、最小値も1→2）
- **グリッドスナップ**: 「スナップ」ON時、`_tmplWizSnapPoint()`が分割線の始点/終点をグリッド交点（`gridW`/`gridH`の倍数）に丸める。表示ON/OFFとは独立したフラグで、グリッド非表示のままスナップだけ有効にすることも可能。実装は座標変換の唯一の入口`_tmplWizClientToSvg()`の戻り値にスナップを適用する1箇所のみで、mousedown/mousemove/mouseupの3ハンドラすべてに自動適用される
- 極端に細かいグリッド指定（セルサイズがページ幅/高さの1/300を下回る）は密集しすぎるため描画自体をスキップする防御を追加
- ON/OFF・サイズ・スナップの設定はlocalStorage(`tmplwiz_grid_settings`)に永続化し、ウィザードを開き直しても引き継ぐ
- Kaptureで動作確認: グリッド表示のON/OFF、幅/高さ変更に伴う間隔追従、スナップのトグル、いずれもコンソールエラーなし

### ヘルプ更新
`_HELP_DATA`の「ページ — テンプレート」に「ガイドグリッド（分割画面）」見出しを新設し、上記グリッド/スナップ機能を記載。「アセットパネル」の概要・A/P/Fの各見出しを更新し、Imageタブでの表示制限（A/Fのみ）・挿入ボタンの違い（レイヤーとして挿入）・PタブがWork限定である旨・FタブのCanvas 2D再現方式を追記。

### 次回
プリセットのグループ機能（2026-07-07朝の実装分から持ち越し、Fタブの折りたたみ表示に対応する形でプリセット自体に任意のカテゴリ/グループを持たせる）は未着手のまま。

## 2026-07-07（フォントタブ: プリセット機能実装・レイアウトタブ連携）

### 概要
前日（2026-07-06）の「次回予定」を受け、「プリセット」（フォント＋サイズ＋スタイル参照）機能を実装し、レイアウトタブ・アセットパネルから呼び出せるようにした。あわせてスタイル/プリセットのUI改善（ドロップダウン化・別名保存・レイアウト再構成）と、アセットパネルへの「フォント」タブ新設まで行った。

### スタイルタブ: プレビュー背景の切替
「デフォルト」「ホワイト」トグルボタンをプレビューエリア上部に追加。背景色は`.fontmgr-style-preview-canvas`側に持たせ、選択状態はlocalStorage（`fontmgr_style_preview_bg`）へ永続化。

### プリセット機能の実装
- データ構造: `{id, name, fontFamily, fontSize, isVertical, styleId}`（`fontmgr_text_presets`にJSON配列保存）。スタイルは`styleId`で参照する2階層設計を踏襲
- **SVGへの線・袋文字・影の適用方式はSVGフィルタで実装**（前日メモに残していた「2枚重ね方式 or フィルタ、要検討」を決定）。塗り・線はテキスト要素のネイティブ`fill`/`stroke`属性、袋文字・影は`feMorphology`（膨張）→`feFlood`→`feComposite`→`feMerge`→`feDropShadow`を1つの`<filter>`にまとめて適用する`_fontMgrApplyStyleAttrsToTextEl()`で実装。この方式により既存の単一`<text>`要素前提の選択・ドラッグ・回転・リサイズロジックを一切変更せずに済んだ
- `applyTextInput()`を作成/編集した要素を返すよう変更（既存呼び出し元には影響なし）し、新設の`insertPresetPlaceholderText()`/`applyPresetToSelectedText()`から利用
- レイアウトタブ「テキスト」サブタブにプリセット選択＋挿入/適用ボタンを一時追加（後日Fタブ実装により撤去、後述）

### プリセットをスタイルタブへ統合
独立していた「プリセット」プレビュータブを廃止し、スタイルタブ左パネル下部（既存コントロールの余白）にプリセットのフォーム一式を統合。プレビューもスタイルタブと共通のキャンバスを再利用し、プリセットの「スタイル選択」を変更するとそのスタイルの見た目が同じキャンバスに反映されるようにした。

### 登録済みスタイル/プリセットのUI改善
- チップ一覧→ドロップダウン選択＋削除ボタンに変更（`#style-select`/`#preset-select` + `#style-delete-btn`/`#preset-delete-btn`）
- 保存時、読込中のエントリから**名前を変更すると別名で新規保存**（元のエントリは変更しない）、名前を変えなければ上書き、という仕様に変更（従来は「新規」ボタンを押さないと必ず上書きになっていた）

### レイアウトの微調整
- `.fontmgr-right`（プロパティペイン）と`.fontmgr-style-controls`の幅を拡大し、`.btn`に`white-space:nowrap`を追加して「追加/解除」「保存/新規」ボタンの文字が縦に折り返される不具合を修正
- `#fontmgr-tab.tab-content.active`に`height:100%;overflow:hidden`が無く、左パネルのカテゴリ展開でタブ全体の高さが伸縮しプレビュー中央の文字位置がずれる不具合を修正（`#output-tab`等と同じ既知パターンが未対応のまま残っていた）

### スタイル設定の項目再構成・斜体/下線追加
- 塗り・線を1行に統合、影を「色+ぼかし」の行と「影位置：X・Y」の行に分割
- 斜体・下線チェックボックスを新設。プレビュー（CSS）・実SVG適用（`font-style`/`text-decoration`属性）ともに対応

### アセットパネルのタブ短縮＋「フォント」タブ新設
- タブ名を「アセット」「ページ」「テンプレート」→「A」「P」「T」に短縮（title属性でフルネーム表示）
- 「フォント」(F)タブを新設。保存済みスタイル/プリセットをサムネイル一覧表示（ミニプレビューはスタイルタブの`_fontMgrRenderTextStylePreview()`を共用）
- サムネクリックの挙動: **テキスト未選択時は選択中のコマ中心に新規挿入**（スタイルの場合は現在のデフォルトフォントのまま挿入）、**テキスト選択中はそのテキストへ適用**
- サムネ背景色パレット（デフォルト/黒/白/グレー/手動）を追加。選択色はlocalStorageへ永続化し、暗背景と同系色の線など見づらいスタイルを確認しやすくした
- スタイル/プリセットの一覧を、フォントタブの左パネルと同じ`_fontMgrGroupOpen`/`_fontMgrToggleGroup`を再利用した折りたたみグループ表示に変更（将来のプリセットのグループ機能実装を見据えた設計）

### 自動更新の修正（2件）
レイアウトタブの「テキスト」サブタブのプリセットセレクト、およびFタブのサムネ一覧が、既にアクティブな状態のままフォントタブで新規保存してレイアウトタブへ戻っても更新されない不具合があったため、`switchTab('layout')`のタイミングで再描画するよう修正（前者は後にUI自体を撤去、Fタブ側の自動更新は存続）。

### 旧UIの削除
Fタブの実装により不要になった、レイアウトタブ「テキスト」サブタブのプリセットドロップダウン・挿入/適用ボタンと、関連関数`_fontMgrRefreshPresetSelectInLayout()`を削除。`insertPresetPlaceholderText()`/`applyPresetToSelectedText()`自体はFタブのサムネクリックから引き続き使われるため存続。

### ヘルプ更新
`_HELP_DATA`の「フォント」「アセットパネル」項目を全面更新し、上記の新機能（スタイル/プリセット作成・別名保存、Fタブでの挿入/適用、背景パレット、A/P/T/F表記）を反映。「はじめに」の画面構成の説明にもフォント関連の導線を追記。

### 動作確認（Kapture実機）
スタイル/プリセットの作成・保存・別名保存・削除・ドロップダウン読込、フィルタのDOM生成（fill/stroke/paint-order/filter要素の中身）、レイアウトタブでの挿入・適用（フォント・サイズ・装飾の反映、フィルタの入れ替え）、Fタブでのサムネ表示・挿入/適用・背景パレット切替・折りたたみ・自動更新、ヘルプ表示、いずれもコンソールエラーなしで確認済み。

### 次回
プリセットのグループ機能（Fタブの折りたたみ表示に対応させるための実データ側の対応）を実装予定。

## 2026-07-06（旧「画像編集」タブ(imgedit)削除・Imageタブ機能追加）

### 概要
Imageタブへの機能統合が完了したことを受け、既存の「画像編集」タブ(imgedit)本体を削除。あわせてImageタブへ2件の機能追加（My CurveのmychainフォルダードSelect対応・Save to Galleryボタン）を実施。

### imgeditタブ削除
- `templates/index.html`: nav内`data-tab="imgedit"`ボタンと`imgedit-tab`セクション（212行）を削除
- `static/js/main.js`: `_imgeditState`〜`_imgeditGmicInsertResult`のメインブロック（約1730行）、`pixiFxOpenForImgedit`、imgedit専用ヘルパー`_editDrawBox`/`_editRoundedRect`/`_editApplyBoxBlur`/`_editApplyMosaic`（呼び出し元が無いことを確認した上で削除）、`switchTab()`のimgedit分岐、`_hideAssetPanelTabs`の`'imgedit'`エントリ、ヘルプタブの「画像編集」項目（`_HELP_DATA`/`_HELP_ORDER`）を削除
- **共用コードの扱い**: `_imgeditDrawOriginalUnit`はレイアウトタブの「レイヤー描画」機能（`_layerDrawMouseMove`）からも呼ばれていたため、`_layerDrawOriginalUnit`にリネームしてボックス描画共通ヘルパー群のそばに移設。`_loadDefaultOriginalImg`はimgedit向けの初期化部分のみ除去し、レイヤードロータブ用ロジックは維持
- **トラブルと対応**: ブロックをまとめて削除した際、Imageタブ連携の入口関数`openImageTabWithSelected`（レイアウトタブ「画像タブで編集」ボタンの遷移先）を誤って削除範囲に巻き込んでしまい、初期化処理全体が`ReferenceError`で失敗する不具合が発生。`image-tab.js`の`loadFromSvgElement`/`window._ccImageTab`連携を参照し、`switchTab('image')` + `window._ccImageTab.loadFromSvgElement(imgEl)`という実装で復元して解消
- Kaptureで動作確認: 初期化エラーなし、レイアウト/Image/ヘルプ各タブの表示、「画像タブで編集」ボタンのクリックも例外なし

### Imageタブ: My Curveのmychainフォルダ選択対応
ShapeツールのMy Curveで、画像を`assets/mychain`フォルダからドロップダウン選択できるように拡張（既存のローカルファイルアップロードは並存）。
- `image-tab.js`: `init()`から`_loadMychainAssets()`を呼び、既存のアセットマニフェスト`/ccc_assets/assets.json`（アセットパネルと共用）からmychainフォルダのエントリを取得してキャッシュ
- `_renderToolOptions("shape")`の画像選択欄に`<select id="ie-shape-mychain-select">`を追加。選択時に`ShapeTool.setOriginalImage(img, name)`を呼んで反映
- Kaptureで動作確認: ドロップダウンに`t1.png`が表示され、選択後に画像名表示が更新されることを確認

### Imageタブ: Save to Galleryボタン追加
アクションバーのSave PNGの右隣に「Save to Gallery」ボタンを追加。ComfyUI標準の`/upload/image`エンドポイントへ`type=output`・`subfolder=cc`を指定してPOSTすることで、`ComfyUI_5/output/cc/`へ保存する（フォルダが存在しなくてもComfyUI本体側`image_upload`が自動作成することを確認済み）。
- `image-tab.js`: `_saveToGallery()`を追加（`_uploadToComfyUI()`の直前）。ファイル名は`cc-image-{タイムスタンプ}.png`
- `templates/index.html`: `#ie-save-gallery-btn`をSave PNGとSave to Eagleの間に配置
- 実機確認: `output/cc/cc-image-20260706160352.png`として保存されることをファイルシステムで確認

### Imageタブ: 調整レイヤーへのマスク適用対応
調整レイヤー（明度/コントラスト/彩度/色相/ぼかし/シャープ/ノイズ/セピア/グレー化/反転/色温度/周辺減光）に、既存のマスクレイヤー機構（✂ボタンのmaskApply）でマスクを適用できるように拡張。従来は「直後の通常レイヤー1枚をクリップする」設計のみで、canvasを持たない調整レイヤー（ctxへ直接フィルタを適用する方式）はクリップ対象として非対応だった。
- `image-tab.js`: `_renderMaskGroup`に`targetLayer.type === "adjustment"`分岐を追加。適用前のctx内容を退避→フィルタ適用→マスクで`destination-in`/`destination-out`→マスク外側を`destination-over`で退避内容に復元、という非破壊マスクの標準パターンで実装
- マスク合成部を`_buildMaskCanvas`に抽出して共通化
- 保存用の`_compositeForExport`（旧実装は単一マスク・単一ターゲットのみでグルーピング非対応）を、プレビュー用`_updateCompositeView`と同じ`_computeMaskGroups`＋`_renderLayersComposite`方式に統一し、プレビューと保存結果の食い違いを解消（旧`_renderMaskedLayer`は不要になり削除）
- 動作確認: 画像に grayscale 100%の調整レイヤー→直前にマスクレイヤー追加→maskApply ON（未着色）で効果が完全キャンセルされカラーに戻る／マスクツールの「Invert」でマスク全面が反転し効果が全面適用に戻ることを確認。Save to Galleryで書き出したPNG（オーバーレイなしの実合成結果）で、意図通りグレースケール全面適用されていることを確認

### Imageタブ: マスクオーバーレイをアクティブレイヤー選択時のみ表示に変更
上記の検証中、マスクレイヤーが存在する限り常に赤いオーバーレイが表示され続け、他のレイヤーを選んでも消えないことが判明したため修正。
- `_renderLayersComposite`: オーバーレイ表示可否を「そのマスク（グループ）がアクティブレイヤーを含むか」で個別判定するよう変更。マスクレイヤーを選択している間だけ赤色ガイドが表示され、他レイヤー選択時は実際の合成結果がそのまま見える
- 副次的に見つかったバグを修正: Selectツールでレイヤーを切り替えた際に`_updateCompositeView()`が呼ばれておらず、drawCanvasの表示が更新されていなかった（オーバーレイが消えなかった主因）
- 動作確認: マスクレイヤー選択中は赤オーバーレイ表示→画像レイヤー選択で即座に消えて実合成結果が見える→マスクレイヤーに戻すと再表示、を確認

### フォントタブ: お気に入りツリーのカテゴリ折りたたみ対応
右パネルのお気に入りツリーで、カテゴリごとにフォント一覧を開閉できるように変更。
- `_fontMgrRenderFavTree`: 左パネルのフォントリストと同じ`_fontMgrGroupOpen`／`_fontMgrToggleGroup`を再利用（キーは`favcat:<カテゴリ名>`）。矢印クリックのみ開閉トグル、カテゴリ名クリックでの既存動作（お気に入り一覧プレビューへの切り替え）は維持
- 対象は「お気に入りツリー内の各カテゴリ」のみ（「タグ」「お気に入り」セクション自体の開閉は対象外、ユーザー確認済み）
- 動作確認: 矢印クリックで開閉、カテゴリ名クリックでのプレビュー切り替えは従来通り

### フォントタブ: お気に入りのカテゴリ一覧を右パネルから左パネルへ統合
上記の折りたたみ対応の直後、「左パネルのソースタブ（システム/Google Fonts/お気に入り）にカテゴリタブを追加すれば右パネルの一覧は不要」という要望を受けて方針転換。右パネルのお気に入りツリー（`#fontmgr-fav-tree`）を削除し、左パネルにカテゴリタブとして統合した。
- `templates/index.html`: 左パネルの`.fontmgr-source-tabs`直下に`#fontmgr-fav-cat-tabs`を新設（お気に入りソース選択時のみ表示）。右パネルの`#fontmgr-fav-tree`は削除（カテゴリ管理ボタン群は右パネルに残置）
- `main.js`: `_fontMgrRenderFavTree`を`_fontMgrRenderFavCatTabs`に置き換え、左パネルへ「すべて」＋各カテゴリ名タブを描画。クリックで`_fontMgr.selectedFavCat`を更新し、`_fontMgrCurrentList()`のfavorites分岐で絞り込み。`_fontMgrSwitchSource()`でソース切替時にタブ表示を制御。未使用だった`_fontMgr.selectedFavFamily`も削除
- `style.css`: `.fontmgr-fav-cat-tabs`/`.fontmgr-fav-cat-tab-btn`を新規追加、不要になった`.fontmgr-fav-tree`系セレクタを削除
- 動作確認: お気に入りソース選択時のみタブ表示、カテゴリクリックで一覧絞り込み、他ソースでは非表示になることを確認

### フォントタブ: 表記統一「お気に入り」→「カテゴリ」・右パネルのレイアウト再構成
ユーザー提示のワイヤーフレーム画像に沿って、UI文言を「カテゴリ」に統一し右パネルの構成を変更（内部の`source: 'favorites'`等の識別子は変更なし、表示テキストのみ）。
- 左パネルのソースタブ「お気に入り」→「カテゴリ」、中央パネルのプレビュータブ「お気に入り一覧」→「カテゴリ一覧」、右パネル見出し「お気に入り」→「カテゴリ」
- 右パネルを画像通りに再構成: フォント名・適用ボタンの直下に「プロパティ表示エリア」（選択中フォントのタグチップ、既存`#fontmgr-tag-chips`を移動）を新設 → 区切り線 → 見出し「タグ追加」（旧「タグ」）＋入力欄 → **新設: 作成済みタグ一覧**（`#fontmgr-all-tags-chips`、全フォントの既存タグをクリックで選択中フォントへ追加できる。付与済みタグは`.selected`でハイライト） → 区切り線 → 見出し「カテゴリ」（旧「お気に入り」）＋管理ボタン群
- タグの追加・削除のたびに作成済みタグ一覧も再描画し、プロパティ表示エリアとの選択状態を同期
- 動作確認: フォント選択→プロパティエリアに既存タグ・全タグ一覧で該当タグがselected表示→未追加タグクリックでプロパティエリアに反映されることを確認

### フォントタブ: 「スタイル」タブ新設（第1段階: 塗り・線・袋文字・影の作成・保存・プレビュー）
将来のプリセット機能（フォント＋サイズ＋スタイル参照をレイアウト/Imageタブから呼び出せるようにする）に向けた第1段階。今回は「スタイル」単体の作成・保存・プレビューのみを実装（ユーザーと段階分けに合意）。データ構造は2階層方式（スタイルは独立部品、将来のプリセットが参照する）を採用。
- 中央パネルのプレビュータブに「スタイル」を追加。プレビューはCSSベース（既存の基本/文章/カスタムプレビューに合わせる）で、`-webkit-text-stroke`と`text-shadow`を使用
- **袋文字は2枚のテキストレイヤーを重ねて実現**（SVG/CSSともstrokeは1色までのため）: 背面レイヤーに「線幅+袋文字幅」の太い縁取りを敷き、前面レイヤーの線と重ねることで二重取りに見せる
- データは`_FONTMGR_LS_STYLES='fontmgr_text_styles'`にJSON配列で保存（`work_size_presets`と同じload/saveパターン）。1件は`{id, name, fill, strokeEnabled/Color/Width, bukuroEnabled/Color/Width, shadowEnabled/Color/Blur/Dx/Dy}`
- チップ一覧から読込・編集・削除が可能。プレビューのフォントはフォントタブで選択中のフォントに自動追従
- 動作確認: 線ON→袋文字ON+色変更で二重取り確認→影ONでtext-shadow値を確認→保存→リロード後も一覧に残り、クリックで全項目が復元されることを確認→削除も確認
- 次回: 「プリセット」（フォント+サイズ+スタイル参照）の作成・保存と、レイアウト/Imageタブからの呼び出し（プレースホルダ挿入・選択テキストへの適用）を実装予定

## 2026-07-05（レイアウトタブ: マスクレイヤー／マスクツール）

### 概要
レイアウトタブに**コマ単位／オーバーレイ単位のマスク機能**を追加。SVG `<mask>`（白=表示・透明=非表示）を対象グループに適用し、ブラシ（隠す/戻す）で塗って編集する。参考: ComfyUI-Workflow-Studio Image Edit タブの MaskTool / LayerManager（maskApply・ブラシスタンプ方式）。SVG DOM基盤方針（canvasライブラリ不採用）に沿い、編集はオーバーレイcanvas＋ベイクで実現。

### SVG表現・データ
- 対象: `g[data-clip-panel="panel_X"]`（コマ）／`g[data-overlay-layer]`（オーバーレイ、内部ID `__overlay__`）に `mask="url(#ccc-mask-<target>)"`
- defs 内: `<mask id="ccc-mask-<target>" data-ccc-mask="<target>" maskUnits="userSpaceOnUse" x/y/width/height=領域><image data-ccc-mask-img href=PNG(dataURL) preserveAspectRatio="none"/></mask>`
- マスク領域: コマ=panel.points の bbox／オーバーレイ=viewBox全体。マスクcanvasは最大辺 `MASK_MAX_DIM=1400px`
- 一時無効化: `mask` 属性を外し `g` に `data-ccc-mask-off="1"`（def は保持）
- 永続化: `savePanelSvg` が `mask[data-ccc-mask=panelId]` を、`saveOverlaySvg` が `mask[data-ccc-mask="__overlay__"]` を defs に持ち回るよう拡張。復元は既存 `buildMergedSvg` の defs マージで自動

### UI
- **マスクサブタブ**（画像と3Dポーズの間）: 対象ラベル／編集ON・OFF／ブラシ 隠す・戻す／サイズ(画面px 4-300)・硬さ／非表示部を赤表示／マスク適用チェック（一時無効化）／反転・全表示・全非表示・マスク削除（confirm）／ステータス
- **レイヤーパネル**: コマ行・オーバーレイ行に 🎭 ボタン（マスクあり=青、無効中=減光）。クリックで対象選択→マスクサブタブ→編集ON（マスク未作成なら全表示で新規作成）

### 実装（main.js `_maskState` 一式 / `initMaskTool`）
- 編集ON: mask def 確保→既存 href を offscreen canvas に読込→ `#image-layer` にオーバーレイcanvas（layer-drawと同パターン、id `_mask-edit-overlay`）
- ブラシ: radial gradient スタンプ（硬さ対応）。隠す=`destination-out`／戻す=白 `source-over`。線分補間 spacing=size*0.2。ブラシサイズは画面px→SVG単位→マスクcanvas px に換算（`getScreenCTM`）
- プレビュー: オーバーレイに「非表示部分の赤表示」（赤塗り→destination-outでマスク白を抜く）＋対象領域の破線枠＋ブラシカーソル円。ストローク中は赤プレビューのみ更新し、**pointerup で toDataURL→mask画像href更新→savePanelSvg/saveOverlaySvg**（描画中の重いベイクを回避）
- 履歴: 編集セッション（編集ON〜OFF）内の最初の操作で1回 `pushHistory`
- ページ切替対策: 編集ON時に `pageName` を記録し、`renderLayoutTab` 再アタッチ時にページが変わっていたら自動で編集OFF（旧ページのマスク持ち越し防止）

### 動作確認（Kapture実機・複製ページ上）
🎭→マスク新規作成＋編集ON（領域破線枠表示）／全非表示→コンテンツ消滅＋赤表示／反転→全表示復帰／リロード後の復元（保存往復）／マスク適用OFF→一時解除、すべて確認済み。ブラシドラッグはUI経路が同一のため手動確認を推奨。

### 今後
画像編集タブへのマスクレイヤー・マスクツール追加を予定（workflow studio の LayerManager 型・canvasベースを想定）。

### 追記（同日・オブジェクト単位のレイヤーマスクに対応）
「コマ全体マスクだと最上位の塗りつぶしにしかならない」との指摘を受け、**マスクを個別レイヤー（オブジェクト）に付けられる**よう拡張（Photoshopのレイヤーマスク相当）。画像2枚が重なっている場合、上の画像に隠すマスクを塗ると**その画像だけが消えて下のレイヤーが見える**。
- **対象解決** `_maskCurrentTarget`: オブジェクト（画像/フキダシ/テキスト/図形/グループ）選択中はそのオブジェクトID（IDが無ければ `_maskEnsureElId` で付与）、未選択時は従来のコマ/オーバーレイ全体。オブジェクト判定は「panels の id 一覧に無い target」（`_maskIsObjectTarget`）
- **適用先**: mask 属性を個別要素に付与。マスク領域（塗り範囲）は所属コマの bbox（オーバーレイ配下はページ全面）
- **保存**: `_maskSaveFor` が対象の所属（コマ/オーバーレイ）を解決して savePanelSvg/saveOverlaySvg を呼ぶ。savePanelSvg/saveOverlaySvg は「コマ/オーバーレイ全体のマスク」に加え、**そのグループ内要素をtargetとする mask def** も defs に持ち回るよう拡張
- **レイヤーパネル**: マスク行は**対象オブジェクト行の直上**（インデント+1）に表示。↑↓ボタンで**1つ上/下のレイヤーへ付け替え**（移動先に既存マスクがある場合は alert、端では no-op）。画像行に🎭「このレイヤーにマスクを追加」ボタン追加。コマ行/オーバーレイ行の🎭は全体マスク用として存続
- **注意**: マスクは userSpaceOnUse（ページ座標）なので、対象オブジェクトを後から移動してもマスクは追従しない（workflow studio と同じ独立マスク挙動）
- 実機確認: 重なった2画像の上側にマスク（隠す・全面塗り）→上だけ消えて下が表示✓／マスク行が対象直上に表示・↑↓動作✓／リロード後の復元（オブジェクトマスクdefの保存往復）✓

### 追記（同日・複数マスクレイヤー対応に改修）
ユーザー要望により単一マスク→**コマ/オーバーレイごとに複数のマスクレイヤー**を持てる形へ改修。
- **構造**: `<mask data-ccc-mask>` 内にレイヤー= `<image data-ccc-mask-layer data-ccc-mask-type="hide|show" data-ccc-mask-name>` を複数保持（文書順=重ね順・後勝ち）。**隠すマスク(hide)=黒塗り（透明地）**・**表示マスク(show)=白塗り（透明地）**。SVGマスクは輝度×アルファ評価なので重ね描きだけで add/subtract 合成になる
- **ベース**: 可視の表示マスクが1つも無いときだけ白rect `data-ccc-mask-base` を最背面に自動挿入/除去（`_maskSyncBase`）。→ 隠すマスクのみ=全表示から減算、表示マスクあり=塗った所だけ表示
- **旧形式移行**: 旧 `data-ccc-mask-img` 単一画像は読取り時に表示マスクレイヤーへ自動変換（`_maskLayerImgs`）
- **レイヤーパネル**: コマ/オーバーレイ行の配下に `🎭 マスク n（隠す/表示）` 行を列挙（行クリック=そのレイヤーの編集開始・✎表示、👁=レイヤー個別の有効/無効、✕=削除）。コマ行の🎭は「レイヤー追加（種類はサブタブのセレクト）」
- **サブタブ**: 種類セレクト＋「＋レイヤー追加」を追加。ブラシは「塗る/消す」に変更（塗り色はレイヤー種別で自動決定）。反転/クリア/全面塗り/レイヤー削除は**編集中レイヤー**に作用。「マスク適用」はマスク全体の一時無効化
- **編集**: 編集開始時に全レイヤーのcanvasをロードし、赤プレビューは全レイヤー合成（`_maskBuildComposite`: base白→show=source-over/hide=destination-out）で表示。ベイクは編集中レイヤーのみ
- 実機確認: 隠すマスク追加→全面塗り（非表示＋赤）／表示マスク追加→全面塗り（後勝ちで表示復帰）／表示マスクの👁無効化（ベース復活で再び非表示）／レイヤーパネルの2行表示・アクティブ表示、いずれも正常

## 2026-07-05（PixiJS FX: comfyUI-particle-pixijs 連携モーダル）

### 概要
カスタムノード **comfyUI-particle-pixijs** のパーティクル・フィルタエンジンを SPA から再利用する「PixiJS FX」モーダルを追加。レイアウトタブ「画像」サブタブと画像編集タブの両方に「✨ PixiJS FX」ボタンを設置。パーティクル4種（煙/火花/光線/スターワープ）＋ pixi-filters 29種を画像にリアルタイムプレビュー付きで適用できる。

### 前提・アーキテクチャ
- ComfyUI に comfyUI-particle-pixijs がインストールされていること（`/extensions/comfyUI-particle-pixijs/` から同一オリジンで JS 配信される）
- カスタムノード側をリファクタし、ComfyUI 非依存の `particle_engine.js`（パーティクルシステム＋`makeFilterInstance` フィルタファクトリ）を新設。SPA は dynamic import で `particle_engine.js` と `filter_library.js`（フィルタ/テクスチャ/モーション設定モーダル）をそのまま再利用する
- Python 側 API は不使用（キャプチャは `canvas.toDataURL` でクライアント完結）。ComfyUI 再起動不要

### 新規ファイル・変更点
- **`static/js/pixifx.js`（新規）**: モーダル本体。公開APIは `window.pixiFxOpen({ imageDataUrl, onApply })`
  - PIXI構成はノードと同じ: `filterWrapper`（bgSprite＝対象画像を最背面に配置）→ `scene`（中心原点・scale.y=-1）→ `particleLayer`
  - コントロール: タイプ/数/サイズ/カラーランプ（HTML自作グラデーションエディタ）/発生点（オーバーレイcanvasでクリック追加・ドラッグ移動・矢印で方向強さ）/再生・一時停止/全面散布/ブレンド/フィルタON・OFF/画像にも適用（BG+Filter相当・デフォルトON）/背景画像非表示（パーティクルのみ透過PNG出力用）
  - 「🎬 フィルタ/詳細設定」でカスタムノードの `openFilterLibrary` モーダルをそのまま起動（z-index 99999 > 本モーダル 20000）
  - 出力サイズ＝画像実寸（最大辺2048にクランプ）。適用で現フレームをPNGキャプチャして `onApply` へ
  - 設定は `localStorage cccPixiFxSettings` に保存・復元（テクスチャ画像は容量のため対象外。発生点は画像サイズ正規化で保存）
- **`templates/index.html`**: レイアウト「画像」サブタブ（G'MIC隣）に `#pixifx-open-btn`、画像編集ツールバー（G'MIC隣）に `#imgedit-pixifx-open-btn`、`pixifx.js` の script タグ追加
- **`static/js/main.js`**: `initPixiFxButtons()` / `pixiFxOpenForLayout()`（`state.selectedImageEl` → 結果を `insertImage` でコマに挿入。G'MICと同パターン）/ `pixiFxOpenForImgedit()`（対象imagelayerまたは基底画像 → G'MIC「結果を反映」と同じ反映ロジック）

### カスタムノード側の変更（comfyUI-particle-pixijs、別リポジトリ）
- `web/particle_engine.js` 新設（particle_widget.js からエンジン部を抽出・export化）
- `web/i18n.js` の `import { app }` を除去（`window.comfyAPI` 参照＋navigator フォールバックに変更）→ SPA から import 可能に
- `web/particle_widget.js` はエンジンを import する形にスリム化（挙動不変）
- 開発リポジトリ→ StabilityMatrix の custom_nodes へ web/*.js を手動コピーで同期（こちらは Junction ではなく実体ディレクトリなので注意）

### 動作確認（Kapture実機）
- レイアウト: 画像選択→PixiJS FX→OldFilm選択（リアルタイムプレビュー）→適用→オーバーレイに挿入 ✓
- 画像編集: PixiJS FX→前回設定復元→適用→キャンバス反映 ✓
- ComfyUI 本体: リロード後 particle_widget/engine/pixi ライブラリのロード正常（ノード登録フロー実行確認）✓

### 追記（同日・モーダル統合）
PixiJS FX 独自モーダルを廃止し、フィルタライブラリモーダル（filter_library.js）に統合。ボタン押下で直接統合モーダルが開く。
- filter_library.js（カスタムノード側）に後方互換フック `topBar` / `previewElement` / `saveLabel` / `onClose` を追加（ノード側動作は無変更）
- pixifx.js: 3ペイン上部の topBar 3段にパーティクル操作を配置（1段目: タイプ/数/サイズ/再生・一時停止/全面散布/ブレンド、2段目: カラーランプ/発生点 削除・リセット、3段目: フィルタON/OFF・画像にも適用・背景画像表示・出力サイズ）。中央ペインは `previewElement` でライブ pixi キャンバス＋発生点操作オーバーレイに差し替え（コピー描画ループ廃止）
- フッター「✓ 適用して反映」で現フレームをキャプチャ→`onClose(true)` 後に onApply 実行。キャンセル/Esc/✕は全体破棄
- 適用→置き換え→「元に戻す」の履歴復元をデバッグログ（panelSvgContent 長比較）で検証: pushHistory スナップショット・undo 後の DB 内容とも正しく復元されることを確認済み（検証は複製ページ上で実施）

### 追記（同日・統合モーダルのシェイプ巻き戻りバグ修正）
統合後、Particle パネルでシェイプ等を変更（プレビュー反映）した後に topBar のスライダー（数・サイズ等）を操作すると、変更前のシェイプに戻るバグを修正。原因: 詳細設定は `onParticlePreview` の一時スナップショット（overrides）でプレビューし、topBar 操作は確定値で `rebuildParticles()` するため。統合モーダルでは両UIが同時に見えるので、`onParticlePreview` 受信時にスナップショットを正本の変数群（shapePreset/randomShape/charSet/textures/size/spread/motion 等）へ即時反映し、topBar のサイズスライダーも同期するよう変更（pixifx.js）。snap=null（キャンセル復元通知）は無視。実機で「シェイプ変更→数スライダー操作→シェイプ維持」を確認済み。

### 追記（同日・出力サイズ改善）
ユーザー報告「適用で作成された画像が元より小さくなる」への対応:
1. **原寸レンダリング**: 最大辺2048pxの固定クランプを廃止し、GPUの `MAX_TEXTURE_SIZE`（`getMaxDim()`、通常16384）までは画像原寸でレンダリング・キャプチャするよう変更（pixifx.js）
2. **レイアウト経路を「置き換え」に変更**: 従来は結果を `insertImage` で新規挿入（コマ幅フィット/オーバーレイはページ幅40%配置）していたため見た目も小さくなっていた。適用時に**選択画像の href をそのまま差し替え**る方式に変更（SVG上の位置・表示サイズ・ピクセルサイズすべて維持）。永続化は `_imgeditSave` と同じパターン（`saveOverlaySvg`/`savePanelSvg`）、`pushHistory` 済みで「元に戻す」可能
3. **例外**: モーダルで「背景画像: 非表示」（透過出力）にした場合のみ、パーティクルのみのオーバーレイ素材として従来どおり挿入する。`onApply(dataUrl, meta)` の第2引数 `meta.bgVisible` で判別
- 実機確認: zoomBlur 適用→選択画像が同位置・同サイズで置き換わること、「元に戻す」で復元できることを確認済み

## 2026-07-04（スクリプトタブ改善: ページ作品名連携・ページ送り・複数セリフ行）

### 概要
スクリプトタブ第2弾。①作品名入力を固定幅にし、作品管理バーの保存ボタン右隣に「ページ作品:」ドロップダウン（ページタブの作品名リスト・先頭「ー」=選択なし）を追加。選択状態で「新規作成」するとその名前が作品名にセットされる（ページ作品と同一名のスクリプト作成用）。保存済み作品セレクトは max-width:50% に制限。②プロットの複数ページ縦並びを廃止し、◀▶ページ送りで1ページ表示に変更。③コマワリを「コマ番｜セリフ番｜セリフ」の3列にし、1コマに複数セリフ行を持てるようにした。

### UI仕様
- 作品管理バー: 保存済み作品セレクト｜読込｜削除｜新規作成｜保存｜ページ作品: ドロップダウン
- プロットツールバー: ◀ ページ n / N ▶｜コマ数 ▲▼｜セリフ ＋−｜（右寄せ）＋ページ追加｜ページ削除
- セリフ＋: 選択行と同一コマ番の直後にセリフ行を挿入（要行選択・挿入行が選択状態になる）。セリフ−: 選択行を削除（各コマ最低1行）
- コマ番セルは rowspan でセリフ行数分結合

### コマ枠線の個別表示/非表示トグル
- レイヤーパネルのコマ行右端に □/− ボタンを追加（□=枠線表示中→押すと非表示、−=非表示中→押すと表示）
- 実装: `togglePanelBorderVisibility(panelId)`。コマID付き枠線polygon（`polygon:not(.panel-overlay):not(.panel-border)` で id 一致）の inline style に `stroke:none` を追加/除去する。元の inline stroke 指定は `data-orig-stroke` に退避して復元。状態マーカーは `data-border-hidden="1"`
- プレビューDOMと `state.activePage.svgContent` の両方を更新して `dbPut('pages')` で永続化（コマ枠線幅と同じパターン）。リロード後も維持されることを確認済み
- fill はそのまま残すため、コマの白背景は維持される（消えるのは線のみ）

### オブジェクト選択時のコマ選択自動追従（レイヤーパネル＋キャンバス）
- オブジェクト（フキダシ/画像/テキスト/図形/グループ）を選択すると、コマ選択がそのオブジェクトの属するコマ（オーバーレイ配下ならオーバーレイ）に自動で切り替わる。レイヤーパネルの行クリックとキャンバス上の直接クリックの両方が対象
- 実装は `syncPanelSelectionToObject(el)`: `el.closest('g[data-clip-panel]')` / `g[data-overlay-layer]` で所属を判定し、`state.selectedPanelId`/`selectedOverlay` 更新＋ドロップダウン同期＋ハイライトのみ行う（`selectPanel` は `_clearObjectSelection` を呼ぶため使用せず、オブジェクト選択・ハンドルは維持）
- 呼び出し箇所: レイヤーパネルの make*Item クリックハンドラ4種（図形は下記経由）／キャンバス側は `selectImage()`・フキダシmousedown・テキストmousedown・`_layerDrawSelectShape()`（レイヤー/キャンバス共通）・`selectGroup()`

### レイアウト連携: スクリプトセリフのInsertボタン
- レイアウトタブ「テキスト」サブタブの「テキスト→PNG」右隣に **Insert** ボタンを追加
- スクリプトタブのプロットでセリフ行を選択 → レイアウトでコマを選択 → Insert押下で、そのセリフを**選択コマのバウンディングボックス中心**にテキスト挿入（オーバーレイ/コマ未選択時はページ中心）
- 実装は `insertScriptDialogueText()`: `_scriptGetSelectedDialogue()` でセリフ取得 → `state.pendingTextPosition` と `#text-input-field` をセットして既存 `applyTextInput()` を呼ぶだけ（フォント・縦書き・色・クリップ・保存の既存ロジックをそのまま再利用）
- セリフ行未選択・空セリフ・ページ未表示時は alert でガード

### 実装メモ
- データモデル変更: `panels: [{ dialogue }]` → `panels: [{ dialogues: [''] }]`。`_scriptNormalizeData()` で旧単数形からの変換・欠損補完（load current / 作品読込の両方で通す）
- 状態: `_script.pageIdx`（表示ページ）と `_script.sel = {panelIdx, dlgIdx}`（選択行）。再レンダー後も選択復元
- ページ作品名リストは `_workMeta.data` のキー。select の focus 時に再構築（他タブでの作品追加に追従）
- 動作確認済み（Kapture）: セリフ行追加/削除・rowspan・ページ送り・ページ追加/削除・ドロップダウン反映・新規作成での名前セット

---

## 2026-07-04（プロジェクトタブ→スクリプトタブ改編）

### 概要
「プロジェクト」タブを「スクリプト」に改名し、プロットサブタブを作品単位のデータ管理に作り替えた。構造は **作品名 > あらすじ > プロット［ページ > コマワリ（コマ番・セリフ）］**。旧データ（プロット/あらすじ/コマワリのフラット構造）との互換なし（ユーザー合意済み・init時に旧キーを削除）。

### UI仕様
- 最上段: 作品管理バー（保存済み作品セレクト＋読込／削除／新規作成／保存）
- その下: 作品名（保存キー）→ あらすじ → サブタブ（プロット｜仮1｜仮2 ※仮は未実装のまま）
- プロットサブタブ: ページブロックの縦並び。各ブロックにコマ数▲▼（最小1）・ページ削除（最後の1ページは不可）、コマワリテーブル（コマ番｜セリフ）。「＋ ページ追加」で末尾に追加（デフォルト4コマ）

### 実装メモ
- 内部タブIDは `project` のまま（`switchTab` / help / `_hideAssetPanelTabs` への波及回避）。関数名 `initProjectTab` も維持
- localStorage キー: `cccScriptCurrent`（作業中オートセーブ）／ `cccScriptWorks`（`[{name, data}]`）。旧 `eagleComicProjectPlot` / `eagleComicProjectSaves` は init 時に removeItem
- データが source of truth（`_script.data`）。入力イベントで data 更新→保存、構造変更（ページ/コマ増減）時のみ再レンダー
- CSSは既存 `project-*` クラスを再利用し、`.script-page-block` 等を style.css に追加
- ヘルプ: `project` 項目を「スクリプト」として書き直し、「はじめに」のタブバー説明も更新
- 動作確認済み（Kapture）: 表示→入力→ページ追加→保存→リロード復元→保存済みセレクト反映、コンソールエラーなし

---

## 2026-07-03（レイアウトタブ 多角形ペンツール追加）

### 概要
レイアウトタブのドローツールに「多角形」を追加。クリックで頂点を積む方式（ドラッグ式の既存ツールと異なる）で、確定後は頂点単位の編集が可能。外部ライブラリなしの自作実装（Fabric.js等のcanvas系はSVGデータモデル・縦書きテキスト・出力パイプラインと相性が悪いため見送り。検討経緯は PLAN_polygon_pen_tool.md 参照）。

### 操作仕様
- **頂点追加**: 描画ON＋形状「多角形」でクリックするたびに頂点を確定。オーバーレイcanvasに実線セグメント＋カーソルへの破線ラバーバンド＋塗りヒント＋頂点マーカーをプレビュー表示
- **パスを閉じる**: 3点以上あるとき始点付近（canvas座標で12px以内）をクリックで確定。閉じられる状態では始点マーカーが緑に強調され、ラバーバンドが始点にスナップ
- **Esc**: 直前の頂点を1つ取り消し（input/textareaフォーカス中は無効）。形状切替・描画OFF・確定で描きかけは破棄
- **確定後の編集**: `<polygon class="draw-shape" data-shape-kind="polygon">` として既存レイヤーシステムに統合。選択時にbboxハンドル（移動・リサイズ・回転）に加えて**頂点ハンドル（白四角・青枠）**を表示し、ドラッグで頂点を個別編集できる

### 実装メモ
- 座標は `points` 属性に実座標で保持。移動・リサイズは `_drawShapeSetBounds` の polygon 分岐で全頂点をアフィン変換、回転は既存の `rotate(angle,cx,cy)` transform 方式
- **回転後に頂点編集を開始すると回転をpointsに焼き込み**（`_polygonBakeRotation`: transform除去・data-angle=0）、以降は無回転座標系で編集
- 頂点ハンドルは `draw-handle vertex-handle` クラスのため、保存時のハンドル除去（savePanelSvg / saveOverlaySvg / 複製）は既存セレクタがそのまま適用される
- Escは `_layerDrawAttachOverlay` / `_layerDrawDetachOverlay` で付け外しするwindowリスナー（`_layerDrawKeyDown`）
- 動作確認済み: 頂点追加→Esc取消→始点クリック確定→頂点編集→移動→回転→焼き込み編集→IndexedDB保存・リロード復元→レイヤーパネル表示（⬠アイコン）・削除

### 今後の展開メモ
- シェイプ・フキダシ・パス沿いテキスト（SVGネイティブ `<textPath>` を想定）は同じSVG DOM編集パターンで拡張予定

---

## 2026-07-03（レイアウトドローUI改善・レイヤーペイン常時表示・作品削除／ゴミ箱グループ）

### 概要
レイアウトタブのドローUIをボタン化し、レイヤーペインを常時表示に変更。ページタブ作品管理に「作品削除」ボタンと予約済み「ゴミ箱」グループ（中身確認＋完全削除）を追加した。

### 1. レイアウトタブ ドローUIのボタン化

- 「描画: ON/OFF」トグルを **ON／OFF のセグメント式選択ボタン**に変更（選択中をハイライト、ON時は緑）
- 形状ドロップダウン（矩形/楕円/直線/曲線/鎖/ロープ/My曲線）を**横並びの選択ボタン**に変更。既存コードが `#layer-draw-shape` の値を多数参照するため、selectは非表示で残しボタンから値同期＋`change`発火する互換方式
- `.seg-group` / `.seg-btn` スタイルを style.css に追加（他UIでも再利用可）
- My曲線デフォルト画像の404を修正: `assets/Mychain/t1.png`（SPA時代の相対パス）→ `/ccc_assets/mychain/t1.png`（カスタムノードのマウントポイント＋実ファイルの小文字に一致）

### 2. レイヤーペインの常時表示化

- 作品新規作成直後（アクティブページなし）にレイアウトタブでレイヤーペインが閉じていた問題を修正。`updateTemplateSidePanel` からアクティブページ有無の条件を撤廃し、レイアウトタブでは常時表示に
- ✕（閉じる）ボタンをHTML・リスナー・CSSごと削除

### 3. 作品管理: 作品削除ボタンと予約済みゴミ箱グループ

- 右ペインに「**作品操作**」セクションを新設（ページ操作の上）。「作品削除」ボタンは作品一覧で作品選択時のみ有効。動作はグループ削除と同等（`page_groups`＋`work_meta` を削除、ページ自体は残る）。作品とグループの役割の違いを明確にする目的
- グループタブ末尾に**予約済みグループ「🗑 ゴミ箱」**（内部名 `TRASH_GROUP = '__trash__'`、仮想グループ）を常設。選択すると trash ストアの中身を削除日時の新しい順にサムネイル表示（バッジは所属グループの代わりに削除日時）
- **ゴミ箱表示中の削除は完全削除**: サイドパネルの削除ボタンはラベルが「完全削除」に変わり、確認後 `dbDelete('trash', name)` を実行。ツールバーの「一括削除」も同様に完全削除化。全選択もゴミ箱内を対象に動作
- ゴミ箱表示中はページ編集系操作（名前変更・連番・複製・↑↓）を無効化。出力ボタンもゴミ箱選択時は無効
- グループの追加・リネームで予約名（`__trash__`／`ゴミ箱`／`stock`）を使用禁止に

### 4. ページ所属の一元化（作品／stock／任意グループ）と復元機能

ページは必ず「作品・stock・任意グループ」のいずれかに属する運用に変更（無所属ページを作らない）。

- **予約済みグループ stock**: 起動時に自動作成される実グループ（`STOCK_GROUP = 'stock'`）。リネーム・削除不可。グループタブでは 📦 アイコン付きで先頭に固定表示、ゴミ箱（🗑）は末尾
- **復元機能**: ゴミ箱表示中は「移動」ボタンが「復元」に変わり、選択ページを trash→pages に戻して移動先グループへ所属させる。同名ページが存在する場合は `_restored` サフィックスでリネームして復元
- **作品削除・グループ削除は所属ページをゴミ箱へ移動**（`_movePageToTrashSilent` を流用、confirmに移動ページ数を明示）。残したいページは事前に個別移動する運用
- **「グループから削除」→「stockへ移動」に変更**: 無所属化の代わりに stock へ退避（ゴミ箱・stock表示中は無効）
- **「すべてのページ」ビューを廃止**: 左ペイン未選択時の中央ペインは選択を促すメッセージのみ（無所属ページが存在しないため全ページビューは不要）
- **起動時マイグレーション**: 無所属ページを自動的に stock へ収容（`_adoptOrphanPagesToStock`）

### 5. 出力サブタブ: ページ削除の廃止とzip保存

- ページ一覧の各行にあった🗑（ゴミ箱へ移動）ボタンを削除（ページ削除は作品管理サブタブに一元化）。専用関数 `_movePageToTrash` と関連CSSも削除
- **zip保存**: 保存ボタン右隣に「zip保存」チェックボックスを追加。ON時は画像形式（PNG/JPEG/WebP）の全出力ページを1つのzipにまとめて保存（JSZip使用・読込済みCDN）。zip名は「ファイル名欄 → 作品/グループフィルタ名 → pages」の優先順。PDF/EPUBは単一ファイル出力のため対象外

### 6. 作品新規作成のモーダル化（サイズプリセット）

- 作品管理ツールバーの作品名・幅・高さ入力欄を廃止し、「新規作成」ボタンでモーダル（`#work-create-dialog`、既存 `.text-dialog` スタイル流用）を開く方式に変更。「作成」で従来どおり作品を作成しレイアウトタブへ遷移
- **サイズプリセット**: 標準プリセット（A4縦/A4横/B5縦/B4縦/A5縦/正方形、`WORK_SIZE_PRESETS`）から選択で幅・高さを自動入力。幅・高さを直接編集すると「カスタム（直接入力）」に切り替わる
- **カスタムプリセット**: 「プリセット保存」で現在の幅・高さに名前を付けて保存（localStorage `work_size_presets`）。一覧に「★名前 (幅×高さ)」で表示され、選択中は✕ボタンで削除可能
- `_workCreate` はツールバー入力参照から引数渡し `(name, width, height)` に変更

### 7. IndexedDB settingsストア未作成バグの修正

- `DB_VERSION` を 3→4 に上げ、`onupgradeneeded` で `settings` ストア（keyPath: 'id'）を追加。出力タブのページ並び順（`output_page_order`）の永続化が機能するようになった（従来は毎回 NotFoundError でリロード時に並び順がリセットされていた）
- マルチタブでの版上げブロック対策: `request.onblocked`（旧バージョンを開いた他タブがあると警告アラート）と `db.onversionchange`（他タブの版上げ要求時に自分の接続を閉じて譲り、リロードを促す）を追加。今後のスキーマ変更でも複数タブ起動時に安全に版上げできる
- 注意: 修正前コードで開かれたタブ（onversionchange なし）が残っていると版上げが保留される。該当タブのリロード/クローズで解消

---

## 2026-07-02（ページタブ再編・作品管理導入・レイアウトUI改善・ヘルプ全面更新）

### 概要
出力タブを「ページ」タブとして左端・初期表示タブに再編し、テンプレート・ページ管理を統合。「作品」（サイズ付きページグループ）の概念を導入し、作品単位のページ管理・レイアウト作業・出力フローを構築した。あわせてレイアウトタブのUI改善（ページ送り・保存・プレビューサイズ等）とヘルプタブのWFS形式への全面更新を実施。

### 1. タブ再編（出力タブ→ページタブ）

- 「出力」タブを「ページ」に改名して左端に移動、起動時のデフォルトタブに変更（内部IDは `output` のまま維持し既存参照への波及を回避）
- 旧「テンプレート」タブをページタブのサブタブに統合。サブタブ構成は **作品管理｜テンプレート｜出力**（旧「ページ管理」サブタブは作品管理に統合して廃止）
- `switchTab('template')` は「ページタブ＋テンプレートサブタブ」へのエイリアスとして動作（ヘルプのジャンプボタン互換）。サブタブ切替は `_activateOutputSubtab()` に関数化
- 初期表示タブがページタブになったため、アセットパネルはHTML側で初期 `display:none`（表示制御は `switchTab` に一元化）

### 2. 作品管理（3ペイン構成）

- **作品 = サイズ情報付きページグループ**。既存の `page_groups`（localStorage）をそのまま実体とし、サイズ等のメタは新規 `work_meta`（localStorage）に保存。作業中の作品は `active_work` で永続化・復元
- **ツールバー**: 作品名＋幅・高さ→「新規作成」で `作品名_年月日時分秒` のグループを作成しレイアウトへ遷移／「開く」で1ページ目をレイアウトに展開／「出力」で選択作品・グループのページのみを出力サブタブに表示
- **左ペイン（作品一覧/グループの2タブ）**: 作品一覧はサムネイルカード（1ページ目・サイズ・ページ数・作業中バッジ）、グループタブは作品メタを持たない通常グループの名前リスト（ページストック用途）。クリックで中央ペインを絞り込み、再クリックで解除
- **中央ペイン（ページ一覧）**: 表示順は**グループ配列順＝作品内ページ順**。↑↓ボタンで順移動（単一選択時）。この順序がレイアウトのページ送り・「開く」の1ページ目・出力順のすべてに反映される
- **右ペイン**: プロパティ／グループ管理（作品グループのrename/deleteは `work_meta`・作業中状態に追従）／ページ操作（名前変更・連番名前変更・**ページ複製**（`元名_copy`、複製元直後に挿入）・**移動先グループ＋移動**（旧「グループに追加」を置換）・グループから削除・削除）
- 出力サブタブに作品/グループフィルタを追加（`_outputFilterGroup`）。フィルタバー＋「解除」、フィルタ中は作品内ページ順表示・番号入力欄非表示、`handleExport` の出力対象・順序もフィルタに追従

### 3. アセットパネル「テンプレート」タブとリサイズ挿入

- アセットパネルを「アセット／ページ／テンプレート」の3タブに拡張。テンプレートタブから「ページとして挿入」（ダブルクリック可）で新規ページを作成し、作品に登録してレイアウトに即展開
- **作品サイズへの自動リサイズ**: 背景SVGは座標数値スケーリング（`_scaleSvgElementTree`: polygon/rect/line/circle/ellipse/text対応、transform持ち要素とpathは `scale()` 前置、線幅は縦横平均倍率）、`panels[].points`・`basePanelPoints` も数値変換、コンテンツ（`panelSvgContent`/`overlaySvgContent`）は `<g transform="scale()">` ラップ（`_scaleSvgContentByWrap`。clipPathは参照要素のユーザー座標系で解決されるためdefsはそのまま）
- テンプレートSVG整形（text除去＋panel_0枠線非表示）を `_prepareTemplateSvgDocForPage()` に抽出し `createPageFromTemplate` と共用

### 4. レイアウトタブUI改善

- **保存ボタン**: 現在ページをDB保存＋作業中の作品へ自動登録
- **ページナビ行**: ◀▶送り（作品のページ順準拠）・「n / N」番号表示・ページ削除（`_movePageToTrashSilent` 再利用、削除後は次ページを自動表示）。表示更新は `updateLayoutPageNav()` を `renderLayoutTab` 冒頭で呼ぶ方式
- コマ枠線幅＋「画像タブで編集」を画像操作行の右端に統合（1行削減）
- 右サイドパネルから「コマ番号確認」を削除しレイヤーパネルを最上部に（✕ボタンはレイヤーヘッダーへ移設、`updateTemplateSidePanel` は表示制御のみに簡素化）
- **プレビュー表示サイズスライダー**（レイヤーパネル最下部）: 25〜300%・初期30%・localStorage永続化。100%以下は `margin:auto` で中央固定、100%超は横スクロール

### 5. ヘルプタブのWFS形式への全面更新

- ComfyUI-Workflow-Studio のヘルプ形式に変更: 左サイドバーは五十音グループ折りたたみを廃止して**タブ順のフラットナビ**（`_HELP_ORDER` で順序制御、付録は区切り見出し付きで末尾）、本文は**セクションごとのカード表示**（`.help-card`）
- 内容をタブごとに再構成・更新: 「はじめに」（基本ワークフロー）「ページ—作品管理/テンプレート/出力」「レイアウト」（ページ操作・表示サイズ追加、旧グループ機能/オーバーレイ項目を統合）「アセットパネル」を新規・書き直し。付録4件（SVG仕様・Inkscape手順）は据え置き

---

## 2026-07-02（テンプレート単一コマ分割・workflow studioタブ整理・Send CC連携・ファイル保存調査）

### 概要
テンプレート作成ウィザードの分割モード拡張、workflow studioタブのUI整理、Workflow Studio GalleryからComic Createrへの画像送信連携（Send CC）を実施。あわせてSPA化に伴うファイル保存方式見直しに向けた現状調査を行った（要検討・未着手）。

### 1. テンプレート作成ウィザード: 単一コマ分割モード追加

- 「分割」ステップに「全体分割」（従来）／「単一コマ分割」（新規）の切替ボタンを追加（`static/js/main.js` の `_tmplWiz.cutMode`、`templates/index.html` にボタンとヒント文言）
- 従来の分割ロジックは、引いた線を無限直線として扱い、その直線が交差する**すべての**コマを分割していた（意図しないコマまで分割される問題）
- 「単一コマ分割」モードでは、ドラッグ線の中点→開始点→終了点の順で点内包判定（新規 `_pointInPolygon`、レイキャスティング法）を行い、線を引き始めた1コマだけを分割するよう変更（`_tmplWizFindPanelIndexForCut` / `_tmplWizCommitCut`）。他のコマはその直線の延長線上にあっても変更されない

### 2. workflow studioタブのUI整理

- ナビタブ名を「WSギャラリー」→「workflow studio」に変更し、`.wfm-gallery-tab-btn` で文字色を水色（`#5ecbf2`）に変更
- 埋め込みタブ内上部にあった説明文・「再読み込み」・「新しいタブで開く」ボタンを削除
- 削除したボタンはナビの「ヘルプ」タブ右隣に「ws再読込」「ws新しいタブで開く」として移設（新規 `.ws-nav-btn`）。reloadボタンのidを `wfmgallery-reload-btn` → `ws-nav-reload-btn` に変更し `initWfmGalleryTab()` を追従
- 削除した説明文はヘルプタブに新規追加（`_HELP_DATA` に `wfmgallery` エントリを追加、概要・操作方法・表示されない場合の対処を記載）
- 未使用となった `.wfm-gallery-embed-toolbar` / `.wfm-gallery-embed-label` のCSSを削除

### 3. Send CC連携（Workflow Studio Gallery → Comic Creater）

- ComfyUI-Workflow-Studio側のGalleryタブに「Send CC」ボタンを追加（詳細は同リポジトリの `DEVLOG.md` を参照）。iframe埋め込み時のみ表示され、クリックすると `window.parent.insertImageFromUrl()`（Comic Creater側の既存グローバル関数）を呼び出し、選択中のコマ／オーバーレイへ画像を挿入する
- Comic Creater側の実装変更は無し。既存の `insertImageFromUrl(url)`（コマ・オーバーレイ判定込みで画像挿入する共通ヘルパー、`main.js`）をそのまま利用できた
- **動作確認時のハマりどころ**: ComfyUI-Workflow-Studioは開発リポジトリと実行時の `custom_nodes/` フォルダが別実体（コピー、symlinkでない）のため、開発リポジトリ側だけ編集しても実機のGalleryタブには反映されなかった。3ファイルを実行時ディレクトリへ手動同期して解決。Comic Creater自体は `custom_nodes\comfyui-comic-creater` がDesktop作業フォルダへのjunctionのため、この問題は発生しない

### 4. ファイル保存構成の調査（要検討・未着手）

SPA化に伴うファイル保存方式の変更を検討するため、現状の保存先を4層に分けて洗い出した（実装は未着手、方針も未決定）。

- **サーバーディスク**（`PLUGIN_DIR` 配下、`py/ccc.py` / `py/config.py`）: `settings.json`（アプリ設定）、`assets/<group>/*.svg`（レイヤーパネル📦からのグループアセット登録）、`output/nanobanana/*.png`（Nanobanana生成画像）、`output/gmic-temp/*`（G'MIC GUI連携の一時ファイル）、`assets/assets.json`（自動生成キャッシュ）
- **IndexedDB**（`ComicCreatorDB`, `DB_VERSION=3`）: `templates`（テンプレートSVG）、`pages`（**ページ本体**。panels配列＋各コマのSVG。挿入画像はbase64 dataURLとしてSVG内に直接埋め込まれ、サーバー側に別ファイルとして存在しない）、`trash`（削除済みページの一時保管）
- **localStorage**: `template_groups` / `page_groups` / `output_sort_criterion` / `eagle_settings` / `fontmgr_tags` / `fontmgr_favorites` / `fontmgr_prefs` / `eagleComicProjectPlot` / `eagleComicProjectSaves`
- **File System Access API（`showSaveFilePicker`/`showDirectoryPicker`、非対応時は`<a download>`）**: 出力タブのPNG/JPEG/WebP/PDF/EPUBエクスポート（`handleExport` / `exportToPdf` / `exportToEpub` / `_saveBlob`）、3Dポーズの `pose.json` ダウンロード保存

**未決定事項**: ページ本体（画像込み）がIndexedDBに閉じ込められており、サーバー側にページ単位のファイルが一切存在しないのが最大の特徴。SPA化に伴い、この「IndexedDB完結型」構成を維持するか、サーバーディスクへの永続化やエクスポート/インポート機構を追加するかは未検討。次回作業時に方針を決定してから着手する。

---

## 2026-07-01（テンプレート作成・ページ管理機能追加）

### 概要
テンプレートタブ・レイアウトタブ・出力タブに、それぞれ独立した機能追加を実施。

### 1. テンプレート作成ウィザード（ライン分割方式）

外部ツール（Illustrator/Inkscape等）でSVGを作成してアップロードする方式に加え、SPA内でテンプレートを完結して作成できるウィザードを追加（テンプレートタブ「テンプレートを作成」ボタン）。

- **フロー**: 縦長/横長選択（幅・高さは手動変更可）→ フレーム幅を指定してベース矩形を作成 → キャンバス上をドラッグして線を引くとその線でコマが分割される（Undo・リセット対応）→ 名前を付けて保存
- **分割アルゴリズム**: 半平面クリッピング（Sutherland-Hodgman方式）を新規実装（`_sideOfLine` / `_lineIntersect` / `_clipPolygonByLine` / `_splitPolygonByLine`、`static/js/main.js`）。既存の `_insetPolygonPoints` から点列パース/整形処理を `_parsePointsStr` / `_pointsToStr` として共通化
- **コマ間の隙間**: 分割線の位置に「フレーム幅」と同じ幅の隙間（ガター）ができるよう、切断線を垂線方向に±(フレーム幅/2)オフセットした2本の線でそれぞれの側をクリップする方式（`_offsetLinePerpendicular`）
- **保存**: 生成したSVG文字列を既存の `parseSVGForTemplate()` / `saveTemplate()` にそのまま渡す設計とし、`createPageFromTemplate()` 等の下流処理は無改修
- **白背景**: 生成SVGにページ全面の白背景 `<rect>` を追加し、テンプレート一覧のサムネイルが視認しやすいようにした
- 既存の `PLAN_polygon_pen_tool.md`（頂点クリックで1コマずつ多角形を描く方式）とは異なり、「線を引いて分割」というナイフツール的なUXを採用（ユーザーとの相談の上で決定）。当該計画ドキュメントは今回の実装方針とは別内容のため注意

### 2. ページ新規作成時のコマ線幅指定・小数点第2位対応

- 「ページ新規作成」ボタン押下時、テンプレートに保存されている線幅をデフォルト値としたプロンプトを表示し、コマの線幅を指定できるようにした（`createPageFromTemplate()`）
- レイアウトタブの「コマ枠線幅」入力（`#panel-border-width`）も含め、線幅の値は共通ヘルパー `_round2()` で小数点第2位までに丸めるよう統一（`step="0.01"` に変更）

### 3. レイアウトタブのページ選択をサムネイル方式に変更

- 左サイドバーの「アセット」パネルを「アセット／ページ」の2タブ構成に変更（`.asset-panel-tabs`）
- 「ページ」タブでは各ページのサムネイル（`buildMergedSvg` + `svgTextToDataUrl` を再利用）をカード表示し、クリックで `switchActivePage()` を呼んで切り替え。現在開いているページには青いハイライト枠
- 旧来の `#page-select` ドロップダウンはレイアウトタブから削除（テキストサブタブの `#text-page-select` は維持）
- サムネイルの背景は `var(--bg-primary)`（ダークUIに合わせた色）とし、ページ実体（白い用紙部分）のみが白く見えるように調整
- ページ名表示は当初 `-webkit-line-clamp: 2` で2行に丸めていたが、長い名前（テンプレート名＋タイムスタンプ連結で30文字超）は2行でも切り捨てられていたため、行数制限を撤廃し必要なだけ折り返して全文表示する方式に変更（`.page-thumb-card-name` / 出力タブの `.pagemgr-card-name` 両方）

### 4. 出力タブ「ページ管理」に連番名前変更機能を追加

- 複数選択したページを、出力タブで事前に設定された並び順（`_pageOrder`）に従って「ベース名_000」「ベース名_001」…と一括リネームするボタン「連番名前変更」を追加（1件以上選択時に有効化）
- 対象ページの中に既に `ベース名_NNN` と同名のページが含まれるケースでも、IndexedDBの `name` 主キー衝突による上書き事故を起こさないよう、一時名を経由した2段階リネームで実装
- 既存の単一リネーム処理（`renamePageInMgr`）とDB更新・state追従ロジックを共通化し、`_applyPageRename()` として切り出し

### 既知の未修正バグ（要対応）

**`settings` オブジェクトストアが IndexedDB に一度も作成されていない**（`DB_VERSION = 3` のまま、`openDB()` の `onupgradeneeded` に `settings` の `createObjectStore` が存在しない）。出力タブのページ並び順を `dbPut('settings', {id:'output_page_order', ...})` で永続化しようとしているが、ストア自体が無いため呼び出す度にコンソールエラーになり、実際には保存されない。ページをリロードすると並び順がリセットされる。

- 修正（`DB_VERSION` を4に上げて `settings` ストアを追加）を一度試みたが、他タブが同一IndexedDBを旧バージョンで開いていると `indexedDB.open()` の版上げが `onblocked` でブロックされ得るリスクがあり、当該セッション内では検証しきれなかったため revert 済み
- 対応時は `request.onblocked` および開いている `IDBDatabase` の `onversionchange`（旧接続を自動クローズ）のハンドリングを入れた上で、マルチタブ環境での動作を確認してから反映すること

---

## 2026-07-01

### 概要
`ComfyUI-Workflow-Studio`（別カスタムノード、同一ComfyUIサーバー上で稼働）と機能が重複する部分を整理。
Workflow Studio 側でカバーされる機能（ワークフロー管理・ComfyUI連携生成・AIアシスタント・翻訳・プリセット管理・ギャラリー閲覧）を comic-creater から順次削除し、コマ割り漫画制作という本来の役割に集約した。

### 1. ComfyUI Outputフォルダパス設定の追加（後にGalleryタブ削除で撤去）

- 設定タブに実体ComfyUI（例: StabilityMatrix配下）のoutputフォルダパスを直接指定できる項目を追加
- `/api/ccc/comfyui/settings` GET/POST、`_get_comfyui_output_dir()` ヘルパー、`/ccc_comfyui_output/{tail}` の動的配信ハンドラを実装
- ※ この節の機能は後続のGalleryタブ削除に伴い全て撤去済み（履歴として記録）

### 2. Workflow Studio ギャラリーのiframe埋め込み統合

- 新規タブ「WSギャラリー」を追加し、`<iframe src="/wfm">` でWorkflow Studio本体を埋め込み
- 初回タブオープン時に `/wfm` の疎通確認 → 未インストール時はフォールバックメッセージを表示
- 同一オリジンを利用し、iframe読み込み完了時にWorkflow Studio内の Gallery タブ（`.wfm-tab[data-tab="gallery"]`）を自動クリックして選択
- ヘッダー（Workflow Studioの全タブナビ）は非表示にせず、そのまま表示する方針で確定

### 3. プロンプトタブの削除

Workflow Studio の Prompt/AI TOOL タブと機能重複するため、関連機能を一括削除：

- `prompt-tab` セクション（AIアシスタント chat・Preset Editor・Preset Manager の3カラムUI）
- `static/js/prompt_settings.js`（自己完結ファイルのため丸ごと削除）
- ComfyUI/Nanobananaタブの翻訳ボタン群・「現在のプロンプトを保存」ボタン、`preset-save-dialog` モーダル
- 設定タブのOllama設定セクション、バックエンドの `/api/ccc/ollama/*` ルート・`OLLAMA_SETTINGS`
- 波及して見つかった依存: ワークフロータブの「要約」ボタン（Ollama chat使用）、プロジェクトタブの「プロンプト」ボタンと `_projectCopyToOllamaChat()`

### 4. ComfyUI・ワークフロータブの削除

最も影響範囲が広い削除。着手前に依存関係を調査し、想定外の副作用を発見・対応した：

- **発見した問題**: レイアウトタブの「I2I」サブタブ（コマ画像→ComfyUI生成→コマ挿入）と画像編集タブのI2Iツールバーが、削除対象の `comfyui.js`/`comfyui_editor.js` に実装を依存していた（ユーザー確認の上、両方とも削除）
- 削除ファイル: `static/js/comfyui.js`・`comfyui_editor.js`・`comfyui_workflow.js`（計約2760行）
- `comfyui-tab`・`workflow-tab` のHTMLセクション（計336行）
- main.js内のワークフローDB管理コード（`wfdb`系、約1034行）
- バックエンドの `/api/ccc/wfdb/*` ルート群・ハンドラー・ヘルパー関数、`WORKFLOWS_DIR`/`WORKFLOWS_DATA_DIR`
- **移植**: `insertImageFromUrl()`（画像URLをコマに挿入する汎用処理、comfyUIオブジェクトに非依存）を `comfyui.js` から `main.js` へ移動し、Galleryタブ用に存続
- 設定タブは「ComfyUI Output設定」（Outputフォルダパスのみ）に縮小、接続先URL・起動時デフォルトワークフローは削除

### 5. Galleryタブの削除

- `gallery-tab` セクション（ComfyUI Output/Nanobanana/GMIC/アセットの4サブタブ）を削除
- バックエンドの `list-assets`・`list-comfyui-output`・`list-nanobanana-output`・`list-gmic-temp`・`delete-gallery-image`・`save-comfyui-image`・`serve-comfyui-output`・`comfyui/settings` ルートとハンドラー、`OUTPUT_COMFYUI_DIR`（config.py）を削除
- `insertImageFromUrl()` は呼び出し元が無くなったが、将来のWorkflow Studio連携（生成画像・ギャラリーからのコマ挿入機能、実装は別途予定）を見据えて関数自体は `main.js` に温存
- `save-nanobanana-image`・`OUTPUT_NANOBANANA_DIR`・`refresh-assets`・`GMIC_TEMP_DIR` 本体機能は現役利用中のため維持

### 削除作業の進め方（今後の参考）

- 各タブ削除の前に、他タブ・バックエンドAPIとの依存関係を必ず調査してから着手（特にComfyUI/ワークフロータブでは、削除範囲外のレイアウト/画像編集タブに波及する依存を発見）
- 削除範囲が明確でない場合（バックエンド設定の温存可否、関連機能の扱いなど）はユーザーに確認してから実行
- 各削除後にJS構文チェック（`node --check`）・Python構文チェック（`ast.parse`）・全ファイル横断でのID/関数名grepによる残渣確認を実施

---

## 2026-06-30

### 概要
SPA アプリ（eagle_comic_creater_spa）を ComfyUI カスタムノードとして統合。
`http://127.0.0.1:8189/ccc` で動作確認完了。

### 完了した作業

- カスタムノード構成（`__init__.py` / `py/` / `templates/` / `static/` / `web/comfyui/`）を整備
- Windows Junction で `custom_nodes/comfyui-comic-creater` → 実体ディレクトリをリンク
- ComfyUI タブ（Template / Layout / Output）の基本表示確認
- ComfyUI 連携・Ollama 連携・基本機能の動作確認完了

### 解決した問題：カスタムルート 404

**症状**：`/ccc`、`/api/ccc/*` などすべてのカスタムルートが 404 を返す。

**根本原因**：aiohttp 3.14.1 の `UrlDispatcher.resolve()` は walk-up アルゴリズムで
`_resource_index` を逆順に検索する。PlainResource（`add_get("/ccc", ...)`）は
正確なパス `"/ccc"` にインデックスされるが、ComfyUI の
`web.static('/', web_root)` が `/` 以下を傍受するため到達できないケースがある。

**修正方針**：PlainResource ルートは残しつつ、DynamicResource を catch-all として追加。
DynamicResource はプレフィックス前のパスにインデックスされるため walk-up で必ず到達できる。

**具体的な変更**（`py/ccc.py`）:

```python
# SPA エントリ — "/" にインデックス、walk-up で必ず到達
app.router.add_get(r"/ccc{tail:(?:/.*)?}", serve_index)

# API catch-all — "/api/ccc" にインデックス
app.router.add_get("/api/ccc/{tail:.*}", _api_get_dispatch)
app.router.add_post("/api/ccc/{tail:.*}", _api_post_dispatch)
```

優先順位（walk-up の特性を利用）:
- `/ccc_static/...` → `/ccc_static` で StaticResource 発見（catch-all より先）
- `/api/ccc/gmic/...` → `/api/ccc/gmic` で既存 DynamicResource 発見（catch-all より先）
- `/ccc` → PlainResource 不在 → `/` で catch-all DynamicResource 発見 ✓
- `/api/ccc/list-assets` → PlainResource 不在 → `/api/ccc` で dispatch catch-all 発見 ✓

**その他の変更**:
- `__init__.py`：`sys.path` 操作を廃止、相対インポート `from .py.ccc import ComicCreater` に変更（lora-manager パターン準拠）
- `py/ccc.py`：`from py.config import` → `from .config import`（相対インポート）
- `handle_proxy_gmic`：`/start-server` を `handle_gmic_start_server` へリダイレクトする特例を追加

### 参考にしたノード
- `comfyui-lora-manager`：同じ SPA 構成で動作する参考実装（相対インポート、同一ルート登録パターン）

---

## 2026-06-30（セキュリティ修正）

### セキュリティレビュー結果と対応

コードレビューで検出された 8 件の問題を全件修正。

| 優先度 | 問題 | 対応 |
|--------|------|------|
| Critical | `save-comfyui-image` / `save-nanobanana-image` — filename パストラバーサル | `_safe_path()` 適用 |
| Critical | `save-group-asset` — filename パストラバーサル | `_safe_path()` 適用 |
| Critical | `local-gmic/result_b64` — 任意ファイル読み取り | `GMIC_TEMP_DIR` 内に限定 |
| Critical | `wfdb/import` — original_name パストラバーサル | `os.path.basename()` + `_safe_path()` 適用 |
| Important | `ollama/settings` — SSRF (任意ホストへのリクエスト) | `_validate_local_url()` でローカルホストのみ許可 |
| Important | `nanobanana/key` — APIキー平文露出 | キー本体を返さず末尾4文字マスクのみ返す |
| Important | `eagle/add` — SSRF + パス操作 | `_validate_local_url()` + `_safe_path()` 適用 |
| Important | `wfdb/change-thumbnail` — `..` チェック漏れ | `..` チェック追加 + `_safe_path()` 適用 |

### 追加した共通ヘルパー（`py/ccc.py` 先頭）

```python
def _safe_path(base_dir, untrusted: str) -> Path:
    """ファイル名をサニタイズし、base_dir 外への書き込みを防ぐ。"""
    name = os.path.basename(untrusted)           # パス区切り文字を除去
    dest = (Path(base_dir) / name).resolve()     # 正規化（.. を解決）
    base = Path(base_dir).resolve()
    if not str(dest).startswith(str(base) + os.sep):
        raise ValueError(f"パストラバーサルを検出: {untrusted!r}")
    return dest

def _validate_local_url(url: str, param_name: str) -> str:
    """URL がローカルホスト（localhost / 127.0.0.1 / ::1）のみ許可する。"""
    p = urlparse(url)
    if p.scheme not in ('http', 'https'):
        raise ValueError(f"{param_name}: http/https のみ許可")
    if (p.hostname or '').lower() not in {'localhost', '127.0.0.1', '::1', '[::1]'}:
        raise ValueError(f"{param_name}: ローカルホスト以外は禁止")
    return url
```
