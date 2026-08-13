# DEVLOG — comfyui-comic-creater

---

## 2026-08-13（SVGインポート時のコマ枠線幅不一致を解消するスケール補正機能を追加、副次的に見つかった2件の不具合も修正、v1.33.0）

ユーザーから「テンプレートを作成」ウィザードで作ったテンプレートと、InkscapeのSVGからテンプレート作成したものとでコマ枠線幅の太さが揃わない、線幅を100超にすると内側に白線が増える、との報告（スクリーンショット添付）。

**原因**: テンプレートウィザードの内部座標系は「1ユーザー単位 = 0.01mm」固定（A4 = 21000×29700）だが、Inkscape等の外部SVGはツールごとに実寸(mm)とviewBoxユーザー単位の対応関係が異なる（例: Inkscapeは96dpiのpx単位で出力するため1ユーザー単位≒0.2646mm、テンプレートウィザードとは約26.5倍のスケール差）。`parseSVGForTemplate`（`06c-template-wizard.js`）はこの差を正規化せずに座標をそのまま取り込んでいたため、同じ線幅数値でも実際の太さが大きく異なっていた。線幅を大きくして帳尻を合わせようとすると、実際のコマ間の隙間（Inkscape座標系では数値が小さい）に対してinset量が過大になり、`clipPath`の縮小ポリゴンが破綻して内側に白線が生じていた。

**修正**: SVGインポート時、ルート`<svg>`要素の`width`属性（実寸・単位付き）とpanel_0の外接矩形から、内部標準スケールへ正規化する倍率を自動算出（`_tmplComputeSuggestedScale`）。1から2%以上ずれている場合は確認ダイアログを表示し、算出した倍率をデフォルト値として確認・補正できるようにした（適用するとコマ座標・ページサイズ・svgContent内の座標とstroke-widthを内部標準スケールへ変換、`_tmplApplyImportScale`）。

**副次的に発見・修正した不具合1（コマ枠線幅が反映されない）**: 上記の対応中、rect/path形式のテンプレート（Inkscape等）で「コマ枠線幅を変えても表示が変化しない」ことが判明。`_tmplTemplateToPageSvgString`（rect/path形式テンプレートをpolygonへ合成する、2026-08-13に追加されたばかりの処理）が、コマのpolygon idを`panel_${number}`という決め打ちで生成していたのに対し、ページ側の`panels[].id`は元のInkscape要素id（`rect4`等）のままだった。コマ枠線幅の変更処理（`07-pages.js`）はこの`id`でsvg内のpolygonを検索するため、一致せず常にスキップされていた。idを`p.id`（元のid）に統一して修正。この修正により、`renderLayoutTab`の`panel-border-width`欄の初期値表示（同じid不一致が原因で機能していなかった）も同時に解消された。

**副次的に発見・修正した不具合2（Cancelしても無確認で上書き）**: ユーザーから「補正ダイアログでCancelしても『作成した』表示になる（実際には作成されていない）」との報告。調査したところ、同名テンプレートへの**無確認上書き**が原因と判明（同名のInkscapeテンプレートを繰り返しインポートしていたため、Cancelを押しても保存自体は実行され、既存の同名テンプレートが上書きされて新規作成されたようには見えなかった）。ユーザーの希望を確認の上、以下に変更: (1) スケール確認ダイアログでCancelを押すとインポート自体を中止（保存しない）、(2) 同名テンプレートが既に存在する場合は上書きせず、別の名前の入力を求める（キャンセルまたは空欄で確定するとインポート中止）。

Kaptureで実機検証済み: jsdomでのスケール算出ロジック単体テスト（`Ink_2panel.svg`/`Ink_3panel.svg`で26.46倍・26.58倍と正しく算出、適用後は幅21000・線幅0.5mm→内部値50に正規化されることを確認）に加え、実機で未補正テンプレート（`ink_2panel`、793.7×1122.5、線幅計算が4という極端に細い値になることを確認）とスケール補正済みテンプレート（21000×29700、線幅63）の両方でページを作成し、`panel-border-width`欄を63→300に変更してsvg内のpolygonに`style="stroke-width:300"`が正しく反映されること・視覚的に枠線が太くなることを確認。ヘルプ（`22-help-tab.js`、日英中3言語）・README（3言語）を更新済み。ヘルプ更新時、「コマは`<polygon>`のみ対応」という現状と矛盾する古い記述（付録: テンプレートSVG仕様）と、「viewBoxをそのまま読み込むため通常は問題ない」という今回の修正と正反対の古い記述（付録: Inkscapeでテンプレート作成のトラブルシューティング）も合わせて修正した。

---

## 2026-08-13（レイアウトのページ送りが作品を閉じた後・新規作品作成直後に他作品のページへ切り替わる不具合を修正、v1.33.0）

上記のテンプレート対応と並行して、ユーザーから「レイアウトで作品を閉じたがページを送ると他の作品が表示される。新規で作成してレイアウトを確認すると同様にページが存在している。しかしアセットパネルのPタブにはこの作品にページがありませんとなっている」との報告。

**原因**: `_layoutPageList()`（`07-pages.js`）が「作品が未選択、またはその作品にページが1件も無い場合」に、**全作品の全ページを名前順にまとめたリスト**へフォールバックしていた。作品を閉じると`state.activeWork`が`null`になり、新規作品作成直後はページがまだ0件のため、いずれのケースでもこのフォールバックが発動し、ページ送りボタンが無効化されずに押すと他の作品のページへ切り替わっていた。一方、ページ管理側は「ページは必ず作品・stock・任意グループのいずれかに属する運用」（無所属ページは起動時に自動でstockへ回収、`11a-work-manager.js`）という設計になっており、この「全ページ」フォールバックは元々不要かつ有害だった（アセットパネルのPタブは正しく作品スコープで表示していたため、レイアウトタブのページ送りだけがこのバグを持っていた）。

**修正**: `_layoutPageList()`から全ページへのフォールバックを削除し、作品未選択・ページ0件では空リストを返すよう変更。

Kaptureで実機検証済み: 2ページある作品を開いて`1 / 2`表示を確認後、作品を閉じると`- / -`表示・前へ/次へボタンとも`disabled`になることを確認（修正前はここが問題だった）。新規作品作成（ページ0件）でも同様に`- / -`・両ボタン`disabled`を確認。検証用に作成した作品は削除済み。

---

## 2026-08-12（rect/polygon混在テンプレートで一部コマだけ枠線幅が反映されない不具合を修正、v1.33.0）

上記の修正（CSSクラスのstroke優先度問題）をユーザーが新規作成したファイル（`corel_svg10.svg`/`corel_svg11.svg`、UTF-8、panel_1・panel_2は`<rect>`、panel_3のみ曲線的な形状のため`<polygon>`という混在構成）で確認したところ、「コマは問題ないが、コマ枠線幅がコマ3にしか効かない」と報告（スクリーンショット添付）。

**原因**: `_tmplResolveTemplateSvgForPage`（ページ生成時に元のsvgContentをそのまま使うか、保存済み座標から合成したSVGにフォールバックするかを判定）が「`<polygon>`が1つでも含まれていれば元のsvgContentをそのまま使う」という判定になっていた。`_prepareTemplateSvgDocForPage`や線幅変更処理は`<polygon>`要素しか見ないため、rect製のpanel_1・panel_2はそもそも処理対象に含まれず、polygon製のpanel_3だけに線幅変更が反映されていた。

**修正**: 判定基準を「`<polygon>`の数が全コマ数（panel_0＋panels全て）以上あるか」に変更（`_tmplSvgHasPolygons` → `_tmplSvgHasEnoughPolygons`にリネームし、必要数を引数で受け取るように変更）。一部だけrect/pathが混ざるテンプレートは合成SVGへ確実にフォールバックされるようになった。

Kaptureで実機検証済み: panel_0/1/2をrect、panel_3のみpolygonという混在SVGを再現し、修正前は判定通り合成フォールバックされず一部のコマの線幅が変更されないことを確認した上で修正を適用。修正後は合成フォールバックが正しく発動し、全コマ（panel_0の非表示化含む）に`getComputedStyle()`で線幅80pxが反映されることを確認。既存の全回帰テスト（純粋polygon形式は引き続き元のsvgContentをそのまま使う＝CorelDraw/ウィザード生成テンプレートの見た目を変えない、純粋rect形式は引き続き合成フォールバック）も再実行し正常。

---

## 2026-08-12（CorelDraw/Affinity実ファイルの実機確認で見つかったテンプレート取込みの追加不具合4件を修正、v1.33.0）

上記のテンプレートSVG互換性拡張について、ユーザーが実際にCorelDraw・Affinity Designerで作成したファイル（`coreldraw/`・`affinity/`フォルダに計7ファイル）で確認したところ、「CorelDrawは矩形でサイズが小さくなり、パスではコマがおかしな状態になる（コマに配置できない）」「Affinityもサイズが小さくなる」との報告を受け、実ファイルを直接調査。当初は文字コード（CorelDrawはUTF-16 BOM付き）を疑ったが、`FileReader.readAsText(file,'utf-8')`は実際にはBOMを見て正しくUTF-16として復号することを実機で確認し否定。真因は以下4件だった。

**1. ページサイズとコマ座標のスケール不一致（CorelDraw）**: `template.width/height`をviewBoxの生数値から直接取得していたが、コマ座標は`getCTM()`（ページ外枠panel_0はページのCSSピクセルサイズ基準で解決される仕様）経由で取得していたため、viewBoxの数値と実際のCSSピクセルサイズが一致しないSVG（CorelDrawは`width="210mm" height="297mm"`に対し`viewBox="0 0 21000 29700"`という独自スケールを使用）で、ページは21000×29700なのにコマ座標は793×1122付近に収まるという致命的な不整合が発生していた。これまでのInkscape等のテストファイルはviewBoxの数値が96dpi換算のCSSピクセル値とほぼ一致していたため気づけなかった。**修正**: `template.width/height`を、コマ座標と同じ`getCTM()`解決結果であるpanel_0（ページ外枠）の外接矩形から算出するよう変更（`_tmplBoundingBoxOfPointsStr`を新設）。

**2. `width="100%" height="100%"`によるサイズ縮小（Affinity）**: width/height属性が完全に無い場合はviewBoxがそのまま実寸として使われるが、**明示的に`100%`指定**されている場合は、テンプレート解析用の非表示コンテナに具体的なサイズが無いためCSSの「置換要素のデフォルトサイズ」（300×150にアスペクト比を保って収める）にフォールバックしてしまい、意図しない小さいサイズになっていた。**修正**: width/heightが%指定の場合、解析前にviewBoxの数値をpxとして明示的に設定し直す処理を`_tmplAttachHiddenSvg`に追加。

**3. コマ番号のズレ（Affinity）**: Affinityはtransform付きレイヤーを`<g id="panel_2" transform="matrix(...)">`のようにグループでラップし、中の`<rect>`自体にはidを付与しない場合がある。コマ番号の判定が図形自身のid/labelしか見ていなかったため、`[1, 1, 2]`のように番号がズレていた。**修正**: 図形自身にid/labelが無い場合、祖先方向に最も近いid/label付き要素を採用するよう`_tmplEffectiveId`/`_tmplGetLabel`を拡張。

**4. panel_0の枠線が消えない・コマの線幅が反映されない（CorelDraw path/polygon版）**: 上記のスケール修正後、ユーザーから「コマ自体は機能するが、不明な枠の表示、枠線幅がコマに適用されない」と追加報告。CorelDrawは`<defs><style>`内のCSSクラス（`.str0{stroke:black;stroke-width:35.27}`）でストロークを指定しており、各図形は`class="fil0 str0"`のみでインラインstyle属性を持たない。ページ生成時の「panel_0の枠線を非表示にする」処理も「コマの線幅をユーザー指定値に変更する」処理も、プレゼンテーション属性（`setAttribute('stroke-width',...)`）しか書き換えておらず、かつ「既にインラインstyleがある場合のみ」styleも書き換える実装だったため、CSS優先順位（クラスセレクタ＞プレゼンテーション属性）によりクラス側の指定が常に勝ち、panel_0の枠線が消えず・コマの線幅も常に元の値のままだった。**修正**: 常にインラインstyle（CSS優先順位が最も高い）を強制設定する共通ヘルパー`_tmplForceInlineStyle`を新設し、両処理をこれ経由に統一（`06c-template-wizard.js`・`07-pages.js`）。

Kaptureで実機検証済み: CorelDraw実ファイル4種・Affinity実ファイル3種（残る2ファイルはベクター図形を含まない背景ラスター画像のみだったため、既存の「コマが見つかりません」エラーが正しく出ることを確認。ユーザーへは再エクスポートを依頼）をバイト列そのまま読み込ませ、正しいページサイズ・コマ数・番号を確認。CSSクラス構造を再現したテストで`getComputedStyle()`によりpanel_0の実際の描画スタイルが`stroke:none`になること、コマ線幅が指定値に正しく上書きされることを確認。既存の全回帰テスト（Inkscape・後方互換ケース等）も再実行し正常。ユーザーからスクリーンショット付きで問題再現の報告を受け、原因特定・修正・再検証まで実施。

---

## 2026-08-12（SVGテンプレートインポートの互換性を拡張してInkscape/Illustrator/Affinity Designer/CorelDrawに対応、v1.33.0）

ユーザーがInkscapeで作成した複数パターンのテンプレートSVG（矩形ツール・ベジェ/直線ツール・多角形/星ツールでそれぞれ作成）がいずれも読み込めない、との報告を受けて調査。

**原因**: `parseSVGForTemplate`（`06c-template-wizard.js`）が`<polygon>`要素のみを認識しており、Inkscapeの矩形ツール（`<rect>`）・ベジェ/直線ツール（`<path>`のH/V/Z）・多角形/星ツール（`<path sodipodi:type="star">`、名前は「多角形」でも実体はpath）のいずれで描いても読み込めなかった。CorelDrawだけ動作していたのは、たまたま`<polygon>`を直接出力する実装だったため。

**修正**: `rect`/`polygon`/`polyline`/`path`/`circle`/`ellipse`のいずれの要素でもコマとして読み込めるよう拡張。transform（入れ子`<g>`のtranslate/matrix/rotate等）の解決は、自前で行列計算するよりブラウザ本体のSVGエンジン（`getCTM()`）に任せる方が各ツール固有の癖（sodipodi:type=star等）に対して確実なため、要素を画面外の非表示コンテナに一時アタッチしてから座標を取得する方式にした。id/label（`panel_0`/`panel_N`）による明示指定、ストローク不可視かつ名前指定の無い図形（装飾用の背景矩形等）の自動除外にも対応。

**曲線・角の崩れ対策**: 当初pathの座標抽出を`getPointAtLength`の等間隔サンプリングで実装したところ、直線区間の角が斜めに削れる不具合が発生（ユーザーが実際にInkscapeファイルを読み込んで報告し発覚）。M/L/H/V/Zコマンドは座標を直接算出する専用パーサー（`_tmplParsePathD`）に切り替え、C/S/Q/T/A等の曲線コマンドのみ、そのコマンド単体の一時的な`<path>`をブラウザに解釈させて`getPointAtLength`でフラット化する方式に修正し、直線の角を厳密な直角に保ちつつ曲線も正しく近似できるようにした。

**副次的に発見・修正した回帰と既存の限界**: 上記の拡張により、アプリ内蔵の「テンプレートを作成」ウィザードが出力する背景用の装飾矩形（`<rect>`、ストロークなし）が誤ってコマとして誤認識される回帰を自己検証中に発見。ストローク可視性による除外ロジックで対応した（除外しすぎて0件になった場合は装飾判定なしで再抽出する安全弁付き）。また、テンプレートからページを新規作成する処理（`_prepareTemplateSvgDocForPage`・`_scaleSvgElementTree`）が従来から`<polygon>`前提の実装だったため、rect/path由来のテンプレートではpanel_0の枠線非表示・コマ線幅変更・作品サイズへのスケーリングが正しく動作しない問題も発見。`_tmplResolveTemplateSvgForPage`を新設し、元のsvgContentが`<polygon>`を含まない場合のみ、保存済みのコマ座標（`panels[].points`/`basePanelPoints`）から正規化済みSVGを合成してフォールバックする方式にした（`<polygon>`を含む既存テンプレートは元のsvgContentをそのまま使うため、CorelDraw・ウィザード生成テンプレートの既存の見た目には影響しない）。

Kaptureで実機検証済み: ユーザー提供の6ファイル（Inkscape純正/プレーン ×矩形・直線path・多角形ツールpath）全てで正しいコマ数・厳密な直角座標を確認、既存のpolygon形式（後方互換）・defs内ダミー図形の除外・panel_0の描画順序に依存しない明示指定・装飾用背景矩形の除外・角丸矩形（曲線混在）を個別ケースとして検証。ユーザーからも「角の改善を確認しました」と確認済み。日本語ヘルプ（`22-help-tab.js`の`_HELP_DATA`）とi18nエラーメッセージ（ja/en/zh）は実態に合わせて更新済みだが、**英語・中国語版ヘルプの詳細手順（付録: Inkscapeでテンプレート作成）は未更新**のため次回対応が必要。

---

## 2026-08-12（オーバーレイへのファイルドロップに対応、移動・複製・削除の不具合を修正、v1.33.0）

上記のテンプレート対応に続けて、ユーザーから2件の報告を受けて対応。

**1. オーバーレイへのファイルドロップに対応**（`08-panels-images.js`の`initDragAndDrop`）: 従来はドロップ地点直下のコマ（`data-panel-id`を持つ要素）しか検出しておらず、コマの外（オーバーレイ含む）にドロップすると「コマを選択してください」で失敗していた。ドロップ地点がオーバーレイ上の既存コンテンツなら明示的にオーバーレイへ切り替え、コマの当たり判定を持たないオーバーレイの空白部分へのドロップは、レイヤーパネルで事前に選択済みの状態（`state.selectedOverlay`）に従うようにした。

**2. オーバーレイ⇔コマ間の移動・複製ができない/複製になってしまう不具合**: ユーザー報告「オーバーレイからコマに移動できないケースがある、もしくは複製になってしまう。移動できた場合、複製元の位置が変わる」を調査。**原因**: `duplicateSelectedObject`/`moveSelectedObject`（`05-groups-move.js`）が画像をオーバーレイへ複製・移動する際、`data-panel-id`属性の更新を怠っていた（下書きレイヤーへの移動では正しく`'__draft__'`に更新していたのに、オーバーレイだけ抜けていた）。この結果、オーバーレイに来た画像が元のコマIDを持ったまま残り、次にその画像を移動しようとした際、移動元コマの判定（同じくこの属性を最優先で参照していた）を誤り、「同じコマへの移動」と誤判定されて失敗する、あるいは保存先を取り違えて元の場所にもデータが残ってしまう（＝複製に見える）不具合になっていた。**修正**: オーバーレイへの複製・移動時に`data-panel-id="__overlay__"`を正しく設定し、あわせて移動元・複製元コマの判定ロジックも、属性ではなく実際のDOM構造（`.closest('g[data-clip-panel], g[data-overlay-layer], g[data-draft-layer]')`）を優先する堅牢な方式に変更した。

**3. 削除したオブジェクトがドロップ後の再描画で復活する不具合**: 上記2の修正確認後、ユーザーから追加報告「以前改善したドロップ時、削除したオブジェクトが復元してしまう現象が一度発生した」を受けて調査したところ、`deleteSelectedObject`（同ファイル）の画像削除時のコマID判定にも同じ弱点があった（`g[data-clip-panel]`のみ`.closest()`でチェックし、オーバーレイ/下書きレイヤーは`.closest()`を経ずに`data-panel-id`属性へフォールバックしていた）。今回までの一連の修正より前に生成された古い`data-panel-id`を持つオーバーレイ画像を削除すると、削除自体はDOM上成功するが保存先を誤り、オーバーレイの永続化データには反映されないままになる。その後何らかの理由で`renderLayoutTab()`が呼ばれる（今回はドロップ後の再描画）と、DBの古いデータから再構築され、削除したはずのオブジェクトが復活していた。`deleteSelectedObject`の`image`/`group`種別いずれの判定にも上記2と同じロジックを適用した。

Kaptureで実機検証済み: (1)実際のUIでオーバーレイへのファイルドロップを確認、(2)画像をpanel-1→オーバーレイ→panel-2と2回移動させ複製されないこと・DB永続化データが正しく更新されることを確認、(3)人為的に古い`data-panel-id`を持つオーバーレイ画像を用意し、削除→再描画をシミュレートして復活しないこと・DB上のオーバーレイデータからも画像が消えていることを確認。1・2はユーザーからも「オーバーレイへのドロップ確認しました」「移動、複製の正常動作確認しました」と確認済み。**3（削除復活バグ）はユーザー未確認**（「確認は時間を取って行いたい、問題があれば別途連絡する」とのこと）のため、次回セッションで指摘があれば優先的に対応すること。

---

## 2026-08-09（フキダシ内包テキストのモーダル拡充・バクダンに内側カーブパラメータを追加、v1.32.0）

ユーザー要望を受けて対応。

**バクダン形状に「内側カーブ」パラメータを追加**（`09b-balloon-shapes.js`）: 従来`generateBombPath()`の本体パスは谷（トゲの間の凹角）・峰（トゲの先端）をすべて直線で結ぶポリゴンだった。トゲの先端は鋭いまま維持しつつ谷とその手前側面を丸められるよう`_h2RoundValleysInClosedPath()`を新設。谷の頂点を二次ベジエ曲線の制御点として使い、頂点そのものへは到達させず前後の辺の一部（`curveAmt` = spikeCurve/100×0.5、最大で各辺の半分）をQ曲線でつなぐことで、峰へは直線のまま到達させて鋭さを保つ。0〜100のスライダー（`h2-spike-curve`、デフォルト0＝従来通りの直線的なギザギザ）で調整でき、`dataset.spikeCurve`として保存される（属性が無い既存のバクダン型フキダシは0扱いのため見た目に影響なし）。

**「テキストを内包」モーダルに行間スライダーを追加**（`09f-bubble-text.js`）: 従来`fontSizeSvg * 1.4`固定だった行間を`dataset.lineHeightMult`（デフォルト1.4）で可変にし、0.8〜3.0のスライダーで調整できるようにした（`_bubbleTextRenderText`）。

**「テキストを内包」モーダルに太字チェックボックスを追加**: 文字色セレクトの右隣に配置し、`dataset.textBold`を内包テキストの`<text>`要素の`font-weight`属性へ反映する。

**整列ボタンのレイアウト変更**（ユーザー要望）: 「文字寄せ（左/中央/右）」と「上下寄せ（上/中央/下）」が別々の行に分かれていたのを、上下寄せグループの右隣に文字寄せグループを並べて1行にまとめた（要素のIDやイベント配線は変更せず、HTML内の配置順のみ入れ替え）。中央ボタンは縦軸・横軸それぞれ独立のまま2つ維持する案をユーザーが選択。

3言語（ja/en/zh）のヘルプ（`22-help-tab.js`の`_HELP_DATA`と`_HELP_I18N.en`/`.zh`）・README（README.md/README_en.md/README_zh.md）を更新済み。バクダン内側カーブ・行間スライダー・太字＋整列レイアウトの3点ともユーザー確認済み（「確認しました。問題ありません」）。`node --check`に加え、ヘルプの文字列リテラル編集は`vm.SourceTextModule`によるESM構文検証も実施。Kaptureでの実機確認は未実施のため、次回セッションで実機E2Eの確認を推奨。下記の画像削除復活バグ修正とあわせてv1.32.0としてリリース。

---

## 2026-08-09（レイアウトタブでコマの画像を削除→別画像をドロップすると削除済み画像が復活する不具合を修正、v1.32.0）

ユーザー報告「コマにある画像を削除後、別の画像をコマにドロップしたところ削除した画像が復活した。再度削除→別コマにドロップしても復活した」を受けて調査。

**原因は複数の問題が絡んでいた**:
1. **ドロップ処理が実際の落下位置を見ていなかった**（`08-panels-images.js`の`initDragAndDrop`）: 画像ファイルをドロップした際、対象コマを`state.selectedPanelId`（＝直前にクリックして選択していたコマ）で決めていた。ドラッグ＆ドロップ自体はクリックを発生させないため選択状態が変わらず、「別のコマにドロップした」つもりでも実際には直前に画像を削除したコマへ挿入されていた。
2. **削除処理が`data-panel-id`属性だけを信用していた**（`05-groups-move.js`の`deleteSelectedObject`、`04b-layer-panel-render.js`のレイヤーパネル✕/🔓/👁ボタン）: 画像削除の保存先コマ判定に、DOM上の実際の親要素（`closest('g[data-clip-panel]')`）ではなく画像要素の`data-panel-id`属性を優先して使っていた。属性が実際の所属コマとズレていた場合、`el.remove()`でDOM上は消えても保存は別コマのデータを更新してしまい、削除が`panelSvgContent`に反映されない。
3. **保存失敗が静かに握りつぶされていた**（`07-pages.js`の`savePanelSvg`）: `dbPut`失敗時にコンソールへのログのみでユーザーへの通知が無く、`state.activePage`も更新されないまま残っていた。
4. **サムネイル遅延書き込みの競合**（`00-db.js`）: `_scheduleThumbUpdate`の600msデバウンス書き込みが、直後の即時書き込み（`deferThumb`未指定）でキャンセルされておらず、短時間の連続操作で古いスナップショットが後から上書きしてしまう余地があった。

**修正**: (1)ドロップ座標の直下にあるコマを`document.elementFromPoint`で判定し`selectPanel()`する、(2)削除・ロック・表示切替の全箇所でDOM上の実際の親コマを最優先にする、(3)`savePanelSvg`の失敗時にユーザーへ`alert`で通知する、(4)即時書き込み時に保留中のデバウンスタイマーを取り消す、の4点をそれぞれ実施。

ユーザー確認済み（「確認しました。問題ありません」）。Kaptureでの実機確認は未実施。`node --check`のみ実施。上記のフキダシ内包テキスト拡充とあわせてv1.32.0としてリリース。

---

## 2026-08-08（レイアウトタブで削除したオブジェクトがタブ切替で復活する不具合を修正、v1.31.1）

ユーザー報告「レイアウトタブで削除を行ってもページタブからレイアウトタブに戻った際に削除したオブジェクトが戻る場合がある」を受けて調査。

**原因**: オブジェクト削除（`deleteSelectedObject()`＝05-groups-move.js、レイヤーパネルの✕ボタン＝04b-layer-panel-render.js）はDOMから要素を削除した後、`savePanelSvg`/`saveOverlaySvg`（07-pages.js/09b-balloon-shapes.js）経由で必ず`await`付きでDB保存まで行っており、保存自体は正しく行われていた。また`state.activePage`の読み取り→dbPut→反映という一連の処理は`_enqueueActivePageSave`（00-db.js）というキューで直列化されており、保存同士が競合してデータが消える問題は既に対策済みだった（`00-db.js`内の既存コメントに、まさにこの「削除したはずのレイヤーが復活する」現象への言及があった）。しかし、レイアウトタブへの再入場時に呼ばれる`renderLayoutTab()`（07-pages.js）が、このキューを待たずに直接`dbGet('pages', ...)`でDBから読み直していたため、削除の保存（`dbPut`）がまだコミットされる前にページタブ→レイアウトタブへ素早く切り替えると、削除前の古いレコードを読み込んでしまい、削除したはずのオブジェクトが復活して見えるという「保存とは独立した経路からの読み込みが保存の完了を待たない」競合状態だった。

**修正**: `00-db.js`に、現在キューに積まれている保存がすべて完了するのを待つ`_waitForActivePageSaveQueue()`を追加し、`renderLayoutTab()`が`dbGet()`する前にこれを`await`するようにした。

Kaptureで実機確認済み: レイヤーパネルの✕ボタンでオブジェクトを削除した直後、ページタブ→レイアウトタブへほぼ同時に（キューイングなしで）切り替える最も厳しいタイミングで再現テストを行い、削除したオブジェクトが復活しないこと・レイヤーパネルの行数が正しく減ったままであることを確認。新規コード起因のコンソールエラーなし。

---

## 2026-08-08（3Dテキストの複数行テキストが上下逆順に表示される不具合を修正、v1.31.1）

ユーザー報告「テキストボックスとプレビューが異なる（上下逆）」を受けて調査。⚙3D設定モーダルのテキストパネル（v1.31.0で新設した5行テキストエリア）に複数行入力すると、1行目がプレビューの下側、2行目以降が上側に表示されてしまう不具合があった。

**原因**: `text3d-core.js`の`_buildShapesForText()`で、各行のベースラインY座標を`opentype.js`の`glyph.getPath(x, y, fontSize)`へ渡す際、行番号`i`に対して`y = -i * fontSizeWorld * lineHeight`（iが増えるほど負）としていた。しかしopentype.jsの`getPath()`はY軸下向き正の座標系で値を返すため、このファイルでは直後に全座標を`shapePath.moveTo(cmd.x, -cmd.y)`で符号反転してthree.jsの座標系（Y軸上向き正）に変換している（ファイル冒頭の既存コメント「注意1」参照）。この符号反転は渡したベースラインyにも等しく効くため、実際の最終Y座標は`-y`となり、`y`が「iが増えるほど負」だと最終的には「iが増えるほど正（上）」になってしまい、2行目以降が1行目より上に表示される逆順になっていた。この不具合はロジック自体は3Dテキスト機能の初期実装から存在していたが、従来ツールバーのテキスト入力欄が1行(`rows="1"`)だったため複数行入力される機会が少なく、v1.31.0で⚙3D設定モーダルに5行のテキストエリアを新設したことで顕在化した。

**修正**: `y = -i * fontSizeWorld * lineHeight` を `y = i * fontSizeWorld * lineHeight` に変更（符号反転を1つ減らし、後段の全体反転と合わせて「iが増えるほど最終Y座標が負（下）」という正しい向きにした）。

Kaptureで実機確認済み: テキストパネルに「text」→改行→「12345」と入力し、プレビューで「text」が上・「12345」が下（テキストエリアと同じ順）に表示されることを確認。新規コード起因のコンソールエラーなし。

---

## 2026-08-08（3Dテキストに SVG立体化・表面/側面カラー分離・設定モーダルのタブ化を追加、v1.31.0）

`feature/text3d-svg-material`ブランチで作業。参考アプリ`3d-text-generator`（React/three.js製プロトタイプ）の「SVGパス立体化」「表面色・側面色の個別指定」を、既存の3Dテキスト機能（レイアウトタブ・Imageタブ共有）へ移植し、あわせてユーザーからのフィードバックを受けて⚙設定モーダルをタブ構成に再設計した。

**SVG立体化モード**: 「テキスト」「SVG」のモード切替ボタンを追加。SVGモードではSVGファイルを選択すると、SVGLoader（three r160、`comfyui-vrm-pose-editor`が配信するthree.module.jsと同バージョンでvendor化）でパースしたベクターパスを`THREE.ExtrudeGeometry`で押し出す（`text3d-core.js`の`_buildSvgGeometry()`、参考アプリ`svgToShapes.ts`のロジックをvanilla js化して移植）。未パス化のテキスト要素（`<text>`）やビットマップ画像（`<image>`）を含むSVGは警告を表示する。

**表面/側面カラー分離**: `THREE.ExtrudeGeometry`が標準で持つ「表裏キャップ面=materialIndex 0」「側面=materialIndex 1」の2グループ（three.js本体の実装仕様）を利用し、`new THREE.Mesh(geometry, [frontMaterial, sideMaterial])`と配列を渡すだけで表面色・側面色を別マテリアルにした。テキスト・SVG両モード共通。面取り（厚み・サイズ・分割数）も詳細スライダーで調整できるようにした。

**バグ修正1: 面取りの値によってSVGの3Dビューが真っ黒になる不具合**。当初は「SVGのviewBoxサイズと押し出し座標系のスケール不一致」を疑ったが、実機調査（`gl.readPixels()`でキャンバスの実ピクセル値を直接確認）の結果、WebGL自体は正常に描画できており、原因は別にあると判明。⚙設定モーダルは実描画中のcanvasを一時的に自分のプレビュー枠へ「借りて」表示する仕組みだが、レイアウトタブ側の「コマの画面上位置にcanvasを追従させるResizeObserver」がモーダル表示中も動き続けており、モーダルが借りている最中のcanvasラッパーを、コマの本来の位置（画面外）へ強制的に書き戻してしまっていた（`text3d-settings-modal.js`に`onClose`コールバックを追加し、`25-text3d-bridge.js`側でモーダルを開く前にResizeObserverを止め、閉じたら再セットアップするよう修正）。あわせて、three.jsのExtrudeGeometry自体が面取りの自己交差で頂点座標や法線ベクトルを破綻させるケース（three.js本体の既知の制約）に対する防御コードも追加し、破綻を検知した場合は面取りを自動的に無効化して再構築し、無音で真っ黒になる代わりに警告メッセージを出すようにした（`_isGeometryValid()`）。

**⚙設定モーダルのタブ化**（ユーザー要望）: 3カラム構成に再設計。左＝「ライト」「マテリアル」「カメラ」のタブ切替パネル、中央＝実描画中のプレビュー、右＝常時表示の「テキスト」パネル（テキスト内容・フォント・整列・**行間スライダー（新規）**）。従来ツールバーに常時表示していたテキスト入力・フォント選択・整列ボタンをモーダルへ移動し、ツールバーはモード切替・押し出し厚み・面取りON/OFF・⚙3D設定ボタンのみのシンプルな構成にした。これに伴い、フォント読込ロジックをDOM値読取（`fontSelect.value`）から`state.text3d.fontFamily`/`fontSource`（stateが正）駆動へリファクタリング（モーダルは開いている間しかDOM要素が存在しないため）。フォント一覧取得はレイアウトタブ・Imageタブで実装が異なる（Google一覧の取得元・システムフォントキャッシュが別々）ため、モーダル自体はロジックを持たず`fontControls`コールバック一式を呼び出し側から受け取って委譲する設計にした。テキスト・整列・行間はモーダル内でeditorへ直接適用されるため、モーダルを閉じた時点（`onClose`）で`editor.getParams()`から読み戻してstateに同期する。

**UI文言調整**（ユーザー要望）: モーダルタイトルを多言語化しない固定名称「3D Text Editor」に変更（3Dポーズの「RC」ボタン表記と同じ扱い）。⚙ボタンを「⚙ 設定」→「⚙ 3D設定」に変更しツールチップに「テキスト編集」を追加。テキスト内容の初期値を空文字から「text」に変更し、「コマに配置」を押しただけで即座に3Dビューに何か表示され操作に迷わないようにした。

Kaptureで実機E2E確認済み: SVGファイル選択・立体化・表面/側面カラー分離・面取り詳細スライダー（意図的に極端な値を試し、以前は真っ黒になっていた組み合わせでも正しく表示され続けることを確認）・タブ切替・フォントソース切替（Google/システム）・整列・行間スライダーのライブ反映・モーダルを閉じた後の状態保持・UI文言変更を確認。新規コード起因のコンソールエラーなし。ヘルプ（ja/en/zh、22-help-tab.jsの`_HELP_DATA`と`_HELP_I18N.en`/`.zh`両方）・README 3言語を更新済み。依存先のcomfyui-vrm-pose-editor側もSVGLoader.jsのvendor追加をv0.12.0として先行リリース済み。v1.31.0としてリリース。

---

## 2026-08-07（デフォルトワークフロー系チェックボックスがRunに反映されないバグを修正、v1.30.1）

ユーザー報告「T2I一括生成でデフォルトワークフローのチェックを外して別のワークフロー（boogu_t2i.json）を生成UIタブに読み込んで実行したが、ernie_t2i.jsonで実行される」を調査。

**原因**: T2I/I2Iモーダルの「デフォルトワークフローを使用する」チェックボックス・ファイル名入力欄は、実行(Run)時には一切参照されず、**「保存」ボタンを押してlocalStorageへ書き込んで初めて次回以降の実行に反映される**設計になっていた。`requestPanelImageFromWorkflowStudio()`/`sendI2IRunToWorkflowStudio()`（14-integrations.js）が、呼び出し時の引数ではなく内部でモジュールスコープの`_t2iSettings`/`_i2iSettings`（保存済み設定）を直接参照していたため。チェックボックスを変更しただけで「保存」を押し忘れると、画面表示と実際の挙動が食い違う（今回は前回セッションでON+`ernie_t2i.json`を保存済みだったため、OFFにしても保存し直さない限りernie_t2i.jsonのまま実行され続けた）。

同じ設計上の欠陥が、スクリプトタブのT2I/I2Iモーダルだけでなく、**レイアウトタブのI2Iモーダル**（15-pixifx-bridge.js）と**ImageタブのSelect I2Iパネル**（image-tab.js）の計4箇所すべてに存在していたため、まとめて修正した。

**修正**: `requestPanelImageFromWorkflowStudio(prompt, width, height, negative, wfOverride)`/`sendI2IRunToWorkflowStudio(imageBlob, params, wfOverride)`（14-integrations.js）に、任意の`wfOverride: {enabled, file}`引数を追加。渡された場合はそちらを優先し、省略時は従来通り保存済み設定（`getT2ISettingsState()`/`getI2ISettingsState()`）を使う（既存呼び出し元との後方互換を維持）。4箇所すべてのRunボタンのクリックハンドラで、モーダル/パネルに**今表示されているチェックボックス・ファイル名入力欄の値**をそのまま`wfOverride`として渡すよう変更。これにより「保存」ボタンは「次回モーダルを開いたときの初期値を保存する」という役割に純化され、Runは常に画面表示中の設定通りに実行されるようになった。

Kaptureで実機E2E確認済み: Comic Creator画面内のWorkflow Studioタブ経由で`boogu_t2i.json`を生成UIタブへ手動ロードし、T2Iモーダルで「デフォルトワークフローを使用する」をOFFにした状態（**「保存」ボタンは押さず**）でRunを実行。コンソールログで`[Eagle] Saved: Boogu_00005_.png`/`Boogu_00006_.png`（Booguモデル、boogu_t2i.json由来）を確認し、修正前に発生していた「ernie_t2i.jsonで実行される」問題が解消されたことを確認（test1作品、2コマとも成功）。検証後は「元に戻す」でtest1作品を挿入前の状態に復元済み。新規コード起因のコンソールエラーなし。v1.30.1としてリリース。

---

## 2026-08-07（「画像を一括生成」(T2I)をI2I同様のモーダルに変更、ヘルプ更新、v1.30.0）

ユーザーから「`ernie_t2i.json`をWorkflow Studioの生成UIタブに読み込んで実行したが、別のワークフローが実行されたようだ」との報告を受け調査。

**原因調査**: コードのバグではなく、ユーザーが手動でワークフローをロードしたのがComic Creator画面内に埋め込まれたWorkflow Studio（`wfmgallery-iframe`）ではなく、ブラウザの別タブとして独立に開いた`/wfm`だったことが原因と判明。Kaptureで両タブを確認したところ、Comic Creator内のiframe側は起動時に自動ロードされるデフォルトワークフロー（`2.json`）のままで、ユーザーが別タブでロードした`ernie_t2i.json`は反映されていなかった（同じURLでも別ブラウザタブ＝別JS実行コンテキストのため状態が共有されない）。「画像を一括生成」(`requestPanelImageFromWorkflowStudio`)は「専用ワークフロー選択には未対応で常にGenerate UIに現在ロード中のワークフローをそのまま使う」設計だったため、iframe側の`2.json`がそのまま実行されていた。

**対応（ユーザー要望）**:
- **T2I版「画像を一括生成」のモーダル化**: 既存の「画像を一括生成（I2I）」と同じ構成（全体Positive/Negativeプロンプト、「コマの画像プロンプトが空の場合はスルーする」チェック、デフォルトワークフロー指定）を持つ専用モーダルに変更。`_handleAutoImageGenerateClick`を`_runAutoImageGenerateT2I`＋`_openAutoComicT2IModal`に置き換え（`26-auto-comic-bridge.js`）。I2I/Nanobananaモーダルと共有していたPositive結合ヘルパー`_composeI2IPositive`を`_composeOverallPrompt`へ汎用リネーム。
- `14-integrations.js`に、I2I/Inpaint設定と同じ独立パターンで`_t2iSettings`（localStorage `ccc_t2i_settings`）・`getT2ISettingsState`/`saveT2ISettingsState`を新設（T2I/I2I/Inpaintそれぞれ別々のデフォルトワークフローを持てる）。`requestPanelImageFromWorkflowStudio(prompt, width, height, negative)`を拡張し、T2I設定が有効な場合は実行前にワークフローJSONを取得してWorkflow Studio側へ渡すようにした。
- Workflow Studio側`gallery-tab.js`の`_wfmReceiveGenerateRequest`をI2I/Inpaintと同じパターンに拡張（`negative`・`workflowData`・`workflowFilename`引数を追加、詳細はComfyUI-Workflow-Studio側DEVLOG参照）。
- モーダル下部の見出しをI2Iと共通の「I2I設定」のまま流用していたところ紛らわしかったため、専用の「T2I設定」ラベル（`script.autoT2ISettingsHeading`）を追加。
- **ヘルプ更新（ja/en/zh）**: 「画像を一括生成」の説明をモーダル仕様に更新。「Workflow Studio連携について」の独立`<li>`を新設し、L/T2I/I2I連携機能が対象とするのはComic Creator画面内の「Workflow Studio」タブに埋め込まれたインスタンスであり、ブラウザの別タブ・別ウィンドウで開いたWorkflow Studioとは無関係である点を明記（今回の調査結果を踏まえた注意喚起）。「画像を一括生成（I2I）」の説明にDenoise指定は対応ワークフロー（denoiseパラメータを持つノードを含むもの）のみ有効という注記を追加。

Kaptureで実機E2E確認済み: T2Iモーダルの表示・入力保持（Positive/Negative/スルーチェック/デフォルトWF設定）を確認。`ccc_t2i_settings`が`ccc_i2i_settings`/`ccc_inpaint_settings`とは独立してlocalStorageに保存されることを確認。実際にComic Creator画面内のWorkflow Studioタブ経由で`ernie_t2i.json`をT2I設定のデフォルトワークフローに指定してRunを実行し、`/queue`監視・コンソールログで`ernie_t2i.json`のモデル（`Ernie-Image-Turbo`）による生成が実行されEagleへ保存されたことを確認（test1作品、2コマとも成功、レイアウトタブへ自動挿入）。検証後は「元に戻す」でtest1作品を挿入前の状態に復元済み。新規コード起因のコンソールエラーなし。ユーザー指示によりボタン名を「画像を一括生成」→「画像を一括生成（T2I）」に変更（i18n・ヘルプ・README 3言語とも追従）。v1.30.0としてリリース。

---

## 2026-08-05（半自動マンガ「画像を一括生成（Nanobanana）」機能を追加、v1.29.0）

`feature/semi-auto-comic-nanobanana`ブランチで作業。スクリプトタブの半自動マンガ作成機能に、既存の「画像を一括生成（I2I）」（Workflow Studio連携）と対になる、Nanobanana（Gemini画像生成API、CC自身が持つ独立タブ`nanobanana.js`と同じ連携）を使うバッチI2I生成機能を追加した。まずは既存I2Iモーダルとは別のボタン・別のモーダルとして実装し、バックエンド選択式の1モーダルへの統合は将来の検討課題とする。

- `auto-comic-core.js`に、既存`pickSdxlResolution`と同じ対数スケール比較ロジックの`pickNanobananaResolution(aspectRatio)`を追加。Nanobananaの解像度プリセット（5種類、値はSDXLと現状同一）から、コマのbboxアスペクト比に最も近いものを自動選択する。
- `nanobanana.js`の`NanobananaManager`内に埋め込まれていた「APIキー確認」「生成API呼び出し」「base64正規化＋サーバー保存＋Eagle自動保存」の3ロジックを、モジュールスコープの独立関数（`checkNanobananaKeyStatus`/`requestNanobananaGenerate`/`saveNanobananaImageAndMaybeEagle`）として切り出しexport。既存Nanobananaタブ自体もこれらを呼ぶ形にリファクタリングし、挙動を変えずに半自動マンガ側と共有できるようにした。
- `26-auto-comic-bridge.js`に「画像を一括生成（Nanobanana）」ボタン・モーダル（`_openAutoComicNanobananaModal`）・実行ロジック（`_runAutoImageGenerateNanobanana`）を追加。既存I2Iモーダルと同じ対象コマ絞り込み・Positive結合・`pushHistory`の設計を踏襲しつつ、モデル選択（3種）・I2I強度スライダー・接続状態表示を持つ。各コマの現在の画像を`_getPanelImageBlob`でラスタライズしdata URL化してNanobanana APIへ送信し、結果はコマのbboxへ`preserveAspectRatio:'none'`でストレッチ挿入する（T2I/I2Iバッチと同じスケール調整方式）。
- 判明した既存事実: `py/ccc.py`の`handle_nanobanana_generate`は`width`/`height`を実ピクセル指定ではなくアスペクト比文字列に変換してGeminiへ渡すのみで、`strength`パラメータは一切処理していない。既存Nanobananaタブのstrengthスライダーも現状バックエンド未反映であり、新モーダルのstrengthスライダーも同じ制約を引き継ぐ（バックエンド改修は今回スコープ外）。
- Kaptureで実機E2E確認済み: 既存Nanobananaタブの回帰なし（リファクタリング後も接続状態表示・生成が正常動作）、新モーダルのUI表示・入力項目がすべて正常、test1作品（半自動マンガ、2コマ）で実際にRunを実行し2コマとも生成成功→レイアウトタブへ自動切替→コマ全面へ隙間なくストレッチ挿入を確認。ネットワークログで`/api/ccc/nanobanana/generate`→`/api/ccc/save-nanobanana-image`→`/api/ccc/eagle/add`の呼び出し順序を確認（Eagle未起動環境のため`eagle/add`は500だったが、fire-and-forgetのため他コマの処理には影響せず両コマとも成功）。挿入された`<image>`の`href`が`data:image/...;base64,...`形式であること、および作品保存→リロード→再読込後も画像が壊れずに表示されることを確認（過去のblob URL永続化バグの再発なし）。新規コード起因のコンソールエラーなし。
- ヘルプ（ja/en/zh、「プロット」節に新規`<li>`）・README（3言語）を更新済み。バージョンアップ・mainへのマージ・プッシュは別途指示があるまで行わない。
- **追加修正: I2I強度スライダーを削除、「2K」生成トグルを追加（Nanobananaタブ・半自動マンガモーダル両方）。** ユーザー指示によりGemini画像生成APIの公式ドキュメント（`https://ai.google.dev/gemini-api/docs/image-generation`・`https://ai.google.dev/api/generate-content`）を確認した結果、(1) I2Iの変化度合いを数値で指定するパラメータ（denoising strength等）はAPIに一切存在せず、変化の強さはPositiveプロンプトの文章のみで制御する仕様であることが確定した。(2) `generateContent`エンドポイントの`GenerationConfig.imageConfig`（`ImageConfig`型）に、既存実装が使っている`aspectRatio`に加えて`imageSize`フィールド（`"1K"`/`"2K"`/`"4K"`、未指定時は`"1K"`）が存在することが判明した（モデルにより対応状況が異なり、`gemini-3.1-flash-lite-image`は`1K`のみ対応、`gemini-3.1-flash-image`/`gemini-3-pro-image`は`2K`/`4K`まで対応）。これを受けて、①`nanobanana.js`・`26-auto-comic-bridge.js`・`templates/index.html`から`nanobanana-i2i-strength`スライダー（UIのみでバックエンド未反映だった）を削除、②`py/ccc.py`の`handle_nanobanana_generate`に`image_size`リクエストパラメータを追加し`imageConfig.imageSize`へ渡すよう変更、③両UIの解像度セレクト隣に「2K」チェックボックスを追加（選択したアスペクト比を維持したまま約2倍相当の解像度で生成、対応モデル選択時のみ有効）。i18nキー`nb.i2iStrength`を`nb.2kLabel`/`nb.2kHint`に置き換え（3言語）。Kaptureで確認したところ、JS側（UIの表示・strength削除・リクエストペイロードへの`image_size`付与）は正常動作を確認したが、`py/ccc.py`の変更はComfyUIのカスタムノードロード方式上サーバー再起動が必要だった（ユーザーが再起動を実施）。再起動後、Nanobananaタブで`gemini-3.1-flash-image`モデル＋「2K」ONで生成→`naturalWidth`/`naturalHeight`が2048×2048（既定の1024×1024から狙い通り2倍）になることを確認。`gemini-3.1-flash-lite-image`（2K非対応）では従来通り1024×1024のまま生成されることも確認済み。半自動マンガのNanobananaモーダルでも同モデル＋2K ONでtest1作品の2コマに対しRunを実行し、2件とも生成成功→コマのbboxへスケール調整挿入（挿入された`<image>`のdata URL長が従来の1K生成時（26万〜100万文字程度）に対し2K生成時は245万〜360万文字程度と明確に大きく、高解像度化を確認）。両モーダルとも新規コード起因のコンソールエラーなし。

---

## 2026-08-05（Imageタブヘルプの翻訳漏れ修正・レイアウトタブ表示サイズの不連続ジャンプ修正・アセットパネル「P」タブ更新漏れ修正、v1.28.0）

ユーザー報告の3件に対応。いずれもバグ修正で、未リリースの下記「3Dポーズタブに風エフェクト」（2026-08-04）と合わせてv1.28.0としてまとめてリリースする。

**1. Imageタブヘルプの翻訳漏れ修正**: ユーザーが以前のセッションで見つけていた「Imageタブ『アクションバー: 開始/終了』見出しの『下書き』ボタンの説明が英語・中国語版に欠けている」を確認・修正。`22-help-tab.js`の日本語版（163行目）には`Upload`/`New`/**下書き**/`Close`の4項目があったが、英語版（`Action Bar: Start/End`）・中国語版（`操作栏：开始/结束`）には`Upload`/`New`/`Close`の3項目しかなく、下書きボタンの説明が丸ごと欠落していた。また関連するもう1箇所、「アクションバー: 保存系ボタンの違い」の「レイアウトに送る」説明末尾にある「ただし『下書き』ボタンで作成したキャンバスは例外で、常に下書きレイヤーへページ全面サイズで挿入される」という一文も英語・中国語版に反映されていなかった。日本語版の内容に合わせて両言語とも追記し、3言語を揃えた。

**2. レイアウトタブ「表示サイズ」スライダーの不連続ジャンプ修正**: 「表示100%から105%に変更すると数値とかけ離れた大きさになる」という報告を受け調査。`02-assets.js`の`_applyLayoutPreviewSize(pct)`が、`pct <= 100`のときだけ`max-height:80vh`を適用し、101%以上では丸ごと解除する実装になっていたのが原因。100%ちょうどの時点では高さ制限によりSVGの実効表示幅が縮小されていたため、101%になった瞬間に制限が消えて「親コンテナ幅のpct%」がそのまま適用され、Kaptureでの実測でも100%→105%で幅572px→822px相当（本来なら601px、5%増のはず）まで跳ね上がることを確認した。修正としてSVGのviewBoxから求めた本来の縦横比をもとに、「コンテナ幅」と「高さ80vh」のうち小さい方を100%の基準サイズとし、pctをその基準への倍率として一貫適用するようCSSの`min()`/`calc()`で書き換えた（`max-height`の分岐は撤廃し常に`none`に）。線形性により、これは実質「pctによらず常にどちらか一方の制約だけが効く」計算と数学的に同一になるため、ウィンドウリサイズにも追従する。Kaptureで100%→105%（572.57→601.20px、809.77→850.26px、いずれも正確に×1.05）、25%（正常縮小）、300%（正常拡大・横スクロールバー機能）を実機確認済み。新規コードに起因するコンソールエラーなし。

**3. アセットパネル「P」タブの更新漏れ修正**: 「レイアウトタブでPタブ（ページサムネイル一覧）を表示している状態のまま他タブへ移動し、そちらでページ関連の操作（保存・並び替え・リネーム・削除・作品切替等）をしてからレイアウトタブに戻ると、Pタブの中身が移動前のまま更新されず違和感がある」という報告を受け調査。`01-state.js`の`switchTab()`は、`tabId === 'layout'`で戻ってきた際に`renderLayoutTab()`（メインキャンバス）と`renderAssetFontGrid()`のみを再描画しており、`renderPageThumbGrid()`（Pタブの中身）は呼んでいなかったことが原因。他タブでの変更自体は`07-pages.js`の`renderPageSelector()`経由で`state.pages`やDOM(`#page-thumb-grid`)には正しく反映されるが、レイアウトタブに戻るだけではその再描画がトリガーされない設計だった。`switchTab()`のレイアウトタブ復帰処理に、アセットパネルの現在のアクティブタブが`pages`の場合のみ`renderPageThumbGrid()`を呼ぶ分岐を追加。

---

## 2026-08-04（3Dポーズタブに風エフェクト（そよ風・発生源マーカー）の操作ボタンを追加、v1.28.0）

comfyui-vrm-pose-editor側（開発元: `vrmpose_light_plus_2\3dpose_light_editor`）に新規実装された「風エフェクト」機能へ、Comic Creator側のUIを追従させた。ユーザーからの「Workflow Studioのレイアウトタブの3Dポーズ機能の更新も必要か」という質問を受けて調査したところ、Workflow Studio自体には3Dポーズ機能が無く、実体はComic Creator側のレイアウトタブ「3Dポーズ」サブタブであることが判明。そちらへの追加対応を行った。

**背景（comfyui-vrm-pose-editor側の新機能）**: `pose_editor_core.js`に、VRMの揺れボーン（髪・スカート等）へthree-vrmのgravityDir/gravityPowerを毎フレーム上書きする方式でsin波合成のそよ風を加える機能（`_windEnabled`等、editor APIとして`getWindEnabled()/toggleWindEnabled()/getWindStrength()/setWindStrength()/getWindDirection()/setWindDirection()/getWindTurbulence()/setWindTurbulence()`）と、視線（LookAt）機能と同じ仕組みでドラッグ可能な3Dコーンから風向きを指定できる「発生源マーカー」機能（`getWindSourceEnabled()/toggleWindSourceEnabled()`）が追加された。

**Comic Creator側の対応**: Comic Creatorは`pose_editor_core.js`・`light_editor.js`・`pose_library.js`のみを`/extensions/comfyui-vrm-pose-editor/`経由の動的importで参照しており（`pose_editor_3d.js`のツールバーDOMには依存していない）、独自のツールバーHTML（`templates/index.html`、`pose3d-lookat-btn`等）とイベントハンドラ（`static/js/main/23-pose3d-bridge.js`）からeditor APIを個別に呼び出す設計になっている。そのため今回のAPI追加だけではUI操作ができず、過去の視線・揺れ物理トグル追加時と同様、対となるUIボタンを手動で追加する必要があった。

- `templates/index.html`: `pose3d-springbone-btn`（🎐揺れ）の直後に`pose3d-wind-btn`（🌬 風）・`pose3d-windsource-btn`（🧭 発生源）ボタンを追加。
- `static/js/main/23-pose3d-bridge.js`: `initPose3DTab()`内でDOM取得を追加し、既存の`lookAtBtn`/`springBoneBtn`と同じパターン（`editor.toggleXxx()`→ボタンのtextContent・背景色を更新）でイベントハンドラを追加。
- `static/js/i18n.js`: `layout.pose3dWindTitle`/`layout.pose3dWindSourceTitle`を日本語・英語・中国語の3言語で追加。
- 強さ・向き・そよぎの詳細パラメータ調整、発生源マーカーONの間の「向き」スライダー無効化は、既存の`pose3d-light-btn`（ライトエディタ）経由でそのまま利用可能（`light_editor.js`自体を動的importしているだけのため、Comic Creator側の追加実装なしで自動的に反映される）。

**検証**: Kaptureで実機確認済み。レイアウトタブ→3Dポーズサブタブ→コマに配置後、「風」ボタンで`editor.toggleWindEnabled()`が呼ばれボタンが青くハイライトすること、「発生源」ボタンで`editor.toggleWindSourceEnabled()`が呼ばれ3Dビュー（`pose3d-canvas`）内にオレンジのコーンマーカーが実際に表示されることを確認。新規コードに起因するコンソールエラーは発生しなかった。なお、このタブでは「default model」の自動ロードがComic Creator側の既存の仕様（baseUrl解決）により404になる（今回の変更とは無関係の既存の挙動）ため、実VRMモデルでの揺れ確認はできていない。

**ドキュメント**: ヘルプ（`22-help-tab.js`、日英中3言語）の「3Dポーズサブタブ」節に「🌬 風」「🧭 発生源」の説明を追加。あわせて、日本語版にのみ存在し英語・中国語版では抜けていた「👁 視線」「🎐 揺れ」の説明も今回3言語で揃えた。README（3言語）の「3D ポーズ」機能概要にも風エフェクトの記載を追加済み。リリースはユーザー判断で後日行う予定。

**重大な不具合と修正**: 上記ヘルプ更新の直後、ユーザーから「ページタブの作品管理で作品一覧が表示されない。新規作成・テンプレートタブ・レイアウトタブも開かない」という報告があり調査した。原因は`22-help-tab.js`の英語版ヘルプ本文（3Dポーズサブタブ節、今回追加した「👁 LookAt」「🎐 Sway」「🌬 Wind」の説明文）に含まれる`model's`/`marker's`という所有格のアポストロフィが**エスケープされずに生のまま**JS文字列リテラル（`'...'`）内に混入していたこと。文字列がそこで終端したとブラウザのパーサーに誤認識され、`SyntaxError: Unexpected identifier 's'`でモジュール評価そのものが失敗し、ヘルプタブどころか作品管理・テンプレート・レイアウトタブまで巻き込んで全機能が使用不能になっていた。`node --check`ではなぜかこの構文エラーが検出されず（トークン列としてたまたま成立してしまっていたためと推測）、実際にブラウザで評価して初めて顕在化する類のバグだった。

- **原因特定**: `git stash`で今回の全変更を一時退避してエラーが消えることを確認したのち、`git checkout stash@{0} -- <file>`で1ファイルずつ復元しながらKaptureでブラウザの再現確認を繰り返す二分探索で`22-help-tab.js`に絞り込んだ。ファイルサイズ・ネットワークレスポンスのバイト完全一致も確認し、文字化けやキャッシュ起因ではないことを先に排除した。
- **修正**: 該当3箇所の`model's`/`marker's`を`model\'s`/`marker\'s`にエスケープ。中国語版・日本語版には所有格アポストロフィ表現自体が存在しないため、他言語への修正は不要だった。
- **教訓**: JS文字列リテラルへ長文の英語説明文を追加する際は、`node --check`が通っても実ブラウザでの構文的な健全性の担保にはならない場合がある。所有格・短縮形のアポストロフィ（`'s`、`doesn't`等）を含む英文をシングルクォート文字列へ追加するときは特に注意する。
- **検証**: 修正後、`node --check`・実ブラウザともにエラーが解消し、Kaptureで「作品管理」の作品一覧・「テンプレート」タブのサムネイル一覧・「レイアウト」タブ（ツールペイン・レイヤーパネル含む）がすべて正常に表示・動作することを確認した。3Dポーズサブタブの🌬/🧭ボタンも引き続き正しく表示されることを確認済み。

---

## 2026-08-04（プロットに「フキダシ形状」列を追加、セリフごとに自動生成の形状を指定可能に、v1.27.0）

ユーザー依頼「プロットにフキダシ形状指定の列を追加したい。セリフごとにドロップダウンで選択可能とし、フキダシを自動生成ボタンで指定のフキダシ形状で作成したい。指定がない場合は現在の矩形で作成としたい。」に対応。Phase 1設計時点で「今回は見送り」としていた項目（[[feature-semi-auto-manga-creation]]参照）を実装した。

**データ構造**: `21a-script-manga.js`のセリフオブジェクトに`shape`フィールドを追加（`{character, text, shape}`）。値は空文字（未指定＝自動生成時は角丸矩形にフォールバック）または`normal`/`rect`/`thought`/`bomb`/`cloudpuffy`/`cloudwavy`（`09c-balloon-handles.js`の`h2-shape-type`セレクトと同じ6値）。`_scriptMangaBlankDialogue()`・`_scriptMangaNormalize()`を更新し、旧形式データ（`shape`フィールドなし）は読込時に自動的に空文字（既定＝角丸矩形）へ補完される。

**UI**: プロットのコマワリテーブルに列を追加（シーン｜コマ番｜画像プロンプト｜セリフ番｜要素｜セリフ/説明等｜**フキダシ形状**の7列）。各セリフ行に`<select>`（既定/通常/角丸矩形/思考/バクダン/雲もこもこ/雲なみなみ）を配置。選択肢の文言は既存のレイアウトタブ「フキダシ」ツールの`h2-shape-type`セレクトと同じi18nキー（`layout.balloonNormal`等）をそのまま再利用したため、新規翻訳は列見出しと既定オプションのみで済んだ。

**生成ロジック**: `26-auto-comic-bridge.js`の`_handleAutoBalloonGenerateClick()`で、これまで固定値`AUTO_BALLOON_TYPE`（`'rect'`）を渡していた箇所を`dialogues[i].shape || AUTO_BALLOON_TYPE`に変更。`createBalloonAtPosition()`/`_buildBalloonShapeEl()`（09c-balloon-handles.js）は既に全6形状のデフォルトパラメータ（バクダンのスパイク数、思考の泡サイズ、角丸矩形の角丸半径等）に対応済みだったため、呼び出し側の変更のみで完結した。

**検証**: Kaptureで実機E2E確認済み。既存作品「これはTESTです。」（漫画メディア、旧形式データ）を読み込み、フキダシ形状列が「既定（角丸矩形）」で正しく初期表示されることを確認（後方互換）。1行目を「バクダン」に変更しリロード後も保持されることを確認。「test1」（半自動マンガ）でコマ1の2セリフをそれぞれ「雲もこもこ」「思考(泡)」に設定し「フキダシを自動生成」を実行、指定通りの形状で生成されレイアウトタブに反映されることをスクリーンショットで確認（コマ2は未指定のため角丸矩形で生成）。新規コードに起因するコンソールエラーなし。

**ドキュメント**: ヘルプ（`22-help-tab.js`、日英中3言語、プロット列一覧・フキダシ自動生成の説明を更新）・README（3言語）を更新済み。

---

## 2026-08-04（スクリプトタブ: 「コマ数取得」実行時に誤削除防止の確認ダイアログを追加、v1.26.1）

ユーザー依頼「コマ数取得実行時確認メッセージを出したい。誤ってデータのあるコマを消してしまう恐れがあるため。」に対応。

`21a-script-manga.js`に`_scriptMangaPanelHasData(panel)`（コマの画像プロンプトまたはセリフのいずれかに非空の値があるか判定）を追加。「コマ数取得」ボタンのハンドラで、コマ数が減る場合に削除対象のコマ（末尾から`targetCount`超過分）へこの判定を適用し、1つでもデータ入りのコマが含まれていれば`confirm(t('script.panelCountSyncConfirmDataLoss', 現在数, 変更後数))`で確認する。キャンセル時は何も変更しない。空のコマのみが削除される場合は従来通り確認なしで即実行（既存の▲▼ボタンと同じ利便性を維持）。既存の作品名・削除確認等と同じ`confirm(t('script.confirmXxx'))`パターンを踏襲。

Kaptureで実機E2E確認済み: コマ3に画像プロンプトを入力した状態で5→2への「コマ数取得」を実行し、確認ダイアログが表示されることを確認。キャンセル時はコマ数・入力内容とも変更されないこと、OK時はコマ数が正しく2に減り残り2コマのデータは保持されることを確認。空コマのみ削除されるケース（データなし）では確認なしで即実行されることも既存動作から確認済み。

**ドキュメント**: ヘルプ（`22-help-tab.js`、日英中3言語、プロット節の「コマ数取得」説明に確認ダイアログの挙動を追記）を更新済み。

---

## 2026-08-04（スクリプトタブ: 「コマ数取得」ボタン追加＋作品名/メディア種別/あらすじのレイアウト整理、v1.26.0）

ユーザー依頼「スクリプトタブ、メディア種別：半自動マンガ、マンガのコマ数をレイアウトタブの選択中のページのコマ数から取得するボタンを追加したい。また、作品名:、メディア種別:を1行に、あらすじを要素タブ、右隣にしてプロット入力作業スペースを確保したい。」に対応。

**「コマ数取得」ボタン**: プロットのツールバー、コマ数▲▼の右に追加（`21a-script-manga.js`）。クリックすると`state.activePage?.panels?.length`（レイアウトタブで現在選択中のページの実際のコマ数）を取得し、表示中スクリプトページのコマ数をそれに合わせる（不足分は`_scriptMangaBlankPanel()`を末尾へpush、超過分はpop。既存の▲▼ボタンと同じ増減ロジックを再利用）。レイアウトタブでページが未選択の場合はエラーメッセージを表示。既存の`21-script-tab.js`が`state`（01-state.js）を直接importしていなかったため新規importを追加したが、`01-state.js → 21-script-tab.js → 21a-script-manga.js → 01-state.js`という循環参照になる。ただし`state`の参照はクリックハンドラ内部（呼び出し時点で評価）に閉じているため、既存の`01-state.js ⇄ 26-auto-comic-bridge.js`循環と同じパターンで安全（[[comic-creator-workflow]]参照）。「漫画」「半自動マンガ」どちらのメディアでも使用可能（既存の流し込み等と同じ扱い）。

**レイアウト整理（プロット編集エリアの縦スペース確保）**: `templates/index.html`を編集。①作品名・メディア種別を別々の`.project-plot-section`から1つの`.project-plot-section-header`内へ統合し1行表示に。②あらすじ入力欄を、常時表示だった位置（サブタブ切替前、あらすじ4行分の固定高さを常に占有していた）から「要素」サブタブへ移設し、要素テーブル（左）とあらすじ（右、`.script-synopsis-col`、幅340px・flex:1で残り高さいっぱいに伸びる）の2カラムレイアウトに変更。`style.css`に`.script-elements-layout`/`.script-elements-col`/`.script-synopsis-col`を追加。`#script-synopsis`/`#script-elements-tbody`等の関連JSはすべてID直指定のみで親要素の構造に依存していなかったため、JS側の変更は不要だった。

**検証**: Kaptureで実機E2E確認済み。「test1」（半自動マンガ、2コマ）読込→要素サブタブであらすじが右カラムに正しく表示・作品名とメディア種別が1行表示されることを確認。コマ数を5に増やした状態で「コマ数取得」を実行し、レイアウトタブの選択中ページ（2コマ）に正しく戻ることを確認（既存セリフ・画像プロンプトも先頭2コマ分は保持）。レイアウトタブでページ未選択時のエラーメッセージ表示も確認。新規コードに起因するコンソールエラーなし。

**ドキュメント**: ヘルプ（`22-help-tab.js`、日英中3言語、「作品名・あらすじ」→「作品名・メディア種別」に見出し変更、プロット節・要素節を更新）・README（3言語）を更新済み。

---

## 2026-08-04（半自動マンガ作成: 一括生成（T2I/I2I）の画像がコマより小さくなる不具合を修正、v1.25.1）

ユーザー報告「生成した画像のサイズがコマよりも小さくなる」を調査し、2つの原因を特定・修正した。いずれも`26-auto-comic-bridge.js`が原因。

**原因1（T2I/I2I共通）**: `auto-comic-core.js`の`pickSdxlResolution()`はSDXL標準解像度5段階（アスペクト比0.57〜1.75）しか選択肢がなく、コマの実際のbboxアスペクト比がこの範囲から外れるほどズレが大きくなる。`08-panels-images.js`の`insertImage()`はplacement未指定時「幅をコマ幅に合わせ、高さは画像のアスペクト比のまま」計算するため（アスペクト比を保つcontainフィット）、生成画像がコマより相対的に扁平だと高さがコマの高さに届かず、コマ内に空白帯が残っていた。

**原因2（I2Iのみ、より深刻）**: 新設した`_getPanelImageBlob()`がコマのbboxをviewBoxに設定したSVGを`drawSvgOnCanvas()`でラスタライズする際、`preserveAspectRatio`を指定していなかったため、デフォルトの`xMidYMid meet`（アスペクト比保持の中央フィット）が適用され、**I2Iへ送信する時点で既にコマの絵が縮小され周囲に白余白ができた状態**になっていた。I2Iはこの構図をそのまま踏襲するため、結果画像も同様に小さくなりやすかった。

**修正**: ①`_getPanelImageBlob()`のSVGへ`preserveAspectRatio="none"`を追加し、キャプチャ時点のレターボックスを解消。②T2I/I2Iとも、`insertImage()`呼び出し時にコマのbboxを明示的な`placement`として渡し、生成画像をコマへストレッチ挿入するよう変更（既存のレイアウトタブ「ページ全体I2I」と同じ設計）。③`insertImage()`の`<image>`要素自体もplacement指定時にpreserveAspectRatio未指定だと箱の中でさらにアスペクト比保持フィットされてしまうため、`extraAttrs`経由で`preserveAspectRatio: 'none'`を渡し箱全面へ伸縮させるようにした（`insertImage()`本体は変更せず、既存の`extraAttrs`→`setAttribute`の仕組みをそのまま利用）。

**検証**: Kaptureで実機E2E確認済み。手書きイラスト2コマページに対しT2I・I2Iとも再実行し、両コマとも画像がコマ全面を隙間なく覆う（白余白なし）ことをスクリーンショットで確認。新規コードに起因するコンソールエラーは発生しなかった。

---

## 2026-08-04（半自動マンガ作成 Phase 3拡張: 「画像を一括生成（I2I）」を追加、v1.25.0）

T2Iのみだった「画像を一括生成」に加え、コマの現在の画像を入力にWorkflow Studio経由でI2Iバッチ生成できる「画像を一括生成（I2I）」ボタンを追加した。レイアウトタブの既存I2Iモーダル（`15-pixifx-bridge.js` `openLayoutI2IModal`）をベースにしたスクリプトタブ専用モーダルを新設し、`26-auto-comic-bridge.js`に実装。

**仕様**: 既存I2Iモーダルと異なり対象選択（選択画像/ページ全体）は無く、常に対応付け済みの全コマが対象。モーダルのPositiveプロンプト（全体指示）はコマごとの画像プロンプトと結合して送信され（`_composeI2IPositive()`、どちらか一方が空でも成立）、Negativeプロンプト（全体）・Denoiseも指定できる。「コマの画像プロンプトが空の場合はスルーする」チェックボックスで、T2Iと同じ絞り込み（画像プロンプトが空のコマをスキップ）と、チェックOFF時の「全コマ対象・モーダルの全体指示だけでも処理される」動作を切り替えられる。I2I設定（デフォルトワークフローの使用・ファイル名）はレイアウトタブのI2Iモーダル・ImageタブのSelect I2Iパネルと同じ`_i2iSettings`（`14-integrations.js`）を共有し、モーダル内に同じUIを追加した。

**実装**: 各コマの現在の画像（`panel.panelSvgContent`）をコマのbbox範囲だけラスタライズしてBlob化する新規ヘルパー`_getPanelImageBlob()`を追加。`15-pixifx-bridge.js`の`_getPageBlob`（ページ全体対象）と同じ手法（`embedFontsInSvg`→`drawSvgOnCanvas`→`canvas.toBlob`）を使い、`panelSvgContent`のルートsvgのviewBoxをコマのbboxへ差し替えるだけで、そのコマの領域だけがクロップして描画される（`panelSvgContent`がページと同じ座標系で描かれているため）。生成リクエストは既存のレイアウトタブI2Iモーダルと同じ`sendI2IRunToWorkflowStudio()`をそのまま再利用したため、**Workflow Studio側の変更は一切不要**だった。結果画像は前回修正した`_urlToDataUrl()`（blob: URL→base64データURL変換）を経由してから`insertImage()`で挿入するため、保存→再読込後もリンク切れにならない。既存画像は削除せず新しい`<image>`として追加する仕様（T2Iバッチと同じ、ユーザー承認済み）。

**検証**: Kaptureで実機E2E確認済み。手書きイラストが入った2コマページに対し、Positive「masterpiece, high quality, anime style, clean lineart」・Negative「low quality, blurry」・Denoise 0.5・スルーOFFで実行し、両コマの画像がアニメ調タッチへ変換されてレイアウトタブへ自動切替されることを確認（`href`はいずれも`data:image/png;base64,...`形式で永続化を確認）。I2I設定セクション（デフォルトワークフロー使用・ファイル名の共有読み込み・保存）も動作確認済み。新規コードに起因するコンソールエラーは発生しなかった。

**検証中に判明した既知の注意点（新規バグではない）**: ページをリロードすると`state.activePage`（レイアウトタブのアクティブページ）がクリアされ、ページ管理タブでページカードを再度開き直す必要がある（テンプレート未選択エラーの原因になりやすい）。今回のHTML変更（新規ボタン追加）はページの完全リロードが必要だったため、検証中に踏んだ。

**ドキュメント**: ヘルプ（`22-help-tab.js`、日英中3言語、「プロット」節に新規`<li>`追加）・README（3言語）を更新済み。

---

## 2026-08-04（半自動マンガ作成 Phase 3: 一括生成画像がリロード後に壊れるバグを修正、v1.24.1）

Phase 3の「画像を一括生成」で挿入した画像が、作品を保存して閉じ、再度開くとリンク切れになる不具合を修正した。

**原因**: `26-auto-comic-bridge.js`の`_handleAutoImageGenerateClick()`が、Workflow Studio側から返る生成結果URL（`genResult.url`、`_wfmReceiveGenerateRequest`が`document.getElementById("wfm-gen-result-img")?.src`から読む値）を変換せずそのまま`insertImage()`へ渡していた。Workflow Studio側`generate-tab.js`の通常のPNG/JPEG生成結果は`URL.createObjectURL(blob)`で作った`blob:`URLであり、ページ（ドキュメント）のセッション限りでしか有効でない一時参照。`insertImage()`は渡された文字列をそのままSVGの`<image href="...">`へ埋め込んで`panelSvgContent`としてIndexedDBへ永続化するため、`blob:`URLがそのまま保存され、次回ページ読込時（＝blob URLを発行した元ドキュメントが破棄された後）には解決不能になり画像が壊れて見える。

**修正**: 既存の`insertImageFromUrl()`（08-panels-images.js）が使っている「fetch→blob→`FileReader.readAsDataURL()`でbase64データURL化」という変換パターンを踏襲し、`_urlToDataUrl(url)`ヘルパーを`26-auto-comic-bridge.js`に追加。`insertImage()`へ渡す前に`genResult.url`をこれで変換することで、常に永続化可能なbase64データURLがSVGへ埋め込まれるようにした（`fetch()`は`blob:`URLにも通常のURLにも使えるため、Workflow Studio側の戻り値の種類（PNG/JPEGはblob:、SVG出力は`/wfm/gallery/image/serve?path=...`という別オリジン依存の相対URL）に関わらず統一的に対応できる）。

**Why**: [[comic-creator-workflow]]の「画像挿入は永続化可能な形式に変換してから行う」という既存の設計原則（`insertImage()`のパラメータ名`base64Data`が示す契約）が、Phase 3の新規コードパスでは守られていなかった。今後、外部（Workflow Studio等）から受け取った画像URLを`insertImage()`系関数に渡す新規コードを書く際は、必ず`insertImageFromUrl()`と同じfetch→blob→dataURL変換を経由すること。

**検証**: `node --check`で構文確認（`vm.SourceTextModule`は今回の変更が単純な関数追加のみのため省略）。ロジックの妥当性は既存の`insertImageFromUrl()`と同一パターンであることで担保。

---

## 2026-08-03（半自動マンガ作成 Phase 3: Workflow Studio連携によるLLMプロンプト下書き＋コマ単位バッチ画像生成を追加、v1.24.0）

Phase 1（対応付け基盤）・Phase 2（フキダシ自動生成）に続き、3フェーズ計画の最終フェーズを実装した。別リポジトリ`ComfyUI-Workflow-Studio`（`C:\Users\statsu-11\Desktop\now_work\comfyUI-wf-maneger\ComfyUI-Workflow-Studio`）側にも変更が及ぶ機能追加。

**Workflow Studio側の調査・実装**: `ai-tab.js`の翻訳タブが既に持つLLM接続ロジック（`callLLM(url, backend, model, prompt)`、`loadAiSettings()`＝localStorage `wfm_ai_settings`からOllama/LM Studio設定を読む、`isValidBackendUrl()`）を`export`に追加して`gallery-tab.js`から再利用できるようにした（新規実装は最小限）。画像生成については、AIチャットタブの`generateImageFromChat`が既に`window._wfmGenerateTab.generate(workflow)`（Generate UIの実行エントリポイント、`generate-tab.js`で公開済み）を使っていたため、これをそのまま踏襲。解像度指定は`comfyui-editor.js`の設定タブ「Latent Image」パネルが`analysis.latent_nodes[0]`（`EmptyLatentImage`/`EmptySD3LatentImage`ノードを検出、`{id, width, height}`を返す）を使って`workflow[id].inputs.width/height`を直接書き換えているのと同じ手法を採用した。

`gallery-tab.js`に、既存の`_wfmReceiveImageForI2I`等と同じ配置パターンで新規ブリッジ2つを追加: `_wfmReceiveLLMPromptRequest(context)`（シーン・要素・セリフ・現在のプロンプトから画像生成プロンプト案をLLMで下書き）、`_wfmReceiveGenerateRequest(prompt, width, height)`（現在ロード中のワークフローでtxt2img生成を実行、`document.getElementById("wfm-gen-result-img")?.src`から結果URLを取得——既存の`runInpaintExternal`/`runI2IExternal`と同じ「resultImgのsrcを読む」パターンを踏襲）。

**Comic Creator側の実装**: `14-integrations.js`に`requestLLMPromptFromWorkflowStudio(context)`・`requestPanelImageFromWorkflowStudio(prompt, width, height)`を追加（既存の`sendInpaintToWorkflowStudio`等と同じ`loadWfmGalleryTab()`→iframe越し呼び出しパターン）。`21a-script-manga.js`の「L」ボタンに、シーン・要素・セリフ・現在の画像プロンプトをコンテキストとして渡すハンドラを配線（実行中は「...」表示、成功時は画像プロンプト欄を上書き）。`auto-comic-core.js`に`pickSdxlResolution(aspectRatio)`を追加——sloppy-comicの`sdxl_ratio_to_res`と同じ考え方で、コマのbboxアスペクト比に対数スケールで最も近いSDXL標準解像度（横長/やや横長/正方形/やや縦長/縦長の5段階）を選ぶ。`26-auto-comic-bridge.js`に「画像を一括生成」ボタンを追加。対応付け済みの各コマ（画像プロンプトが空でないもの）について、コマのbboxから解像度を決定→Workflow Studioへ生成リクエスト→結果を`new Image()`で読み込んで実寸を取得→`state.selectedPanelId`を対象コマへ切り替えて`insertImage`で挿入、を順次実行する（sloppy-comicの逐次forループと同じ設計）。一部のコマが失敗しても成功分は反映し、完了後はレイアウトタブへ自動切替。

**回帰バグ発見: `node --check`では検出できないESM構文エラー**: 実装完了後にKaptureで実機確認したところ、ページ全体が`SyntaxError: Unexpected identifier 'shape'`という謎のエラーで機能停止する事態が発生。`node --check`は全ファイルで問題なしと報告していたため原因特定に時間を要したが、`node --experimental-vm-modules`の`vm.SourceTextModule`（実際のESMパーサー）で全ファイルを検査したところ、`22-help-tab.js`のPhase 2で追加した英語ヘルプ文言内に`balloons' shape`という**エスケープし忘れたアポストロフィ**（文字列全体がシングルクォート`'...'`で囲まれているため、`balloons'`の`'`がそこで文字列を閉じてしまい、直後の`shape`が裸のJS識別子としてパースされて構文エラーになっていた）を発見・修正した。`22-help-tab.js`は`01-state.js`から`initHelpTab`としてimportされており、ほぼ全モジュールがimportグラフ経由でこの1ファイルの構文エラーに巻き込まれ、アプリ全体が起動不能になっていた。**教訓**: `node --check`は大きなESMファイルの構文エラーを見逃すことがある（今回のケースでは誤ってOKと報告し続けた）。今後、特に長い文字列リテラルを含むファイル（`22-help-tab.js`等のヘルプ文言）を編集した際は、`node --experimental-vm-modules -e "new (require('vm').SourceTextModule)(src)"`のような実際のESMパーサーでの検証か、必ずブラウザでの実機確認を行うこと。

**検証**: Kaptureで実機E2E確認済み。「L」ボタン: Workflow Studio未接続時は`Failed to fetch`、Ollama接続済みだが応答が空の場合は専用エラーメッセージを表示することを確認（後者はモデル自体が複雑なプロンプトに対して空応答を返す品質上の問題であり、ブリッジ実装は正しく機能している）。「画像を一括生成」ボタン: Workflow StudioのGenerate UIにt2iワークフローを読み込んだ状態で実行し、「1件の画像を生成しました」の成功メッセージ、レイアウトタブへの自動切替、対象コマへの正しい画像挿入（コマのアスペクト比に応じた小さいタイトルコマにも適切なサイズで挿入）を確認。全操作を通じて新規コードに起因するコンソールエラーは発生しなかった（前述の22-help-tab.js修正後）。

**ドキュメント**: ヘルプ（`22-help-tab.js`、日英中3言語）・README（3言語）・PLAN_backlog.md（半自動マンガ作成の未着手項目を削除、3フェーズ全完了）を更新済み。

---

## 2026-08-03（半自動マンガ作成 Phase 2: スクリプトのセリフからフキダシを自動生成する機能を追加、v1.23.0）

Phase 1（スクリプト⇄コマ対応付け基盤）に続き、対応付け結果をもとに各コマへフキダシを自動生成する機能を実装した。3フェーズ構成の第二弾（Phase 3: Workflow Studio連携バッチ画像生成は未着手）。

**実装方針**: 既存のフキダシ生成ロジック（`09c-balloon-handles.js`の`insertSmartBalloonTemplate`、h2挿入ボタンの手動挿入用関数）とテキスト内包ロジック（`09f-bubble-text.js`の`applyBubbleTextToShape`、内包テキストモーダルの適用用関数）が、調査の結果ほぼそのままプログラム的呼び出しに転用できることが判明したため、新規実装は最小限に抑えた。`insertSmartBalloonTemplate`から、フキダシ`<g>`要素の生成・dataset設定部分を`_buildBalloonShapeEl(type, cx, cy, rx, ry)`として抽出し、これを使う新規エクスポート関数`createBalloonAtPosition(overlaySvgEl, type, cx, cy, rx, ry)`を追加（`state.selectedPanelId`を対象コマへ設定した状態で呼ぶ規約は`insertImage`と同じ）。テキストの流し込みは`applyBubbleTextToShape`をそのまま呼ぶだけで済み、`setBalloonText`のような新規関数は不要だった。

**配置ロジック**: `26-auto-comic-bridge.js`に「フキダシを自動生成」ボタンを追加し、Phase 1と同じ`mapScriptPageToPanels`で対応付けを行った上で、セリフ（空文字は除く）が入力されている各コマについて、コマのbbox内を上から均等分割した位置に角丸矩形フキダシ（h2タイプ`rect`固定）をセリフ件数分生成する。フォントサイズはコマの分割サイズに収まる範囲で、レイアウトタブの現在のフキダシ既定値（`state.balloon.fontSize`）を上限に自動調整する。生成完了後は自動的にレイアウトタブへ切り替わる。スクリプト側でのフキダシ形状指定（角丸/思考/バクダン/雲等）はPhase 2の計画通り見送り、固定形状のみ対応。

**回帰修正**: 前回のメディア種別追加（`semiAutoManga`）作業時に`26-auto-comic-bridge.js`の`mediaType !== 'manga'`という古いガード条件を更新し忘れており、「半自動マンガ」メディアで「このページをレイアウトに流し込む」ボタンが機能しない状態になっていたバグを本作業で発見・修正した（`_scriptIsMangaLikeType()`を使うよう修正）。

**検証**: Kaptureで実機E2E確認済み。メディア種別「半自動マンガ」の作品（4コマ、うち3コマにセリフ入力・1コマは空欄）とテンプレート適用済みページ（実際は10パネル構成）で「フキダシを自動生成」を実行し、「3個のフキダシを生成しました」のアラート・レイアウトタブへの自動切替を確認。生成された3個のフキダシが正しいコマ（panel_2/3/4、空欄だったpanel_1はスキップ）に、正しいセリフ本文（キャラクター名は含めない設計）で生成されていることをDOM調査で確認。ページリロード後もIndexedDB上の`panelSvgContent`にフキダシが永続化されていることを確認。新規コードに起因するコンソールエラーは発生しなかった。

**ドキュメント**: ヘルプ（`22-help-tab.js`、日英中3言語）・README（3言語）を更新済み。

---

## 2026-08-03（半自動マンガ作成 Phase 1: スクリプトタブにメディア種別サブタブ基盤（漫画/半自動マンガ/小説/脚本）＋スクリプト⇄コマ対応付け機能を追加、v1.22.0）

参考実装 `ComfyUI_sloppy-comic`（台本内の`{タグ}`埋め込みでコマ単位の画像プロンプト・セリフを切り出し、Masonry風レイアウトへ自動合成するComfyUIカスタムノード）を踏まえ、Eagle Comic Creator版の「半自動マンガ作成」機能の実装を開始した。3フェーズ構成（Phase 1: スクリプト⇄コマ対応付け基盤／Phase 2: フキダシ自動配置／Phase 3: Workflow Studio連携バッチ画像生成）の第一弾。

**ユーザー要望によるスコープ変更**: 当初案ではコマ割りの自動生成（グリッド計算等）を検討していたが、ユーザーの指示により「ユーザーが事前にレイアウトタブで選択・適用した既存テンプレートに対し、コマ1から**パネル番号順**に処理する」方式に変更した。パネル番号（`06c-template-wizard.js`がテンプレートSVGの`polygon id="panel_N"`から採番し`state.activePage.panels[].number`として保持）をそのまま処理順として利用するため、新規のレイアウトアルゴリズムは不要になった。

**スクリプトタブのメディア種別サブタブ基盤（ユーザー要望による追加スコープ）**: 「スクリプトタブの機能拡張も見据え、メディア（漫画の他、小説・脚本台本等）に応じた画面構成サブタブにしたい」という要望を受け、今回のコマ対応付け機能に先立ってこの土台を実装した。データ構造を`{ name, synopsis, mediaType: 'manga'|'semiAutoManga'|'novel'|'screenplay', elements, manga: {...}, semiAutoManga: {...}, novel: null, screenplay: null }`に拡張し、旧形式（`mediaType`なし、`pages`が直下）のデータは読込時に自動的に`mediaType:'manga'`へ移行・ラップする（`_scriptNormalizeData`）。メディア種別は作品ごとに固定で、新規作成時のみ選択可能、既存作品読込後はセレクトが`disabled`になり変更不可。

続けてユーザーから「半自動マンガ作成用にメディアを追加してほしい（画面構成を半自動向けに変更対応するため）、LLM下書きボタンは両方のメディアで"L"表記にしてほしい」という要望を受け、4つ目のメディア種別「半自動マンガ」（`semiAutoManga`）を追加した。「漫画」「半自動マンガ」は同じコマ割り編集画面（プロット/プレビュー横/プレビュー縦）を共有しつつ、データは`data.manga`/`data.semiAutoManga`として作品ごとに完全に独立させる設計（最小差分案をユーザーが採用）。`21a-script-manga.js`に`_scriptMangaData()`ヘルパーを追加し、現在の`mediaType`に応じてどちらの名前空間を読み書きするかを解決するようにした上で、既存のハードコードされた`_script.data.manga`参照・`mediaType !== 'manga'`ガードをすべてこのヘルパー経由に置き換えた（`_scriptIsMangaLikeType()`を21-script-tab.js側に追加しエクスポート）。「小説」「脚本」は引き続き画面構成が異なる将来実装の予約枠のまま。現時点で編集画面を実装しているのは「漫画」「半自動マンガ」の2種で、他のメディア種別を選択するとプロット関連サブタブに「この機能は開発中です」のプレースホルダーが表示される（要素サブタブはメディア種別非依存の共通機能として存続）。

既存の`04a`/`04b`・`09a`〜`09f`と同じ「英数字サフィックスでの機能単位分割」慣習に沿い、`21-script-tab.js`を作品名・あらすじ・要素・保存読込・メディア種別切替を担う共通層に再編し、漫画/半自動マンガ共通のプロット編集ロジック（ページ／コマ／セリフ管理、旧`_scriptRenderPage`等）を新規`21a-script-manga.js`へ切り出した。両ファイルは相互import（循環）だが、循環先シンボルの参照はすべて関数内部に閉じているため安全（既存の07⇄08パターンを踏襲）。`09e-text-tool.js`・`09f-bubble-text.js`が使っていた`_scriptGetSelectedDialogue`は`_scriptMangaGetSelectedDialogue`として21aへ移動し、import元を更新した。

**画像プロンプト欄**: コマワリテーブルに「画像プロンプト」列を追加（コマ単位、`panel.imagePrompt`）。プロンプト下書きボタンも設置したが、Workflow Studio連携によるプロンプト自動下書きはPhase 3で実装予定のため、現時点ではクリックすると未実装アラートを表示するのみ。ボタン表記はユーザー指示により当初の「LLMで下書き」から3Dポーズ側の「RC」ボタンと同様の固定・非翻訳な短縮表記「**L**」へ変更した（ツールチップ側で説明文を維持）。

**コマ対応付け機能**: 新規`auto-comic-core.js`（DOM非依存）に`mapScriptPageToPanels(scriptPage, panels)`を実装。`state.activePage.panels`を`number`昇順ソートし、表示中のスクリプトページのコマと先頭から対応付ける。数が一致しない場合は警告を返し、少ない方の件数までのみ対応付ける。新規`26-auto-comic-bridge.js`（DOM連携層、`01-state.js`の`switchTab`から`'project'`タブ切替時に`initProjectTab()`と並んで初期化）がスクリプトタブの「このページをレイアウトに流し込む」ボタンから呼び出し、対応付け結果（コマ番号ごとのセリフ件数）と件数不一致警告を一覧表示する。この時点ではフキダシ・画像はまだ生成しない（Phase 2/3で本機能を拡張する）。

**検証**: Kaptureで実機E2E確認済み。スクリプトタブでメディア種別を「漫画→小説→漫画」と切り替えてプレースホルダー表示・復元を確認、要素タブがメディア種別非依存で動作することを確認、本機能追加前に保存された既存作品（旧形式データ）を読み込んで自動移行が正しく行われることを確認（コマワリ内容がそのまま復元）、画像プロンプト欄への入力とオートセーブを確認、下書きボタンの未実装アラートを確認、レイアウトタブでページ未選択時の警告アラートを確認、テンプレート適用済みページ（6コマ、サブコマ含む）とスクリプト（4コマ）で「流し込み」を実行し、件数不一致警告と「先頭4コマ分のみ対応付け」の正しい挙動、対応付け結果一覧の表示を確認。追加で「半自動マンガ」を新規作成し、同じコマ割り編集画面（画像プロンプト列・「L」ボタン表記）が表示されること、保存後に`data.semiAutoManga`名前空間へ独立して保存されること（`data.manga`とは別データ）、保存後はメディア種別セレクトが`disabled`になること、既存の「漫画」作品を読み込んで画像プロンプト・ボタン表記ともに正常表示されること（回帰なし）を確認。全操作を通じて新規コードに起因するコンソールエラーは発生しなかった。

**ドキュメント**: ヘルプ（`22-help-tab.js`、日本語`_HELP_DATA`＋英中`_HELP_I18N`の3言語）・README（3言語）を更新済み。

---

## 2026-08-03（3Dテキストの対応フォント形式拡張(TTC対応)・Imageタブのツール未初期化時「coming soon」誤表示を修正）

**TTC対応の背景**: ユーザーから「読み込めないフォントが結構ある」と報告を受けて調査したところ、原因は`opentype.js`がTrueType Collection（`.ttc`、署名`ttcf`）形式を一切パースできない仕様だと判明。游ゴシック・游明朝・メイリオ・MSゴシック・MS明朝・BIZ UD系など、Windows標準のCJKシステムフォントの多くがこの形式で配布されている。

**実装**: `text3d-font-loader.js`に`_extractFaceFromTTC()`を追加。TTCヘッダから先頭書体のテーブルディレクトリと各テーブルの実データを読み取り、オフセットを0起点に振り直して単体sfntバイナリへ再構成してから`opentype.parse()`に渡す（TTC仕様上、各テーブルの実データはファイル内の絶対オフセットで指されているため、ディレクトリと実データをコピーし直せば単体フォントとして正しく解釈できる）。複数書体入りのファイルは常に先頭書体を採用する（太さ/イタリック別選択は本用途に対して過剰と判断し非対応）。

**検証**: Node.js上でWindows実機の`msgothic.ttc`・`meiryo.ttc`・`YuGothM.ttc`・`BIZ-UDGothicR.ttc`の4フォントを実際に`opentype.module.js`でパースし、修正前は全て`Unsupported OpenType signature ttcf`で失敗、修正後は全て「あ」のグリフ取得に成功することを確認済み（ブラウザでの実機E2Eは未検証）。

**coming soon誤表示の背景**: ユーザー報告「Imageタブでキャンバス作成前に3DTextツールを選択すると3D Text: coming soonのままなので直してほしい」を受けて調査。

**原因**: `image-tab.js`の`this._text3dTool`（および`_drawTool`/`_textTool`/`_shapeTool`等）はキャンバス作成時の`_initCanvases()`内でのみ生成される。`_renderToolOptions()`は各ツールIDごとに`toolId === "text3d" && this._text3dTool`という形でツールインスタンスの存在を前提条件にしており、キャンバス未作成の状態でツールボタンを押すと（`TOOL_DEFS`の`ready:true`自体は素通りするため）この条件を満たせず、フォールバックの「coming soon」（未実装機能という誤解を招く文言）が表示されていた。これはtext3dに限らず全ツール共通の構造的な問題だった。

**修正**: フォールバック分岐で`this._layerMgr`（キャンバス未作成時はnull）の有無を判定し、キャンバス未作成時は「先に画像を作成または読み込んでください」という案内メッセージ（`image.toolNeedsCanvas`、ja/en/zh追加）に差し替えた。キャンバス作成後は既存の`_setActiveTool("select")`呼び出しでパネルが正しく再描画されるため、ツールを選び直せば正常に動作する。

**検証**: `node --check`で構文確認のみ（ブラウザでの実機E2Eは未検証）。

**ドキュメント**: ヘルプ（`22-help-tab.js`、日本語`_HELP_DATA`＋英中`_HELP_I18N`の3言語、見出し数・順序を相互比較して確認）・README（3言語）を更新済み。

---

## 2026-08-03（3Dテキストにライト・マテリアル設定モーダルを追加、プレビュー品質改善とアンチエイリアス強化トグルを実装）

ユーザー依頼「3Dテキストにもライト、マテリアル設定のモーダルを追加したい（ズーム操作切り替え設定も3Dポーズと共通で）」を受けて実装。

**実装**: 新規`text3d-settings-modal.js`を、3Dポーズ側`light_editor.js`のプレビュー埋め込み手法（実際に描画中のcanvasを内包するDOM要素をモーダル内のプレビュー枠へ一時移動し、`transform:scale()`で表示）を範に軽量実装。マテリアル（色・標準/トゥーン切替・金属/粗さまたは陰色/階調）、ライト（Ambient/Key/Fillの3灯固定、各色・強度・位置）、カメラ（RCボタン・ズーム操作モード）をまとめ、常時表示だったツールバーの対応コントロールは撤去した。ズーム操作モード（ホイール/Ctrl+右ドラッグ）はlocalStorageキー`vrmPoseEditor_zoomMode`を3Dポーズ側と共有し、どちらで変更しても両方に反映される。`text3d-core.js`にライトAPI（`getLights`/`setLightColor`/`setLightIntensity`/`setLightPosition`）とズームモードAPIを追加。Imageタブ側（`Text3DTool.js`）はモーダルの変更が`this.xxx`のツール内部状態と乖離しないよう、マテリアル系セッターを`t3.setXxx()`経由でルーティングするアダプタ越しにモーダルへ渡す設計にした。

**プレビュー品質の改善とアンチエイリアス強化トグル**: ユーザーから「プレビューの拡大表示が粗い、アンチエイリアスのON/OFF切替が欲しい」と指摘を受けて追加調査・実装。**原因**: `transform:scale()`でプレビュー枠に合わせて拡大表示する際、レンダラー自体の解像度は据え置きのままだったため、拡大するほど輪郭が粗く見えていた（3Dポーズのライトエディターも同じ手法のため同様の問題を抱えていた）。**対策1（常時）**: 拡大率(`scale > 1`)に応じて実表示サイズ×devicePixelRatioでレンダラーを都度リサイズし、モーダルを閉じる際は元のサイズへ戻す。**対策2（ON/OFFトグル）**: `renderer.setPixelRatio()`を通常の2倍（上限4倍）に底上げするスーパーサンプリングを、`text3d-core.js`・`pose_editor_core.js`（`comfyui-vrm-pose-editor`ノード側）双方に追加し、localStorageキー`vrmPoseEditor_superSample`を共有。設定モーダル／ライトエディターそれぞれにトグルボタンを追加した。

**モーダルが閉じられなくなる不具合の修正**: 上記プレビュー埋め込み中に「モーダル操作中にエラーが出てフォントが表示されなくなり、モーダルを閉じられない」という報告を受けて調査。`cleanup()`内の`origParent.appendChild(...)`が、何らかの理由で`cvsWrapper`の元の親要素が失われている場合に`origParent`がnullとなり例外を投げ、`overlay.remove()`まで到達せずモーダルがそのまま画面に残り続けるバグだった。`cleanup()`全体を`try/catch`で保護し、`origParent`の接続状態を確認した上で復元、失敗時も必ずモーダル自体は閉じるよう修正。同一パターンをコピー元である`light_editor.js`側にも予防的に適用した。あわせて、モーダルを開く際に`document.activeElement?.blur()`を追加し、背後のテキスト入力/フォント選択にフォーカスが残ったまま操作がすり抜ける経路も遮断した。

**カメラリセットボタン追加・表記統一**: ユーザー依頼によりモーダルにも「RC」ボタン（`editor.resetCamera()`）を追加し、既存のツールバー上の2つのカメラリセットボタン（レイアウトタブ・Imageタブ）を3Dポーズ（`pose3d-reset-camera-btn`）と同じ「RC」固定表記（非翻訳）に統一した。

**検証**: 全ファイル`node --check`による構文チェックのみ。プレビューの拡大時の見た目改善・トグルのON/OFF挙動・モーダル開閉時のレンダリング解像度の復元・カメラリセットの動作は、ブラウザでの実機E2Eが未検証。

**ドキュメント**: ヘルプ（日英中3言語）・README（3言語）を、下記MToon/カメラ操作改善エントリと合わせて一括で更新済み。

---

## 2026-08-03（3DテキストにMToonマテリアルを追加、カメラ操作を3Dポーズに揃えて改善）

**MToon追加**: ユーザー依頼「3Dテキストにトゥーンシェーダー(MToon)を追加したい」を受けて実装。`comfyui-vrm-pose-editor`ノードが配信する`vendor/three-vrm.module.js`から`MToonMaterial`（GLTFロード無しで単体newできる標準クラス）を動的importし、3Dテキストのマテリアル種別として「標準(MeshStandardMaterial)」と「トゥーン(MToon)」を切替可能にした（`text3d-core.js`の`_createMaterial()`で分岐）。レイアウトタブ・Imageタブ双方のUIにトグルボタンと陰色/階調設定を追加。

**カメラ操作の改善**: 続けてユーザーから「3Dポーズのようにカメラ操作を行いたい（ズームも可能に、回転スライダーをなくす）」と依頼を受けて対応。**原因調査**: OrbitControlsのズーム自体は元々有効だったが、テキストや文字サイズを変更するたびに`_fitCameraToText()`が呼ばれてカメラ位置を強制的に上書きしており、ユーザーがホイールでズームしてもすぐにリセットされる状態だった。**修正**: `orbit`の`start`イベントでユーザーの手動操作を検知するフラグ(`userAdjustedCamera`)を導入し、一度でも手動操作した後は編集のたびの自動フィットを止めるようにした（「カメラ位置リセット」ボタンで自動フィットへ復帰）。テキスト自体のX/Y/Z回転機能（`params.rotation`/`setRotation`/UIスライダー）はカメラのオービット操作に完全移管する形で削除した。

**検証**: 全ファイル`node --check`による構文チェックのみ。MToonの実際の見た目・カメラのドラッグ回転/ホイールズームの挙動は、ブラウザでの実機E2Eが未検証。

**ドキュメント**: 上記2エントリと合わせ、ヘルプ（`22-help-tab.js`、日本語`_HELP_DATA`＋英中`_HELP_I18N`を見出し数・順序を相互比較しながら更新）・README（3言語、機能一覧・依存関係テーブル・Acknowledgementsを更新）を一括で反映済み。

---

## 2026-08-01（スクリプトタブ経由でアセットパネルの「A」「F」タブが非表示のまま戻れなくなる不具合を修正）

ユーザー報告「レイアウトタブ、Imageタブでアセットパネルタブを選ぶと初期のタブを選択することができないAタブがあった」を受けて調査・修正。

**原因**: `01-state.js`の`switchTab`関数で、スクリプトタブ（「S」）に切り替える際、アセットパネルの「A（アセット）」「P（ページ）」「T（テンプレート）」「F（フォント）」「I（画像プロジェクト）」の全ボタンを`style.display = 'none'`にしていたが、他のタブへ戻る際に「A」「F」のdisplayを`''`（表示）へ戻す処理が漏れていた（「P」「T」「I」は別の条件分岐で個別に制御されていたため無事だった）。そのため一度でもスクリプトタブを開くと、以後レイアウトタブ・Imageタブに戻っても「A」「F」のボタン自体が画面に現れなくなる（`active`クラスは付くが`display:none`のまま）。`git log -S`で調査した結果、このロジックはESモジュール化とは無関係で、v1.0の初回リリース（2026-07-16）から存在していた既存バグと判明した。

**修正**: `switchTab`のスクリプトタブ以外の分岐で、`assets`/`fonts`ボタンのdisplayを明示的に`''`へリセットするようにした。

**検証**: Kaptureで実機確認。レイアウトタブ→スクリプトタブ→レイアウトタブ、ページタブ→スクリプトタブ→レイアウトタブ、Imageタブでも「A」「F」「I」が正しく表示・非表示制御されることを確認済み。

---

## 2026-08-01（フキダシ「テキストを内包」に主軸整列と独立した上下/左右の配置調整を追加）

ユーザー依頼「レイアウトタブのフキダシのテキストを内包に横書き、縦書きそれぞれ上下、左右、中央にしたい（延長追加で重ねて配置した場合のテキストの位置調整が必要なため）」を受けて実装。

**背景**: フキダシ「テキストを内包」モーダルには既に「文字寄せ」（横書き=左/中央/右、縦書き=上/中央/下）があったが、これは1軸（主軸）のみで、もう一方の軸（横書き=上下、縦書き=左右）は常に中央固定だった。延長フキダシ機能で複数のフキダシがネックで繋がって重なって配置されるケースで、内包テキスト同士が重なりを避けられるよう、隅へ寄せる調整ができないという問題があった。

**実装**: `09f-bubble-text.js`に、既存の`data-text-align`（主軸）とは独立した新しいデータ属性`data-text-valign`（副軸、値は`top`/`center`/`bottom`で統一）を追加。横書き時はそのまま垂直方向（上/中央/下）として使い、縦書き時はラベルを「左/中央/右」に読み替えて水平方向として使う（`top`→左端寄せ、`bottom`→右端寄せ）。既存の`textAlign`が横書き=水平・縦書き=垂直の値をボタンの`data-align="left"/"right"`固定値のままラベルだけ動的に切り替える設計だったため、同じパターンを踏襲した。`_bubbleTextRenderText`のレンダリング計算式は、列群/テキストブロックの端をエリアの端（`padding`を引いた内側）に合わせる形で導出（例: 横書き上寄せは`startY = area.cy - area.ry + padding + lineHeight * 0.8`）。モーダルUIには既存の「文字寄せ」ボタン群の下に、同じ構造の新しいボタン群を追加し、`isVertical`切り替え時に両方のラベルを同期させる（`syncAlignLabels`に対応する`syncValignLabels`を新設）。

**後方互換性**: 新規データ属性のため、既存の内包テキストは全て`textValign`未設定→デフォルト`'center'`（従来通りの中央配置）になり、見た目は変わらない。

**検証**: Kaptureで実機確認。既存フキダシのテキストを内包モーダルを開き、横書き時に「上下」ボタン群が正しく表示されること、「上」を選んで更新するとテキストが円の上部に移動すること、縦書きに切り替えるとボタンラベルが「左右」に切り替わること、「左」→「右」の切り替えでテキストが左右に移動することを確認。コンソールエラーはゼロ件。ヘルプ（`22-help-tab.js`、日英中3言語）・README（3言語）を更新済み。

**調整（ユーザーフィードバック）**: 「フキダシの端は半行（文字サイズの半分）程度開けるのが見た目のバランスがいい。端に寄せすぎない」という指摘を受けて修正。**原因**: 楕円形状（`kind === 'oval'`、`normal`/`thought`/`bomb`/`cloudpuffy`/`cloudwavy`/`textbox-oval`が該当）は対角線方向の実効半径が`rx`/`ry`そのものより小さく（内接矩形相当の`rx/√2`, `ry/√2`）、折り返し判定用の`availWidth`/`availHeight`は既にこの係数`k`で補正していたが、寄せ位置の計算（`textX`/`textY`/`startX`/`startY`）は`area.rx`/`area.ry`をそのまま使っており`k`を反映していなかった。そのため上下左右いずれかに寄せると、楕円の先端付近ではテキストが輪郭のすぐ近くまで接近してしまっていた（矩形形状は元々`k=1`のため影響なし）。**修正**: `hRange = area.rx / k`・`vRange = area.ry / k`を導入し、主軸（align）・副軸（valign）の位置決め計算を全てこれらの値基準に統一。これにより楕円のどの方向に寄せても、輪郭からpadding（`fontSizeSvg * 0.5`＝半行）分のマージンが確保されるようになった。**検証**: Kaptureで、楕円フキダシに新規テキストを内包し、上/下/左寄せ・縦書きでの下寄せ×右寄せの組み合わせで、輪郭とテキストの間に適切な余白が保たれることを確認。コンソールエラーはゼロ件。

---

## 2026-08-01（ESモジュール化 完全後始末: グループ間の`window.xxx`ブリッジを全て正式import化）

`01-state.js`のESM化完了（本DEVLOG直下エントリ）を受け、G6〜G9で「残課題」として積み残していた、グループ間の既存`window.xxx`ブリッジ経由・暗黙のグローバル参照の呼び出し箇所を全て正式`import`に置き換えた。これにより、プロジェクト内の非module scriptが1つも存在しない状態（プロジェクト完了）に加え、`window.xxx`ブリッジ自体もゼロ件になった（vendorのUMDライブラリ`jspdf`/`jszip`が公開するグローバルを除く）。

**規模**: 対象は`static/js/main/`配下16ファイル＋`image-tab.js`＋`i18n.js`＋`pixifx.js`の計19ファイル。203件のシンボル参照（symbol-file ペア、ユニークシンボル数122）にimportを追加し、実import化で死んだ分岐になった`typeof X === 'function'`存在確認ガードを26箇所削除し、不要になった`window.X = X`ブリッジ定義を120件削除した。

**手法（機械化した手順）**:
1. 全JSファイルから`export {...}`/`export function`/`export const`を機械抽出し、symbol→定義ファイルのマップを生成。
2. 各ファイルのソースからコメント（`//`・`/* */`）と文字列・テンプレートリテラルの中身を空白に置換した「ノイズ除去版」を作り、そこから未解決識別子（呼び出し・値参照どちらも単語境界一致で検出、import済み・自己定義のいずれでもないもの）を抽出。ローカルスコープの`const/let/var`宣言・関数引数・アロー関数引数・`catch`節の変数もすべて自己定義として扱い、シャドーイングによる誤検出を防いだ。
3. 定義元ファイルごとにグルーピングしたimport文を、既存import文群の直後に自動挿入するスクリプトで一括追加。
4. 追加により`typeof X === 'function'`ガードが死んだ分岐になった箇所を全箇所目視で精査し、意味のある条件分岐（`isOverlay &&`等）と単純な存在確認を区別しながら手動で削除。
5. 対象シンボルが「定義元ファイル自身のブリッジ定義行」以外から`window.X`として参照されていないかを機械チェックした上で、`window.X = X;`行を削除。

**誤検出との戦い（重要な教訓）**: 初回の未解決識別子抽出では、コメント除去をしていなかったため34ファイルが該当と過検出になった。コメント除去を追加すると21ファイルまで絞れたが、それでも`t`という1文字シンボルが`image-tab/DrawTool.js`等で大量に誤検出された。原因は`const t = i / steps;`（線形補間パラメータ）というローカル変数がi18n.jsの`t()`関数と同名なだけの偶然の一致で、トップレベル宣言だけを自己定義として扱う簡易チェックではローカルスコープの変数宣言を見逃していたため。関数内部の`const/let/var`宣言もすべて自己定義として拾うよう検出ロジックを強化し、最終的に18ファイル・203ペアまで絞り込めた。**短い/一般的な名前のシンボル（`t`, `db`等）をimport候補として機械抽出する際は、トップレベル限定ではなく関数内ローカル宣言によるシャドーイングも必ず考慮すること。**

**着手前チェック4点セットの適用結果**: (1)トップレベル即時参照チェックは2件ヒットしたが両方コメント内の偶然の文字列一致（`04a-mask-core.js`の`_maskState`定義直後コメント「一度だけpushHistory」等）で実害なし。(4)セッターパターン（別ファイルからの直接再代入）チェックは対象シンボル122件中ゼロ件で、セッター新設は不要だった。

**検証**: Kaptureで実機確認。ページリロード後の初期化完了、コマ選択（`selectPanel`）、フキダシ挿入・レイヤーパネル反映（`h2InsertBtn`→`renderHandles`/`renderLayerPanel`）、「テキストを内包」モーダルでのテキスト作成・保存（`openBubbleTextModal`→`savePanelSvg`→実際にフキダシへテキストが反映されることを確認）、マスクレイヤー追加、ドローツールでの矩形描画（`initGroupManipulation`系）、サブコマ分割（`initSubPanelManipulation`）、フォント管理タブ、Imageタブでの新規キャンバス作成→「レイアウトに戻る」（`_saveToLayout`→`insertImage`/`switchTab`/`state.activeWork`）を一通り確認し、コンソールエラーはゼロ件だった（「テキストを内包」初回操作時に原因不明の`Uncaught (in promise)`エラーが1件出たが、2回目以降は再現せず、機能自体は正常に動作したため今回の変更との関連は薄いと判断）。検証で作成したテストフキダシ・矩形・サブコマ・画像は全て「元に戻す」（undo）で作業前の状態に復元した。

**残る非moduleコード**: `vendor/jspdf.umd.min.js`・`vendor/jszip.min.js`（UMD形式の外部ライブラリ、`window.jsPDF`/`window.JSZip`等を公開）のみ。これらはESM化対象外（サードパーティ配布物）として意図的に維持する。

---

## 2026-08-01（ESモジュール化 最終弾: `01-state.js` を type="module" 化、段階的移行プロジェクト完了）

G0〜G9（本DEVLOG直下エントリ参照）で`01-state.js`を除く`static/js/main/`配下の全ファイルがESM化済みだったところに、初期化オーケストレーター`01-state.js`（状態管理+初期化+タブ管理、340行）を最後にESM化。これで`static/js/`配下28ファイル・約29,000行の段階的ESM化プロジェクトが完了した。

**`state`/`switchTab`という2つの中核シンボルが35ファイル超から参照されていた**: `01-state.js`は非moduleだった間、`state`オブジェクトと`switchTab()`関数を暗黙のグローバル参照として`static/js/main/`配下のほぼ全ファイル・`image-tab.js`・`nanobanana.js`から素の識別子で参照されていた。機械的に依存関係を洗い出した結果、`state`は35ファイル、`switchTab`は7ファイル（`image-tab.js`含む）から実使用されていることを確認し、全対象ファイルへ`import { state, switchTab } from './01-state.js';`を追加した。追加は自動化スクリプトで一括実施し、事前に`state.`のプロパティアクセスかどうか（ローカル変数やコメント内の"state"との誤混同を除外）・関数引数等によるシャドーイングの有無を機械チェックした上で対象を確定した（`i18n.js`のコメント内`state.`、`pixifx.js`のトグルボタン内部変数`state`、`image-tab/FillTool.js`・`image-tab/ShapeTool.js`のコメント`internal state`は誤検出として除外）。

**`image-tab.js`の3箇所の暫定ブリッジを正式importへ置き換え**: `window._ccGetActiveWork?.()`（2箇所、作業中の作品情報取得）を`state.activeWork`に、`window.switchTab(...)`（2箇所）を`switchTab(...)`に置き換え、`typeof window.switchTab !== "function"`という存在確認ガードも実importで保証されるため削除した。`window.initImageTab = () => imageTab.init();`は`export function initImageTab()`に変更し、`01-state.js`側で`import { initImageTab } from '../image-tab.js';`として正式import化。これに伴い`01-state.js`が持っていた`window._ccGetActiveWork`ブリッジ自体と、`00-db.js`の`window.openDB`/`window._setDb`ブリッジ（`01-state.js`以外に参照元が無かった）を撤去した。

**着手前チェック4点セットの結果**: (1)トップレベル即時参照チェックでは`i18n.js`と`22-help-tab.js`の英語ヘルプ文字列内に"...state."という単語が偶然含まれていただけの誤検出2件のみで実害なし。(2)ヘッダコメント非網羅チェックでは`initI18nSettings`のヘッダコメント漏れを発見したが外部から参照されていないため実害なし（ヘッダコメントは更新済み）。(3)未解決識別子検出では`01-state.js`自身の依存関数（30個超、各ファイルの定義元をexportマップとの突き合わせで機械特定）に漏れなし。(4)セッターパターンチェックでは`state`/`switchTab`いずれも変数自体への再代入は無く（`pixifx.js`の`state = !state`はローカル変数、無関係）、セッター新設は不要だった。

**残課題**: G6〜G9で積み残されていた、他グループ間の既存`window.xxx`ブリッジ経由呼び出し（例: `image-tab.js`が`window.pixiFxOpen`/`window.saveToEagle`/`window.pushHistory`等を、`19-font-manager.js`関連ファイルが`_fontMgr`系をブリッジ経由で呼ぶ等）は今回のスコープ外として現状維持。これらは呼び出し先が全てESM化済みのため、低リスクな追加清掃としていつでも正式import化できる（`PLAN_backlog.md`に記録）。

**検証**: Kaptureで実機確認。ページリロード後の初期化完了（コンソールエラーなし、`Plugin Initializing...`→`DB connected`→`NanobananaManager Initializing...`→`Plugin Initialized`の順で完走）、動的importで取得した`01-state.js`の`state`/`switchTab`が実際にページ内で使われているモジュールインスタンスと一致すること（`state.activeWork`に実データが入っていることを確認）、レイアウト/Image/フォント/設定/スクリプト/ヘルプ/ページ(output)の全主要タブへの`switchTab`遷移、Imageタブの「レイアウトに戻る」ボタン（`switchTab`+`state.activeWork`経由）操作、をいずれもコンソールエラーなしで確認。検証後はページタブに戻して元の作業状態に復元済み。

---

## 2026-08-01（ESモジュール化 第10弾 G9: その他タブを type="module" 化、main/以下28ファイルのESM化が完了）

G0〜G8（本DEVLOG直下エントリ参照）に続く段階的ESM化の第10弾かつ最終コンテンツグループ。対象は `21-script-tab.js`（スクリプトタブ、567行）・`22-help-tab.js`（ヘルプタブ、996行）・`23-pose3d-bridge.js`（3Dポーズエディタ、575行）・`24-sub-panels.js`（サブコマ機能、936行）の4ファイル（計約3,070行）。これで`01-state.js`（初期化オーケストレーター、最終グループとして残置）を除く`static/js/main/`配下の全ファイルがESM化された。

**G7・G8に続き「既ESM化済みファイルからの逆方向依存」が今回も多数見つかった**: `_escHtml`（21）は`02-assets.js`/`04b-layer-panel-render.js`/`06c-template-wizard.js`/`11a-work-manager.js`（G1・G2・G5）から、`_scriptGetSelectedDialogue`（21）は`09e-text-tool.js`/`09f-bubble-text.js`（G4）から、`hidePose3DCanvas`/`_pose3dSyncPosition`（23）は`11a-work-manager.js`/`07-pages.js`（G5・G3）から参照されていた。特に`24-sub-panels.js`は影響範囲が広く、`_isSubPanelFrameMode`/`toggleSubPanelFrameMode`/`deleteSubPanel`/`renderSubPanelHandles`が`04b-layer-panel-render.js`から、`_subPanelCurrentSelected`/`duplicateSubPanel`/`moveSubPanel`が`05-groups-move.js`から、`_subPanelSyncBorderWidthUI`が`08-panels-images.js`・`09b-balloon-shapes.js`から参照されており、全てgrepで実コード上の使用箇所を確認した上でブリッジ一覧を確定した。

**24-sub-panels.jsは既ESM化ファイルへの依存も最多**: 17c-layer-draw-handles.js（G7）の draw-shape 用ジオメトリ関数6個、03-layers-panel.js（G1）のロック判定3個、05-groups-move.js（G7で作られたポリゴン中心計算等）2個、06a-polygon-geometry.js（G2）の複製ヘルパー、09b/09c-balloon-shapes.js/-handles.js（G4）のバルーン形状更新・画像transform、00-db.js（G0）の`dbPut`、04b-layer-panel-render.js（G1）・07-pages.js（G3）・08-panels-images.js（G3）の各種、計14個のシンボルを実importに置き換えた。この過程で`_updateH2ShapePath`の`typeof`存在確認ガードも実importで保証されるため削除した。

**新規発見はなし（G7・G8で確立した手法がそのまま機能）**: 着手前チェック4点セットを全て適用し、実機検証でのランタイムエラーはゼロ件だった。`22-help-tab.js`は約860行の巨大な静的ヘルプデータ（`_HELP_DATA`/`_HELP_I18N`、英語help文）を含むため、機械的な未解決識別子検出で大量の英単語ノイズが発生したが、実コード部分（末尾約140行）は少数の関数のみで影響は限定的だった。

**検証**: Kaptureで実機確認。初期化完了（コンソールエラーなし）、スクリプトタブでの既存プロジェクトデータ表示（`_workMeta`との実import連携）・プレビュー切替、ヘルプタブでのナビ表示・記事切替・検索・「タブを開く」ジャンプボタン（`switchTab`との連携）、レイアウトタブのサブコマツール（ON/OFF切替、`initSubPanelManipulation`のmousedown/mouseupハンドラ発火確認）、3Dポーズタブ（コマ選択→「コマに配置」→3Dビューオーバーレイの正確な位置合わせ確認、`getBoundingBoxFromPoints`との実import連携）・「キャンセル」の一連を確認・エラーなし（3Dビュー表示時に発生したデフォルトVRMモデルファイルの404エラー3件は、このComfyUI開発環境にモデルファイルが未配置なことによるネットワークエラーであり、今回のESM化とは無関係と判断）。

---

## 2026-08-01（ESモジュール化 第9弾 G8: フォント管理を type="module" 化）

G0〜G7（本DEVLOG直下エントリ参照）に続く段階的ESM化の第9弾。対象は `19-font-manager.js`（フォントマネージャータブ+文字スタイル、930行）・`20-font-presets.js`（プリセット+初期化+ソース切替、511行）の2ファイル（計約1,440行）。

**G7に続き「既ESM化済みファイルからの逆方向依存」が多数見つかった**: `_fontMgr`/`_fontMgrCatLabel`/`_fontMgrCatNames`/`_fontMgrLoad`/`_fontMgrGoogleList`は`09a-balloon-init.js`・`09d-balloon-tools.js`・`09f-bubble-text.js`・`image-tab.js`（いずれもG1〜G4で完了済み）から、`_fontMgrGroupOpen`/`_fontMgrToggleGroup`/`_esc`/`_fontMgrLoadStyles`/`_fontMgrRenderTextStylePreview`は`09e-text-tool.js`から参照されていた。全てgrepで実コード上の使用箇所を確認した上でブリッジ一覧を確定（G7と同じ「着手前チェック2点目に既存グループからの参照確認も含める」運用を適用）。

**新たに発覚した逆方向依存の変種**: `19-font-manager.js`の`_fontMgrGoogleList()`が参照する`GOOGLE_FONT_FAMILIES`（Google Fonts名一覧のSet）は、意外にも`11b-page-manager-tab.js`（G5、ページ管理タブ）で定義されていた。`typeof GOOGLE_FONT_FAMILIES !== 'undefined'`という存在確認ガードで守られていたため、これまで気付かれていなかった依存関係。実importに置き換え、ガード節（およびフォールバックの`#font-group-google` option要素からの収集コード）は到達不能になったため削除した。

**グループ内相互import**: 19⇄20で多数の循環importが発生（19は20の`_fontMgrRenderPresetStyleSelect`を、20は19の25個のシンボルをimportする非対称な依存）。いずれも関数内部での参照に閉じており安全と確認済み。また19は`09e-text-tool.js`（G4、既ESM化済み）の`_fontMgrApplyStyleAttrsToTextEl`も実importに置き換えた（スタイルプレビューSVGの実描画に使用、`_fontMgrRenderStylePreviewSvg`関数のコメントに関数名の言及はあったが、呼び出し自体は着手前チェック3点目の機械抽出で発見）。

**検証**: Kaptureで実機確認。初期化完了（コンソールエラーなし）、フォントタブでのシステムフォント一覧読み込み・フォント選択・基本プレビュー表示、スタイルタブでのSVGプレビュー描画（`_fontMgrApplyStyleAttrsToTextEl`との実import連携を確認）・線（ストローク）トグルのライブ反映、スタイル保存→プリセット側セレクトへの反映確認（19→20方向のimport）→削除、プリセット保存→削除、タグ追加→削除、「選択テキストに適用」ボタンのガード節（`state.selectedTextEl`未選択時の警告アラート）の一連を確認・エラーなし。検証で作成したテストスタイル・テストプリセット・テストタグは全て削除し、最終的にページをリロードして検証前の状態に復元済み。

---

## 2026-08-01（ESモジュール化 第8弾 G7: 描画/加工(layer-draw)を type="module" 化）

G0〜G6（本DEVLOG直下エントリ参照）に続く段階的ESM化の第8弾。対象は `16-processing-edit-tabs.js`（Processingタブ+Editタブ初期化、408行）・`17a-layer-draw-input.js`（描画初期化+オーバーレイ管理+座標変換+マウスイベント+多角形/ベクター曲線ペン、1301行）・`17b-layer-draw-commit.js`（SVG要素確定+Undo、345行）・`17c-layer-draw-handles.js`（draw-shapeハンドル・操作、789行）・`17d-layer-draw-paint.js`（ペイントツール、463行）・`18-svg-color-png.js`（SVG色変更+SVG→PNG変換、340行）の6ファイル（計約3,650行）。今回のグループは、17a〜17dが元は単一ファイル`17-layer-draw.js`を3分割したもの（+ペイントツールが後日追加され4分割）で、かつ16・18もこの描画機能と密結合していたため、G6までで最も相互import数が多いグループとなった。

**着手前チェック4点セットで発覚した特筆すべき点**: 従来のG1〜G6では「未ESM化ファイルからESM化済みファイルへの依存」（呼び出し先が先にESM化されるケース）が中心だったが、G7では逆に「**既にESM化済みの多数のファイル（03/04a/04b/05/06a/07/08/09c/09d/09e/11a-work-manager.js/15-pixifx-bridge.js、G1〜G6で完了済み）が、まだESM化されていなかったG7側の関数を呼んでいる**」というケースが大量に見つかった（`clearDrawShapeHandles`は03/04b/05/06a/08/09dの6ファイルから、`_layerDrawState`/`_layerDrawDetachOverlay`は07-pages.js・11a-work-manager.jsから、`_drawShapeGetBounds`/`_drawShapeSetBounds`/`updateDrawShapeHandles`はG6で完成したばかりの15-pixifx-bridge.jsから、といった具合）。これらは非moduleの合成の原理（トップレベル`function`/`var`宣言が自動的に`window`プロパティになる）により、G7側がまだ非moduleである間は無条件で動いていたが、G7をESM化した瞬間にこの暗黙のwindow公開が失われるため、**G7側の各ファイルで`window.X = X`ブリッジを新設しないと、これら6グループ分のESM化済みファイル群が軒並み壊れるところだった**。全ての呼び出し元をコード上で確認（コメントのみの誤検出を除外）した上でブリッジ一覧を確定させた。

**グループ内の相互import**: 17a⇄17b⇄17c⇄17d⇄16の間で多数の循環importが発生した（例: 17aが16の`_layerDrawOriginalUnit`をimportする一方、16も17a/17d/17b/18の関数をimportする）。全て「循環先シンボルの参照が関数内部に閉じている」ことを確認済み。16は`15-pixifx-bridge.js`（G6で完成）の`openImageTabWithSelected`/`openLayoutI2IModal`/`moveSelectedObjectToCenter`も、暗黙のグローバル参照から正式importに置き換えた。

**単純な誤検出が多数（重要）**: 機械抽出した「未解決識別子」の中には、コメント内に関数名を書いているだけの偽陽性が非常に多かった（`_drawShapeSyncTexturePatternTransform`/`_drawShapeSyncProps`/`_layerDrawFillState`/`initSubtabs`/`_fontMgrExtractStyleFromTextEl`等）。またimage-tab.jsに`_procUpscale`/`_procApplyDenoise`/`_procApplySharpen`という**同名だが無関係な独自ローカル関数**が存在しており、単純な文字列一致では別ファイル間の依存と誤認する危険があった。全て実コードを目視確認して除外した。

**検証**: Kaptureで実機確認。初期化完了（コンソールエラーなし）、ドロータブでの多角形ペンツール（3点クリック→始点クリックで確定、`getOrCreateClipGroup`/`_fontMgrApplyFillPaintToEl`/`saveOverlaySvg`/`_layerDrawSelectShape`/`renderDrawShapeHandles`が正常動作)、OCボタンでの図形中央移動（G6で完成した`moveSelectedObjectToCenter`がG7の`_drawShapeGetBounds`/`_drawShapeSetBounds`を正しくimportして連携）、「図形をPNG変換」（`convertShapeToImage`との連携)、ペイントツール（「ペイントを追加」→`insertImage`/`_selectClone`、ブラシストローク1点)、SVG色変更・SVG→PNG（画像未選択時の警告アラートが正しく表示され、ガード節まで到達することを確認)、Processingタブの「実行」ボタン（同様に警告アラート確認)の一連を確認・エラーなし。多角形描画・PNG変換・ペイント追加で作成したテストオブジェクトは全てレイヤーパネルから削除し、最終的にページをリロードして検証前の状態に復元済み。

---

## 2026-08-01（ESモジュール化 第7弾 G6: 外部連携/マンガエフェクトを type="module" 化）

G0〜G5（本DEVLOG直下エントリ参照）に続く段階的ESM化の第7弾。対象は `nanobanana.js`（Nanobanana API連携、358行）・`pixifx.js`（PixiJS FXモーダル、938行）・`14-integrations.js`（Eagle連携+WorkflowStudioギャラリー+G'MIC連携+I2I/Inpaint連携、614行）・`15-pixifx-bridge.js`（PixiJS FXブリッジ+I2Iモーダル+OCボタン、440行）・`15b-manga-tone.js`（ハーフトーン変換/生成+マンガ効果、1191行）・`15c-manga-bgpattern.js`（背景パターン、579行）の6ファイル（計約4,120行）。

**pixifx.jsの特殊対応**: 他ファイルと異なり `(function () { 'use strict'; ... })();` というIIFEでカプセル化された非module scriptだった（先行するG0〜G5には無かったパターン）。モジュールのトップレベルスコープ自体が既にファイル外から隔離されているためIIFEラッパーは不要と判断し、除去した上で `window.pixiFxOpen = async function (...) {...}` を `async function pixiFxOpen(...) {...}` + 末尾 `export { pixiFxOpen }` に変換。内部の大量のヘルパー関数・変数は元の4スペースインデントのまま残し、ラッパー除去のみの最小差分にした。

**着手前チェック4点セットを適用**: (1)トップレベル即時参照チェック→対象なし（G6の6ファイルへの外部からの呼び出しは全てDOMContentLoadedハンドラ内かボタンのクリックハンドラ内に閉じており、即時評価なし）。(2)ヘッダコメント非網羅チェック→今回も複数件の未記載シンボルを発見（`14-integrations.js`の`_i2iSettings`/`_inpaintSettings`等、`15-pixifx-bridge.js`の`_getSelectedImageBlob`/`_PI2I_DPI`等）。(3)未解決識別子検出（呼び出しパターン）→Node.jsスクリプトで機械抽出（`grep`ベースの簡易版、コメント中の関数名らしき文字列を拾う誤検出が複数出たため`saveToEagle`/`savePanelSvg`等は実際のコードで使用箇所を目視確認して切り分けた）。(4)再代入されるモジュール内部変数の再代入チェック→該当なし（G6の6ファイルではセッターパターンの新設は不要だった）。

**グループ内の相互依存も実import化**: G6は6ファイルを同時に着手したため、ファイル間の呼び出し（`nanobanana.js`→`14-integrations.js`の`saveToEagle`/`_eagleSettings`、`15-pixifx-bridge.js`→`pixifx.js`の`pixiFxOpen`・`14-integrations.js`の`getI2ISettingsState`/`saveI2ISettingsState`/`sendI2IRunToWorkflowStudio`、`15c-manga-bgpattern.js`→`15b-manga-tone.js`の対象領域決定ヘルパー11個）は全て`window.`ブリッジ経由ではなく最初から正式な`import`にした。これに伴い、従来`typeof window.X === 'function'`で存在確認していた防御的チェックのうち、実importで存在が保証されるようになったものは死んだ分岐として削除した（`saveI2ISettingsState`/`sendI2IRunToWorkflowStudio`/`pixiFxOpen`の3箇所）。

**window.pixiFxOpenは維持**: `image-tab.js`（先行グループでESM化済みだが今回のG6スコープ外）が`window.pixiFxOpen(...)`を直接呼んでいるため、`pixifx.js`側のwindowブリッジは削除せず維持した。同様の理由で`14-integrations.js`の`saveToEagle`/`getI2ISettingsState`/`saveI2ISettingsState`/`sendImageToWorkflowStudioI2I`/`sendInpaintToWorkflowStudio`/`sendI2IRunToWorkflowStudio`のブリッジも維持。`image-tab.js`のimport化は次回以降の任意タイミングでの追加清掃候補とし、今回のG6では対象外とした（対象ファイル拡大によるリスク増を避けるため）。

**検証**: Kaptureで実機確認。初期化完了（コンソールエラーなし）、Nanobananaタブ（APIキー接続確認・タブ切替）、設定タブ（Eagle/G'MIC/Inpaint設定の保存値読み込み）、レイアウトタブでのマンガ効果モーダル（ヴィネット生成→挿入→取消）、背景パターンモーダル（ドットパターン生成→挿入→取消、15c→15bの11個のimportが正常動作）、ハーフトーンモーダル（パターン生成→挿入）、PixiJS FXモーダル（画像選択→フィルタ&パーティクル設定画面のライブレンダリング、IIFE除去後のpixifx.jsが正常動作することを確認）、I2Iモーダル（`getI2ISettingsState`によるデフォルトワークフロー設定の読み込み確認）、OCボタン（`moveSelectedObjectToCenter`）、Workflow Studioギャラリータブ（iframe読み込み・自動タブ選択）の一連を確認・エラーなし。検証で追加した全てのテスト画像・パターンは元に戻すボタンで取消し、ページを検証前の状態に復元済み。

---

## 2026-08-01（ESモジュール化 第6弾 G5: 出力/書き出しを type="module" 化）

G0〜G4（i18n.js/00-db.js〜09fフキダシ系、本DEVLOG直下エントリ参照）に続く段階的ESM化の第6弾。対象は `10-output-pages.js`（出力管理/ページ一覧/外部ファイル取込、745行）・`11a-work-manager.js`（作品管理、930行）・`11b-page-manager-tab.js`（ページ管理タブ、810行）・`12-text-png-export.js`（テキスト透過PNG変換/画像出力、610行）・`13-export-pdf-epub.js`（PDF/EPUB出力、320行）・`13a-export-metadata.js`（画像メタデータ埋め込み、400行）の6ファイル（計約3,800行）。加えて、G4完了時点で`window`ブリッジ経由の暫定呼び出しになっていた`09a-balloon-init.js`の`convertTextToPng`・`09c-balloon-handles.js`の`embedFontsInSvg`を、G3の前例（00-db.js→07-pages.jsのbuildMergedSvg）に倣い正式な`import`に置き換えた。

**実装**: 6ファイルは10⇄11a⇄11b⇄12⇄13⇄13aと相互に密結合しており、複数組の循環importが発生した（いずれも循環先シンボルの参照は関数内部に閉じており安全と確認）。

**再代入されるモジュール内部変数が3件見つかった（G0の`db`と同じ問題が今回は3倍）**: `_outputFilterGroup`（10で定義、11aから再代入）・`_outputSelectedPage`（10で定義、11bから再代入）・`_workSelected`（11aで定義、11bから再代入）の3つのlet変数は、定義ファイルとは別のファイルから直接代入（`_workSelected = null` 等）されていた。importされたバインディングへの代入はできないため、00-db.jsの`_setDb()`と同じパターンで`_setOutputFilterGroup()`・`_setOutputSelectedPage()`・`_setWorkSelected()`の3つのセッターを新設し、代入箇所をセッター呼び出しに置き換えた。この問題は着手前チェック（`grep`で`変数名\s*=[^=]`パターンを機械的に洗い出し、定義ファイル以外からの再代入がないか確認）で全て事前に発見できた。

**新しい教訓（着手前チェック4点目）**: 上記のセッター化作業で、セッター関数（`_setWorkSelected`等）はimportしたが、読み取り用の変数自体（`_workSelected`）のimportを一部忘れるミスが発生した。G4で確立した「未解決識別子検出」（`check_unresolved_calls.js`、関数呼び出しパターン`identifier(`のみを対象）はこの種の見落としを検出できず、実機検証で `ReferenceError: _workSelected is not defined at renderPageMgrGrid (11b-page-manager-tab.js:662)` として発覚した。原因は、セッターパターンを使う変数は「関数呼び出し」ではなく「値としての参照」（`_workSelected === name`のような比較）でしか使われないため。対策として、関数呼び出しに限らず単語境界一致（値としての参照も含む）でimport漏れを検出するスクリプト（`check_g5_value_refs.js`）を新設し、これで`_workSelected`・`_outputSelectedPage`の2件のimport漏れを追加検出・修正した。**How to apply**: 次グループ以降、セッター経由で更新するモジュール内部変数を新設する場合は、「セッター関数」と「変数自体」の両方をimportしたか必ずペアで確認すること。着手前チェックは（1）ヘッダコメント非網羅、（2）export/windowブリッジ差分、（3）未解決識別子（関数呼び出しのみ）、（4）値としての参照も含めた未解決識別子、の4点セットに拡張する。

なお、通常の未解決識別子検出（関数呼び出しパターン）でも、`_dbPutRaw`（00-db.js）・`_saveBlob`（13-export-pdf-epub.js）・`renderPageMgrGrid`（11b-page-manager-tab.js）・`svgTextToDataUrl`（00-db.js）・`_getOrBuildPageThumb`（11a-work-manager.js）の計5件のimport漏れを着手前に発見・修正できており、G4に続きこのチェックの有効性が実証された。

**検証**: Kaptureで実機確認。初期化完了（`_workSelected`のimport漏れ修正前は初期化エラーが発生したが、修正後はエラーなし）、出力サブタブでのページ一覧描画・プレビュー表示（`buildMergedSvg`+`svgTextToDataUrl`）・ソート基準変更と並び替え（`_sortPageOrder`、DB保存ログ確認）、作品管理サブタブでのグループ切り替え（ゴミ箱表示、`_getOrBuildPageThumb`によるサムネイル生成）、作品選択→出力フィルタ設定・解除（`_setOutputFilterGroup`セッター経由）、JPEG画像出力（`handleExport`→`drawSvgOnCanvas`→`_embedImageMetadata`、ユーザーに保存されたファイルを確認いただき「そのままの名前で保存し確認しました」の回答を得た）の一連を確認・エラーなし。

---

## 2026-08-01（ESモジュール化 第5弾 G4: フキダシ/テキストツールを type="module" 化）

G0（i18n.js/00-db.js）・G1（アセット管理/レイヤーパネル/マスクツール）・G2（グループ機能/移動/テンプレート管理）・G3（ページ管理/パネル画像操作、本DEVLOG直下エントリ参照）に続く段階的ESM化の第5弾。対象は `09a-balloon-init.js`（初期化、697行）・`09b-balloon-shapes.js`（図形/パス生成、1353行）・`09c-balloon-handles.js`（変形/ハンドル操作、740行）・`09d-balloon-tools.js`（ツール初期化/フォント選択、474行）・`09e-text-tool.js`（テキスト編集、1053行）・`09f-bubble-text.js`（フキダシ内包テキスト、594行）・`text-style-modal.js`（IIFEカプセル化済み、importのみ追加）の7ファイル（計約5,000行）。フキダシ機能全体がESM化された。

**実装**: G1〜G3と同様の方針。G4内は09a→09b/09c/09d/09e/09fへの依存を中心に、09b⇄09c、09b⇄09e、09b⇄09f、09c⇄09fなど複数組の循環importが発生したが、いずれも循環先シンボルの参照は関数内部に閉じており安全と確認した。`text-style-modal.js`はIIFEで完全にカプセル化された構造のため、`import { t } from './i18n.js'`の追加のみで対応。

**着手前チェックの結果**: 正規表現によるG4全94トップレベルシンボルの機械抽出、外部参照有無の一括チェック（26件のwindowブリッジ対象を特定）、トップレベル即時参照チェック（該当なし）、export/windowブリッジ差分チェックを事前実施。それでも`09a-balloon-init.js`が使う`applyTextInput`（09e-text-tool.js定義）のimport漏れは事前チェックをすり抜け、実機検証で「初期化エラー: applyTextInput is not defined」として発覚した。

**教訓（新しい検出手法）**: 上記の見落としを受け、各ファイルの関数呼び出しパターン（`identifier(`）のうち、import・自己定義・既知グローバルのいずれにも該当しない識別子を機械的に検出するスクリプト（`check_unresolved_calls.js`）を新設。メソッド呼び出し（`.foo()`）がノイズとして混入するため手動精査は必要だが、`applyTextInput`修正後にこのスクリプトを流し直したところ、`saveTextSvg`（07-pages.js定義、09a:284行目で使用）のimport漏れも追加で発見できた（`window.saveTextSvg`はG3で既にブリッジ済みだったため実害はなかった可能性が高いが、念のため明示的にimportへ置き換えた）。**How to apply**: 従来の「ヘッダコメント非網羅チェック」「export/windowブリッジ差分チェック」だけでは、依存ファイル側の呼び出し漏れ（exportした側ではなく使う側の書き忘れ）は検出できないことが判明した。次グループ以降は「未解決識別子検出」もG1由来の着手前チェック2点セットに加えた3点セットとして標準化する。

**検証**: Kaptureで実機確認。初期化完了、フキダシ作成（`insertSmartBalloonTemplate`、尻尾付き楕円フキダシとハンドル表示を確認）、「テキストを内包」モーダル（`openBubbleTextModal`）でのテキスト入力・作成（`applyBubbleTextToShape`、フキダシ内に正しくテキストが表示されることを確認）まで機能面はエラーなし。モーダルを開いた際に一度「Uncaught (in promise) The message port closed before a response was received.」がコンソールに記録されたが、これはセッション全体で既知のブラウザ拡張機能由来のノイズ（拡張機能間メッセージングのタイムアウト）と同種であり、アプリケーションコードとは無関係と判断した。検証後、テストで作成したフキダシはレイヤーパネルから削除し後片付け済み。

---

## 2026-08-01（ESモジュール化 第4弾 G3: ページ管理/パネル画像操作を type="module" 化、コアSVG統合処理が完全ESM化）

G0（i18n.js/00-db.js）・G1（アセット管理/レイヤーパネル/マスクツール）・G2（グループ機能/移動/テンプレート管理、本DEVLOG直下エントリ参照）に続く段階的ESM化の第4弾。対象は `07-pages.js`（ページ管理・`buildMergedSvg`統合処理・コマ単位保存）と `08-panels-images.js`（パネル操作・画像挿入・画像操作）の2ファイル（計約2,400行）。このグループでコアのSVG統合・保存パイプラインが全てESM化された。

**実装**: G1/G2と同様の方針。`07-pages.js`と`08-panels-images.js`は相互import（循環）で、循環先の参照はすべて関数内部に閉じているため安全。加えて、G0時点で`00-db.js`から`window.buildMergedSvg(...)`という暫定ブリッジ経由で呼んでいた箇所を、正式な`import { buildMergedSvg } from './07-pages.js'`に置き換えた（`00-db.js`⇄`07-pages.js`も循環importになるが、双方とも参照は関数内部に閉じており安全）。これでPLAN_backlog.mdに残っていたG0時点の暫定対応を解消できた。

**着手前チェックの結果**: ヘッダコメント非網羅チェックで、`08-panels-images.js`の`getOrCreateDraftGroup`（05-groups-move.jsから使用）・`saveDraftSvg`（07-pages.jsから使用）・`selectDraft`（04b-layer-panel-render.jsから使用）の3件を着手前に発見。export/windowブリッジ差分チェックでも`07-pages.js`の`_collectReferencedFilters`（05-groups-move.js/09b-balloon-shapes.jsから使用）のwindowブリッジ漏れを着手前に発見・対応した。G1以来の「着手前チェック2点セット」がここでも効果を発揮し、実機検証でのランタイムエラーはゼロ件だった。

**検証**: Kaptureで実機確認。初期化完了、ページを開く（`buildMergedSvg`+`renderLayoutTab`+`initPanelsOnSvg`）、アセットパネルからの画像挿入（`insertImage`→`insertImageToOverlay`）、画像選択・ハンドル表示（`renderImageHandles`）、レイヤーパネルからの削除、「保存」ボタンでの明示保存（`savePanelSvg`、ユーザーに確認いただいた「保存しました」アラート）の一連を確認・エラーなし。

---

## 2026-08-01（ESモジュール化 第3弾 G2: グループ機能/移動/テンプレート管理を type="module" 化）

G0（i18n.js/00-db.js）・G1（アセット管理/レイヤーパネル/マスクツール、本DEVLOG直下エントリ参照）に続く段階的ESM化の第3弾。対象は `05-groups-move.js`, `06a-polygon-geometry.js`, `06b-template-manager.js`, `06c-template-wizard.js` の4ファイル（計約2,600行）。

**実装**: G1と同様の方針（G2内の相互依存はimport/export、G2外への呼び出しは書き換えず素の識別子のまま＋ヘッダコメントに依存元を明記）。G2内部でも循環importが2組できた: `04a-mask-core.js`⇄`04b-layer-panel-render.js`と同じ判断基準で、`06b-template-manager.js`⇄`06c-template-wizard.js`が相互import（テンプレート管理とウィザードは元々1ファイルだったものを3分割した経緯があり、双方向に密結合）。循環先シンボルの参照はすべて関数内部に閉じているため安全と確認した。

**G1の教訓を適用した結果**: 着手前に「ヘッダコメントに頼らず全トップレベル定義を機械抽出」を実施したところ、`05-groups-move.js`の`deleteSelectedObject`/`initLayoutDeleteShortcut`（01-state.js/07-pages.jsから外部参照）、`06c-template-wizard.js`の`_tmplGetFrameWidth`（内部専用）がヘッダコメントに載っていないことを着手前に発見・対応できた。G1では実機検証まで発覚しなかったが、今回は事前チェックで潰せた。同様に、export一覧とwindowブリッジ一覧の機械的差分チェックも着手前に実施し、`_round2`（07-pages.js/11a-work-manager.js/24-sub-panels.jsから使用）・`_insetPolygonPoints`（07-pages.js）・`_polygonCenter`（24-sub-panels.js）・`_selectClone`（17d-layer-draw-paint.js）・`_cloneWithNewIds`（24-sub-panels.js）・`layerMove`/`clearGroupHandles`/`renderGroupHandles`/`initGroupManipulation`/`updateGroupHandlePositions`（複数ファイルから使用）・`_tmplGroups`/`initTemplateManager`/`loadTemplates`（01-state.js/11a-work-manager.jsから使用）・`_prepareTemplateSvgDocForPage`/`renderTemplateList`/`openTemplateWizard`/`closeTemplateWizard`/`renameTemplate`/`deleteTemplate`/`parseSVGForTemplate`（07-pages.js/10-output-pages.js/11a-work-manager.jsから使用）を漏れなくwindowブリッジに含めることができ、G0/G1のようなランタイムエラーが今回は一件も発生しなかった。

**検証**: Kaptureで実機確認。初期化完了、テンプレート一覧表示（`loadTemplates`/`renderTemplateList`/`_tmplGetFrameWidth`/`buildMergedSvg`）、テンプレート選択（`selectTemplate`）、テンプレート作成ウィザードの起動・分割ステップ表示・キャンセル（`openTemplateWizard`/`_tmplWizCreateBase`/`_tmplWizRender`/`closeTemplateWizard`）、グループアセット挿入（`insertGroupAsset`+`renderGroupHandles`）、複製（`duplicateSelectedObject`+`_cloneWithNewIds`+`_applyOffset`+`_selectClone`）、Deleteキー削除（`initLayoutDeleteShortcut`+`deleteSelectedObject`）、レイヤーパネル✕ボタン削除の一連を確認・エラーなし。

**How to apply**: G1の教訓（ヘッダコメント非網羅、export/windowブリッジ差分の機械チェック）を着手前に前倒しで実施することで、実機検証まで問題が残らずに済んだ。今後のグループでも「着手前チェック」として定着させる。

---

## 2026-08-01（ESモジュール化 第2弾 G1: アセット管理/レイヤーパネル/マスクツールを type="module" 化）

G0（i18n.js/00-db.js、本DEVLOG直下エントリ参照）に続く段階的ESM化の第2弾。対象は `02-assets.js`, `03-layers-panel.js`, `04a-mask-core.js`, `04b-layer-panel-render.js` の4ファイル（計約1,760行）。

**方針転換**: G0では未ESM化ファイルへの依存を `window.buildMergedSvg(...)` のように明示していたが、G1は外部依存が20件を超え機械的置換のコストが高いため、**G1外への呼び出しは書き換えず素の識別子のまま**にした。非moduleのトップレベル宣言（`function`/`var`）は自動的に`window`のプロパティになり、それはmoduleのグローバルスコープからも素の識別子で見える（`image-tab.js`が`t(...)`をimportなしに呼べていたのと同じ原理）ため、動作上は問題ない。各ファイル冒頭に未ESM化の外部依存一覧をコメントで明記し、依存の出所が追えるようにした。G1内（4ファイル間）の相互依存はimport/exportにした（`04a-mask-core.js`と`04b-layer-panel-render.js`は相互import＝循環依存になるが、両者とも循環先シンボルの参照はすべて関数内部に閉じており、モジュールのトップレベルでは参照していないため安全と判断）。

**実装**: 4ファイルを`type="module"`化し、それぞれの主要シンボルをexport + `window.foo = foo`ブリッジ（G1外の非ESMファイルから呼べるようにするため）で公開。`templates/index.html`の該当4タグに`type="module"`を追加。

**発覚した問題と修正**:
1. **`00-db.js`（G0）のexport漏れ**: `_enqueueActivePageSave`（state.activePageの読み書き直列化キュー）と`_dbPutRaw`が、G0時点でヘッダコメントの「主なトップレベル定義」一覧に載っていなかったためexport/windowブリッジから漏れていた。実機でマスク編集ONにした際、`saveOverlaySvg`（09b-balloon-shapes.js）→`_maskSaveFor`（04a-mask-core.js）経由で`_enqueueActivePageSave is not defined`エラーが発生し発覚。`_dbPutRaw`は`11a-work-manager.js`のバックアップ復元処理から使われていることも合わせて判明。両方をexport+windowブリッジに追加した。
2. **`02-assets.js`のexport漏れ**: `_layoutPreviewSizePct`/`_applyLayoutPreviewSize`をexportしたがwindowブリッジへの追加を忘れており、まだ非ESMの`07-pages.js`（`renderLayoutTab`）が直接呼ぶ箇所で「プレビュー読み込みエラー」として実機発覚。
3. **`03-layers-panel.js`のexport漏れ**: `_getPanelGroupDom`が`24-sub-panels.js`から使われているのにwindowブリッジ漏れ。
4. **`04a-mask-core.js`のexport漏れ**: `_maskAttachOverlay`が`07-pages.js`から使われているのにwindowブリッジ漏れ。

**教訓（重要）**: 各ファイル冒頭の「主なトップレベル定義」ヘッダコメント（`main.js`分割時に用意されたもの）は**網羅的ではない**。アンダースコア始まりの内部ヘルパーが意図的に省略されている場合があり、これを鵜呑みにしてexport対象を決めると本番相当の見落としが発生する。正しい手順は、正規表現（`^(async function|function|const|let)\s+\w`）で**ファイル内の全トップレベル定義を機械的に抽出**し、それぞれについて他ファイルからの参照有無をgrepで確認すること。G1の4ファイル自体はこの機械抽出とヘッダコメントが一致していたが、G0の`00-db.js`だけ一致しておらず、これが今回の全ての見落としの元だった。次グループ着手時は、対象ファイルだけでなく既にESM化済みの全ファイルについてもこのチェックをやり直す価値がある。

**検証**: Kaptureで実機確認。初期化完了・ページ選択・レイアウトタブでのコマ描画（修正後）・アセットパネル表示・レイヤーパネル表示・マスク編集ON→ブラシ塗り→自動保存（`_maskBakeAndSave`→`saveOverlaySvg`→`_enqueueActivePageSave`）→レイヤー削除（confirmダイアログ経由）の一連を確認・エラーなし。

---

## 2026-08-01（ESモジュール化 第1弾: i18n.js / 00-db.js を type="module" 化）

`static/js/main/*.js`（24分割）ほか計28ファイルが classic `<script>`（非module、グローバルスコープ共有）のまま肥大化していた件について、ESモジュール化に着手した。バンドラーは導入せず（ComfyUIカスタムノードとしてビルドツール無しの環境でも動く必要があるため）、機能クラスタ単位で段階的に移行する方針をユーザーと合意。第1弾として最も依存の少ない基盤2ファイルを対象にした。

**対象を i18n.js + 00-db.js の2ファイルに限定した理由**: 当初は `01-state.js` も含める想定だったが、精読の結果、同ファイルは `DOMContentLoaded` ハンドラ内で他23ファイルの `init*` 関数群（19個以上）を呼ぶ「初期化オーケストレーター」であることが判明。ESM化すると呼び出し箇所全部に `window.` プレフィックスを付けて回る必要があり、書き忘れリスクが最も高い。他の全グループのESM化が終わってから最後に着手する方が、`window.xxx()` と書いてすぐ `import` に直す二度手間も避けられるため、今回は対象から外した。

**実装**:
- `static/js/i18n.js`: `type="module"` 化。`t`/`resolveBackendError`/`getLang`/`setLang`/`getLanguageOptions`/`applyI18nToHtml` を `export` しつつ、まだESM化されていない classic `<script>` 側（42ファイルが `t()` に依存）から呼べるよう `window.t = t` 等のブリッジを同時設置。
- `static/js/main/00-db.js`: `type="module"` 化。`DB_NAME`/`DB_VERSION`/`openDB`/`dbGet`/`dbPut`/`dbDelete`/`dbGetAll`/`dbGetAllPagesMeta`/`readFileAsText`/`readFileAsDataURL`/`svgTextToDataUrl` を `export`+windowブリッジ。内部の `db` はモジュールスコープに閉じ込め、外部（01-state.js）から更新するための `_setDb(d)` セッターを新設（`db` はexport後に再代入されるため直接exportできない）。`buildMergedSvg`（07-pages.js、未ESM化）への依存は `window.buildMergedSvg(...)` 経由の暫定呼び出しに変更。
- `static/js/main/01-state.js`: `db = await openDB();` の1行のみ `window._setDb(await window.openDB());` に変更（ファイル自体は非moduleのまま）。
- `templates/index.html`: 上記2ファイルの `<script>` タグに `type="module"` を追加。

**発覚した問題と修正（`static/js/main/11a-work-manager.js`）**: `type="module"` スクリプトは常にdefer相当のタイミングで実行されるため、i18n.js（従来は非module・文書内で最も早く同期実行される想定だった）が、後続の非moduleスクリプト群より後に実行されるようになった。これにより、`11a-work-manager.js` のトップレベル（関数外、モジュール読み込み時に即時評価される部分）にあった `const TRASH_GROUP_LABEL = t('page.trashLabel');` と、`WORK_SIZE_PRESETS` 配列リテラル内の6箇所の `t(...)` 呼び出しが、i18n.jsのモジュール実行（`window.t` ブリッジ設置）より先に走り `ReferenceError: t is not defined` で初期化が失敗、後続の `const STOCK_GROUP` も未初期化のままTDZエラーを誘発した。`_trashGroupLabel()` / `_reservedGroupNames()` / `_workSizePresetList()` という遅延評価関数に変更し、呼び出し時に都度 `t()` を評価するよう修正（`11a-work-manager.js`、使用箇所の `11b-page-manager-tab.js` 側4箇所も追随）。事前のgrep調査（`^t\(` 等の行頭一致）ではこの2箇所を検出できておらず、ブレース深さを追跡するNode.jsスクリプトで全ファイルを再チェックして他に無いことを確認した。

**検証**: Kaptureで実機確認。初期化完了（`DB connected` → `Plugin Initialized`、エラーなし）、ページ一覧・サムネイル表示、ページを開く（レイアウトタブでのコマ描画、`buildMergedSvg` ブリッジ経由）、保存（`dbPut`、「保存しました」アラートをユーザーに確認いただいた）、言語切替（en⇄ja、`setLang`/`getLang` → `location.reload()`）を確認・承認済み。

**How to apply**: 非moduleスクリプトのトップレベル（関数外）で他ファイルのグローバル関数を即時評価しているコードがないか、対象ファイルをESM化する前に必ず確認すること。`type="module"` 化は実行タイミングを常にdefer相当へ変えるため、それより前に書かれた非moduleスクリプトのトップレベルコードの方が先に実行されるようになる（読み込み順が保たれるという直感に反する）。検出時は単純な正規表現（行頭一致）だけでは配列/オブジェクトリテラル内の呼び出しを見逃す（今回`WORK_SIZE_PRESETS`の1件がまさにこれで、2回に分けて見つかった）。トップレベルの `const/let/var` 宣言はブロック全体（複数行にまたがる場合を含む）を対象にチェックすること。

**残作業**: `01-state.js` を含む残り26ファイルは引き続き非module。今後、機能クラスタ単位（フォント管理、フキダシ、ページ/出力、描画系など）で段階的にESM化を進める。詳細な区分は `PLAN_backlog.md` 参照。

---

## 2026-07-30（延長フキダシの孫（3段以上の連結）で境界線マスクが効かない不具合を修正）

延長フキダシ機能で、ベースに延長を追加しさらにその延長へ延長を追加する（親→子→孫の3段連結）と、親+子の直接連結では正しく効いていた「重なり部分の境界線を消して外周だけ1本の線にする」共有リング処理が孫では機能せず、継ぎ目やネックの取り残しが起きるとの報告を受けて調査・修正した。

**原因**（`static/js/main/09b-balloon-shapes.js`）
`_updateH2ShapePath()`末尾のチェーン追従処理が、`dataset.linkedToId`を**1段だけ**辿ってチェーンの基点を求めていた（`document.getElementById(el.dataset.linkedToId)`）。孫フキダシ（子フキダシにリンクした延長）の場合、この基点は真のルートである親ではなく「子」になってしまう。同様に共有リングを生成する`_updateChainUnionRing()`も**直接の子だけ**を集めて合成していたため、親+子で1つ、子+孫で別の1つという2つの独立した共有リングが作られてしまい、本来1本であるべき外周に継ぎ目が出たり、孫側のネックが再計算されず取り残されたりしていた。親に2つ直接延長した場合はどちらも直接親にリンクするため1つのリングで済み、この問題は起きていなかった。

**修正**
1. `_h2ChainRootEl(el)`（新規）: `linkedToId`を最上位（リンク元を持たない要素）まで辿るヘルパーを追加。循環参照やベース削除済みのケースはnullを返す。
2. `_h2ChainAllDescendants(rootEl)`（新規）: ルート要素から`data-linked-to-id`で直接・間接に連なる延長（子・孫・ひ孫...）を再帰的にすべて収集するヘルパーを追加。
3. `_updateChainUnionRing()`の集計対象を「直接の子のみ」から`_h2ChainAllDescendants()`に変更し、チェーン全体を1つの共有リングにまとめるようにした。
4. `_updateH2ShapePath()`末尾のチェーン追従処理を、1段だけ辿る基点解決から`_h2ChainRootEl()`によるルート解決に変更。ネックの再計算対象も`_h2ChainAllDescendants()`で孫以降まで含めるようにした。
5. ついでに見つかった同種の不具合2件も同じヘルパーで修正: `_h2CleanupBalloonChainBeforeDelete()`（09b-balloon-shapes.js）の削除カスケードが直接の子までしか道連れにしておらず、途中のフキダシを削除すると孫が孤立して残っていた点、および`static/js/main/08-panels-images.js`のベースドラッグ時の平行移動カスケードが直接の子までしか追従しておらず、ルートをドラッグすると孫が置き去りになっていた点。

**検証**: ユーザーが実機で親→子→孫の3段連結を作成し、修正後は親に2つ直接延長した場合と同様に重なり部分の内部線が出ない1本の外周表示になることを確認・承認済み。

**How to apply**: このフキダシ連結機能で「直接の子」だけを見るコードを新たに書く場合、親→子→孫のような3段以上の連結で必ず抜け漏れが起きる（今回3箇所で同種のバグが見つかった）。`dataset.linkedToId`を辿る／集計するロジックは`_h2ChainRootEl()`/`_h2ChainAllDescendants()`に一本化すること。

---

## 2026-07-30（レイアウトタブのSVG色変更機能で、色を変更・保存し再度開くとSVG画像が消える不具合を修正）

ユーザーから「レイアウトタブのドローツールでSVG色変更を行い保存した後、再度開くとSVG画像が消える」との報告を受けて調査・修正した。

**原因**（`static/js/main/18-svg-color-png.js`）
`_svgColorApply()`が色変更後の画像要素に`href`と`xlink:href`の両方を`setAttribute`していた。HTMLドキュメント上のライブDOM要素に対して`setAttribute('xlink:href', ...)`を使うと、名前空間が束縛されていない生の属性になる（`setAttributeNS`ではないため）。保存時（`savePanelSvg`/`saveOverlaySvg`、07-pages.js）は`XMLSerializer`でシリアライズするが`xmlns:xlink`宣言は付与されないため、保存データは不正なXMLになる。再度開く際、`renderLayoutTab()`が内部で`DOMParser`の厳格XMLモード（`'image/svg+xml'`）でこの文字列を再パースすると、名前空間エラーで`<parsererror>`ドキュメントになり、`querySelector('svg')`が`null`を返してそのパネル/オーバーレイの内容ごと黙って読み飛ばされていた。通常の画像挿入処理（08-panels-images.js）は`href`のみをセットしており、この不具合はSVG色変更機能に固有だった。

**修正**
`_svgColorApply()`から`xlink:href`のセットを削除（既に付いていれば`removeAttribute`で除去）。他の画像挿入経路と同様に`href`のみをセットするようにした。

**既知の制限**: この修正は今後の色変更・保存が正しく行われることを保証するのみで、修正前に既にこの不具合で保存済みのSVG画像は、次にそのパネル/オーバーレイを保存した際に空のSVGとして上書きされる形で既に消えている可能性がある。該当ページがあれば個別に復旧を検討する必要がある（本セッションではユーザーの実データに該当は見つからなかった）。

**How to apply**: SVG文字列をライブDOM要素に対して構築・保存する際、`xlink:href`のような名前空間付き属性は`setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', ...)`を使うか、そもそも`href`のみで足りる場合は付与しないこと。`setAttribute`で名前空間プレフィックス付きの属性名を設定すると、シリアライズ後に厳格XMLパーサ（`DOMParser`の`'image/svg+xml'`モード）で再パースした際に静かに全内容を失う事故になる。

---

## 2026-07-30（フキダシに「尻尾なし」チェックボックスを追加、ツールバーの「削除」ボタンを画像専用から全オブジェクト対応に汎用化）

延長フキダシ機能まわりの一連のバグ修正（本DEVLOGの直下3エントリ参照）に続く追加要望2件。

**実装1: 「尻尾なし」チェックボックス**（`templates/index.html`, `static/js/main/09a-balloon-init.js`, `09c-balloon-handles.js`）
フキダシ選択時の尻尾パラメータ行（長さスライダーの右隣）に`h2-tail-none`チェックボックスを追加。ONにすると現在の長さを`dataset.tailLengthPrev`に退避したうえで`dataset.tailLength = 0`にし、長さスライダーを無効化する。OFFに戻すと退避しておいた値（無ければ既定の60）を復元し、スライダーも再度有効化する。`_syncH2UI`（09c-balloon-handles.js）にチェック状態・スライダー無効化状態の同期も追加し、フキダシの選択切り替え時に正しく反映されるようにした。延長フキダシの既定（`tailLength=0`）とも自然に整合する。

**実装2: ツールバー「削除」ボタンの汎用化**（`static/js/main/07-pages.js`, `templates/index.html`）
レイアウトタブ上部ツールバーの「削除」ボタン（id: `delete-image-btn`）は、画像専用の`deleteSelectedImage()`という独立した関数を呼んでおり、フキダシ・テキスト・図形・グループを選択していても「画像が選択されていません」と表示されるだけで削除できなかった。ボタンのクリックハンドラを、Delete/Backspaceキーと共通の汎用関数`deleteSelectedObject()`（05-groups-move.js。画像・フキダシ・テキスト・図形・グループすべてに対応し、延長フキダシの連結解除等の後始末も含む）を呼ぶように変更し、未選択時のメッセージも汎用的な文言（`layout.msgNoObjectSelected`）に差し替えた。旧`deleteSelectedImage()`関数は他に呼び出し元が無いことを確認のうえ削除。

**検証**: Kaptureで両機能を実機確認。尻尾なしチェックボックスはON/OFFで尻尾の表示・非表示と長さの復元、保存後の永続化を確認。削除ボタンはフキダシ選択時の削除成功、未選択時のアラート表示をそれぞれ実際のクリック操作で確認済み（画像削除については既存の共通関数を流用するのみのため、コードレビューで回帰が無いことを確認）。

---

## 2026-07-30（延長フキダシ削除時、レイヤーパネルの✕ボタン経由だとネック・共有リングが消し忘れられる不具合を修正）

前2件の共有リング関連バグ修正（本DEVLOGの直下エントリ2件参照）に続く3件目の関連バグ。ユーザーから「フキダシ削除後にフキダシ形状の黒の表示、ネックのみのゴミ、フキダシ・延長フキダシのあった場所に矩形が残り、保存して再度開いても表示が残る」との報告。

**原因**: 延長フキダシの道連れ削除・ネック（コネクタ）・共有リング/マスクの後始末は`deleteSelectedObject()`（05-groups-move.js、Delete/Backspaceキー経由）にのみ実装していたが、**レイヤーパネルのフキダシ行の✕ボタン（04b-layer-panel-render.js）は`shape.remove()`のみを行う完全に別の削除コードパス**で、この後始末を一切経由していなかった。✕ボタンで削除すると、道連れになるはずの延長フキダシ、ネック（`.balloon-connector-fill`/`.balloon-connector-border`）、共有リング（`<rect id="chain-ring-...">`）、共有マスク（`<mask id="chain-mask-...">`）が全て孤立したまま残り、保存されるとその状態が永続化されてしまう。孤立したリングは対応するフキダシが消えているため`_h2ChainAnchorNode`等の追従処理も働かず「矩形」として、孤立したネックは接続先が無いまま固定形状の「ゴミ」として、フキダシ本体を削除し忘れた側では枠線非表示のまま孤立して「黒塗り」として見えていた。

**修正**（`static/js/main/09b-balloon-shapes.js`, `05-groups-move.js`, `04b-layer-panel-render.js`）
削除前後の後始末を`_h2CleanupBalloonChainBeforeDelete(el)`（道連れ延長・ネック・共有リング/マスクの削除、戻り値はelが延長なら紐づくベースid）と`_h2RefreshChainAfterDelete(linkedToId)`（削除後にベースを再描画し枠線表示/共有リングを更新）の2関数に共通化し、`deleteSelectedObject()`とレイヤーパネル✕ボタンの両方から呼ぶように統一。今後どちらの削除経路を使っても同じ後始末が保証される。

**残存ゴミの調査・除去**: Kaptureのevaluateで全ページ（IndexedDB内`pages`ストア）を横断的にスキャンし、フキダシ本体が存在しないのに残っている`chain-ring-*`/`chain-mask-*`/`.balloon-connector-*`要素を検出するスクリプトを実行。ユーザーの1ページ（3コマ分）で該当を発見し、ユーザー確認のうえその場でSVG文字列から孤立要素のみを取り除いて保存し直した（該当コマ以外・他ページへの影響なし）。修正後、全ページ再スキャンで0件を確認。

**検証**: Kaptureで実際にレイヤーパネルの✕ボタンをクリックする操作（今回のバグ発生と同じ経路）で延長フキダシを削除し、道連れ削除・ネック除去・共有リングの再構築（残り数に応じて）が正しく行われること、保存→DB直接読み返しでゴミが残っていないことを確認済み。

**How to apply**: 同じ種類のオブジェクト（フキダシ、画像等）に対する削除操作が複数の入口（キーボードショートカット、レイヤーパネルのボタン、等）を持つ場合、道連れ削除や付随要素の後始末を伴うロジックは、片方にしか実装していないと今回のように別経路から漏れる。新しい付随要素（ネック・共有リング等）を追加する際は、既存の削除コードパスを`grep`等で全て洗い出し、共通ヘルパー関数に切り出して全ての入口から呼ぶこと。

---

## 2026-07-30（延長フキダシの共有リング・ネックが、画像挿入や重ね順変更で他オブジェクトに隠される不具合を修正）

直前の共有リング関連バグ修正（本DEVLOGの直下エントリ参照）の直後、別のユーザー報告で発覚した2件目の関連バグ。「フキダシ配置後、画像を挿入し最背面に移動したところ、フキダシの線が画像との境界で表示されなくなる」との報告。

**原因**: `_updateChainUnionRing()`/`_updateBalloonConnector()`（09b-balloon-shapes.js）が生成する共有リング・ネックは、常に「親要素の先頭（＝コマ/オーバーレイ内で絶対的な最背面）」に固定配置されていた。これは、レイヤーパネルの重ね順操作（画像を最背面へ移動、等）が対象オブジェクトを**レイヤーパネルに表示される実オブジェクトの中でのみ**並べ替える一方、共有リング・ネックはレイヤーパネルに存在しない実装上の要素であるため、その並べ替えの対象外になる。結果、「画像を最背面へ」という操作が、レイヤーパネル上のフキダシより後ろ・かつリング/ネックより前という中間位置に画像を割り込ませてしまい、画像がリング/ネックを覆い隠して線が消えた。

**修正**（`static/js/main/09b-balloon-shapes.js`）
新関数`_h2ChainAnchorNode(parent, targetNodes)`を追加。ベース・延長のうち現在のDOM順で最初に現れる（＝最も奥にある）ノードを毎回探索し、共有リング・ネック（塗り→縁取りの順）をその直前に固定するよう変更（従来の「parent先頭に固定」から「対象シェイプ群の直前に固定」へ）。呼び出しのたびに再計算するため、画像挿入や重ね順変更で他オブジェクトが間に割り込んでも、リング・ネックは常にベース/延長のすぐ奥に留まる。あわせて`_updateH2ShapePath`末尾のフックの呼び出し順を「リング→ネック」に統一（リングを後から挿入すると、先に挿入したネックより手前に来てネックを隠してしまうため）。

**副次的に発覚した検証手順上の注意点**: 修正確認のためKaptureのevaluateで対象フキダシに`savePanelSvg(panelId, svgEl)`を直接呼ぶ際、`panelId`を`state.selectedOverlay`等のUI状態から推測すると誤ったコマ/オーバーレイに保存してしまう（対象フキダシは`data-clip-panel`属性を持つコマの中にあり、オーバーレイ上ではなかった）。誤ったオーバーレイへの保存は幸いこのケースでは実害が無かった（保存先が元々ほぼ空だったため）が、修正確認の保存操作では必ず`shape.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel')`（無ければ`'__overlay__'`）で対象を特定してから`savePanelSvg`を呼ぶこと。

**検証**: Kaptureのevaluate機能でユーザーの実データ（`panel_6`内、画像を最背面へ移動済みの延長フキダシペア）に対し、修正後のコードで`_updateH2ShapePath()`を再実行→線が表示されることを確認→正しいパネルID（`panel_6`）で`savePanelSvg()`→リロード→DOM順・見た目とも維持されていることを確認済み。

**How to apply**: レイヤーパネルに現れない「実装上の補助要素」（共有リング、ネック、その他の合成用path/rect等）をSVGに追加する場合、単純に「parentの先頭/末尾に固定」する設計は、レイヤーパネル経由の重ね順操作や新規オブジェクト挿入によって他要素がその補助要素と本来のオーナー要素の間に割り込む形で壊れる。補助要素は常に「オーナー要素（群）のうち現在のDOM順で最初/最後に現れるものを起点に、毎回位置を再計算して配置し直す」設計にすること（`_h2ChainAnchorNode`のパターンを参照）。

---

## 2026-07-30（延長フキダシの共有リングが保存のたびに壊れ、コマ/オーバーレイの背景が黒くなる不具合を修正）

直前の「延長フキダシ」機能追加（本DEVLOGの直下エントリ参照）で発生した重大な回帰バグ。ユーザーから「フキダシ配置後に画像を挿入したら全コマの背景が黒くなり、フキダシの枠線も消えた。フキダシを動かすと背景は戻るが線は直らない。別ページでも再現する」との報告を受けて調査・修正した。

**原因**: `_updateChainUnionRing()`（09b-balloon-shapes.js）が生成する`<mask id="chain-mask-{baseId}">`に、保存処理（`savePanelSvg`/09b-balloon-shapes.js内の`saveOverlaySvg`）が保存対象のマスクを判定するために使う`data-ccc-mask`属性を付け忘れていた。両保存関数は`mask[data-ccc-mask]`かつ値がコマ/オーバーレイ内の要素idと一致するものだけをdefsに持ち回る仕様（04a-mask-core.jsのレイヤーマスク機構と共通の規約）で、この属性が無いマスクは保存の度に静かに欠落する。結果、連結範囲だけを型抜きするはずの共有リング`<rect>`（ページ全面サイズで作成し、mask属性で連結範囲だけに絞り込む設計だった）が、参照先のmaskを失って**mask無しの状態＝ページ全面がstrokeColor（黒）で塗りつぶされた状態**で描画されてしまい、フキダシ自身の枠線も個別には非表示にしている設計（共有リングに依存）のため、黒一色に埋もれて見えなくなっていた。画像挿入自体は直接の原因ではなく、保存（savePanelSvg/saveOverlaySvg）を伴うあらゆる操作で発生し得た。

**修正**（`static/js/main/09b-balloon-shapes.js` `_updateChainUnionRing()`）
1. `<mask>`生成時に`data-ccc-mask`属性（値はベースのid）を付与し、保存対象として正しく持ち回られるようにした。
2. 併せて、リング`<rect>`のサイズをページ全面から「チェーン各メンバーの外接矩形＋余白」に縮小。同種の不具合が万一再発しても被害をその範囲に留める防御策。

**検証**: Kaptureのevaluate機能でユーザーの実データ（オーバーレイ上の壊れたチェーン、`chain-ring-shape-1785340943021`が存在しないmaskを参照していたことを直接確認）に対し、修正後のコードで`_updateH2ShapePath()`を再実行→表示が正常化→`savePanelSvg('__overlay__', ...)`で保存→リロード→`chain-mask-shape-1785340943021`が正しくdefsに残っていることを確認済み。

**既知の制限**: この修正は今後の編集で正しく保存されることを保証するのみで、修正前に既に壊れた状態で保存済みの他ページ・他作品のチェーンは自動修復されない（該当のベースまたは延長フキダシを一度選択して少し動かす／リサイズすると、その場で正しく再生成され次回保存時から直る）。全ページを走査する一括修復スクリプトの実行はユーザーの判断で見送り（必要になれば都度対応）。

**How to apply**: このアプリで新規に`<mask>`や`<clipPath>`等の`<defs>`要素を保存対象のSVGコンテンツ内に追加する場合、`savePanelSvg`（07-pages.js）・`saveOverlaySvg`（09b-balloon-shapes.js）は「白紙から保存用SVGを再構築し、明示的に収集したdefsだけを persist する」方式のため、**新しい`<defs>`要素は保存関数側にも対応するコピーロジックを追加しない限り、次の保存で静かに失われる**。既存のマスクは`data-ccc-mask`属性の値（対象パネルid/`__overlay__`、またはそのパネル/オーバーレイ内に存在する要素id）で持ち回り判定されているため、パネル・オーバーレイに紐づくマスクを新設する場合はこの規約に乗るのが最も安全（クリップパスなど別種のdefsを追加する場合は、両保存関数の収集ロジックそのものを拡張する必要がある）。

---

## 2026-07-30（レイアウトタブのフキダシに「延長フキダシ」機能を追加）

Comic Life（市販マンガ作成アプリ）の「延長フキダシ」を参考に、1つのフキダシに同じ形状の追加フキダシをネック（連結部分）でつないで延長できる機能を追加。長いセリフを複数のフキダシに分けて配置したいという依頼に対応した。

**実装: 延長の追加**（`09c-balloon-handles.js` `addExtensionBalloon()`新規、`09a-balloon-init.js`でボタンイベント登録、`templates/index.html`に`h2-add-extension-btn`追加）
選択中のフキダシ（ベース）と同じ`shapeType`・色・タイプ別パラメータをコピーした新規フキダシを、ベース中心から右下にオフセットした位置に生成。`dataset.linkedToId`でベースのIDを保持し、`tailLength=0`にして自身の突き出し尻尾は非表示にする（ベースとの連結はすべてコネクタが担う）。ドロップダウン→挿入ボタンという既存のフキダシ挿入UIパターンに合わせ、Comic Lifeのようなパレットからのドラッグ＆ドロップ方式は採用しなかった（ユーザー承認済み）。

**実装: ネック（コネクタ）の描画**（`09b-balloon-shapes.js` `_updateBalloonConnector()`新規）
ベースと延長、両方の現在位置・回転角から境界点を毎回動的に計算し、閉じた蝶ネクタイ形のパスとして描画する。フキダシとの接合部分に境界線が見えてしまう問題があったため、塗り（`.balloon-connector-fill`、閉じた形、stroke無し）と縁取り（`.balloon-connector-border`、実際に露出する自由端2曲線のみをオープンパスでstroke）に分割し、接合部分には一切線を引かないようにした。`_updateH2ShapePath()`の末尾に、自身が延長ならコネクタを、自身がベースなら延長側のコネクタも合わせて再計算するフックを追加。リサイズ・回転・尻尾ドラッグ・本体移動などフキダシの見た目が変わるすべての経路がこの関数を通るため、この一箇所で追従を担保できる。

**実装: 位置の追従ルール**（`08-panels-images.js`の本体ドラッグ処理）
ユーザーとの検討の結果、次の3ルールで確定: ベースを移動すると延長も同じ量だけ平行移動する（相対位置を保持）／ベースをリサイズ・回転しても延長の位置には影響しない／延長を移動するとベースは動かずネックだけが伸縮する。本体ドラッグのmousedown/mousemoveに、ドラッグ対象がベースの場合はリンク済み延長の初期中心を記録し同じdx/dyを適用するカスケード処理を追加。延長側をドラッグした場合はこのカスケードが空振りし、コネクタだけが再計算される。

**実装: 尻尾が延長の外周まで届く**（`09b-balloon-shapes.js` `_h2TailBoundaryPoint()`/`_h2RayExitDistance()`新規）
フキダシ本来の尖った尻尾を、ベースから延長側へドラッグしたときに連結全体の外周まで届かせたいという要望に対応。ベースから尻尾方向へレイを飛ばし、その方向に延長フキダシがあれば境界サンプリング＋二分探索で延長側のより外側の交点を境界点として返す汎用関数を実装し、尻尾関連の境界点計算7箇所（本体描画のnormal/rect/cloudpuffy/cloudwavy分岐、ハンドル位置計算、尻尾ドラッグ処理）を置き換えた。bomb/thoughtタイプは独自のスケール処理のため今回は対象外（既知の制限）。

**実装: フキダシ同士が重なる場合の内部の線を消す（mask方式）**（`09b-balloon-shapes.js` `_updateChainUnionRing()`新規）
ネックのみの修正では、延長を大きく重ねて配置した場合にベース・延長それぞれの独立した輪郭線が交差して見える問題が残っていた。SVGにはパスの論理和(union)を作る機能が無いため、`<mask mask-type="alpha">`にベース+全延長の本体・尻尾パス（`.h2-bg-body`/`.h2-bg-tail`の`d`をそのまま複製し、各自の`angle`で`transform="rotate(...)"`を付与）を集約し、枠線太さ分だけ外側に膨らませたシルエットでstrokeColorの全面矩形を型抜きする共有リング（`<rect id="chain-ring-{baseId}">`）を実装。連結されているフキダシは個別の枠線を非表示にし（`_updateH2ShapePath`に`hasChainPartners`判定を追加）、各自のfill-layer（内側の白塗り）だけを通常どおり最前面に描画することで、結果的に連結全体の外周だけが1本のリングとして見えるようにした。延長を削除した際は`05-groups-move.js`の削除処理からベースを再描画し、枠線表示・共有リングを最新の連結状態に合わせて更新する。

**検証**: Kaptureで実機確認。フキダシ選択→延長追加でネック付き延長が正しく生成されること、延長のみ削除でコネクタごと消えベースが残ること、ユーザー自身の実データ（「いいい」「ああああ」の連結フキダシ）でネック・重なり部分の余計な線が解消されたことを確認済み（ユーザー承認）。ベース/延長のドラッグ移動・リサイズ・回転・尻尾ドラッグによるカスケード追従は、コードレビューでロジックを確認したのみで、このセッションのKaptureにドラッグ操作を模擬する手段が無く実機での網羅的な検証はできていない。

**How to apply**:
- SVGでは複数の独立した閉じた形状が重なると、それぞれの輪郭線がそのまま交差して見える。「連結された複数図形をまとめて1つの輪郭として見せたい」場合は、個別の枠線を非表示にしたうえで`<mask mask-type="alpha">`に各図形の本体パスを複製・集約し共有の「外周リング」を作る、という今回のパターンが再利用できる（本ノードにはパスの論理和を作る手段が無いため）。
- 延長フキダシの追加以降、そのフキダシが「見た目が変わるすべての経路が通る1つの関数」（本アプリでは`_updateH2ShapePath`）にコネクタ・共有リングの再計算フックを仕込むと、個別の呼び出し元（ドラッグ・リサイズ・回転処理）を変更せずに追従を担保できる。

---

## 2026-07-29（設定タブ「Inpaint設定」見出しの英語・中国語訳の欠落を修正）

直前のSelect I2I／レイアウトI2Iモーダル追加作業で発見していた既知の翻訳漏れ（`_HELP_I18N.en`/`.zh`に設定タブ「Inpaint設定」見出しが一件も存在せず、日本語版`_HELP_DATA`にしか無かった）に対応。日本語版の内容（デフォルトワークフロー指定・保存手順・有効/無効時の挙動・ブラウザ保存の旨）をそのまま英語・中国語に翻訳し、両ロケールのsettingsセクション末尾に追加。3言語とも見出し数が一致すること（settings: 5見出し、image-tab: 8見出し）を確認済み。

**How to apply**: [[comic-creator-workflow]]にある通り、ヘルプタブの英語・中国語訳は日本語版と完全に独立したデータで自動同期されない。見出し単位で丸ごと欠落することがあるため、関連機能のヘルプを触る際は都度、日本語版と同じ見出し数が3言語で揃っているか確認する。

---

## 2026-07-29（レイアウトタブの「I2I」「PI2I」ボタンを1つの「I2I」モーダルに統合）

「レイアウトタブのI2I、PI2Iを１つのモーダル（I2I）にして同様の内容で実行できるようにしたい」との依頼を受けて実装。直前に追加したImageタブ「Select I2I」パネル（本DEVLOGの直下エントリ参照）と同じ体験を、レイアウトタブでもモーダルとして提供する。

**実装: 統合モーダル**（`static/js/main/15-pixifx-bridge.js` `openLayoutI2IModal()`新規）
`templates/index.html`の`layout-i2i-send-btn`（I2I）・`layout-pi2i-send-btn`（PI2I）の2ボタンを、常時有効な単一の`layout-i2i-modal-btn`（ラベル「I2I」）に統合。クリックで開くモーダルは、`.tsm-overlay`/`.tsm-dialog`パターン（09f-bubble-text.js等と同型）で実装し、Target（選択画像／ページ全体）トグル・Positive/Negative Prompt・Denoise・Run・I2I設定（デフォルトワークフロー使用チェック＋ファイル名、`14-integrations.js`の`getI2ISettingsState`/`saveI2ISettingsState`をそのまま使用しSelect I2Iパネルと共有）を持つ。実行は既存の`sendI2IRunToWorkflowStudio()`ブリッジをそのまま流用（Workflow Studio側の変更は不要）。既存`sendSelectedImageToI2I()`/`sendCurrentPageToI2I()`の画像Blob取得部分を`_getSelectedImageBlob()`/`_getPageBlob()`に切り出して共通化し、元の2関数は削除（`sendImageToWorkflowStudioI2I`自体はImageタブの「I2Iへ送る」ボタンが引き続き使うため残置）。`04b-layer-panel-render.js`の旧ボタン無効化ロジック、`16-processing-edit-tabs.js`のボタンイベント登録もあわせて更新。

**実機フィードバックによる追加修正（4点）**
1. **Layerモードと同じ「新規追加」方針への統一**: 当初「選択画像」対象のRun結果はページ全体対象と同様に単純挿入する設計だったが、実装時点でレイアウトタブに「選択中の画像を置き換える」汎用関数が存在しないと判明。Select I2Iパネルでも直前のセッションで同様の理由から「新規レイヤー追加」に統一した経緯があったため、レイアウトタブも一貫して常に新規画像として挿入する設計で確定（ユーザー確認済み）。
2. **ページ全体対象の挿入先とサイズ**: 実機確認後、「ページ全体の生成結果はオーバーレイに追加したい」「サイズが小さくなっている」の2点フィードバックを受けて対応。`insertImageFromUrl()`（`08-panels-images.js`）に`placement`引数を追加（後方互換のため省略可）し、`insertImage(dataUrl, imgW, imgH, {}, placement)`へそのまま渡せるようにした。`_pi2iResolvePagePixelSize()`がSVG座標系（mm×100）でのページサイズ`svgW`/`svgH`も返すよう拡張し、`_getPageBlob()`の戻り値を`{blob, pageW, pageH}`に変更。ページ全体対象のRunでは実行直前に`state.selectedOverlay = true`をセットしてから`insertImageFromUrl(result.url, {x:0, y:0, width:pageW, height:pageH})`を呼ぶことで、常にオーバーレイへページ全面サイズ（`insertImageToOverlay`の既定=挿入先の40%縮小を回避）で挿入されるようにした。
3. **対象トグルの視認性**: 「対象選択ボタンの選択状態がわかりにくい」というフィードバック。原因はCSSの設計自体にあった——`.btn.active`という汎用ルールは存在せず、既存の`.tmplwiz-orientation-buttons .btn.active`/`.btm-shape-btns .btn.active`のように**親要素でスコープしたセレクタでのみ**背景色が定義されている（`active`クラス単体では見た目が変わらない）。同様に`.btn.primary`という汎用ルールも存在しない。新規`.li2i-target-btn.active { background-color: var(--primary-color); color: white; }`をstyle.cssに追加して解決。
4. **レイアウト微調整**: Positive/Negative textareaを3行→5行に、モーダル幅を900px→720px（`.li2i-dialog`、既定の`.tsm-dialog`比20%減）に、本文左右にpadding 24px（`.li2i-body`）を追加。Runボタンは`margin-left:auto`でステータステキストと分離し行右端に配置。

**検証**: Kaptureで実機確認（`15-pixifx-bridge.js`は非moduleのため`window.関数名=...`で直接上書きしリロード不要で検証）。選択画像対象・ページ全体対象の両方でRun→実際にWorkflow Studioで生成→結果が新規画像として正しい挿入先・サイズで反映されることを確認。

**How to apply**:
- レイアウトタブに新しい`.btn`ベースのトグルボタン群を追加する際、`active`クラスをtoggleするだけでは見た目が変わらないことがある（既存の`.btn.active`ルールがすべて親要素スコープ付きのため）。新規トグルには対応するスコープ付きCSS（`.独自クラス.active {...}`）を必ず追加すること。同様に`.btn.primary`も見た目に影響しない可能性があるため、色を保証したい場合はスコープ付きCSSか既存の`.btn.primary`実装箇所を確認してから使う。
- `insertImage()`系の関数は「コマ/オーバーレイ幅の40%」という既定サイズを前提にしている。ページ全体のI2I結果のような「対象そのものと同じサイズで挿入したい」ケースでは、`placement`引数を明示的に渡す必要がある（省略すると意図せず縮小される）。

---

## 2026-07-29（Imageタブ Selectツールに常時I2Iパネル「Select I2I」を新規追加、I2I設定を設定タブから移設）

「Imageタブのセレクトメニューもプロパティを常時表示、マスクメニューのinpaintのようにI2I用のPositive Prompt、Negative Prompt、Ksampler設定Denoise、Run、I2I設定（設定タブのI2I設定を移設）をしたい」との依頼を受けて実装。既存のMaskツール「Inpaint」サブツール（プロパティパネル常時表示＋その場でWorkflow Studio実行→結果を新規レイヤーとして反映、という完成済みパターン）をマスク処理抜きで踏襲した。

**実装1: comic-creator側 image-tab.js**
`_setActiveTool()`のプロパティペイン非表示条件（`toolId !== "mask" && ... !== "fill"`）に`&& toolId !== "select"`を追加し、Selectツール選択中も`#ie-props-pane`が常時表示されるようにした。新規`_renderSelectI2IProps()`（`_renderMaskProps("inpaint")`と同型）で、Target（All/Layerトグル）・Positive/Negative Prompt・Denoise・Run・ステータス・I2I設定の各UIを`#ie-props-body`にinnerHTML生成する。実行本体`_runSelectI2I()`は、Allモードは`_buildCompositeCanvas()`（既存のInpaintと同じ合成）、Layerモードは`this._layerMgr.activeLayer.canvas`（変形前の生コンテンツ）をPNG化して`sendI2IRunToWorkflowStudio()`へ渡す。結果の反映は当初「Layerモードは元レイヤーのcanvas内容を直接差し替え」で実装したが、実機確認後のフィードバックで「Layerモードも新規レイヤーとして追加したい」と修正依頼があり、新規`_addI2IResultAsLayer()`に差し替えた。元レイヤーと同じ`displayW/displayH/x/y/rotation/flipX/flipY`を引き継いだ新規レイヤー（名前は`<元レイヤー名> I2I`）を追加し、元レイヤー自体は変更しない（Allモードは従来どおり`_loadFromDataUrl(result.url, "I2I Result")`で新規レイヤー化、これは無改造）。

**実装2: I2I設定の移設**
設定タブの「I2I設定」ブロック（`templates/index.html`、デフォルトワークフロー使用チェック＋ファイル名）を削除し、Select I2Iパネル内に同等のUIを新設。`14-integrations.js`の`initI2ISettings()`（設定タブDOM前提の初期化）を削除し、代わりに`window.getI2ISettingsState()`/`saveI2ISettingsState()`という薄いgetter/setterに置き換えた。設定データ自体（`_i2iSettings`、localStorage `ccc_i2i_settings`）はレイアウトタブの既存I2I送信（`sendImageToWorkflowStudioI2I`）と共有のため変更していない。`01-state.js`の設定タブ初期化からは`initI2ISettings()`呼び出しを削除（`initInpaintSettings()`は据え置き、Inpaint設定は今回移設対象外）。

**実装3: Workflow Studio側（別リポジトリ、新規ブリッジ）**
既存のInpaint実行ブリッジ（`gallery-tab.js`の`_wfmReceiveInpaintRequest` → `image-edit-tab.js`の`runInpaintExternal`/`_runInpaintWithImages`）を参考に、マスク不要のI2I版を新設。`image-edit-tab.js`に`_runI2IWithImage()`（`comfyEditor.applyImageToSlot()`→`setPromptText()`×2→`setInpaintParams({denoise})`→`window._wfmGenerateTab.generate()`→結果URL取得）と外部エントリポイント`runI2IExternal()`を追加。`setInpaintParams()`は`growMaskBy`未指定なら自動的にスキップされる既存実装だったため、denoise単体用の新規セッターは不要だった。`gallery-tab.js`に`window._wfmReceiveI2IRunRequest`を追加し、`comic-creator`側からの呼び出しを受ける。既存の`_wfmReceiveImageForI2I`（画像を送るだけ、レイアウトタブのI2I/PI2Iボタンが使用）は無改造。変更後、開発リポジトリから`custom_nodes\comfyui-workflow-studio\`（ComfyUI本体側、シンボリックリンクではなく通常コピー）へ手動反映。

**検証**: Kaptureで実機検証。`window._ccImageTab`のプロトタイプに新規メソッドを注入し、ページをリロードせずにUI・実行フロー（All/Layer両モードでの実際のI2I生成→新規レイヤー追加）を確認した。

**ドキュメント**: ヘルプタブ（`_HELP_DATA`日本語＋`_HELP_I18N.en`/`.zh`）に新規見出し「Select I2I（Workflow Studio連携）」を追加し、既存の設定タブ・I2I連携（Workflow Studio）の解説もUI移設を反映。README（3言語）にも同内容を追記。あわせて、既存の「Inpaint（Workflow Studio連携）」見出しと設定タブ「Inpaint設定」見出しが英語・中国語訳に一件も存在しない（日本語版のみ）という既存の翻訳漏れを発見。Image タブの Inpaint 見出しは今回の作業ついでに英語・中国語へ追加したが、設定タブの Inpaint 設定見出しの翻訳漏れは今回のスコープ外として未対応のまま残した。

**How to apply**:
- Workflow Studio連携で「その場で実行し結果を受け取る」機能（Inpaintパターン）を新設する際は、`comfyEditor.applyImageToSlot`/`setPromptText`/`setInpaintParams`/`window._wfmGenerateTab.generate`が既にマスクなし用途にも流用できる設計になっている（`growMaskBy`等のオプション引数は未指定なら書き込みをスキップする）。新規のI2I的な機能を追加するたびにWorkflow Studio側のプリミティブを増やす必要は薄い。
- Kaptureでリロード禁止の検証を行う際、`type="module"`で読み込まれるクラス（`window._ccImageTab`のようにwindow公開されているインスタンス）は、`Object.getPrototypeOf(instance)`にメソッドを直接生やせば、ページをリロードせずに新規実装の動作確認ができる。iframe埋め込みの別アプリ（Workflow Studio）側の変更は、`iframe.contentWindow.location.reload()`でiframeだけ再読み込みすれば反映できる（ホストページ全体のリロードは不要）。
- ヘルプタブの英語・中国語訳（`_HELP_I18N`）に日本語版と比べて見出し自体が丸ごと欠落していることがある（今回のInpaint関連2見出し）。新機能のドキュメントを書く前に、関連する既存見出しがそもそも3言語揃っているか確認する価値がある。

---

## 2026-07-28（ペイントツールに背景色指定・画像への直接描画・複数画像統合を追加、統合直後にドラッグできない不具合を修正）

前回追加したペイントツールの実機検証フィードバックを受けて3点追加、実装中に見つかったバグを1点修正した。

**追加1: ペイントオブジェクト作成時の背景色指定**（`static/js/main/17d-layer-draw-paint.js` `_paintAddObject`）
透過画像に描画した状態でI2I送信すると、多くの生成モデルが透過部分を黒として解釈してしまい意図しない結果になるとのフィードバックを受けて対応。「ペイントを追加」ボタン左隣に「背景色」チェックボックス＋カラーピッカーを追加し、ONの場合はcanvasを`ctx.fillRect()`で指定色に塗りつぶしてから`toDataURL()`する（OFF時は従来通り全透過）。

**追加2: 通常画像への直接ペイント**（`_paintMouseDown`）
これまでは`data-ccc-paint-object="1"`が付いたペイントオブジェクトにしかブラシ描画できなかったが、選択中の`.inserted-image`要素であれば通常画像（アセットから挿入した写真等）にも直接描き込めるよう判定条件を緩和した。

**追加3: 複数画像の統合（Imageタブのレイヤー統合と同等機能）**（新規`_paintMergeSelected`）
I2Iは選択中の1オブジェクトしか送信できないため、複数レイヤーをまとめて送りたい場合の対応として実装。レイヤーパネルの既存チェックボックス機構（`state.checkedLayerEls`、グループ化「G+」と同じ仕組み）を再利用し、`.inserted-image`（画像・ペイントレイヤーいずれも対象）を2つ以上選択→「選択画像を統合」ボタンで合成する。同一コマ／オーバーレイ／下書き内であることを前提とし、各画像の絶対座標系での四隅（`transform`による回転を考慮）からユニオンのバウンディングボックスを算出、選択画像のクローンを含む単独SVGを構築して`convertShapeToImage`（09c-balloon-handles.js）と同じ手法でラスタライズ→1枚のPNGに合成する。元の画像は削除され、統合結果に置き換わる（重ね順は維持）。図形・テキストは「画像に変換」で画像化すれば統合対象にできるため、任意のオブジェクトをI2I用に柔軟に合成できる。

**バグ修正: 統合直後に画像をドラッグ移動できないことがある**
`_paintMergeSelected`は当初、DOM操作（元画像の削除＋統合結果の挿入）と`savePanelSvg`による保存のみを行い、`renderLayoutTab()`（DOM全体の再構築）を呼んでいなかった。複製・移動など他の全てのDOM変更系処理は必ず`renderLayoutTab()`で再構築し`initImageManipulation`等のイベントリスナーを再バインドしているのに対し、統合処理だけこれを省略していたため、統合直後だけ稀にドラッグイベントの委譲が正しく効かなくなっていた（「別コマへ移動すると直る、元のコマへ戻しても直る」という報告から判明。移動処理は必ず`renderLayoutTab()`を経由するため、それが暗黙の「直す」動作になっていた）。他の複製・移動系処理と同じパターン（DOM操作→保存→`renderLayoutTab()`→IDで再取得して再選択）に統一して解消。

**How to apply**: レイアウトタブでライブDOMを直接操作（要素の追加・削除・並べ替え）した後、その場で選択・ハンドル表示だけを更新して`renderLayoutTab()`を省略すると、保存やレイヤーパネル表示は正しく動いても、ドラッグ等のインタラクションだけが不安定になることがある。既存の複製・移動処理が例外なく処理の最後に`renderLayoutTab()`→IDで再取得→`_selectClone()`という手順を踏んでいるのは、この非対称性を避けるための一貫パターンである。新しくDOM変更系の機能を追加する際は、パフォーマンス上の理由がない限りこのパターンに従うこと。

---

## 2026-07-28（レイアウトタブに「ペイントツール」を新規追加、コマ間オブジェクト移動・保存の複数バグを修正）

「レイアウトタブにペイントツールを追加したい」との依頼を受けて実装。開発途中の実機検証で複数のバグ報告を受け、同セッション内で調査・修正した。

**実装: ペイントツール**（`static/js/main/17d-layer-draw-paint.js` 新規）
既存の「ドロー」（SVGベクター図形描画、17a〜17c）とは意図的に完全分離した独立サブタブとして実装（最初はドロー内の1シェイプ種別として実装したが、「既存ドローツールと分けたい」との要望を受けて独立タブへ再構成）。「ペイントを追加」ボタンで、選択中のコマ／オーバーレイ／下書きレイヤーのサイズにジャストフィットする透過PNG（`<image data-ccc-paint-object="1">`）を生成・挿入し、自動選択＋描画ON状態にする。描画ON中はオーバーレイ用の透明canvasでマウスイベントを捕捉し、選択中のペイント画像のビットマップをオフスクリーンcanvasにデコードして丸ブラシで描画、都度`href`を`toDataURL()`で更新する方式（ラスタライズ解像度は図形PNG変換と同じ`MAX_DIM=2000`スケール）。ブラシサイズはスライダー化、消しゴム・x5（5倍サイズで描画、スライダー値自体は変更しない）はいずれもトグルボタン化しON/OFFを背景色で明示。レイヤーパネルでは`data-ccc-paint-object`を見て🖌アイコン・「ペイント」名で通常画像と区別する。

**バグ修正1: 削除済みオブジェクトがペイント追加時などに復活する**
`savePanelSvg`/`saveOverlaySvg`/`saveDraftSvg`/`insertImage`系/複製/移動はいずれも「`state.activePage`を読む→変更を反映→`dbPut`→`state.activePage`を更新後の値に差し替える」処理を個別に行っており、削除やペイント追加を短時間に連続実行すると、後発の呼び出しが先発の呼び出しの`state.activePage`更新前に古い内容を読んでしまい、先発の変更（削除）が後発の保存で上書き消失していた。`00-db.js`にグローバル直列化キュー`_enqueueActivePageSave`を新設し、`state.activePage`を読み書きする8箇所全てをこのキュー経由に統一して解消。

**バグ修正2: ドロー図形・ペイントオブジェクトを別コマへ移動するとバウンディングボックスが元の位置に残る／消える**
3段階の不具合が重なっていた。(1) `_applyCenterTranslate`/`_applyOffset`（`06a-polygon-geometry.js`）が矩形・画像・テキスト以外の図形を「未分類」として`transform`の追加のみで動かしていたが、`_drawShapeGetBounds`（バウンディングボックス計算）は生のx/y・cx/cy・points等しか見ないため座標系がズレていた。図形種別ごとに正しい生座標を直接更新するよう修正。(2) `_drawUpdateTransformForPathG`（曲線・鎖・ロープ・My曲線・ベクター曲線のtransform再計算、`17c-layer-draw-handles.js`）が`el.ownerSVGElement`に依存しており、移動・複製処理でクローンをDOM未接続のまま座標更新すると`null`になり関数が何もせず抜けていた（＝data-x/data-yだけ新位置になり実描画位置は移動前のまま）。未接続時は使い捨ての`<svg>`要素で代替するよう修正。(3) `moveSelectedObject`/`duplicateSelectedObject`（`05-groups-move.js`）の移動元中心座標`srcCx/srcCy`が`el.getBBox()`（要素の生ジオメトリ、transform除外）から計算されていたため、一度でも移動・リサイズ済みのpath/g系図形では実際の現在位置とズレた中心を基準に移動先座標を計算してしまい、繰り返し移動すると誤差が蓄積してコマ外（クリップ範囲外）へはみ出し非表示になっていた。path/g系図形は`data-x/data-y/data-w/data-h`から直接中心を計算するよう修正。Kaptureで実機検証し、移動後の中心座標が移動先コマの重心と一致することを確認済み。

**ドキュメント**: ヘルプタブ（日本語版`_HELP_DATA`および英語・中国語翻訳`_HELP_I18N`）とREADME（3言語）にペイントツールの説明を追加。あわせて、英語・中国語のヘルプ翻訳が以前から日本語版に対して欠落していた項目（サブコマ節・マンガサブタブ節が丸ごと未翻訳、下書きレイヤー・PI2Iの説明が欠落）に気づいたため、「レイアウト」セクション全体を日本語版と同じ17見出し構成へ揃えた。

**How to apply**:
- SVGレイヤーへの描画機能で新しい図形種別・操作モードを追加する際は、`_applyCenterTranslate`/`_applyOffset`（コマ間移動・複製時の座標変換）が対象タグを正しく認識できるか必ず確認する。「未分類の図形」フォールバック（`transform`の追加のみ）は、独自の生座標（x/y以外の位置表現）を持つ要素には使えない。
- `el.ownerSVGElement`はライブDOM接続時のみ値を持つため、クローン→座標更新→DOM挿入という順序の処理（複製・移動系）で`SVGMatrix`を使う関数を呼ぶ場合は、未接続でも動作するようフォールバック（使い捨ての`<svg>`要素等）を用意すること。
- `state.activePage`を`{...state.activePage, X: Y}`の形で読み書きする処理が複数箇所に分散している設計では、短時間の連続操作（削除連打・複数追加など）で読み取りタイミングが競合し、片方の変更が失われるバグが起きやすい。同種の処理を追加する際は、既存の`_enqueueActivePageSave`キューに必ず乗せること。
- ヘルプタブの英語・中国語訳（`_HELP_I18N`）は日本語版（`_HELP_DATA`）と完全に独立したデータであり、自動同期されない。日本語のヘルプを更新した際は、同じ`id`の英語・中国語エントリも忘れずに更新する（[[comic-creator-workflow]]のヘルプ更新手順に「3言語とも」の確認を追記する価値がある）。

---

## 2026-07-27（本セッションで追加した5機能をヘルプ・READMEへ反映）

「ヘルプを更新してください」「README、DEVLOGを更新してください」との依頼を受け、本セッションで実装した以下5点をアプリ内ヘルプタブ（`static/js/main/22-help-tab.js`、日本語のみ・全言語共通表示）とREADME（`README.md`/`README_en.md`/`README_zh.md`の3言語）に反映した。

- サブコマのレイヤーパネルからの複製・移動（オーバーレイへの移動含む）
- アセットパネル「テンプレート」タブのグループ折りたたみ表示
- Imageタブ Selectツールの「✂ クロップ」機能
- Imageタブのレイヤーグループ（📁）機能とレイヤーパネル上部メニューの2行化
- レイアウトタブの「PI2I」（ページ全体をPNGでWorkflow Studioへ送信）機能

ヘルプタブ側は、レイアウトタブの既存「I2I連携（Workflow Studio）」の解説と設定タブの既存「I2I設定」の解説を相互参照させ、デフォルトワークフロー自動読み込み設定が「I2I」「PI2I」の両ボタンに共通で効くことを明記した。

**How to apply**: ヘルプタブのデータ（`_HELP_DATA`）は日本語のみの単一配列で、UIの表示言語設定に関わらずヘルプ内容は常に日本語表示になる（i18n.jsの3言語辞書とは別系統）。機能追加時にヘルプへ反映する際は、この配列内の該当セクション（`id`と`heading`で特定）を探して追記すればよく、i18n側の翻訳作業は不要。README側は3ファイルとも同じ見出し構成で並行しているため、1機能につき3ファイルへ同内容を翻訳して反映する。

---

## 2026-07-27（レイアウトタブに「PI2I」機能を新規追加、ページ全体をWorkflow StudioのI2Iへ送信）

「ページI2I機能（PI2I）を追加したい。ページとしてPNGで出力、WorkflowStudioに送ります」との依頼を受けて実装。

既存の「I2Iへ送る」ボタン（`sendSelectedImageToI2I`、`static/js/main/15-pixifx-bridge.js`）は選択中の`<image>`要素1枚をBlob化して送るだけの単一画像版だったが、送信先の`sendImageToWorkflowStudioI2I(blob, name, sourceTab)`（`14-integrations.js`）自体は任意のBlobを受け取れる汎用実装で、`state.selectedImageEl`には一切依存していなかったため、ページ全体のPNG化さえ用意すれば流用できることが分かった。ページ全体のPNG化も、既存のPDF/EPUB/PNG出力（`12-text-png-export.js`の`handleExport()`）が使っている経路（`buildMergedSvg`→`embedFontsInSvg`→`drawSvgOnCanvas`→共有`#render-canvas`の`canvas.toBlob`）をそのまま流用できたため、新規のPNG化ロジックは書かず、既存の出力パイプラインに乗せた。

**実装**:
- `static/js/main/15-pixifx-bridge.js`: 新規`sendCurrentPageToI2I()`。`state.activePage`から`dbGet('pages', ...)`でpageRecordを取得→`buildMergedSvg(pageRecord)`（既存出力と同じくオプション無し＝下書きレイヤーは含めない）→`embedFontsInSvg`→共有`#render-canvas`に白背景で`drawSvgOnCanvas`→`canvas.toBlob('image/png')`→`sendImageToWorkflowStudioI2I(blob, pageRecord.name, 'layout')`という一連の流れ。単一画像版の`sendSelectedImageToI2I`と同じエラーハンドリング（`layout.msgWfmI2ISendFailed`）に合わせた。
- `templates/index.html`: レイアウトタブの上部メニューに「PI2I」ボタン（`#layout-pi2i-send-btn`）を「I2I」ボタンの直後に追加。画像選択に依存しないため（既存の「I2I」ボタンと異なり）常時有効。
- `static/js/main/16-processing-edit-tabs.js`: クリックハンドラを`sendSelectedImageToI2I`の登録直後に追加。
- `static/js/i18n.js`: `layout.sendToPi2iBtn`/`sendToPi2iTitle`/`msgNoActivePage`をja/en/zhに追加（`msgNoActivePage`はページ未オープン時のガード用。既存の`msgSelectImageFirst`は文言が「画像を選択」に固定されておりページ未オープンの文脈と合わないため、専用キーを新設した）。

**How to apply**: 「単一オブジェクトを外部連携へ送る」機能（今回のI2I）を「ページ全体」等の広い単位に拡張したい場合、まず送信先の橋渡し関数（`sendImageToWorkflowStudioI2I`等）が本当に対象オブジェクト固有の状態（`state.selectedImageEl`等）に依存しているか確認するとよい。多くの場合、橋渡し関数自体は「Blobを受け取って送るだけ」の汎用実装になっており、新しく用意すべきは「対象をBlobに変換する経路」だけで済む。今回のようにその変換経路（SVG→PNG）が別の既存機能（PDF/EPUB/PNG出力）で既に確立済みなら、それをそのまま呼び出すのが最小実装になる。

**追記（同日、実機検証後）**: 実機で「Workflow Studioへの送信に失敗しました: Blob生成失敗」が発生（ComfyUI再起動後も再現、ワークフロー自体は生成可能とのことでcanvas側の問題と判断）。原因は`canvas.width = pageRecord.width; canvas.height = pageRecord.height;`で、`pageRecord.width/height`はピクセル数ではなく**SVG座標単位（mm×100相当。A4なら21000×29700）**で保持されている値だったこと。これをそのままcanvasのピクセルサイズに使うと約6億2000万ピクセル相当の巨大canvasになり、`canvas.toBlob()`が（例外を投げず）コールバックに`null`を返して`page.errBlobGenFailed`に落ちていた。出力タブの解像度自動計算（`_applyExportDpi`、`10-output-pages.js`）が同じmm×100値を`mm = 値/100`→`px = mm * dpi / 25.4`で変換し`_EXPORT_MAX_SIZE`（8000px）でクランプしているのと同じ考え方を、新設の`_pi2iResolvePagePixelSize(pageRecord)`として`15-pixifx-bridge.js`内に実装（DPIは固定150、`_EXPORT_MAX_SIZE`は出力タブの定数をそのまま流用）。`pageRecord.width/height`が無い/不正な場合はsvgContentの`viewBox`からもフォールバック取得するようにした。

**How to apply（追記）**: このアプリでは「作品/ページのwidth・height」はどこで保持されていても一貫して**SVG座標単位（mm×100）**であり、ピクセル値ではない（`WORK_SIZE_PRESETS`のA4が`{width:21000, height:29700}`であることからも分かる）。新しくcanvasへラスタライズする処理を書く際は、既存の出力コード（`12-text-png-export.js`/`10-output-pages.js`）のように必ずDPI等でpx換算してから`canvas.width/height`に設定すること。巨大canvasでの失敗は例外にならず`toBlob`/`toDataURL`が`null`を返すだけなので、開発中に気づきにくい。

---

## 2026-07-27（Imageタブにレイヤーグループ機能を追加、レイヤーパネル上部メニューを2行化）

「レイヤーグループを可能にしたい。レイヤー上部メニューを2行にして下段にグループと統合ボタンにしてください」との依頼を受けて実装。

ImageタブのレイヤーモデルはLayoutタブ（SVG、`state.activePage.panels[]`）とは全く別物で、`LayerManager.layers`が実ピクセルを持つ`Layer`オブジェクトのフラット配列（`composite()`が配列順そのまま前面→背面の合成順として扱う）だったため、グループを配列内の疑似レイヤー（`type:"group"`等）として実装すると`composite`/`mergeLayers`/`toJSON`/`fromJSON`など複数箇所に分岐追加が必要になり影響範囲が大きくなる。そこで、各`Layer`に`groupId`フィールドを追加し、`LayerManager.groups`（`{id, name, collapsed}`の配列、メンバーは`layer.groupId`で判定）という**配列の外側にある並行レジストリ**として実装した。これにより`layers`配列自体の並び（＝実際の合成順）には一切手を加えず、レイヤーパネルの表示だけがグループヘッダー配下にメンバーをまとめて描画する（Layoutタブのサブコマで使った「データの配列順は変えず表示だけ並べ替える」パターンと同じ考え方）。

**実装**:
- `static/js/image-tab/LayerManager.js`: `Layer`に`groupId`（デフォルトnull）を追加し`toJSON`/`fromJSON`にも反映。`LayerManager`に`groups`配列を追加し、`createGroup(layerIds, name)`（2枚以上選択時のみグループ化、既に別グループにいた場合はそちらから抜ける）・`ungroup(groupId)`・`toggleGroupCollapsed(groupId)`・`setGroupVisible(groupId, visible)`・`_pruneEmptyGroups()`（メンバー0枚になったグループ定義を自動掃除、`deleteLayer`/`mergeLayers`/`createGroup`後に呼ぶ）を新設。`mergeLayers()`は統合対象が全て同一グループのメンバーだった場合のみ統合結果もそのグループに残す。`duplicateLayer()`も複製後に元と同じグループへ残すよう`groupId`をコピー。`LayerManager.toJSON`/`fromJSON`（マネージャー単位）にも`groups`を追加し、Undo/Redoでグループごと復元できるようにした。
- `static/js/image-tab.js`: `_refreshLayerList()`を、`layers`配列の並び順を保ったまま`groupId`でメンバーをまとめてグループヘッダー（📁アイコン・件数・一括表示/非表示ボタン・解除ボタン、クリックで折りたたみ）配下に描画するよう変更（`_renderLayerRowHtml`/`_renderGroupHeaderHtml`に処理を切り出し）。新規`_groupSelectedLayers()`を追加し、レイヤーパネルの既存の複数選択（Shift+クリック、`_selectedLayerIds`）をそのまま「グループ化するレイヤーの選択」として流用した。
- `templates/index.html` / `static/css/image-tab.css`: レイヤーパネル上部の`.ie-layers-header`（1行）を2行に分割し、1行目に既存のAdd/Mask追加/削除/上へ/下への各ボタン、新設の2行目（`.ie-layers-header-row2`）に「📁 グループ」ボタンと、既存の「統合」ボタン（`#ie-flatten-btn`、元々1行目末尾にあったものを移動）を配置。
- `static/js/i18n.js`: `image.group`/`groupTitle`/`groupSelectFirst`/`groupDone`/`ungroup`/`ungroupTitle`をja/en/zhに追加。

「統合」ボタン自体は今回新規実装したものではなく、既存の`mergeLayers()`（選択レイヤーのみ統合、2026-07-24のInpaint機能追加時にマスクレイヤー対応で修正済み）に繋がる既存ボタンをレイアウト変更に伴い2行目へ移設しただけである。

**How to apply**: 既存のデータモデル（今回で言う`LayerManager.layers`の「配列順＝実際の描画/合成順」という不変条件）を壊さずに新しい「グルーピング」概念を追加したい場合、対象の配列に疑似要素を混ぜ込むより、外側の並行レジストリ（id参照ベースのメンバーシップ）として実装する方が、既存の合成・シリアライズ・統合ロジックへの影響を最小化できる。表示順の組み替えが必要な場合も、実データの並びには手を付けず「レンダリング時にメンバーをまとめて描画する」だけで対応できる（[[comic-creator-workflow]]のサブコマ表示順対応と同じ考え方）。

---

## 2026-07-27（ImageタブのSelectメニューに「クロップ」ツールを新規追加）

「Selectメニューにクロップボタンを追加。オーバーレイのクロップエリアをサイズ変更し実行としたい。メニューにはx,yでサイズしても可能にしたい」との依頼を受けて実装。

Imageタブのキャンバス/レイヤーモデルを調査したところ、各レイヤーは自身のネイティブ解像度の独立した`<canvas>`（`layer.canvas`）を持ち、ページ全体上の配置は`layer.x/y`（絶対座標）で表現されている（`LayerManager.composite`が`layer.x/y`起点で合成し、ページキャンバス境界外はそのまま描画クリップされる仕組み）ことが分かった。このため「クロップ」は各レイヤーのピクセルデータを一切書き換えず、①`_canvasW/_canvasH`（ページ全体サイズ）とクロップ後サイズへ縮小、②全レイヤーの`x/y`をクロップ原点分シフト、③`#ie-canvas-draw`/`#ie-canvas-overlay`/`#ie-canvas-container`のリサイズ、の3点だけで実現できる設計にした。

**実装**:
- `static/js/image-tab.js`: Selectツールのオプションパネル（`_renderToolOptions`の`toolId === "select"`分岐）に「✂ クロップ」トグルボタンを追加。ONにすると`#ie-canvas-overlay`上にドラッグ可能なクロップ範囲（半透明の範囲外オーバーレイ＋点線枠＋四隅/四辺中点の8ハンドル、`_drawCropOverlay`/`_cropGetHandlePositions`/`_cropHitHandle`）を表示し、同時にX/Y/W/H数値入力欄も表示してドラッグ・数値入力のどちらでも範囲を調整できるようにした（`_onCropMouseDown`/`_onCropMouseMove`をSelectツールのマウスディスパッチ内に分岐追加）。「実行」ボタンで`_applyCrop()`を呼び、上記3点の変更を適用する。「キャンセル」またはクロップボタン再クリックで`_exitCropMode()`により編集前の状態のまま抜けられる。
- `_initCanvases()`内のキャンバス要素リサイズ処理（`ie-canvas-draw`/`ie-canvas-overlay`/`ie-canvas-container`のwidth/height設定）を`_resizeCanvasElements(w, h)`として切り出し、新規キャンバス作成時とクロップ実行時の両方から共通で呼べるようにした（`LayerManager`の再構築は伴わない、既存レイヤーを維持したままのリサイズ用）。
- `static/js/image-tab/LayerManager.js`: `fromJSON()`が`toJSON()`で保存していたはずの`width`/`height`を復元していなかった（従来はキャンバスサイズを変える操作自体が存在せず、Undo/Redoで顕在化していなかった潜在バグ）ため修正。あわせて`image-tab.js`の`_restoreState()`（Undo/Redo共通処理）で、復元後の`layerMgr.width/height`が現在の`_canvasW/_canvasH`と食い違っていれば`_resizeCanvasElements`で同期するようにし、クロップ操作もUndo/Redoで正しくキャンバスサイズごと戻る/やり直せるようにした。
- `static/js/i18n.js`: `image.cropBtn`/`cropBtnTitle`/`cropXLabel`/`cropYLabel`/`cropWidthLabel`/`cropHeightLabel`/`cropApply`/`cropCancel`をja/en/zhに追加。

**How to apply**: Imageタブのようにレイヤーがページ座標系へ絶対配置される合成モデル（`layer.x/y` + `composite`時にキャンバス境界でクリップ）を持つエディタでキャンバスサイズを変更する機能を作る場合、レイヤーのピクセルバッファ自体を再サンプリングする必要はなく、「ページサイズを変える」＋「全レイヤーのオフセットをシフトする」の2点で足りる。また`toJSON`が保存している値は将来的に何かの操作がその値を変更する可能性がある以上、対応する`fromJSON`側で必ず復元しておかないと、Undo/Redoが暗黙に「その値は不変」という前提に依存してしまい、後から来た機能（今回のクロップ）が原因不明の状態不整合を起こす。

---

## 2026-07-27（アセットパネルのテンプレート"T"タブをグループ折りたたみ表示に対応）

「テンプレート数が増えることでサムネが小さくなりすぎる対策とグループ表示による素早い選択を兼ねたい」との依頼を受けて実装。対象範囲（テンプレートTタブのみ／ページPタブは対象外）とグループ分けの基準（既存のテンプレートグループ機能を流用）は質問して確認した。

「ページ」タブ→「テンプレート」サブタブ側に既にグループ管理機能（`_tmplGroups`、`06b-template-manager.js`。グループの作成・削除・リネームとテンプレートの割り当てをlocalStorage `template_groups` に永続化）があったため、新しいデータ層は作らず、アセットパネル側の表示だけをこのデータを読んで組み替える形にした。

**実装**:
- `static/js/main/11a-work-manager.js`: `renderAssetTemplateGrid()`を、テンプレートを`_tmplGroups.groupOf()`でグループ別に振り分けてから描画するよう変更。グループは`.asset-folder`（アセットツリーの折りたたみフォルダと同じCSSクラス、`static/css/style.css`）のヘッダー行＋件数バッジで表示し、クリックで展開/折りたたみを切り替える。展開状態はモジュールスコープの`_assetTmplExpandedGroups`（Set）に保持し、初期状態（未展開）は空集合＝全グループ折りたたみになる。グループ未所属のテンプレートは従来通りヘッダー無しでそのまま並べるため、グループ機能を使っていないユーザーには見た目の変化がない。空グループ（所属テンプレート0件）は表示しない。
- `static/css/style.css`: グループ内カード列用の`.asset-tmpl-group-list`（`.asset-list`と同じ考え方で`.collapsed`時`display:none`）と件数バッジ`.asset-tmpl-group-count`を追加。

**How to apply**: 同じ「グループ分け」概念を複数のUI（今回は「ページ」タブのテンプレート管理と、アセットパネルのテンプレートタブ）で使う場合、データ層（`_tmplGroups`等）を一本化して片方は表示専用にすると、グループの作成・削除・リネーム・割り当てロジックを二重実装せずに済む。折りたたみUIは`.asset-folder`/`.asset-list`（アセットツリーで既に確立済みのクラス・挙動）を流用すると、新規CSSは「グループ内リストの入れ物」用の最小限で足りる。

---

## 2026-07-27（サブコマをレイヤーパネル下部の「移動」「複製」ボタンに対応）

「前回追加したサブコマについてレイヤーパネル下部のレイヤー移動、複製は可能ですか？」との質問を受けて調査したところ、下部の移動/複製ボタン（`duplicateSelectedObject`/`moveSelectedObject`、`05-groups-move.js`）は`state.selectedGroupId`/`selectedShapeId`/`selectedImageEl`/`selectedTextEl`/`selectedDrawId`のいずれかしか見ておらず、サブコマ選択は通常のコマ選択と同じ`state.selectedPanelId`を使う仕組みのため対象外だった（押しても「対象を選択してください」のアラートが出るだけで何も起きない）ことが判明。「実装願います」との依頼を受けて対応した。

**実装**:
- `static/js/main/24-sub-panels.js`: インタラクティブなドラッグ移動用に`initSubPanelManipulation`のクロージャ内に閉じていた`_subPanelSnapshotContent`/`_subPanelApplyContentTranslate`（中身のオブジェクトを種別ごとの正規座標属性で平行移動するロジック）をトップレベル関数に切り出し、新規の`duplicateSubPanel(subId, targetParentId)`/`moveSubPanel(subId, targetParentId)`から共通利用できるようにした。
  - `duplicateSubPanel`: 対象未指定（＝同じ親コマ）ならオブジェクト複製と同じOFFSET(20,20)でずらして複製、異なる親コマを指定した場合は複製元/複製先の親コマ中心の差分だけ平行移動。枠線・中身ともに`_cloneWithNewIds`（グループ複製で使用の既存ヘルパー）でID一括付け替えし、新規`panel-clip-<newId>`クリップパスを複製先親コマとの交差ポリゴン（既存の`_subPanelEffectiveClipPoints`）で作成。
  - `moveSubPanel`: 同じidのまま`parentPanelId`を付け替え、複製元/複製先の親コマ中心の差分だけ枠線・クリップ・中身を平行移動。自分自身や自分の子孫サブコマを移動先に選ぶ循環参照は`_subPanelIsDescendantOf`でガード。
  - どちらも通常のコマ・パネルSVG永続化経路（`savePanelSvg`）をそのまま利用（`state.activePage.panels`にエントリを追加/更新後、`savePanelSvg`が内部で対応エントリを見つけてDOM内容を書き戻し+dbPutする既存動作に乗せている）。
- `static/js/main/05-groups-move.js`: `duplicateSelectedObject`/`moveSelectedObject`が対象オブジェクトなし判定した直後に、選択中が`_subPanelCurrentSelected()`（既存ヘルパー）で取得できるサブコマかどうかをチェックし、該当すれば`duplicateSubPanel`/`moveSubPanel`に委譲する分岐を追加。既存のレイヤーパネル下部UI（移動先コマ選択ドロップダウン・移動/複製ボタン）をそのまま流用できる。
- i18nメッセージは既存の`layer.duplicateTargetPanelNotFound`等（汎用的な文言のため）をそのまま流用し、新規キー追加はなし。

**How to apply**: 「コマ」抽象を流用して作られた新しいエントリ種別（[[comic-creator-workflow]]のサブコマのような）にレイヤーパネルの既存の移動/複製ボタンを対応させる場合、対象特定ロジックがチェックする`state.selected*`変数の一覧に新しい選択状態判定を追加するだけで、UI（ドロップダウン・ボタン）は無改造のまま流用できる。中身のオブジェクトを種別ごとに正しく追従移動させるロジック（`_subPanelApplyContentTranslate`等）はクロージャ内に一度書くと使い回しづらくなるため、インタラクティブ操作専用に見えても最初からトップレベル関数として書いておくと、後から「同じ移動をプログラム的にも呼びたい」という要望に対応しやすい。

**追記（同日、実機検証後）**: 上記の移動/複製を実機確認した後、「オーバーレイへも可能にしたい」との追加依頼を受けて対応した。オーバーレイは`state.activePage.panels[]`の実エントリではない（`'__overlay__'`という特別なID文字列で扱われる）ため、サブコマの`parentPanelId`にそのまま`'__overlay__'`を許すと、①`_subPanelEffectiveClipPoints`等の「親コマのpointsで交差クリップ」計算が`state.activePage.panels.find(...)`で親が見つからず素通り（無クリップ）になる、②レイヤーパネルの表示ロジック（`orderedPanels`はトップレベルコマから`parentPanelId`を辿って子を並べる仕組みのため、親が実在しない`'__overlay__'`だとどこからも辿り着けず表示から消える）という2つの穴があった。
- `24-sub-panels.js`: `_subPanelResolveParent(parentPanelId)`を新設し、`'__overlay__'`の場合は`state.activePage.basePanelPoints`（ページ全面の形）を疑似的な親として返すようにした。`_subPanelCommit`（ドラッグ確定時のクリップ再計算）・`duplicateSubPanel`・`moveSubPanel`の親コマ解決をすべてこれ経由に統一し、通常のオブジェクトがオーバーレイへ移動する際に`basePanelPoints`の重心へ再配置されるのと同じ考え方で中心合わせできるようにした。
- `04b-layer-panel-render.js`: コマ1件分の行+マスク行+中身オブジェクト一覧を描画する処理を`renderPanelNode`関数として切り出し、通常のコマ一覧ループに加えて、オーバーレイ行の直後でも`panels.filter(p => p.parentPanelId === '__overlay__')`分を呼べるようにした（オーバーレイもコマ一括ロックの対象外という既存仕様に合わせ、呼び出し後に`_rlpPanelLocked`をリセットする処理も追加）。表示名は`parentPanelId === '__overlay__'`のときだけ専用ラベル（`subpanel.optionLabelOverlay`）を出すよう分岐。
- `i18n.js`: `subpanel.optionLabelOverlay`をja/en/zhに追加。

移動先コマ選択ドロップダウン自体は既存の`updateDuplicatePanelSelect`（`03-layers-panel.js`）がもともと`__overlay__`オプションを無条件で持っていたため、UI側の変更は不要だった。

**How to apply**: 「実コマの集合（`panels[]`）」と「オーバーレイ（`__overlay__`という特別なID）」のように、同じ「親」概念を扱う先が「配列内の実エントリ」と「配列外の特別な存在」に分かれている場合、`.find(p => p.id === X)`をそのまま使い回すコードは後者で静かに`undefined`を返して意図しない動作（クリップ無効化・表示から消失等）になりやすい。`X === '__overlay__'`等の特別値を吸収して両者を同じインターフェース（今回は`{points}`を持つオブジェクト）に正規化する解決関数を1つ作り、すべての参照箇所をそれ経由に統一するとこの種の穴を防ぎやすい。

---

## 2026-07-27（レイアウトタブに「サブコマ」機能を新規追加、実機検証で見つかった不具合を順次修正）

「レイアウトタブでコマの中にコマをオブジェクトとして入れたい。矩形、丸でサイズ変更、移動を可能としたい」との依頼を受けて実装。続けてユーザー自身の実機検証で複数の不具合・追加要望（回転対応、コマ外へのはみ出し、サブコマ自体と中のオブジェクトの操作の切り分け、枠線幅の個別設定、上部メニューのレイアウト整理）が見つかり、同じ流れで対応した。

サブコマは「`state.activePage.panels[]` の1エントリ（id + points）」という既存の抽象を`parentPanelId`付きで拡張しただけの設計とし、`insertImage`/`getOrCreateClipGroup`/`savePanelSvg`/`buildMergedSvg`/`selectPanel`/`initPanelsOnSvg`のクリック選択・パネルロック/マスク機能をほぼ無改造のまま流用できるようにした（新規ファイル`static/js/main/24-sub-panels.js`）。

**実装**:
- **新規作成**: ツールペイン「サブコマ」サブタブでON＋矩形/丸を選び、実際にドラッグを開始した座標がどのコマ形状の内側にあるかをレイキャスト法の点内判定（`_subPanelFindPanelAtPoint`）でその場で検出し、その場所を含むコマを親として自動決定する（あらかじめ「コマ:」を選択しておく必要はない。選択中コマを使う実装だと、選択がズレていた場合に見た目と違うコマの子として作成されてしまう不具合になった）。
- **移動・リサイズ・回転**: `17c-layer-draw-handles.js`のdraw-shape用ロジック（`_drawShapeGetBounds`/`_drawShapeSetBounds`/`_drawShapeApplyRotation`/`_polygonBakeRotation`等）をそのまま流用。
- **親コマ外へのはみ出し**: 当初は位置をコマ内に強制的にクランプしていたが、「通常のオブジェクトのようにコマ外へ動かせ、はみ出た部分をクロップする挙動にしたい」というフィードバックを受け、Sutherland-Hodgman法によるポリゴン交差計算（`_subPanelClipPolygon`）に変更。サブコマ自身の形と親コマの形の交差部分だけを実際のclipPathに使い、枠線・ハンドル・保存データは常にサブコマ本来の完全な形（はみ出し込み）を保持する。
- **サブコマ移動時の中身追従**: 「サブコマ自体を動かしたい＝中のオブジェクトもそのまま動いてほしい」というフィードバックを受けて対応。`moveSelectedObjectToCenter`（`15-pixifx-bridge.js`）と同じ「要素種別ごとに本来の位置属性（画像=x/y、テキスト=x/y+tspan、フキダシ=dataset.cx/cy、グループ=data-tx/ty）へ直接座標を書き込む」方式を採用した。`transform`を重ねるだけの簡易実装も試したが、画像等の選択ハンドル表示ロジックが`transform`を見ずx/y等の生属性だけを見て動くため、移動後に中のオブジェクトを選択するとハンドルが移動前の位置に残ってしまう不具合になった。
- **既存オブジェクトとの操作衝突防止**: サブコマ作成ドラッグの`mousedown`ハンドラを、画像/テキスト/フキダシ/ドロー図形/グループの各操作ハンドラより先に発火させるため、キャプチャフェーズでの先取り登録（`06a-polygon-geometry.js`の`initGroupManipulation`と同じ手法）に変更。バブルフェーズのままだと、コマ内の画像等の上からサブコマを描いた際に両方のハンドラが反応し、画像が一時的に引きずられてから元の位置に戻る不具合になっていた。
- **枠線のクリック挙動**: 枠線ポリゴンの`pointer-events`を`stroke`に限定（`all`のままだと塗り全体（透明部分含む）がクリックを捕捉し、下に敷いた画像へのドラッグを奪ってしまう不具合があった）。
- **サブコマ操作の切り替え**: 当初はツールペインにグローバルなON/OFFトグルを設けたが、「レイヤーパネルでサブコマごとに切り替えたい」というフィードバックを受け、レイヤーパネルのサブコマ行アイコンをチェックボックスに変更。ON時はそのサブコマ内クリックで中のオブジェクトより優先してサブコマ自体を選択・移動し、OFF（既定）では中のオブジェクトを個別操作できる。状態はパネルロックと同じく`g[data-clip-panel]`のdata属性として持たせ、既存の保存経路でそのまま永続化されるようにした。
- **枠線幅の個別設定**: 「サブコマ」サブタブに選択中サブコマの枠線幅入力欄を追加。他のサブコマ・コマの枠線幅とは独立して設定できる。
- **レイヤーパネルの表示順**: サブコマは配列末尾に追加される仕様のため、そのまま並べると実際の親コマと無関係に「配列で直前にあるコマの子」に見えてしまっていた（データは正しいが表示が紛らわしい不具合）。表示専用の並び替えを追加し、実際の親コマの直後に子サブコマが並ぶよう修正。
- **上部メニューのレイアウト整理**: 折り返して2行になっていたボタン列を1行に収めるため、コマ枠線幅入力欄の縮小、「I2Iへ送る」→「I2I」・「作品を閉じる」→「閉じる」のラベル短縮を実施。続けて「コマ:」ドロップダウン・「削除」「元に戻す」ボタンの並び順をユーザー指定の位置（元に戻すの右隣／画像を挿入の左隣）に整理し、単独行になった「保存」ボタンもページ送り行へ統合した。

**検証**（Kapture、実機`http://127.0.0.1:8189/ccc`）: 作成・選択・リサイズ・回転・親コマ外へのはみ出し時のクロップ・枠線幅変更・移動時の中身追従・レイヤーパネルのチェックボックスの表示切替・上部メニューの1行化のいずれもコンソールエラーなしで確認。ドラッグ操作そのもの（mousedown→mousemove→mouseup）は現行のKaptureツールセットでは個別イベントとして直接シミュレートできないため、コードレビューと部分的なクリック確認を組み合わせつつ、実際のドラッグ挙動の最終確認はユーザー自身の実機検証に委ねた（4件の不具合はすべてユーザーからのフィードバックで発見・修正）。

**How to apply**: 新しい「コマ的なオブジェクト」を追加する際は、`state.activePage.panels[]`に`parentPanelId`付きの通常エントリとして追加する設計にすると、既存のパネル関連インフラ（挿入・保存・選択・ロック・マスク）を無改造で流用できる。オブジェクトを他のオブジェクトごと移動する新機能を実装する際、`transform`を重ねるだけの簡易実装は既存の各オブジェクト種別の選択ハンドル表示ロジック（x/y等の生属性だけを見るものが多い）と食い違うため、`moveSelectedObjectToCenter`と同じ「種別ごとに本来の位置属性へ直接書き込む」方式に統一すること。また同じsvgElに複数の`mousedown`ハンドラが積み重なっている場合、新しい操作を既存ハンドラより優先させたいときはキャプチャフェーズ登録（`addEventListener`第3引数`true`）で処理後に`stopPropagation`すると、バブルフェーズの既存ハンドラとの二重発火を避けられる。

---

## 2026-07-24（背景パターンのカスタムSVGアップロードをセキュリティレビュー）

v1.13.0リリース後、ユーザーから「カスタムSVG読み込みについてセキュリティチェックをお願いできますか」との依頼を受けて`15c-manga-bgpattern.js`のカスタムSVGアップロード経路（`_mangaBgRecolorSvgString`/`_mangaBgLoadSvgImage`/`_mangaBgBuildSvgTileCanvas`）をレビューした。

アップロードされたSVGは`new Image(); img.src = "data:image/svg+xml,..."`という`<img>`要素のコンテキストで読み込まれており、ブラウザ仕様上この経路では内部の`<script>`要素やイベントハンドラ（`onload`等）は実行されない（`innerHTML`でのDOM直接挿入や`<object>`/`<iframe>`埋め込みとは異なる安全な経路）。読み込んだ画像は`ctx.drawImage()`でcanvasに描画され最終的にPNGとしてラスタライズされるため、元のSVGコードはどこにも保存・送信されない。色置換で注入する`<style>`ブロックの値は`<input type="color">`由来でブラウザが常に`#rrggbb`に正規化するため文字列注入の余地もなく、外部リソース参照を含むSVGによる`canvas.toDataURL()`のcanvas tainting（`SecurityError`）も呼び出し元の`try/catch`で握られており実害はない。重大な脆弱性は見つからなかった。

レビュー中に見つけた軽微な不具合（セキュリティとは無関係）として、`renderPreview()`内の`_mangaBgRenderPatternToCanvas`呼び出しが`try/catch`で囲まれておらず、画像として解釈できない壊れたSVGファイルをアップロードすると未処理のPromise rejectionがコンソールエラーになる点を修正した。

**実装**:
- `static/js/main/15c-manga-bgpattern.js`: `renderPreview()`内のパターン描画を`try/catch`で囲み、失敗時は`console.error`でログするだけで操作を継続できるようにした。

**How to apply**: ユーザーアップロードのSVGをブラウザ内で画像として扱う場合、`<img>`要素（`src`に直接ファイルURLまたはdata: URIを設定）またはCSS `background-image`経由でレンダリングする限り、内部のスクリプトは実行されない。逆に`innerHTML`でDOMに直接挿入したり`<object>`/`<iframe>`で開いたりする実装に変更する場合は、この前提が崩れるため別途サニタイズ（`<script>`除去等）が必須になる。

---

## 2026-07-24（マンガツールに「背景パターン」を新規追加、デモ画像・README更新）

「レイアウトタブに新しい機能、背景パターンを追加したい。マンガツール内に"背景パターン"ボタンを追加。選択中のコマ、またはオーバーレイのサイズにパターンを作成する機能のモーダルを表示します。参考としてworkflow studioの設定、テーマのカスタマイズの背景パターンをベースに機能を拡張したい」との依頼を受けて実装。続けてユーザーからのフィードバック（パラメータに回転・カスタムSVGの縦横個別サイズを追加、モーダルサイズ拡大でスクロール不要に）を反映し、4機能（PixiJS FX・ハーフトーン・マンガ効果・背景パターン）のデモ画像撮影とREADME 3言語への反映まで一連の流れで対応した。

参考にした`ComfyUI-Workflow-Studio`（`comfyUI-wf-maneger`）の「テーマのカスタマイズ」→「背景パターン」は、ストライプ×3・ドット・チェック・カスタムSVGアップロードをCSSの`background-image`でページ全体に敷き詰める実装。一方Comic Creator側には既に「マンガ効果」（`15b-manga-tone.js`）という、選択中のコマ/オーバーレイのサイズにジャストフィットする透過PNG画像を生成・挿入する仕組みが確立していたため、その基盤（対象領域決定・キャンバスサイズ計算・プレビュー背景ガイド切替・挿入処理）をそのまま再利用し、Workflow Studio実装をCanvas 2D移植する形で新規モーダルとして実装した。ユーザーの選択（PNG画像挿入方式・カスタムSVGアップロード対応・和柄パターン追加）に基づき、Workflow Studioにはない和柄4種（麻の葉・市松・七宝・鱗）も追加している。

**実装**:
- `static/js/main/15c-manga-bgpattern.js`（新規）: パターン10種（横縞/縦縞/斜め縞/ドット/チェック/麻の葉/市松/七宝/鱗/カスタムSVG）のCanvas 2Dタイル描画関数。いずれもタイル境界をまたいでも継ぎ目なく繰り返せるよう座標計算（斜め縞は`x-y=k`の45度直線群をkをタイルサイズ分ずらして複数描画、麻の葉は六角格子(pointy-top)の中心から6頂点への放射線を行ごとに半分ずらして配置、七宝は円弧をタイルの四隅・辺の中点・中心に規則正しく配置）。パターン全体の回転は個々のタイル描画ロジックを変えず`pattern.setTransform(new DOMMatrix().rotate(angle))`で実現（`CanvasPattern`は無限に繰り返される平面なので回転の中心や境界の継ぎ目を気にする必要がない）。カスタムSVGはWorkflow Studioの色置換ロジック（fill/stroke属性・インラインstyle・`<style>`ブロック注入）を移植し、幅・高さを独立指定できるよう拡張（横長ロゴ等、正方形でない画像に対応）。
- `templates/index.html`: マンガサブタブに「🎴 背景パターン」ボタンを追加。
- `static/js/i18n.js`: パターン名・パラメータラベル（色・不透明度・サイズ・回転・幅・高さ・間隔等）をja/en/zh 3言語に追加。
- `static/js/main/01-state.js`: `initMangaBgPatternButton()`の呼び出しを追加。
- モーダルUI: 右パネルのパラメータ領域にモーダル本体固定高さ`980×780px`（初期`900×640px`から拡大）とし、パラメータ増加後もスクロール操作なしで全項目が収まるよう調整（`overflow-y:auto`のスクロールラッパー自体はセーフティネットとして残置）。

**デモ画像・README**:
- `docs/11_pixifx.png`〜`docs/14_bgpattern.png`をKaptureで撮影。モーダルが`position:fixed`のためDOM要素`selector`指定キャプチャでは要素が重複表示される不具合があり、フルページキャプチャ（`scale=1`）→モーダルの背景色（`.tsm-dialog`は`rgb(45,45,45)`、独自CSSの`filter-lib-modal`は`rgb(22,33,62)`のヘッダー等）をnumpyでピクセル実測→Pillowで正確にクロップする方式に統一。
- `README.md`/`README_en.md`/`README_zh.md`のスクリーンショット節に4枚追加し、テキスト/Shapeツールの塗りテクスチャの位置X/Y指定・マンガツールの背景パターンを機能一覧の説明文に反映。

**検証**（Kapture）: 全10パターンのサムネイル生成・プレビュー切替・パラメータ変更（色/不透明度/サイズ/回転/透過切替）を確認。市松模様を実際にオーバーレイへ適用しレイヤーに画像として挿入されることを確認後、Undoで元に戻した。回転90°で横縞パターンが縦縞に変わることを確認し、回転の実装が正しく機能することを確認。

**How to apply**: `CanvasPattern`は`createPattern`の時点で無限に繰り返されるタイル平面になるため、`pattern.setTransform()`による回転・平行移動は個々のタイル内部の描画ロジックを一切変更せずに安全に適用できる（境界の継ぎ目を考慮する必要があるのは、タイル内部の柄そのものを回転させて描画する場合のみ）。またKaptureで`position:fixed`のモーダルをスクリーンショットする際、DOM要素`selector`指定は要素が重複して撮れることがあるため、フルページキャプチャ＋既知の背景色でのピクセル実測クロップ（[[comic-creator-workflow]]既出の教訓）を優先する。

---

## 2026-07-24（テキスト/Shapeツールの塗りテクスチャに座標オフセットを追加、座標ずれを解消）

「レイアウトタブ、imageタブのテキストのスタイルで塗りでテクスチャ選択時の座標ずれの改善と座標設定を追加したい。※ドローツールの塗りテクスチャと同様にしたい」との依頼を受けて調査したところ、レイアウトタブのSVGテキストは`<text x= y=>`属性を直接書き換えて移動する仕組みのため、`patternUnits="userSpaceOnUse"`のテクスチャパターンが絶対座標に固定されたまま取り残され、ドロー図形のrect/ellipse/lineが元々抱えていたのと同じ問題（既に`_drawShapeSyncTexturePatternTransform`で対処済み）を抱えていることが判明。加えてテキストスタイルのUI自体にドロー図形にある座標オフセットX/Y入力欄が存在しなかった。続けて「Imageタブのシェイプの塗りテクスチャにもオフセット設定を追加したい」との追加依頼も同じ流れで対応した。

**実装**:
- `static/js/text-style-modal.js`: テクスチャパネルにドロー塗りと同じ座標オフセットX/Y入力欄を追加。状態の保存・読込・スタイル適用のすべての経路に反映。
- `static/js/main/09e-text-tool.js`: `_textSyncTexturePatternTransform`（テキスト移動時に移動分をパターンへ`patternTransform`として反映する追従補正）・`_textSyncTexturePatternScale`（フォントサイズ変更＝リサイズ時にタイルサイズ・オフセットを再計算）を新設し、既存のドラッグ/リサイズハンドラおよびスタイル適用関数`_fontMgrApplyStyleAttrsToTextEl`（パターン生成時点のx/yを追従の基準座標として記録）から呼び出す。
- `static/js/image-tab.js`: Canvas版`_textFillStyle`の`pattern.setTransform`にオフセットのtranslateを追加。Imageタブは各テキストレイヤーが独立canvasのため座標ずれ自体は元々起きない構造だが、オフセットの入力自体が反映されていなかった分を追加。
- `static/js/image-tab/ShapeTool.js` / `static/js/image-tab.js`: シェイプツール（Rect/Ellipse）の塗りテクスチャに`offsetX`/`offsetY`を追加。Imageタブの図形は確定時にレイヤーへラスタライズされるため座標ずれ自体は起きない構造で、純粋にオフセット機能の追加のみ。
- `static/js/i18n.js`: `font.texOffsetX`/`font.texOffsetY`をja/en/zhに追加。

**検証**（Kapture）: テキストスタイルモーダル・ImageタブシェイプツールのオプションバーにオフセットX/Y入力欄が表示されパラメータ変更でエラーが出ないことを確認。レイアウトタブでテキストを選択→スタイルモーダルでテクスチャモードへ切替→UI表示を確認。テクスチャ画像のアップロード自体はOSネイティブのファイル選択ダイアログを介するためKaptureからは自動操作できず、移動時の追従挙動そのものの実演確認はユーザー側での確認に委ねた。

**How to apply**: 「`transform`で移動する要素」と「属性を直接書き換えて移動する要素」が混在する実装では、後者だけテクスチャパターンが絶対座標に取り残される。新しい要素タイプに塗りテクスチャ機能を追加する際は、その要素がどちらの移動方式かをまず確認し、属性直書き方式であればパターンの追従補正（生座標の記録＋移動時の`patternTransform`差分適用）を忘れずに実装すること。

---

## 2026-07-24（ImageタブのMaskツールにInpaint（Workflow Studio連携）を追加）

「workflow studioに追加したインペイント機能をcomic creatorにも追加したい。workflow studioのImage EditタブのインペイントメニューをImageタブに追加、Runでworkflow studioで処理して結果を表示したい。workflow studioがインストールされていない場合インペイントメニューは非表示にしたい」との依頼を受けて実装。ユーザーからのフィードバックで2点の設計変更（I2I設定と同様にInpaint専用のデフォルトワークフロー設定を追加／独立した「Inpaint」ツールボタンではなくMaskツールのサブツールバーに統合）を反映し、実機検証で見つかった3件の不具合も同じ流れで修正した。

Comic CreatorのImage タブはもともとComfyUI-Workflow-StudioのImage Editタブを移植したもの（`image-tab.js`冒頭コメントに明記）。Workflow Studio側にはその後Inpaintツールが追加されており、既存のI2I連携（`iframe.contentWindow._wfmReceiveImageForI2I`を直接呼ぶ同一オリジンiframe方式）と同じパターンでInpaintの連携ブリッジを新設した。

**実装**（Comic Creator側）:
- `static/js/image-tab.js`: Maskツールのサブツールバー（Paint/Color/Alpha/Text/Vector/Shape/SAM3の右）に、Workflow Studio導入時のみ表示される「Inpaint」ボタンを追加（`_switchMaskSubtool("inpaint")`）。`_renderMaskProps`に`sub === "inpaint"`分岐を新設（Positive/Negativeプロンプト・Grow Mask By・Denoise・Run・ステータス行）。`_exportMaskCanvas`（黒背景+白マスクのグレースケール書き出し）・`_runInpaint()`（合成画像+マスクを送信→結果を新規レイヤー「Inpaint Result」として追加）・`_checkWfmAvailability()`（`/wfm`疎通確認、既存の`_checkBiRefNetAvailability`等と同パターン）を新規追加。
- `static/js/main/14-integrations.js`: 既存の`_i2iSettings`と同構造で`_inpaintSettings`（localStorageキー`ccc_inpaint_settings`）・`initInpaintSettings()`を新設（I2Iとは独立したInpaint専用デフォルトワークフロー設定）。`sendInpaintToWorkflowStudio()`を新設（`loadWfmGalleryTab()`でiframeロードを保証しつつ、`switchTab`は呼ばずImageタブの表示のまま裏側で実行）。
- `static/js/main/01-state.js`: 設定タブ表示時に`initInpaintSettings()`を呼ぶよう追加。
- `templates/index.html` / `static/js/i18n.js`（ja/en/zh）: 設定タブに「Inpaint設定」ブロックを追加。
- `static/js/image-tab/LayerManager.js`: `mergeLayers()`が統合結果を常に`type: "image"`で作成していたため、選択レイヤー全てが`type: "mask"`の場合は統合結果も`type: "mask"`として作成し、合成も各マスクのAdd/Subtractに応じた`lighten`/`destination-out`（既存の`_buildMaskCanvas`と同じ規約）に変更。従来は統合後に通常の画像レイヤーになってしまい、未ペイント部分（黒として扱われるべき箇所）が下のレイヤーを透過してしまっていた。
- Inpaint実行時のマスクレイヤー選択（アクティブなマスク優先、なければ最前面のマスク）に`.visible`チェックを追加し、非表示のマスクレイヤーは対象から除外されるよう修正。

**実装**（Workflow Studio側、`comfyUI-wf-maneger/ComfyUI-Workflow-Studio`）:
- `static/js/image-edit-tab.js`: 既存の`_runInpaint()`から共通処理を`_runInpaintWithImages()`として切り出し、外部（Comic Creator等）向けの公開エントリポイント`runInpaintExternal()`を新設。マスクレイヤー選択に同じく`.visible`チェックを追加。
- `static/js/gallery-tab.js`: 既存の`window._wfmReceiveImageForI2I`と同じ場所に`window._wfmReceiveInpaintRequest`を新設（デフォルトワークフローの任意プリロード→`runInpaintExternal`呼び出し→結果URLまたはエラーを返す）。
- `static/js/comfyui-editor.js`: `_loadImageElement()`内`src instanceof Blob`が、別ウィンドウ（Comic Creator）で生成したBlob/Fileを別レルム（iframe）で判定するとコンストラクタの参照が異なり常に`false`になるバグを発見・修正（`typeof src !== "string"`による実体判定に変更）。修正前は`img.src`にBlobオブジェクトがそのまま代入され文字列化された`[object Blob]`がURLとして扱われ404エラーになっていた。

**検証**（Kapture、実機`http://127.0.0.1:8189/ccc`）: マスクレイヤーを描いてInpaint実行→Workflow Studio側で生成→結果が「Inpaint Result」レイヤーとして追加されるまでの一連の流れを確認。Inpaint用デフォルトワークフローのON/OFF両方の経路を確認。非表示マスクレイヤーでRunした場合にガードメッセージが出ることと、表示状態に戻すとガードを通過することを確認。マスクレイヤー2枚を別々の位置にペイント→Shift選択→統合→結果レイヤーがマスク用アイコン（黒背景サムネイル）で表示され、ツールパネルもMask用のオプションのままであることを確認。

**How to apply**: 同一オリジンiframe越しに別ウィンドウで生成したBlob/Fileを直接引数として渡す連携パターンでは、受け取り側で`instanceof Blob`のようなコンストラクタ同一性に依存するチェックを使わないこと（`typeof x !== "string"`等、実体で判定する）。ウィンドウをまたぐと同じ仕様のオブジェクトでも`instanceof`は必ず`false`になる（Blob自体はcreateObjectURL等では別レルムでも問題なく使えるため、チェック方法だけの問題）。またマスクレイヤーは「透過背景+白ペイント、未ペイント部分は黒として扱われる」という規約に依存する処理（エクスポート・サムネイル・統合等）が複数箇所にあるため、マスクレイヤーを加工する新機能を追加する際は統合先の`type`が`"mask"`のまま維持されるかを必ず確認する。

---

## 2026-07-23（レイアウトのドローに「ベクター曲線」を追加、テクスチャ塗りの追従・位置指定・PNG変換時の欠落を修正）

「レイアウトタブのドローツールにベクター曲線を追加したい。ImageタブのMaskツールのVectorのように描きたい」との依頼を受けて実装。続けてユーザー自身の検証で3件の追加不具合が見つかり、同じ流れで修正した。

1つ目は新機能で、既存の「多角形」ペンツール（クリックで頂点追加・直線で結ぶ）と対をなす、Catmull-Romスプラインでなめらかに結ぶベクター曲線ツール。Imageタブの`MaskVectorTool`（`image-tab/MaskEditorOneTools.js`）と同じ操作感・同じ補間式に合わせた。

2〜4件目はユーザーが新機能を検証中に見つけた既存不具合。「ベクター曲線・曲線にテクスチャ塗りを設定してシェイプを動かしても座標が変わらないが、矩形・楕円・多角形では変わる」→「矩形・楕円・多角形をベクター曲線と同じ（動かしてもズレない）挙動に揃えたい、その上で座標も設定可能にしたい」→「テクスチャを使ったシェイプを『図形をPNG変換』すると塗りがない状態になる」→「フキダシを画像に変換すると左・上が切れる」の順で報告され、いずれもSVGの`fill="url(#...)"`（グラデーション・テクスチャパターン）や`getBBox()`の挙動に起因する根の深い箇所だったため、原因調査から着手した。

**実装**:
- `templates/index.html` / `static/js/i18n.js`（ja/en/zh）: シェイプ選択に「ベクター曲線」ボタン・選択肢を追加。
- `static/js/main/17a-layer-draw-input.js`: `_layerDrawVecClick`/`_layerDrawVecPreview`/`_vecBuildSplineCtx`/`_vecBuildSplinePathD`/`_layerDrawVecCommit`等を新設。クリックでノード追加、3点以上で始点付近クリック→閉じたシェイプ（`<path>`、塗り適用）として確定、Enterキー→開いた線（`fill="none"`固定）として確定、Escキーで直前のノードを取消。多角形の確定処理にも、テクスチャ追従用の生座標（`data-raw-x/y/w/h`）記録を追加。
- `static/js/main/17c-layer-draw-handles.js`: 新設`_drawShapeSyncTexturePatternTransform(el)`。矩形・楕円・線・多角形はSVG属性（x/y/points等）を直接書き換えて移動するため、`patternUnits="userSpaceOnUse"`のテクスチャパターンが絶対座標に固定されたままシェイプに対して滑って見える問題があった（曲線・ベクター曲線は`transform`で移動するためパターンも一緒に動き問題なし）。作成時点の生座標→現在のbboxへのアフィン変換を`patternTransform`としてパターンにも適用し、`_drawShapeSetBounds`（移動・リサイズ時）と多角形の頂点個別ドラッグの両方から呼ぶことで、path/g系と同じ「テクスチャがシェイプに対して動かない」挙動に統一。回転は元々シェイプ自身の`transform="rotate(...)"`で行われておりパターンにもそのまま継承されるため対象外。
- `static/js/main/17b-layer-draw-commit.js`: 矩形・楕円・線の作成時にも生座標（`data-raw-x/y/w/h`）を記録。
- `static/js/main/09e-text-tool.js`: 共通の塗り適用関数`_fontMgrApplyFillPaintToEl`にテクスチャの位置オフセット（`offsetX`/`offsetY`）を追加し、パターンの`x`/`y`属性および往復用の`data-ccc-tex-offset-x/y`に反映。抽出側`_fontMgrExtractStyleFromTextEl`・`17c`の`_drawShapeExtractFillState`も同項目を読み戻すよう対応。
- `templates/index.html` / `17a-layer-draw-input.js`: テクスチャ塗りパネルに位置X/Y入力を追加（UIへの反映・保存・選択図形からの復元）。
- `static/js/main/09c-balloon-handles.js`（`convertShapeToImage`。フキダシ「画像に変換」とドロー「図形をPNG変換」の共通処理）: (a) クローンしたシェイプだけの単独SVGに元の`<defs>`（グラデーション・テクスチャパターンの定義本体）が複製されておらず、`fill="url(#id)"`の参照先が解決できず塗りが消えていたため、`<defs>`もクローンして持たせるよう修正。(b) 余白計算が`el`自身の`stroke-width`属性しか見ておらず、フキダシの枠線は`.h2-layer-border`など子要素側にあるため取得できず、実際の線幅を大幅に下回る固定4px余白にフォールバックしていた（`getBBox()`は塗りの幾何形状のみでstrokeのはみ出し分を含まないため、この余白不足がそのまま輪郭のクリッピングになっていた）。自身+子孫の中の最大`stroke-width`を探すよう修正。

**検証**（Kapture）: ベクター曲線は閉じたシェイプ（Catmull-Romによる`C`コマンドの`<path>`、`Z`で閉じ塗り適用）・Enterでの開いた線（`fill="none"`、`Z`なし）の両方をDOM上で確認。以降の3件はユーザー自身の実機検証により解消を確認。

**How to apply**: SVGの`patternUnits="userSpaceOnUse"`（`x`/`y`省略）は参照元の要素が`transform`で動く場合は自動的に追従するが、属性を直接書き換えて移動するタイプの図形では絶対座標に取り残される。「`transform`で動く図形」と「属性直書きで動く図形」が混在する実装では、後者にも生座標との差分を`patternTransform`として明示的に載せないと挙動が揃わない。また要素を単独SVGとしてクローン→ラスタライズする処理（`convertShapeToImage`等）では、`url(#...)`参照の定義本体（`<defs>`）を必ず一緒に複製すること、および`stroke-width`は要素自身ではなく子孫要素にあるケースを想定して余白を計算すること。

---

## 2026-07-23（3Dポーズタブに視線ターゲット・揺れ物理トグルを追加）

「現在使用しているライブラリで追加可能な機能」の検討依頼を受け、3Dポーズ機能（実体は別カスタムノード`comfyui-vrm-pose-editor`）が使う`three-vrm`ライブラリを調査。VRMLoaderPluginが`springBonePlugin`・`lookAtPlugin`を内包しており、`vrm.lookAt`（VRMLookAt）・`vrm.springBoneManager`（VRMSpringBoneManager、揺れボーンがあるモデルで生成）が既にロード時点で存在し、`VRM.update(delta)`が毎フレーム両方を自動更新していることが判明。つまり視線追従・揺れ物理は「ライブラリ内に実装済みだが配線されていないだけ」の状態だったため、UIから使えるように配線した。

合わせてHDRI環境ライティング（擬似.hdr、`THREE.PMREMGenerator`+手続き生成グラデーション）も実装したが、Kapture実機検証でキャンバス全体1ピクセルも変化しないことを発見。原因切り分けの結果、ブラウザの`OES_texture_half_float_linear`（half-floatテクスチャの線形フィルタリング）拡張が未対応で、`PMREMGenerator`がエラーを出さずに空の環境マップを生成していたと判明。加えてVRMのMToonシェーダーは元々`envMap`/`scene.environment`を参照しないためキャラ本体には無関係（Ground/BG Wallの反射のみに影響）という効果の限定性もあり、ユーザー判断で機能ごと削除した。

**実装**（`comfyui-vrm-pose-editor`側。SPAの3Dポーズタブは動的importでこのコードをそのまま利用）:
- `js/pose_editor_core.js`: ドラッグ可能なシアン色マーカー(`lookAtHelperMesh`)を追加し、ON時に`vrm.lookAt.target`へ割り当てて目・頭を追従させる（`hasLookAt()`/`getLookAtEnabled()`/`toggleLookAt()`）。マーカーは`capture()`時に自動非表示化、新モデル読込時はVRM0/VRM1の正面向きに応じた位置へ再配置。揺れ物理は、ポーズの瞬間切替（リセット/ポーズ読込/ミラー）直後に`springBoneManager.setInitState()`で新ポーズへ再アンカーして「一瞬跳ねる」問題を解消し、ON/OFFトグルは`capture()`で既に使われている「delta=0で一時停止」と同じ手法をアニメーションループに適用（`hasSpringBones()`/`getSpringBoneEnabled()`/`toggleSpringBoneEnabled()`）。
- `js/pose_editor_3d.js`（ComfyUIノードUI）・`comfyui-comic-creator/templates/index.html`＋`static/js/main/23-pose3d-bridge.js`（SPA UI）の両方に「👁 視線」「🎐 揺れ」トグルボタンを追加。
- `static/js/i18n.js`: `layout.pose3dLookAtTitle`/`layout.pose3dSpringBoneTitle`をja/en/zh 3言語に追加。
- （削除済み）HDRI環境ライティング: `pose_editor_core.js`のEnvironment lightingセクション・API、`light_editor.js`のEnvセレクトUI・ライトライブラリプリセットへの永続化を全て実装後に削除。

**検証**（Kapture）: ユーザーが実際にVRMモデルを配置した状態で、視線ターゲットのマーカー表示/非表示・トグル動作、揺れ物理トグル（`hasSpringBones: true`のモデルで確認）のクリック時無エラーを確認。HDRIについては`editor.setEnvironmentPreset()`をキャンバス全ピクセルでdiff比較するテストで実装バグを検出し、上記の通り原因究明後に機能ごと削除する判断に至った。

**How to apply**: サードパーティ製3Dライブラリ（three-vrm等）に機能追加を頼まれたら、まず「vendorされているクラスに実はもう実装されているが未配線なだけ」のケースがないか（該当クラス名でgrep）を先に調べる。`THREE.PMREMGenerator`のような高度なGPU機能に依存する実装は、`gl.getSupportedExtensions()`で対象拡張（`OES_texture_half_float_linear`等）の対応有無をKaptureの`evaluate`で実機確認してから着手しないと、エラーが出ないまま無効化したように見える「サイレント失敗」に気づけない。詳細は[[vrm-pose-editor-architecture]]メモリに記録。

---

## 2026-07-22（PDF/EPUB/zip出力のユーザー操作エラーを修正、画像出力の解像度メタデータを追加）

下書きレイヤー機能の確認後、「出力を試したところPDF/EPUB/zip保存でエラーになる」との報告（`Failed to execute 'showSaveFilePicker' on 'Window': Must be handling a user gesture to show a file picker.`）を受けて調査・修正した。原因は、`showSaveFilePicker()`はクリック等のユーザー操作から間を置かず呼ばないと失敗する仕様のところ、PDF/EPUB/zip出力は保存ダイアログを開く前に「全ページの描画・フォント埋め込み・PDF/ZIP生成」という重い非同期処理を挟んでいたため、処理に時間がかかる（ページ数が多い等）とユーザー操作の有効期限が切れていたこと。PNG単ページ出力は処理が短く済むため、たまたま失敗しにくかった。

続けて、出力したPNG/JPEGのファイルプロパティでdpiがWindows既定値の96、WebPだけ72と表示され食い違うとの指摘を受け調査したところ、このアプリはPNG/JPEG/WebPのいずれにも解像度メタデータを一切埋め込んでおらず、Windowsのプロパティ画面がコーデックごとに異なる既定値を表示していただけと判明。実際に選択したdpiをファイルへ埋め込む実装を追加した（最終的にはWindowsのプロパティ画面自体がこの情報を反映しない仕様と分かったが、Photoshopでは正しく72dpiと確認できたためファイル側の実装は正しいと判断）。

**実装**:
- `static/js/main/13-export-pdf-epub.js`: `showSaveFilePicker()`をクリック直後（重い処理の前）に呼んでハンドルだけ確保する`_pickSaveTarget(fileName, mimeType, ext, description)`を新設。`_saveBlob()`は確保済みハンドルを受け取れるよう拡張。`exportToPdf`/`exportToEpub`は関数の冒頭で先にハンドルを確保し、ページ生成後にそのハンドルへ書き込む順序に変更。
- `static/js/main/12-text-png-export.js`: `handleExport()`のzip保存も同じパターンで、ページ描画ループの開始前に`_pickSaveTarget`でzipファイルのハンドルを確保するよう修正。
- `static/js/main/13a-export-metadata.js`: 画像出力メタデータ埋め込みに解像度(dpi)埋め込みを追加。PNGは`pHYs`チャンク（メートルあたり画素数に変換）、JPEGは既存JFIF APP0セグメント内のdensityフィールドを上書き（セグメント長は不変のため新規挿入不要）、WebPはXResolution/YResolution/ResolutionUnitの3タグのみを持つ最小TIFF blobを`EXIF`チャンクとして新設しVP8Xヘッダにフラグを設定。`_embedImageMetadata()`は、タイトル等のテキストメタが空でも解像度は常に埋め込むよう変更（「手動」選択時はPDF出力と同じ既定値96dpiを使用）。

**検証**: PDF/EPUB出力のエラーはユーザー確認により解消を確認。画像出力（PNG/JPEG/WebP）でも一度エラー報告があったが、コンソールエラー・JSダイアログとも発生しておらず、ネイティブ保存ダイアログが裏に隠れていただけとユーザーの再確認で判明（コードの問題ではなかった）。解像度メタデータのバイナリ構造は、Node.js上でフェイクのPNG/JPEG/WebPバイト列を生成し、埋め込み関数を実行→生成されたpHYs/JFIF density/EXIFタグの値を逆算してdpiが正しく往復すること、テキストメタ情報との併用時もチャンク順序が壊れないことをテストスクリプトで検証済み（ブラウザでの実クリックはネイティブファイル選択ダイアログが絡むため自動操作不可）。Windowsのプロパティ画面には反映されない（Windows側の仕様）が、Photoshopでは正しい値が確認できている。

**How to apply**: `showSaveFilePicker()`/`showDirectoryPicker()`など「ユーザー操作の有効期限（transient activation）」が必要なAPIは、ボタンのクリックハンドラ内であっても、呼び出す前に重い非同期処理（複数ページのレンダリング等）を挟むと失敗しうる。対策は「先にピッカーを呼んでハンドルだけ確保→重い処理→確保済みハンドルへ書き込み」の順序に組み替えること（`showDirectoryPicker`は元々この順序だったため、`showSaveFilePicker`側もそれに合わせた）。またPNG/JPEG/WebP等の画像フォーマットの「解像度(dpi)」表示は、ファイル自体にメタデータが無ければビューア・OS側の既定値が使われ、フォーマットごとに既定値が異なりうる（Windows Explorerのプロパティ画面はさらにOS側で反映されない場合がある）。dpiを意図通り一致させたい場合は、ピクセル寸法の計算とは別に、各フォーマット固有のメタデータフィールド（pHYs/JFIF density/EXIF等）への明示的な書き込みが必要。

---

## 2026-07-22（下書きレイヤー機能を追加 — レイアウト＋Imageタブ連携）

「レイアウトのレイヤーに下書きレイヤーを追加したい。オーバーレイのように全コマの上に表示されるが、クリックしても無視されその下のレイヤーが操作可能・出力にも含まれない」との依頼を受けて実装した。編集方法は「編集モード切替方式」（選択中のみ操作可能）、対応コンテンツは「画像のみ」で合意したうえで着手。続けて「下書きのラフスケッチをImageタブで作成できるようにしたい。Newボタン右隣に下書きボタンを追加、作品サイズ（72dpi換算）でキャンバス作成」という関連依頼も同じ流れで実装した。

**実装**:
- `static/js/main/01-state.js`: `state.selectedDraft`を追加。ESモジュールの`image-tab.js`からclassic script側の`state.activeWork`を安全に参照するため`window._ccGetActiveWork`ブリッジを追加。
- `static/js/main/08-panels-images.js`: オーバーレイ実装（`insertImageToOverlay`/`getOrCreateOverlayGroup`等）を踏襲し、`insertImageToDraft`/`getOrCreateDraftGroup`/`selectDraft`/`saveDraftSvg`を新設。`_syncDraftInteractivity(svgEl)`で編集モードに応じて下書き内画像のpointer-eventsをauto/noneに切替（非選択時は常にクリックが透過）。`initPanelsOnSvg`で下書きg要素をオーバーレイのさらに前面に配置。
- `static/js/main/07-pages.js`: `buildMergedSvg(pageRecord, opts)`に`opts.includeDraft`を追加し、プレビュー描画（`renderLayoutTab`）でのみtrueを渡す。PDF/EPUB/PNG連番等の出力側は変更なしのため下書きは自動的に出力対象外になる。`savePanelSvg`に`__draft__`のディスパッチを追加。
- `static/js/main/03-layers-panel.js` / `05-groups-move.js` / `06a-polygon-geometry.js`: 保存先パネルID解決ロジック（`syncPanelSelectionToObject`・複製/移動・レイヤー並べ替え）に下書き対応を追加。下書き内画像は`data-panel-id="__draft__"`を持つため、既存の「画像は`data-panel-id`属性を最優先で使う」という規約（オーバーレイ実装で既に使われていたパターン）にそのまま乗せられた。
- `static/js/main/04b-layer-panel-render.js`: レイヤーパネル最下段にオーバーレイと対になる「📝 下書き（全面）」行を追加（画像のみ表示、マスクボタンは非表示）。
- `static/js/main/03-layers-panel.js`: 複製/移動先ドロップダウンに「下書きへ」を追加。下書きは画像専用のため、画像以外を複製/移動しようとした場合はエラーメッセージ（`layer.draftImagesOnly`）を表示。
- Imageタブ: `templates/index.html`に「下書き」ボタン（New/Close間）を追加。`static/js/image-tab.js`の`_newCanvas()`から共通ロジックを`_createNewCanvasWithSize(w, h, baseName)`として切り出し、`_newDraftFromActiveWork()`を新設（work.width/height＝1/100mm単位を`/100/25.4*72`でpxへ変換、サイズ入力ダイアログなし）。「レイアウトに送る」（`_saveToLayout`）は、送信元が`baseName==="draft"`のキャンバスの場合、現在の選択に関わらず自動的に下書きレイヤーへ`selectPanel('__draft__')`で切り替え、作品サイズそのままでページ全面挿入する（既定の「40%センター配置」だとサイズ対応が崩れるため）。
- `static/js/i18n.js`: `common.draftFull`/`image.draftBtn`/`image.draftBtnTitle`/`layer.draftOptionTo`/`layer.draftImagesOnly`等をja/en/zh 3言語に追加。

**検証**（Kapture）: レイヤーパネルの「下書き」行選択・パネル選択ドロップダウン経由での編集モード切替、他コマ/オーバーレイ選択時にクリックが正しく透過する（pointer-events）こと、コマ内画像の「下書きへ複製」で下書きレイヤーに正しく配置され即座にドラッグ可能になることを実機で確認。Imageタブの「下書き」ボタンでは、作品サイズ（29700×21000 = A4横）から72dpi換算した842×595pxのキャンバスがダイアログなしで正しく作成されることを確認。ファイル選択ダイアログが絡む画像アップロード・保存操作は自動操作できないため未検証。

**How to apply**: オーバーレイのような「ページ全面レイヤー」を新設する際は、既存実装（データモデル・DOM属性・保存関数・pointer-events制御・レイヤーパネル行）を1対1でミラーリングするのが最も低リスク。差分（下書きは編集モード時のみ操作可・出力除外・画像のみ対応）は、ミラーリングした実装に対するピンポイントな上書き（`_syncDraftInteractivity`のpointer-events切替、`buildMergedSvg`のopts分岐、対応オブジェクト種別のガード）として追加すると影響範囲を最小化できる。既存コードが「`data-panel-id`属性を保存先解決の最優先に使う」という規約を既に持っていた（オーバーレイ実装で先例あり）ため、新レイヤーもそれに乗せるだけで済み、保存先解決ロジックを新規設計せずに済んだ。

---

## 2026-07-22（フキダシ内包テキストの統合・縦書き対応・尻尾幅デフォルト変更）

前日（07-21）に追加した「フキダシ+テキスト作成」モーダルは、四角/角丸四角/楕円の3形状限定の新規シンプル形状（textbox-*）専用で、既存の尻尾付きフキダシ全形状（通常/角丸矩形/思考/バクダン/雲もこもこ/雲なみなみ、以下h2タイプ）とは別の独立した仕組みだった。「フキダシ+テキスト作成と既存のフキダシを統合したい。テキストは縦書きにも対応させたい」との依頼を受け、既存フキダシ全形状にテキスト内包機能を統合した。ユーザー方針: 「フキダシ形状の作成・微調整（既存のh2挿入ボタン＋ハンドル操作）」と「テキストの詳細設定（モーダル）」の導線は2つのまま維持する。

**実装**:
- `static/js/main/09f-bubble-text.js` を全面改修。`_bubbleTextAreaFor(el)`（形状ごとにテキスト内包エリアの cx/cy/rx/ry/kind を算出。バクダン・雲もこもこ・雲なみなみは輪郭が凹凸なため rx/ry を0.75倍に縮小）・`_bubbleTextRenderText(el, area)`（横書き/縦書き共通のテキスト描画）・`_bubbleTextSyncH2Text(el)`（h2タイプ用の同期エントリ）を新設。`static/js/main/09b-balloon-shapes.js` の `_updateH2ShapePath` 末尾に `_bubbleTextSyncH2Text` 呼び出しを追加し、本体path生成後にテキストがあれば内包描画するようにした。テキストの折返し幅・高さは常に「現在のフキダシのrx/ry」を基準にし、テキスト量に応じて箱を自動拡大することはしない（箱のサイズ調整はハンドル操作に委ねる設計。textbox-*も同じ挙動に統一）。
- 「フキダシ+テキスト作成」ボタンを「テキストを内包」に役割変更。選択中のフキダシ（textbox-*またはh2タイプ）へのテキスト設定専用とし、モーダルから形状選択（四角/角丸/楕円）ボタンを削除。textbox-*の新規作成導線は廃止し、既存データの編集のみ後方互換で維持（新規にシンプル形状を作りたい場合は、h2ツールで角丸矩形/通常を挿入してからテキストを内包する2ステップに統一）。
- 縦書き対応の実装中に、`writing-mode="tb"` というSVG1.1属性値が、CSS Writing Modesを実装する現行ブラウザ（有効な値は `horizontal-tb`/`vertical-rl`/`vertical-lr` のみ）では無効な値として無視され、実際には機能していないバグを発見。`09f-bubble-text.js` と、同じ実装だった単独テキストツール `09e-text-tool.js`（`_setTextElVertical`）の両方を、属性ではなく `style.writingMode = 'vertical-rl'` + `style.textOrientation = 'upright'` に修正した（既存の単独テキストの縦書きも同時に直った）。
- 追加依頼で、モーダルに文字色セレクト（黒/白/赤/青、`dataset.textColor` に保存）と、フォント選択のGoogle/システム/カテゴリタブ切替（レイアウトタブのテキストツールと同じ構成、`_bubbleTextInitFontTabs` を新設）を追加。モーダル幅を480px→560pxに拡大。
- 縦書きの上/下寄せが実際の見た目と逆になる不具合を発見・修正。原因は各tspanのy座標が常にエリア中心(cy)固定のまま`text-anchor`（start/end）だけで上下を切り替えていたため、テキストが中心から片側に伸びるだけで見た目の上下が意図と逆転していたこと。横書きのX方向計算と対称に、上寄せ/下寄せ選択時はエリアの上端/下端(`cy - ry + padding` / `cy + ry - padding`)を基準点にするよう修正。あわせて、モーダルの文字色セレクトを独立行から「文字サイズ・縦書き」の行（縦書きチェックボックスの右隣）へ移動。
- 「フキダシの尻尾パラメータ『幅』のデフォルトを30°から13°に変更したい（楕円/角丸矩形/バクダン/雲もこもこ/雲なみなみ）」との追加依頼を受け、`templates/index.html` のスライダー初期値、`09c-balloon-handles.js` の新規挿入時初期値・UI同期のフォールバック値、`09b-balloon-shapes.js` のパス生成フォールバック値など、`tailWidth` のデフォルト値30が使われている全箇所を13に変更。

**検証**（Kapture）: 楕円・角丸矩形・バクダン・雲もこもこ・雲なみなみへのテキスト内包（横書き・縦書き）、縦書きの上/中央/下寄せが実際にフキダシの上部/中央/下部に配置されること、文字色「赤」+システムフォント切替の反映、新規挿入したフキダシの `dataset.tail-width` が13になることをDOM・スクリーンショット双方で確認。テスト用に追加した要素は削除し元のページ内容を維持したまま完了。

**How to apply**: SVGの縦書きは `writing-mode` をSVG1.1のレガシー値（`tb`等）で属性指定するのではなく、CSS Writing Modes準拠の値（`vertical-rl`/`vertical-lr`）を `style` プロパティとして設定する（現行ブラウザはCSS Writing Modes実装のため属性値は無視されうる）。`text-anchor` だけでテキストブロックの整列（上/中央/下や左/中央/右）を制御する実装は、基準点となる x/y 座標を「align に応じてエリアの端へ動かす」処理とセットでないと、中心固定のままでは見た目が意図と逆に見えることがある — 横書き・縦書きどちらでも対称に扱うこと。

---

## 2026-07-21（@imgly/background-removal のローカル同梱を見送り、モデル品質セレクトを追加）

PLAN_backlog「@imgly/background-removal のローカル同梱可否の判断」に着手。当初「同梱で」との依頼だったが、実際に必要なファイルを調査したところ想定以上に大きく、方針を変更した。

**調査結果**: npm本体（JSコード）は解凍後約2MBで問題ないが、実行時にCDN（staticimgly.com）から取得しているWASMランタイム＋ONNXモデルは合計で最大約326MB（CPU用WASM 10.7MB + WebGPU用WASM 20.7MB＋small/medium/largeの3モデル計294MB）。現在CDN版が使っているデフォルト設定（device=cpu, model=medium=isnet_fp16）を維持するだけでも約95MB。本リポジトリはGitHub公開リポジトリ（`.git`が現状約9MB）で、GitHubの単一ファイル上限は100MB（largeモデル168MBは超過しGit LFSが別途必要）。一度gitに取り込むと履歴からの除去も手間がかかるため、ユーザーに実測値を提示のうえ再確認し、**同梱は見送りCDN依存を維持**、代わりに**背景除去のモデル品質をアプリ上で選べるようにする**方針に決定した。

**実装**: `removeBackground()` の `model` オプション（"small"=isnet_quint8・42MB / "medium"=isnet_fp16・84MB・既定 / "large"=isnet・168MB）をUIから選べるようにした。
- レイアウトタブ（`templates/index.html` + `static/js/main/16-processing-edit-tabs.js`）: 「画像」サブタブの背景除去モデル選択（軽量/BiRefNet）の右に品質セレクトを追加し、`_procRemoveBackground`/`_procRemoveBackgroundImgly` に `quality` 引数を通した。モデル選択が「軽量」以外（BiRefNet）のときは非表示。i18n 3言語対応（`layout.bgQuality*` キー追加）。
- Imageタブ（`static/js/image-tab.js`）: BG Removeツールのオプションバーにも同じ品質セレクトを追加し、`_bgRemoveImgly`/`_applyBgRemove` に `quality` 引数を通した。既存のBG Removeパネルの慣例（英語のみ、i18n未対応）に合わせて英語表記のまま実装。モデル選択がBiRefNetのときは非表示（`change` イベントで切替）。
- どちらもデフォルトは既定値の "medium" のため、既存ユーザーの挙動・見た目は変わらない（後方互換）。

**検証**（Kapture）: 両タブでQuality/品質セレクトが正しいラベル・デフォルト値（標準品質/Standard 84MB）で描画されることを確認。Imageタブでモデル選択をBiRefNetへ切り替えると品質セレクトが正しく非表示になることを確認。実際のモデルダウンロード・背景除去処理自体はCDN依存のまま変更していないため未実施（フェーズ1以前から動作実績あり）。

**How to apply**: 「CDNライブラリのローカル同梱」のような判断は、依頼時点の粗い見積り（「数十MB」）だけで進めず、実際にファイルを取得してサイズを確認してから最終判断を仰ぐのが安全。特に公開gitリポジトリでは、大きいバイナリの取り込みは後戻りしにくい（履歴除去が面倒、GitHubのファイルサイズ上限に抵触しうる）ため、確認なしに進めない。

---

## 2026-07-21（ドロー/シェイプの塗りにグラデーション・テクスチャ・塗りなしを追加 — 塗り拡張フェーズ2）

フェーズ1（テキスト塗り拡張）・フォントタブ対応に続き、レイアウトタブのドロー図形（矩形・楕円・直線・曲線・多角形・鎖・ロープ・My曲線）とImageタブのシェイプツール（矩形・楕円）にも同じ塗り設定（グラデーション・テクスチャ・塗りなし）を追加した（PLAN_backlog「塗りのグラデーション・テクスチャ・塗りなし対応」フェーズ2）。

**設計判断（スケール基準）**: テキストの塗りはフォントサイズ100pxあたりの相対値だったが、ドロー図形にはフォントサイズに相当する基準がない。図形サイズ比例か固定かの選択肢のうち、**k=1固定**（テクスチャのスケール%がそのままSVG単位／canvas pxのタイルサイズになる、図形サイズに応じた追加スケーリングはしない）を採用した。理由: ドロー/シェイプの塗りは（フォントタブのスタイルのような）名前付き保存・再利用の対象ではなくオブジェクトごとの都度設定であり、単純な絶対値の方が予測しやすいため。

**実装**:
- `static/js/main/17a-layer-draw-input.js`: `_layerDrawFillState`（mode/gradient/selectedStopIdx/texture）と、`_layerDrawFillRampColorAt`/`_layerDrawDrawGradRamp`/`_layerDrawFillSyncUI`/`_layerDrawGetFillStyleObj`/`_layerDrawLoadFillStateFromShape` を新設（`text-style-modal.js` の同名ロジックのミニマム移植）。`initLayerDraw()` にモード切替・ランプのドラッグ/追加/削除・テクスチャファイル選択（最大512px縮小）のイベントを追加し、`_layerDrawApplyPropsToSelected()` の塗り適用を `_fontMgrApplyFillPaintToEl(el, svgEl, styleObj, 1)`（09e-text-tool.js、フェーズ1で作った関数をそのまま流用。第1引数は任意の要素でよい設計だったため追加実装不要）に差し替えた。
- `static/js/main/17b-layer-draw-commit.js`（矩形/楕円/直線/曲線等の確定）・`static/js/main/17a-layer-draw-input.js`（多角形ペンの確定）: 図形生成時の `el.setAttribute('fill', fillColor)` を同じく `_fontMgrApplyFillPaintToEl` 呼び出しに置き換え。
- `static/js/main/17c-layer-draw-handles.js`: `_drawShapeExtractFillState(el, svgEl)` を新設（`_fontMgrExtractStyleFromTextEl` の塗り抽出部分と同じロジックのミニマム版。テキスト専用のfont-weight等を読まない）。`_drawShapeSyncProps()` から呼び出し、選択中図形の塗りモード・グラデーション・テクスチャをUIへ復元する。
- `templates/index.html`: レイアウトタブの描画ツールバーに塗りモードセレクト・グラデーションパネル（線形/円形・角度・カラーランプ・ストップ追加/削除）・テクスチャパネル（画像選択・スケール%）を追加。ラベルは `font.*` の既存i18nキー（fillModeSolid/fillModeGradient/fillModeTexture/gradShape*/texSelectImage/texScale）を再利用し新規キー追加なし。
- `static/js/image-tab/ShapeTool.js`: `fillMode`/`fillGradient`/`fillTexture`（`{img, scale}`。img は選択時に既にロード済みのImage要素で、Imageタブのシェイプは確定時に一度だけラスタへ焼き込むため既存の `_getTextureImage` のような非同期キャッシュは不要 — My曲線の `originalImg` と同じパターン）フィールドと `addFillStop`/`removeFillStop`（既存 `FillTool.evalGradient` を再利用）を追加。`drawShape()` の rect/ellipse 塗り部分を新設の静的メソッド `_fillStyleFor(ctx, sh, x1, y1, w, h)`（image-tab.js の `_textFillStyle` と同型。基準サイズは図形自身のバウンディングボックス）に置き換え。
- `static/js/image-tab.js`: シェイプツールのオプションパネル（`_renderToolOptions("shape")`）に塗りモードセレクト・グラデーションパネル（`_drawShapeGradRamp`/`_setupShapeGradRamp`を新設、FillツールのランプUIと同型）・テクスチャパネルを追加。矩形・楕円選択時のみ表示（線・鎖・ロープ・My Curveは塗り自体を持たないため対象外）。

**検証**（Kapture）: レイアウトタブで多角形をグラデーション塗り（白→グレー、線形0°）で実際に描画し、`linearGradient`（objectBoundingBox、x1/y1/x2/y2が角度と一致）と`fill="url(#...)"`がDOMに正しく生成されることを確認。単色・塗りなしへの切り替えで旧defsが正しくクリーンアップされることも確認。選択中図形からの塗りモード再抽出（グラデーション→UIに復元）も動作確認済み。テスト図形はUndoで削除済み。ImageタブはUI（モード切替によるグラデーション/テクスチャパネルの表示切替）の動作を確認したが、矩形/楕円の実際のドラッグ描画はKaptureのクリック操作がmousedown+mouseupを同一座標で発行するため検証できず、コードレビュー（SVG側で検証済みの同型ロジックの流用、および既存の `_textFillStyle`/`FillTool.evalGradient` との構造的一致）に留めた。

**How to apply**: 同じ機能を複数の場所（テキスト/ドロー/シェイプ、SVG/Canvas）に展開する際は、汎用化した適用関数（`_fontMgrApplyFillPaintToEl` のように第1引数を「任意の要素」にしておく）は素直に使い回し、UI（モード選択・ランプ描画・ドラッグ操作）は対象ごとに小さく複製する方が、状態管理のスコープや呼び出しタイミングの違いを吸収する共通レイヤーを作るより変更コストが低い（フォントタブ対応時の教訓と同じ）。スケール基準がない対象（今回のドロー図形）には、既存の相対値方式を無理に当てはめず絶対値（k=1）を選ぶ判断も、複雑さを増やさないという同じ方針に沿う。

---

## 2026-07-20（フォントタブのスタイル編集にも塗りのグラデーション・テクスチャ・塗りなしを追加）

フェーズ1（テキスト塗り拡張）では、フォントタブのスタイル編集フォームは単色のみ対応のままで、拡張塗り（グラデーション/テクスチャ/塗りなし）はレイアウト/Imageタブの「スタイル」ボタンから開くモーダルでのみ編集可能にし、フォントタブ側は保存時に値を持ち回るだけ（`_fontMgrEditingFillExt`）としていた。追加依頼を受け、フォントタブのフォームにも同じ編集UIを実装した。

**実装**:
- `templates/index.html`: `#style-fill-color` 周りに `text-style-modal.js` と同じ塗りUI（塗りチェックボックス＋モードセレクト＋グラデーションパネル（線形/円形・角度・カラーランプ・ストップ追加/削除）＋テクスチャパネル（画像選択・スケール%））を追加。id は `style-` プレフィックス（モーダル側は `tsm-` プレフィックス）で名前空間を分離。
- `static/js/main/19-font-manager.js`: `_fontMgrEditingFillExt`（保存値の素通し）を削除し、モジュールスコープの `_fontMgrFillState`（enabled/mode/gradient/selectedStopIdx/texture）と、`_fontMgrHex2Rgb`/`_fontMgrRgb2Hex`/`_fontMgrRampColorAt`/`_fontMgrDrawGradRamp`/`_fontMgrSyncFillUI`/`_fontMgrLoadFillState` を新設（`text-style-modal.js` の同名ロジックの移植・同一設計）。`_fontMgrGetStyleFromUI`/`_fontMgrApplyStyleToUI`/`_fontMgrResetStyleUI`/`_fontMgrUpdateStylePreview` を実状態ベースに書き換え、`_fontMgrInitStyleTab` に塗り関連イベント（モード切替・ランプのドラッグ/追加/削除・テクスチャファイル選択（最大512px縮小）・スケール入力）を追加。
- レイアウト/Imageタブ・フォントタブのどちらで編集・保存しても同じ `fontmgr_text_styles`（v2形式）を読み書きするため、一覧・見た目は双方向で一致する。

**検証**（Kapture）: フォントタブでモード切替（単色→グラデーション→テクスチャ→塗りなし）ごとにパネル表示・SVGプレビューが追従することを確認。ランプのストップ色変更（白→赤）がプレビューに反映され、名前を付けて保存→「新規」でリセット→保存済み一覧から再選択で、モード・ランプ・プレビューが完全に復元されることを確認。テスト用スタイルは削除済み。コンソールエラーなし。

**How to apply**: モーダルとタブ埋め込みフォームのように同じ編集UIを2箇所に持つ場合、id プレフィックスを分離（`tsm-` / `style-`）して同一ページ内での衝突を避けつつ、ロジック（状態管理・ランプ描画・ドラッグ処理）は関数名を変えて丸ごと複製するのが早い（モジュール化して共有する設計にすると、それぞれが参照する `document.getElementById` のスコープや呼び出しタイミングの違いを吸収する層が余計に必要になるため、複製の方が変更コストに見合う）。

---

## 2026-07-20（テキスト塗りのグラデーション・テクスチャ・塗りなし対応 — フェーズ1）

「レイアウトのテキストツールの塗りにグラデーション・テクスチャを使いたい。塗りなしも線同様チェックボックスで切り替えたい。スタイルモーダルで設定し、Imageタブのテキストでも同様にしたい」との依頼（PLAN_backlog「塗りのグラデーション・テクスチャ・塗りなし対応」フェーズ1）。フェーズ2（レイアウトのドロー図形・Imageタブのシェイプへの展開）は次回作業。

**スタイルオブジェクト拡張**（後方互換: 未定義=従来動作）:
- `fillEnabled`（false=塗りなし）/ `fillMode`（solid/gradient/texture）/ `fillGradient`（shape: linear|radial・angleDeg・stops[{pos,color}]）/ `fillTexture`（dataUrl・w・h・scale%）。既存の `fill`（単色）は維持。
- v2 の「フォントサイズ100pxあたりの相対値」思想を踏襲し、テクスチャのタイルサイズは 画像実寸×(scale/100)×(fontSize/100)。SVG（レイアウト）と Canvas（Imageタブ）で見た目が一致する。

**実装**:
- `static/js/text-style-modal.js`: 「塗り」チェックボックス＋モードセレクト＋グラデーションパネル（線形/円形・角度・カラーランプ。ランプはImageタブFillツールの `_drawFillGradientRamp` を移植し、ストップのドラッグ移動・クリック選択・追加/削除・色変更に対応）＋テクスチャパネル（画像ファイル選択→**最大512pxへ縮小してdataUrl保持**（localStorage容量対策）＋スケール%）。ランプのストップ等はDOM入力で表現できないためモーダル内 `fillState` として保持し、`getStyleFromUI`/`applyStyleToUI`/`applyInitialStyle`/`resetStyleUI` に組み込んだ。
- `static/js/main/09e-text-tool.js`: `_fontMgrApplyFillPaintToEl()` を新設し `_fontMgrApplyStyleAttrsToTextEl` から使用。defs に linearGradient（objectBoundingBox、角度→x1/y1/x2/y2変換）/ radialGradient / pattern（userSpaceOnUse、`data-ccc-tex-w/h/scale` でラウンドトリップ用の元データを持たせる）を生成して `fill=url(#id)`。前回適用分は `dataset.styleFillId` で管理し再適用時に除去（styleFilterId と同じライフサイクル）。`_fontMgrExtractStyleFromTextEl` は none / url(#...) を判別してグラデ・テクスチャ・塗りなしを復元する。
- `static/js/main/07-pages.js`: `_collectReferencedFilters` を filter に加え **fill / stroke の url(#...) 参照**（linearGradient/radialGradient/pattern）も取り込むよう一般化。コマ/オーバーレイ保存・オブジェクトのコマ間移動/複製・テキスト→PNG変換のすべてで定義が持ち回られる（12-text-png-export.js は defs 全体をクローンする方式のため対応不要だった）。
- `static/js/image-tab.js`: `_rerenderTextLayer` の塗りパスを `_textFillStyle()`（createLinearGradient=バウンディングボックスの角度方向投影幅／createRadialGradient=中心から対角半径／createPattern=repeat＋DOMMatrix.scale）に差し替え。fillEnabled=false は fillText パスをスキップ（線・袋文字のみ描画）。テクスチャ画像は `_getTextureImage()`（dataUrl→Imageキャッシュ）で管理し、未ロード時は単色フォールバック→ロード完了で自動再描画（フォントロードと同じパターン）。`_fontStyleAttrsFromStyle`/`getSelectedTextStyleInfo` に新フィールドを追加。
- `static/js/main/19-font-manager.js`: フォントタブのスタイル編集UIは単色のまま。`_fontMgrEditingFillExt()` で編集中スタイルの拡張塗りフィールドを保存時・プレビュー時に持ち回り、**フォントタブで再保存しても拡張塗りが欠落しない**ようにした。CSSミニプレビューはグラデ=先頭ストップ色で近似・塗りなし=透明。
- i18n: 塗りモード・グラデーション・テクスチャ関連の3言語キーを追加。

**検証**（Kapture）: モーダルで赤→青・角度90°のグラデーション設定→プレビュー・挿入・保存SVG・リロード後の保持を確認。塗りなし+線で `fill="none"`＋旧定義のクリーンアップを確認。テクスチャ（市松模様32px）で pattern 生成・タイルサイズのフォントサイズ比例（フォント529×scale100% → タイル169.28）・抽出ラウンドトリップを確認。Imageタブでグラデ/塗りなし+線/テクスチャの3種を挿入し描画を視覚確認。コンソールエラーなし。

**How to apply（SVGとCanvasの塗り表現を揃える）**: SVGの `objectBoundingBox` グラデーションに合わせるには、Canvas側は「テキストボックスの角度方向への投影幅」（|cosθ|×W+|sinθ|×H）でグラデーション区間を取ると一致する。テクスチャは両側とも「サイズ相対のタイル寸法」を共通式にすることでズレを防ぐ。SVG側のペイント定義はフィルタ定義と同様に dataset でIDを持たせて適用時に前回分を除去し、保存側は url() 参照の走査（fill/stroke/filter）で defs を持ち回るのが定石。

---

## 2026-07-20（CDN 依存ライブラリのローカル同梱: jsPDF/JSZip をオフライン対応に）

DEVLOG 2026-07-17 で「ヘルプにオフライン制限を明記」として先送りしていた、jsPDF/JSZip の CDN 依存を解消した（PLAN_backlog の次回作業）。これによりインターネット接続のないオフライン環境でも PDF/EPUB 出力・zip 保存・一括バックアップ／復元が動作する。

**実装**:
- cdnjs 配布物の `jspdf.umd.min.js`（jsPDF 2.5.1、MIT）と `jszip.min.js`（JSZip 3.10.1、MIT/GPLv3 デュアル）を `static/js/vendor/` に同梱。**cdnjs API（`https://api.cdnjs.com/libraries/<name>/<version>?fields=sri`）の SRI（SHA-512）ハッシュとローカルファイルのハッシュが一致することを検証**し、配布物そのまま（改変なし）であることを確認した。ライセンス表記は各 min.js 先頭のヘッダーコメントに含まれる。
- `templates/index.html` の `<script>` 2本を cdnjs URL → `/ccc_static/js/vendor/...` に差し替え。静的配信は既存の `app.router.add_static("/ccc_static", STATIC_DIR)`（`py/ccc.py`）がサブフォルダごと配信するためサーバー側の変更は不要。
- `static/js/vendor/README.md` にバージョン・ライセンス・取得元 URL・SRI 検証手順（更新時の手順として）を記録。`.gitignore` に vendor を除外する記述はなく、min.js はコミット対象。
- **@imgly/background-removal（BG Remove 軽量モデル）は CDN 依存のまま残した**。バンドルJSに加えモデルデータ（数十MB）の同梱が必要でリポジトリが肥大化するため。ローカルの背景除去は BiRefNet 連携（comfyui-mask-editor-one）で既にカバーされており、対応可否は PLAN_backlog に「要判断」として整理。

**検証**: リロード後にスクリプトがローカルパスから読み込まれ CDN 参照が消えていること、`window.jspdf.jsPDF` / `window.JSZip`（3.10.1）のロード、jsPDF での PDF 生成（正常な dataURI 出力）、JSZip での zip 生成→読み戻し（内容一致）、コンソールエラーなしを確認。

ヘルプ「ページ — 出力 > オフライン環境について」（3言語）を「全出力形式がオフラインで利用可。Webフォント未キャッシュ時は代替フォント描画の可能性あり。BG Remove（軽量モデル）と Nanobanana は要ネット接続」に書き換え、README 3言語（出力の機能記述＋アーキテクチャのディレクトリ構成に vendor/ 追記）を更新した。

**How to apply（CDNライブラリの同梱）**: min.js を `static/js/vendor/` に置いて `<script>` の src を差し替えるだけでよいが、取得物が改変されていないことを cdnjs API の SRI ハッシュ照合で必ず検証し、vendor/README.md に出所・ライセンス・更新手順を残すこと。動的 import 型（esm.sh の @imgly 等）はモデルデータ等の外部フェッチを伴う場合があり、src 差し替えだけでは完結しない点に注意。

---

## 2026-07-20（カスタムフキダシSVGの配置後 fill・stroke 変更）

ヘルプ「付録: フキダシSVG仕様」に明記していた既知の制限「配置後にアプリ内でfill・strokeを変更する機能は現状未実装」を解消した（PLAN_backlog の次回作業 1）。

**原因（なぜ変更できなかったか）**: アセット（`assets/speech/` 等）のSVGは `handleInsertAsset`（`02-assets.js`）経由で `<image href="data:image/svg+xml;base64,...">` として配置される。組み込みフキダシ（balloon-shape の `<g>`＋path）と違い中身がSVG要素としてDOMに存在しないため、既存の色変更UIが届かなかった。

**実装**: `<image>` のまま、href内のSVGテキストを書き換えて差し替える方式（既存の画像操作・ハンドル・保存経路を全て流用できる）。
- `static/js/main/08-panels-images.js`: `_isSvgImageEl()`（href が `data:image/svg` の inserted-image 判定）／`getSvgImageColors()`（代表色の取得）／`applySvgImageColors()`（色一括置換→base64再エンコード→href差し替え、`dataset.fillColor/strokeColor` へ記録）を追加。`renderImageHandles()` で選択時に塗り/枠ピッカー（レイアウト・セリフ両タブ）を現在色に同期。
- `static/js/main/09a-balloon-init.js`: `initBalloonManager` 末尾で box-color / border-color 系4入力にフックを追加。`state.selectedShapeId` があればフキダシ優先（従来動作）、なければ選択中のSVG画像へ適用。input で即時反映、change で `savePanelSvg`（オーバーレイは `g[data-overlay-layer]` 判定で `__overlay__`）。
- **色の適用ルール**（要決定だった方針）: 「明示指定のない要素にのみ適用」だと典型ファイル（各要素に fill/stroke 明示、またはCSSクラス指定）で何も変わらないため不採用。**実効値が `none` 以外の要素の fill / stroke を一括置換**とした。`none`（穴・透明）と `url()` 参照（グラデーション等）は維持。
- **CSSクラス色指定への対応**: CorelDRAW出力（org_sp1.svg 等）は `<style>` の `.fil0/.str0` で色指定している。SVGを document に一時追加（position:fixed 画面外、同期で即削除）して `getComputedStyle` で実効 fill/stroke を解決し、CSSクラスより優先される inline style で上書きする。
- 枠線太さ（stroke-width）の配置後変更は対象外（SVGごとにviewBox座標系が異なり、ページ単位の太さ指定と整合しないため）。ヘルプにその旨を明記。

Kapture検証: org_sp1.svg をオーバーレイに挿入→選択でピッカーが実色（#fefefe/#000000）に同期→塗りピンク・枠青へ変更が即時反映→リロード後も保持、コンソールエラーなし。ヘルプ（フキダシSVG仕様の3言語）・README 3言語のフキダシ機能記述を更新した。

**How to apply（`<image>` として配置されたSVGの編集）**: dataURLのSVGは「デコード→DOM操作→再エンコードしてhref差し替え」で、ラスター化せずに配置後編集ができる。CSSクラス・継承を含む実効スタイルの判定が必要な場合は、documentへの一時追加＋`getComputedStyle` で解決し、上書きは属性ではなく inline style で行う（属性はCSSクラスに負けるため）。同期処理内で追加→削除すれば描画への影響はない。

---

## 2026-07-19（出力メタデータ全形式対応・プロジェクト一括バックアップ・解像度指定の出力サイズ自動計算）

既存ライブラリ（jsPDF/JSZip）で追加可能な機能として調査済みだった「PDF出力のメタデータ設定」「JSZipによる一括バックアップ」の実装依頼を受け、レビューを経て「メタデータの全形式対応」「解像度指定による出力pxサイズ自動計算」まで拡張した。あわせてアプリ名表記を Eagle Comic Creator → **ComfyUI Comic Creator** に統一した（ComfyUIカスタムノード化に伴う改名。`eagle_settings` 等の機能キーは互換性のため据え置き）。

**出力メタデータ（ページタブ→出力サブタブ）**:
- 「メタ情報」入力行（タイトル・著者・件名・キーワード）を全形式共通で常時表示。入力値は `ccc_export_meta` へ永続化（旧 `ccc_pdf_meta` から自動引き継ぎ）。空欄項目は未設定、全欄空なら一切加工しない。
- **PDF**: `pdf.setProperties()` で Info 辞書へ。jsPDF 2.5.1 の `putInfo` は値をリテラル文字列として素通しするため、日本語はBOM付きUTF-16BEのバイト列に自前エンコードする `_encodePdfInfoText()` を実装（CDNソースの `putInfo` を確認して確定）。
- **EPUB**: content.opf の Dublin Core（著者→dc:creator、件名→dc:description、キーワード→カンマ/読点分割で dc:subject 複数展開、XMLエスケープ付き）。
- **画像**: 新規ファイル `static/js/main/13a-export-metadata.js` に集約し、`handleExport` の toBlob 直後の1箇所で `_embedImageMetadata()` を通す（単発保存・フォルダ保存・zip保存すべてに効く）。PNG=iTXtチャンク（IHDR直後に挿入、CRC32自前実装）／JPEG=XMPのAPP1セグメント（既存APPn群の直後）／WebP=VP8Xヘッダ新設＋XMPチャンク（VP8Lのアルファビットを検出してALPHAフラグ継承、RIFFサイズ更新）。失敗時は元Blobを返すフェイルセーフ。
- Nodeでの構造検証23項目（PNG全チャンクCRC再検証・iTXt/XMP読み戻し・RIFFサイズ整合・チャンク順・空メタ無加工）を全パス。

**プロジェクト一括バックアップ（ページタブ→作品管理サブタブ）**:
- 「バックアップ」で IndexedDB 全ストア（pages/templates/trash/settings）と本アプリのlocalStorageキー23個を `ccc_backup_日時.zip` へ書き出し（`11a-work-manager.js`）。**ComfyUIと同一オリジンでlocalStorageを共有しているため、全キーダンプではなく `_BACKUP_LS_KEYS` の明示列挙にした**（復元時も同リストでフィルタ）。
- 「復元」は `backup.json` マニフェスト（format識別子）検証→件数入り確認ダイアログ→マージ書き戻し（同名上書き・他は保持、settingsストアのみkeyPathが`id`）→自動リロード。

**解像度指定による出力サイズ自動計算（出力サブタブ）**:
- 「解像度」セレクト（手動/72〜600dpi）を追加。作品サイズ（内部単位=mm×100）から `mm×dpi÷25.4` で幅・高さを自動計算。基準作品は「選択ページの所属作品→フィルタ中の作品→アクティブ作品」の順で解決（画像取込ページはpx実寸を持つため、ページのwidth/heightは基準に使わない）。
- 幅・高さの手動編集でセレクトは「手動」へ自動復帰（プログラム的代入では`input`イベントが発火しないことを利用）。dpiは `ccc_export_dpi` に永続化し、起動時・ページ選択時は silent モードで再適用。
- 出力px上限を 3000→8000 に引き上げ（`_EXPORT_MAX_SIZE`。従来上限では300dpi A4=3508pxすら不可）。超過時は縦横比維持で縮小し通知。
- **PDFの物理サイズ修正**: px→mm換算を固定96dpiから選択dpiに変更。A4作品を300dpiで出力するとPDF用紙が210×297mmになる（手動時は従来どおり96dpi）。

ヘルプ（出力・作品管理の3言語）、README 3言語の機能一覧、i18n（メタ情報・バックアップ・解像度の3言語キー）を更新した。

**How to apply（ツール経由のコード書き込みでバックスラッシュ列が化ける）**: 今回 `/[^\x00-\xff]/` という正規表現をEditツール経由で書いたところ、ファイルに生のNUL/0xFFバイトが混入した（シェル・ツールのエスケープ変換が原因。Bash heredoc経由のperl/pythonでも `\\x00` が `\x00` に潰れて修正が空振りした）。JSソースに `\xNN`/`\uNNNN` リテラルを書く必要がある場合は、エスケープ不要な等価コード（`codePointAt()` 比較や `String.fromCharCode(0xNN)`）に書き換えるのが確実。バイナリレベルの修正はPythonの `bytes([0])` のような数値構築で行い、書き込み後は必ず `xxd` 等でバイト検証すること。

**How to apply（ブラウザ内アプリのバックアップ設計）**: 同一オリジンに他アプリ（ComfyUI本体）が同居する場合、localStorageの全キーダンプは他アプリの設定を巻き込むため、自アプリのキーを定数リストで明示列挙し、復元側も同リストでフィルタする。復元はDBのkeyPath（`name`/`id`）ごとの存在チェック＋マージ方式にし、完了後はリロードで全タブ状態を作り直すのが安全。

---

## 2026-07-18（画像リサイズ: Alt＋ドラッグで縦横比固定を解除できるように）

レイアウトタブの画像ハンドルリサイズについて「現在は縦横比固定だが、Alt＋ドラッグで固定解除したい」との要望を受けた。

**調査で判明した実態**: リサイズ処理（`static/js/main/08-panels-images.js` の `imgResizing` ブロック）は実は枠（x/y/width/height）を自由変形しており、縦横比を固定するコードは存在しなかった。「固定に見えていた」原因は、`<image>`要素に`preserveAspectRatio`が未指定のためSVGデフォルトの`xMidYMid meet`（縦横比維持で内接）が効いており、枠を歪めても画像の中身は歪まず表示されていたため。つまり従来は「枠だけ歪み、枠と画像の間に見えない余白が育つ」状態だった。

**実装**: mousemoveイベントの`e.altKey`で分岐する2モードに書き換えた。
- **通常ドラッグ**: 枠ごと縦横比固定でリサイズ。角ハンドルは伸び率の大きい方の軸に追従した等倍スケール、辺ハンドルも等倍スケール（直交方向は中央固定）で、反対側の辺/角が固定点。見えない余白が発生しなくなる。
- **Alt＋ドラッグ**: 従来の自由変形ロジックをそのまま使用し、加えて`preserveAspectRatio="none"`を画像に設定して中身も枠に合わせて実際に伸縮させる。属性は保存されるため、以降その画像は枠どおりに表示される。ドラッグ中のAltの押し離しでモードが即時切り替わる。

過去に辺ハンドル操作で「枠だけ歪んで中身に余白がある」状態になっていた既存画像は、Alt変形した瞬間に中身が枠いっぱいに引き伸ばされ見た目が変わる（枠と中身のずれの解消として許容）。ヘルプ「画像の挿入」・README 3言語の「画像配置」にAltの説明を追記した。

**How to apply（SVG imageの「縦横比が固定されて見える」現象）**: SVGの`<image>`は`preserveAspectRatio`未指定だと`xMidYMid meet`がデフォルトで、width/height枠を歪めても中身が歪まない。「リサイズが縦横比固定になっている」ように見える挙動を調査するときは、リサイズ計算のコードだけでなく`preserveAspectRatio`の有無を必ず確認すること。自由変形をサポートする場合は`none`の明示が必要。

---

## 2026-07-18（マンガ効果: 集中線を参考アプリ移植で品質改善、ウニフラ/ウニ（輪）追加、ヴィネット改善）

マンガ効果モーダルの集中線について「参考アプリ（manga-halftone-processor）と比べ質が悪い」との報告を受けた。Kaptureで両アプリの表示を見比べ、参考実装（`HalftoneCanvas.tsx`）との差分を特定した。

**指摘された問題と原因**:
1. **線の奥の先端が太い** — 旧実装は線の終端を対角長の50〜100%のランダム位置で止めていたため、太い側の終端がキャンバス内に見えていた。参考アプリは線を常に対角長いっぱいまで伸ばすので太い終端は必ずキャンバス外に出る。
2. **密度最大でも手前側に隙間** — 旧実装は本数最大120本＋終端がランダムに途切れる方式。参考アプリは密度%×5本（最大500本）で全線が外周まで届く。
3. **線の長さが変えられない** — 旧実装は中心の空白が固定だった。

**実装**（`static/js/main/15b-manga-tone.js`）:
- `_mangaDrawRadialSpeedLines`を参考アプリの移植版に全面書き換え。中心側の先端は針状（0.2px相当固定）、外枠側だけが太くなるテーパー四角形で、常に対角長まで描く。密度は%指定（本数=密度×5、最低15本）に変更。「範囲・長さ」（中心の空白サイズ）・「外枠側の太さ」スライダーを新設（i18n 3言語追加）。
- **手前側の塗りつぶし対応**: 「外枠側の太さ」上限を15→60pxに拡張。太さを上げると隣接する線が外側で重なり、手前側がベタ塗りになる（密度・長さ・太さの組合せで集中線〜ウニフラッシュ状のベタ表現まで1つのモードでカバー）。
- **ウニフラ／ウニ（輪）を新規追加**: 参考アプリの`drawUniFlash`（中心コア円＋短中長3層の外向き三角トゲ、密度×5本）と`drawUniRing`（基準円の内外に伸びる細ストローク束、密度×9.5本、線幅ランダム）を移植。ウニ系専用の「外側の長さ」スライダーを追加。参考アプリはウニフラ白固定だが、本実装では既存の色設定を適用する仕様にした（透過オブジェクトのため背景に応じて白/黒を選ぶ）。
- **ヴィネット改善**（「効果があまりない」との指摘対応）: 円形グラデーション（半径=対角長）だと最大濃度に達するのが四隅だけで四辺中央がほぼ暗くならなかった。キャンバスの縦横比に合わせた楕円グラデーション（`ctx.scale`変形）に変更し、中間色停止点（55%地点で濃度×0.55）も追加して効きを強くした。
- サイズ系パラメータはすべて`_MANGA_SIZE_REFERENCE_DIM`(400)基準の`sizeScale`でスケールし、プレビューと適用結果の見た目を一致させている（前回確立した設計指針に準拠）。

**Kapture検証**: モーダルのプレビューcanvas（閉じられた後は一時canvasをbodyに追加→確認後削除）へ新ロジックを直接描画し、密度100で外周まで隙間なし・太さ40で手前ベタ塗り・ウニフラ/ウニ（輪）が参考アプリ同等の見た目になることをスクリーンショットで確認した。

**How to apply（「質が悪い」系の報告は参考実装と両方の実物を見る）**: 見た目の品質差の報告は言葉だけで原因を推測せず、参考実装のコードと、可能ならKapture等で両方の実際の描画結果を並べて確認する。今回は「終端を対角長まで伸ばす（太い端をキャンバス外に出す）」という参考実装の設計意図がコード比較で初めて分かった。移植時はパラメータのスケール基準（絶対px か 基準解像度比か）の変換を忘れないこと。

---

## 2026-07-18（マンガ効果モーダル: プレビュー背景3択追加・Opacity/Intensity削除・背景画像の縦横比修正）

ハーフトーンモーダルで確立した「選択画像／デフォルト／白」のプレビュー背景3択UIを、マンガ効果モーダルにも展開した。

- **プレビュー背景3択**: `_mangaGetRegionBackdropImage()`（選択中の画像→対象コマ/オーバーレイ内の既存画像の優先順）を再利用し、背景ガイド画像がある場合は「選択画像」を初期選択・ない場合はボタン非表示。背景はプレビュー確認専用で生成される透過オブジェクトには含まれない。
- **Opacityスライダー削除**: 不透明度は挿入後にレイヤーパネル側で調整する方式のため、モーダル内のスライダーと挿入時の`opacity`属性を削除（常に不透明で挿入）。
- **集中線のIntensityスライダー削除**: 純粋な不透明度（globalAlpha）だったためレイヤー側調整と重複。削除して常に不透明で描画（ヴィネット強度・スクリーントーン強度は広がり/粒密度を制御する機能的パラメータのため残置）。
- **背景ガイド画像の縦横比バグ修正**: プレビューcanvas（=コマの縦横比）へ`drawImage(img, 0, 0, w, h)`で全面に引き伸ばしていたため画像が歪んでいた。縦横比を保った中央トリミングのカバー描画ヘルパー`_mangaDrawBackdropCover()`を新設し、ハーフトーン「パターンを作成」プレビューとマンガ効果プレビューの両方で使用。

あわせてヘルプ（「マンガサブタブ」「画像サブタブ」のハーフトーン記述）とREADME 3言語の「マンガツール」項目を、集中線4種・プレビュー背景3択・不透明度のレイヤー側調整方式に合わせて更新した。

---

## 2026-07-17（ComfyUI Manager PR承認 → READMEにマンガツールを反映 → Registry公開へ）

`ltdrdata/ComfyUI-Manager`(現 `Comfy-Org/ComfyUI-Manager`)への登録PR([#3086](https://github.com/Comfy-Org/ComfyUI-Manager/pull/3086)、詳細は本ファイル内「ComfyUI Manager PR提出」の項を参照)が承認された。ユーザー方針で待機していたComfyUI Registry(registry.comfy.org)公開のステップ2に進む前段として、README 3言語(README.md/README_en.md/README_zh.md)の「レイアウトタブ」機能一覧に、直近で実装した「マンガツール」(ハーフトーン変換/生成 + マンガ効果、コミット`2316da5`)の項目が未反映だったため追記した。

**追記内容**: PixiJS FXの項目の直後に、ハーフトーンモーダル(画像を変換／パターンを作成の2モード)とマンガ効果モーダル(ヴィネット・スクリーントーンノイズ・集中線の透過オブジェクト生成)をまとめた1項目を追加。

**How to apply（機能追加時のREADME更新漏れ防止）**: 新機能をDEVLOGに記録するタイミングと、ユーザー向けドキュメント(README)へ反映するタイミングがずれることがある。ComfyUI Manager PR・Registry公開のような対外公開作業の直前は、直近の機能追加コミットがREADMEに反映済みかを必ず確認すること。

**ComfyUI Registry公開**: `comfyui-registry`スキルのステップ2に従い、`pyproject.toml`(PublisherId="statsu"、既存公開済みノードの`comfyui-vrm-pose-editor`から流用して確認)・GitHub Actionsワークフロー(`Comfy-Org/publish-node-action`をコミットSHA固定・`permissions: contents: read`付きで新設)・サムネイル画像(`docs/1_top.png`を800×380にリサイズして`docs/thumb.png`として新設)を追加してpush。

初回pushは`version = "1.2.0"`のままだったが、既存の`v1.2.0`タグがそれより前のコミット(`2316da5`)を指しており、タグ付きアーカイブとRegistry公開内容がズレる問題に気づいた。ユーザー確認の上、`v1.2.0`タグ以降の未リリースコミット(PDF/EPUBオフライン制限のヘルプ追記・今回のREADME/Registry公開準備)を含めて`v1.2.1`としてパッチバージョンを再公開し、公開に使われたコミットにちょうど一致する形で`v1.2.1`タグ・GitHub Releaseを作成した。公開URL: https://registry.comfy.org/publishers/statsu/nodes/comfyui-comic-creator

**つまずいた点**: 初回のワークフロー実行が`Option '--token' requires an argument`で失敗した。原因はユーザー側の`REGISTRY_ACCESS_TOKEN` Secret設定の誤りで、修正後に`gh workflow run`で手動再実行し成功した（`comfyui-registry`スキルのトラブルシューティング表に載っている既知のパターンと一致）。

**How to apply（バージョンバンプ前にタグ位置を確認）**: 既存タグがある状態で新規に`pyproject.toml`を追加してRegistry初公開する場合、その時点の`version`値と同名のGitタグが過去のコミットを指していないか（＝今回pushする内容を含んでいないか）を事前に確認すること。含んでいなければ、その`version`のままpushせず、パッチバージョンを上げてから公開し、公開に使ったコミットに対して新しいタグ・Releaseを作成する。

---

## 2026-07-17（ヘルプ「ページ — 出力」にPDF/EPUB出力のオフライン制限を明記）

リリース前チェックとして「requirements.txt作成の要否」をユーザーと確認していた過程で、PDF/EPUB出力機能が何に依存しているかを改めて調査した。

**調査結果**: PDF/EPUB出力（`static/js/main/13-export-pdf-epub.js`）はComfyUIネイティブの機能ではなく、Pythonライブラリにも依存していない。実体はブラウザ側JavaScriptで、PDF生成は`jsPDF`、EPUB(ZIP)生成は`JSZip`を使用しており、両方とも`templates/index.html`から`https://cdnjs.cloudflare.com/...`のCDN経由で`<script>`タグ読み込みしている（ローカル同梱ではない）。そのためrequirements.txt不要という結論自体は正しい一方、**インターネット接続のないオフライン環境ではPDF/EPUB出力ボタンが動作しない**という制約が新たに判明した（JPEG/PNG/WebP出力は外部ライブラリ不要なため影響なし）。

**対応**: ユーザーからオフライン環境での利用者を想定してヘルプページに明記してほしいとの依頼を受け、ヘルプタブの「ページ — 出力」セクション（日本語/英語/中国語の3言語すべて）に「オフライン環境について」の項目を追加した（`static/js/main/22-help-tab.js`）。CDN依存の理由とJPEG/PNG/WebPは影響を受けない旨を記載。

**How to apply（外部ライブラリのCDN依存はrequirements.txt確認だけでは見つからない）**: 「サーバー側の依存関係（requirements.txt）が不要」という結論は、クライアント側JavaScriptがCDN経由で外部ライブラリを読み込んでいないことを保証しない。オフライン配布・オフライン利用を想定するアプリでは、フロントエンドの`<script src="https://...">`タグも合わせて棚卸しし、CDN依存が見つかった場合はローカル同梱への切替を検討するか、少なくともヘルプ等のドキュメントに制約として明記すること。

---

## 2026-07-17（ハーフトーン/マンガ効果: プレビューと適用結果でドット密度が一致しないバグを修正）

ユーザーからスクリーンショット付きで「Generate Patternで作成したハーフトーン画像がプレビューとだいぶ異なる」との報告を受けた。プレビューでは明瞭に見えていたドットパターンが、実際にコマへ適用した結果ではほぼ見えないほど微細になっていた。

**原因**: `dotSize`（および `_mangaDrawScreentoneTexture` の `grainSize`、集中線の線の太さ）が「canvas上の絶対ピクセル値」として実装されていたが、プレビュー用canvas（プレビュー枠の実サイズ、せいぜい数百px）と実際に適用するcanvas（`_MANGA_HALFTONE_MAX_DIM=2400`まで許容する大きな解像度）とでは解像度が大きく異なる。同じ`dotSize=8`という値でも、400px幅のcanvasでは画像の2%を占める目立つドットになる一方、2000px幅のcanvasでは0.4%程度の非常に細かいドットになってしまい、プレビューで確認した見た目と適用結果が一致しないという実装上の欠陥だった。

**修正**: 新設した `_MANGA_SIZE_REFERENCE_DIM`（400）を基準に、`dotSize`・スクリーントーンノイズの`grainSize`・集中線（放射状/線形）の線の太さを、実際の描画先canvasの長辺サイズに比例してスケールするよう修正した（`sizeScale = Math.max(width, height) / _MANGA_SIZE_REFERENCE_DIM`）。これにより、プレビューがどんな解像度で描画されようと、また実際の適用がどんな解像度で行われようと、"画像に対する相対的なドット密度"が常に一致するようになった。影響範囲は `_mangaRenderHalftone`（ハーフトーンの画像を変換／パターンを作成の両モード共通）、`_mangaDrawScreentoneTexture`、`_mangaDrawRadialSpeedLines`、`_mangaDrawLinearSpeedLines`（いずれもマンガ効果モーダル）。

**Kapture実機検証**: 画像入りのコマで「パターンを作成」モードのプレビュー（選択画像を背景に表示）でドットパターンを確認したのち「適用」し、レイアウトタブの表示倍率を300%→150%まで拡大して実際にコマへ挿入された結果を確認。修正前は肉眼でほぼ判別できないほど細かかったドットが、修正後はプレビューと同等の明瞭な網点パターンとして表示されることを確認した。

**How to apply（プレビュー解像度と適用解像度が異なる機能の設計指針）**: 「軽量なプレビューを小さい解像度で描画し、実際の適用は高解像度で行う」という最適化パターンを使う場合、パラメータの中に「canvas上の絶対ピクセル値」として解釈されるものがあると、プレビューと適用結果で見た目が一致しなくなる典型的な罠になる。この種の機能を実装する際は、サイズ系パラメータは必ず「基準解像度に対する比率」として扱い、実際の描画先の解像度に応じてスケールする設計を最初から組み込むこと（今回のような後追い修正を避けられる）。

**リリース**: ユーザー承認のもと本セッションの全変更（マンガツール新規実装〜今回のバグ修正まで）をまとめてコミット→`git push origin master`→マイナーバージョンとして`v1.2.0`タグを作成・push→`gh release create v1.2.0`でGitHub Release公開（https://github.com/ketle-man/comfyui-comic-creator/releases/tag/v1.2.0 、日本語本文＋英語summary併記）。新機能（マンガツール一式）を含むためマイナー版（v1.1.0→v1.2.0）とした。

---

## 2026-07-17（ハーフトーンプレビュー背景UIを3択「選択画像／デフォルト／White」に統合）

前回の修正（Convert Imageの不透明化バグ修正＋背景トグル）に対し、ユーザーから「意図が伝わっていない」と再度フィードバックを受けた。改めて整理すると要点は次の通り：

- Convert Image・Generate Patternのどちらも、**選択した画像を見ながらドットサイズ等を調整しないと出来上がりの具合が判断できない**（両モードに共通する本質的な要求）。
- Convert Imageは「背景切り替えを追加する前は機能していた」——つまり以前の壊れていない状態（用紙色で不透明に変換される）が正しい前提であり、背景暗さによる視認性の悪さだけを「デフォルト／白」で解消したい、という単純な話だった（前回の不透明化バグ修正はこの理解で合っていた）。
- Generate Patternについては、「パターンの後ろに**選択画像／デフォルト／白**で切り替えて確認しながら設定したい」——つまり2択（デフォルト/White）ではなく、**「選択画像を背景に表示する」を含む3択**が必要だった。前回実装した「ガイド画像を表示」チェックボックス＋デフォルト/White 2択という2段構えのUIは、機能的には近いものの、ユーザーが求めていた「1つの3択スイッチ」というシンプルな操作感と一致していなかった。

**実装**: プレビュー背景の選択UIを、`mh-preview-bg-group` 内の単一セグメントボタン群「選択画像／デフォルト／White」に統合した。「選択画像」ボタンは「パターンを作成」モードかつ背景ガイド画像（選択中の画像、または対象コマ内の既存画像）が利用可能な場合のみ表示し、それ以外（「画像を変換」モード、またはガイド画像が存在しない場合）は自動的に非表示になる。状態は`previewBgMode`（`'image' | 'default' | 'white'`）という単一の変数で管理し、モード切替時に`updatePreviewBgButtons()`が可視性と選択状態の整合性を取る（「選択画像」が使えなくなったら自動的に「デフォルト」へフォールバック）。「パターンを作成」モードを選択画像ありで開いた場合は、ユーザーの要望通りデフォルトで「選択画像」が選ばれた状態にした（ガイドなしで開始すると調整の基準がないため）。

「画像を変換」モードは引き続き常に不透明で、「デフォルト」（設定中の用紙色）／「White」（プレビュー限定の白上書き）の2択のみ（「選択画像」は変換対象そのものが背景になるため表示しない）。適用結果への影響は従来通り: Convert Imageは常に実際の用紙色で確定、Generate Patternは背景設定に関わらずパターンのみが生成される。

**Kapture実機検証**: 画像入りのコマを選択（画像自体は未選択）して「パターンを作成」モードを開き、「選択画像」が既定でアクティブになり実際の絵を背景にドットパターンをプレビューできることを確認。「デフォルト」（チェッカーボード）「White」（白背景）への切替も確認。続けて実際に画像を選択して「画像を変換」モードを開き、「選択画像」ボタンが表示されず「デフォルト／White」の2択のみになることを確認。

**How to apply（フィードバックの再確認は具体的な操作イメージまで踏み込む）**: UIの意図がうまく伝わらなかった場合、抽象的な言葉（「背景を切り替えたい」）だけでなく、ユーザーが思い描く具体的な選択肢の構成（今回は「選択画像／デフォルト／白の3択」）まで踏み込んで確認・実装すること。機能的に等価な実装（チェックボックス＋2択ボタン）でも、UIの構造がユーザーのメンタルモデルと異なると「意図が伝わっていない」と感じさせてしまう。

---

## 2026-07-17（Convert Imageの不透明化バグ修正 + プレビュー背景/ガイド画像の再設計）

前回実装した「Black/White」プレビュー背景トグルをユーザーが実際に使ってみたところ、「これではConvert Imageが機能しない」という指摘を受けた。調査の結果、セッション中に生成モード（Generate pattern）向けに追加した`transparentBackground`オプションが、意図せず「画像を変換」モードにも漏れ込んでいる実装バグを発見した。

**根本原因**: `readOptionsFromUI()`は`$('mh-transparent-bg').checked`をモードに関係なく常に読み取る実装だった。このチェックボックスはHTML上`checked`がデフォルトで付与されており、`#mh-generate-params`内（Convert Imageモードでは`display:none`）にあるため、Convert Imageモードではユーザーが触れられないままtrueであり続ける。結果、`_mangaRenderHalftone()`内の`if (!options.transparentBackground) { 用紙背景を描画 }`が常にスキップされ、**「画像を変換」の実際の出力が意図せず透過（ドットのみ、用紙背景なし）になっていた**。これは今セッションの改修（コマサイズ生成モードの追加）で生まれた回帰バグで、本来「画像を変換」は選択画像を完全に置き換える不透明な仕上がりであるべきだった。

**修正**: 「画像を変換」モードは常に`transparentBackground: false`を強制するようにし（プレビュー・適用の両方）、モード間のオプション漏れを断ち切った。これでConvert Imageは常に用紙色（モノクロ=白、デュオトーン=設定した紙色）を背景に持つ、正しい完全変換画像を生成するようになった。

**プレビュー背景トグルを「デフォルト/White」に再設計**: 単純なCSS背景色の切り替え（Black/White）ではなく、**実際のレンダリングパラメータ（用紙色）を一時的に上書きしてプレビューし直す**方式に変更した。「デフォルト」は設定中の実際の用紙色（デュオトーンのカスタム紙色を含む）でプレビューし、「White」はプレビューのみ用紙色を強制的に白に差し替える（実際の適用結果には影響しない、あくまで見やすさ確認用）。デュオトーンで暗い紙色を設定していても、Whiteボタンで一時的に白背景での見え方を確認できる。

**Generate Patternモードに「ガイド画像を表示」トグルを追加**: 前回実装した「対象コマ内の既存画像をスケール確認用の背景ガイドとして自動表示する」機能に、明示的なON/OFFチェックボックスを追加した（ガイド画像が利用可能な場合のみ表示）。OFF時は「デフォルト/White」設定に応じてチェッカーボード（透過を示す）または白背景にフォールバックする。ガイド表示のON/OFFに関わらず、「適用」時は従来通りパターンのみが生成され、ガイド画像は一切焼き込まれないことをKaptureで確認した。

**Kapture実機検証**: Convert Imageモードでデュオトーン・暗い紙色を設定し、「デフォルト」で実際の紙色、「White」で強制白にプレビューが切り替わることを確認。Generate Patternモードで「ガイド画像を表示」のON/OFFによりプレビュー背景（実画像⇔チェッカーボード/白）が切り替わり、どちらの状態でも「適用」でパターンのみが挿入されることを確認。

**How to apply（モード別オプションの読み取りは明示的に分離する）**: 複数モードを持つUIで、片方のモード専用のはずのオプション（今回は`transparentBackground`）を、共有の`readOptionsFromUI()`のような関数で無条件に読み取ると、非表示になっているだけのDOM要素の初期値がもう片方のモードに漏れ込む。モード固有のオプションは、実際に使用する箇所（レンダリング・適用処理）で「今のモードで本当に使うべきか」を明示的に判定してから使うか、今回のように該当モードでは値を強制上書きすることで、DOM状態への依存を断ち切ること。

---

## 2026-07-17（ハーフトーンモーダルのUI改善5点: プレビュー拡大・背景トグル・レイアウト固定・Opacity削除）

「Convert Image」モードを実際に使ったユーザーから、モーダルUIの不具合・改善要望を5点受けた。

**1. プレビューが小さい／背景を白に切り替えたい**: `previewTargetSize()` が「元画像の実ピクセルサイズを400px以内に収める」計算だったため、元画像が小さいとプレビューcanvasも小さいまま表示されていた（`max-width/max-height:100%`は上限を絞るだけで拡大はしない）。プレビュー枠（`#mh-preview-wrap`）の実際の`clientWidth`/`clientHeight`を基準に、画像またはコマ領域のアスペクト比を保ちながら枠いっぱいに拡大/縮小するよう変更し、「Generate pattern」モードと同じ見た目の大きさになるようにした。あわせてプレビュー枠の背景色を黒/白でトグルできるボタンを追加（暗い画像は黒背景だと見づらいため）。

**2〜4. レイアウト崩れ3点（上部ボタンに戻れない／横スクロール／ボタン下部の見切れ）**: いずれもモーダル右パネルの構造に起因していた。従来は「モード切替ボタン＋全パラメータ」をまとめて1つの`overflow-y:auto`領域に入れていたため、Duotone選択などでコンテンツが増えるとモード切替ボタンごと下にスクロールしてしまい（→上部ボタンに戻れない）、`<label>`がinline要素のままrangeスライダーに`width:100%`を指定していたことで意図しない横方向のはみ出しが発生し（→横スクロール）、`.tsm-body`のインライン`overflow:auto`とパラメータ領域の`overflow-y:auto`が二重にかかってflexboxの縮小計算を乱していた（→footerが見切れる）。右パネルを「モード切替ボタン（`flex-shrink:0`で常時固定）」と「パラメータ一式（`#mh-params-scroll`、`overflow-y:auto; overflow-x:hidden;`で独立スクロール）」に分離し、各`<label>`を`display:block`化・rangeに`box-sizing:border-box`を付与、`.tsm-body`自体のoverflow指定を削除して`min-height:0`によるflex収縮に一本化することで解決した。

**5. Opacityコントロールの削除**: 「不透明度は挿入後にレイヤーパネルの汎用Opacityスライダーで調整できるため、モーダル内に専用コントロールは不要」との指摘。実際に確認すると、「画像を変換」モードの適用処理（`_mangaCommitCanvasToSelectedImage`）は`options.opacity`を全く参照しておらず、UIとしては存在するが機能していないパラメータだった（実質的なバグ）。「パターンを作成」モードでは`extraAttrs.opacity`として機能していたが、一貫性のためモーダルから完全に削除し、生成物は常にデフォルト不透明度で挿入、以後の調整はレイヤーパネルに委ねる設計にした。

**Kapture実機検証**: Panel内の既存画像を選択してモーダルを開き、「Convert Image」でプレビューが枠いっぱいに拡大表示されること、White背景トグルで見やすい背景に切り替わることを確認。Color modeをDuotoneに切り替えてパラメータが増えても、モード切替ボタンが常に上部に固定表示され、横スクロールが発生せず、Cancel/Applyボタンが常に見えることを確認。Generate patternモードでも同様にレイアウトが崩れないことを確認。

**How to apply（モーダル内の固定ヘッダー＋スクロール領域パターン）**: 縦に伸び縮みするパラメータ群と、常時アクセスしたいコントロール（モード切替・タブ切替等）を同じパネルに置く場合は、最初からそれらを別のflexアイテムに分離し、固定側は`flex-shrink:0`、可変側だけに`overflow-y:auto`を持たせること。1つの`overflow:auto`領域に両方を混在させると、コンテンツが増えたときに固定したいはずの要素までスクロールで隠れてしまう。

---

## 2026-07-17（マンガツール微修正3点: プレビュー背景画像 / マンガ効果のモーダル化 / 集中線Intensity修正）

直前の改修（コマサイズ生成方式への統一）を実際に触ったユーザーから3点の追加改善依頼を受けた。

**1. ハーフトーン「パターンを作成」モードのプレビュー背景を実画像に**: 透過チェッカーボードだけでは網点の大きさが実際の絵に対してどう見えるか掴みにくいという指摘。新設 `_mangaGetRegionBackdropImage(region)` が「選択中の画像→無ければ対象コマ/オーバーレイ内の既存画像」の優先順位でプレビュー背景用の画像を探してロードする。**実際に生成・挿入されるcanvas自体は変更せず透過のまま** — backdrop画像はプレビューcanvasにのみ描画し、スケール確認用のガイド表示に徹する設計にした。

**2. 「マンガ」サブタブをメニュー化**: 「マンガ」サブタブは今後複数のマンガ関連ツールを追加していく入り口という位置づけのため、これまでインラインでパラメータ一式を表示していた「マンガ効果」（ヴィネット/スクリーントーンノイズ/集中線）を、ハーフトーンと同じ「ボタン→モーダル」形式に統一した。`subtab-manga` は「✨ マンガ効果」ボタン1つだけのメニューになり、クリックで `mangaEffectsOpen()` がハーフトーンモーダルと同じ `.tsm-overlay`/`.tsm-dialog` パターンでモーダルを動的生成する（ハーフトーンボタン自体はユーザーの要望により「画像」サブタブに残置）。

**3. 集中線（放射状）のIntensity修正**: 「強度」スライダーが不透明度（`globalAlpha`）にしか効いておらず、参考アプリでは強度が中心の空白サイズにも影響していたのに現状は変化しない、との指摘。`_mangaDrawRadialSpeedLines()` の `innerR`（集中線が始まる中心の空白半径）計算を、完全ランダムから `baseInnerR = maxR * (0.02 + intensity * 0.12)` を軸にしたばらつきに変更し、intensityスライダーで中心の空白サイズが視覚的に変化するようにした。

**副産物のバグ修正**: 実装中、`_mangaGetRegionBackdropImage()` が `getPanelLayerSvg()`（`#image-layer svg` を探す、Imageタブ向けのセレクタパターン）を使ったところレイアウトタブのSVGを取得できず、常にチェッカーボードにフォールバックしてしまうバグを作った。Kaptureで実機検証した際にプレビューへ画像が反映されないことに気付き、`07-pages.js` で頻出する `document.querySelector('#layout-preview svg')` に置き換えて解決した。

**Kapture実機検証**: 既存の網点パターンが入ったコマで「パターンを作成」モードを開き、選択中の画像が無い場合でもコマ内の既存画像がプレビュー背景に表示されることを確認（生成結果は透過のまま変わらないことも確認）。「マンガ」サブタブが「✨ マンガ効果」ボタンのみのメニューになり、クリックでモーダルが開いて従来通りの機能一式（ヴィネット・ノイズ・集中線・コマに追加）が動作することを確認。放射状集中線のIntensityを0.1と1.0で比較し、中心の空白サイズが明確に変化することを確認（0.1ではほぼ見えないほど小さく、1.0では大きくはっきり）。

**How to apply（セレクタの使い回しは文脈を確認してから）**: `getPanelLayerSvg()` のような「特定タブ専用に作られたヘルパー関数」を別の文脈（今回はレイアウトタブ）で再利用する際は、関数内部のセレクタが本当にその文脈のDOM構造と一致しているか確認すること。名前だけでは汎用的に見えても、実装が特定のIDツリー（`#image-layer` 等）に依存している場合がある。迷ったら、その文脈で実績のある既存コード（今回は `07-pages.js` の `#layout-preview svg`）に合わせるのが安全。

---

## 2026-07-17（マンガツールの改修: 「コマサイズのパターン/オブジェクト生成」方式への統一 + パラメータ拡充）

直前に実装した「マンガ」ツールに対し、ユーザーから「ハーフトーン変換にハーフトーンを作成するだけのモードを追加したい（コマのサイズにハーフトーンを作成）。Mangaツールもコマサイズにオブジェクトを作成する形にしたい。パラメータ数が少ない点も含め改善が必要」という改修依頼を受けた。実際の漫画制作でスクリーントーンシート・集中線シートを描画の上に別レイヤーとして貼る使い方に近づけたい、という意図。

**方針決定**: ユーザー確認の上、①マンガ効果サブタブ（ヴィネット/スクリーントーンノイズ/集中線）は「選択画像への焼き込み」を全廃し「コマサイズの新規透過オブジェクトを生成して挿入」方式に完全統一、②ハーフトーンの新設「パターンを作成」モードは背景を透過にする（デフォルト、チェックボックスで不透明紙色にも切替可）、の2点を確定した。

**対象領域（コマ/オーバーレイ）決定とジャストフィット挿入の実装**: 新設 `_mangaGetTargetRegion()` が、選択中の画像があればその画像が属するコマ/オーバーレイを（`imgEl.closest('g[data-clip-panel]')` で逆引き、`15-pixifx-bridge.js` の `moveSelectedObjectToCenter()` と同じ手法）、画像未選択なら `state.selectedPanelId`/`state.selectedOverlay` から対象領域の位置・サイズを取得する。新設 `_mangaInsertGeneratedToRegion()` は生成したcanvasを `insertImage()`（`08-panels-images.js`）経由で挿入するが、**`placement` 引数を明示的に対象領域の座標・サイズで渡すことで、`insertImage`/`insertImageToOverlay` のデフォルト自動配置（コマ幅基準アスペクト比フィット／ページ40%中央配置）を上書きし、対象領域にジャストフィットさせる**のが実装の肝。挿入前後で `state.selectedOverlay`/`state.selectedPanelId` を対象領域に合わせて一時的に書き換え、`insertImage()` 完了後に元へ戻す設計にした（`insertImage()` 自体は変更せず、呼び出し側で選択状態を対象に合わせるアプローチ）。

**副産物のバグ修正**: 実装中に `insertImageToOverlay()`（オーバーレイへの画像挿入）が `extraAttrs`（不透明度などの追加属性）を受け取らず、`insertImage()` からも渡されていないことに気付いた。オーバーレイに新規オブジェクトを追加する際に初期不透明度が設定できない不具合になるため、`insertImageToOverlay()` に `extraAttrs` 引数を追加し、`insertImage()` からの呼び出しでも渡すよう修正した（既存の呼び出し元は引数追加のみで影響なし）。

**ハーフトーンモーダルの改修**: 「画像を変換」（従来方式）と「パターンを作成」（新規）の2モードをセグメントボタンで切替可能にした。パターン作成モードは元画像の代わりに新設 `_mangaCreateSyntheticImageData()` が生成する一様濃度またはグラデーション（線形/放射状、開始・終了濃度・角度を指定可）のグレースケール画像をハーフトーン生成ロジックのソースとして使う。既存の `_mangaRenderHalftone()` はソースがどちらでも同じロジックで処理できるため、コア部分の変更は「背景塗りつぶしを `transparentBackground` オプションでスキップ可能にする」「`invert` オプションで濃度を反転できるようにする」の2点で済んだ。加えてパラメータを拡充: 両モード共通で明暗反転・不透明度、パターン作成モードのみ濃度・グラデーション設定・背景透過チェックを追加。開くボタンの条件も「選択画像必須」から「画像またはコマ/オーバーレイいずれかがあれば可」に緩和した。

**マンガ効果サブタブの全面改修**: 「対象: 選択中の画像」を廃止し「対象: 選択中のコマ/オーバーレイ」に変更（`_maskTargetLabel()` と同様のロジックで表示）。`_mangaDrawScreentoneTexture()` は元々「既存ピクセルへノイズ加算」実装だったため、透明ピクセル（alpha=0）にはグレー粒をランダム不透明度で新規配置する分岐を追加し、透過キャンバス単体でも粒状ノイズが乗るようにした（`grainSize` パラメータで粒の粗さも調整可能に）。ヴィネットに色指定、集中線に放射状時の中心位置（X/Y%指定）・線形時の角度を追加。プレビューはチェッカーボード模様で透過部分を可視化。「適用」ボタンは「コマに追加」に変更し、`_mangaInsertGeneratedToRegion()` 経由で新規オブジェクトとして挿入する。

**Kapture実機検証**: 画像未挿入のコマを選択→ハーフトーンモーダルが自動的に「パターンを作成」モードで開くことを確認→グラデーション網点パターンがプレビューに正しく表示→「適用」でコマにジャストフィットする新規透過オブジェクトが挿入されることを確認。既存画像を選択→モーダルが「画像を変換」モードで開き、明暗反転オプションが正しく機能することを確認（従来機能の非破壊を確認）。マンガ効果サブタブでコマを選択→「対象: Panel 1」表示を確認→ヴィネットと放射状集中線（中心位置パラメータ含む）を有効化しプレビューに反映されることを確認→「コマに追加」で新規オブジェクトとして挿入されることを確認。すべてリロード後も結果が保持される（IndexedDBへの永続化）ことを確認。コンソールエラーは終始無し。

**How to apply（既存の汎用挿入関数を新用途で再利用する際の落とし穴）**: `insertImage()`/`insertImageToOverlay()` のような「配置ロジック込みの汎用挿入関数」を新しい用途（今回は「対象領域にジャストフィットさせる」）で再利用する際は、関数が受け取る全てのオプション引数（今回は `extraAttrs`）が実装の全分岐（コマ用/オーバーレイ用）で一貫して機能するか確認すること。片方の分岐だけ引数が欠落しているパターンは、テストするまで気づきにくい。

**How to apply（「まとめて焼き込む」から「独立レイヤーとして生成する」への設計転換）**: 画像加工ツールを「選択済みの何かに適用する」方式で作ると、適用前の状態に戻せない・複数effect を重ねづらい・移動やリサイズが個別にできない、という制約が生まれる。実際の制作ツール（スクリーントーン、集中線シート等）が別レイヤーとして重ねる方式を採用している場合、同じ設計（対象領域サイズの透過オブジェクトを生成し、既存のレイヤーシステムに載せる）に寄せることで、ユーザーが後から自由に調整できる柔軟性を安く獲得できる。

---

## 2026-07-17（レイアウトタブに「マンガ」ツール追加: ハーフトーン変換 + マンガ効果）

「レイアウトタブに“マンガ”ツールを追加したい。マンガトーンスタジオ（`manga-halftone-processor`、React製スタンドアロンアプリ）を参考にハーフトーン・マンガ効果機能を実装してほしい」というユーザー依頼を受けて、計画策定→実装→Kapture実機検証まで行った。

**参考プロジェクトの調査**: `manga-halftone-processor`は Canvas 2D API のみで実装された網点（ハーフトーン）変換エンジンを持つ。角度を付けて回転させたグリッド（間隔=`dotSize`）を対角線範囲でスキャンし、各格子点に対応する元画像1pxの濃度（グレースケール化＋明るさ／コントラスト補正、任意で2値化）に比例したサイズの図形（dot/line/square/cross）を描く古典的なAMスクリーニングの簡易実装。CMYK版は4チャンネルを別々の角度でレイヤー分割し`multiply`合成する本格的な印刷網点分解も実装していたが、今回は用途（白黒漫画のトーン表現）とコスト（4chループで処理が重い）を踏まえてモノクロ/デュオトーンのみ移植することにした。ヴィネット・スクリーントーンノイズ（紙質ノイズ）・集中線（放射状/線形）も同アプリの実装を参考にした。吹き出し・オノマトペ機能は既存の「フキダシ」「テキスト」サブタブと役割が重複するため対象外とした。

**UI設計**: ユーザー確認の上、ハイブリッド構成にした。①ハーフトーン変換は「画像」サブタブに独立モーダルとして追加（既存の「PixiJS FX」ボタンと同じ「選択画像のdata URL取得→加工→href置換→`savePanelSvg`/`saveOverlaySvg`保存」パイプラインを踏襲）。②ヴィネット・スクリーントーンノイズ・集中線は新規サブタブボタン「マンガ」として常設パネルに配置（プレビューcanvas＋パラメータUI＋「適用」ボタン）。モーダルは`text-style-modal.js`が確立している`.tsm-overlay`/`.tsm-dialog`（`document.createElement`でJS側から動的生成、既存CSSクラスをそのまま再利用）のパターンに倣い、新規CSSを追加せずに実装できた。

**実装**: 新規ファイル`static/js/main/15b-manga-tone.js`にコア描画関数（`_mangaRenderHalftone`、`_mangaDrawVignette`、`_mangaDrawScreentoneTexture`、`_mangaDrawRadialSpeedLines`、`_mangaDrawLinearSpeedLines`）と、両UIから共有する適用パイプライン（`_mangaLoadImage`→`_mangaProcessToCanvas`→`_mangaCommitCanvasToSelectedImage`）を実装。`_mangaCommitCanvasToSelectedImage`は`15-pixifx-bridge.js`の`pixiFxOpenForLayout()`と同じ`isOverlay`判定ロジック（`svgEl.querySelector('g[data-overlay-layer]')?.contains(imgEl)`）を再利用し、保存経路の一貫性を保った。プレビューは常時400px以内にダウンスケールしてrAFスロットルで再描画、「適用」時は元画像を2400px以内にダウンスケールしてから処理（SVG `<image>`側のwidth/height表示サイズ属性は変更しない）。同期処理でUIがブロックしないよう、「適用」クリック時に処理中表示を出してから`setTimeout(fn, 0)`で1フレーム後に本処理を実行する設計にした。

**Kapture実機検証**: 既存テスト作品のコマ画像を選択→「🎨 ハーフトーン」ボタンでモーダルを開き、パターン形状変更（dot→line→dot）でプレビューが即座に再描画されることを確認。「適用」でコマ内画像が実際に網点パターンへ置き換わり、リロード後も結果が保持されている（IndexedDBへの永続化）ことを確認。続けて「マンガ」サブタブでヴィネットON・集中線を放射状に設定するとプレビューに正しく重畳表示され、「適用」でハーフトーン画像の上にヴィネット＋放射状集中線が焼き込まれ、こちらもリロード後に保持されることを確認。コンソールエラーは終始無し。

**How to apply（モーダルUIの実装方法）**: このアプリで新規モーダルUIを追加する際は、静的HTMLに書き足すのではなく`text-style-modal.js`のパターン（`.tsm-overlay`/`.tsm-dialog`/`.tsm-header`/`.tsm-body`/`.tsm-footer`という既存の汎用CSSクラスを使い、JS側で`document.createElement`により動的にDOMを組み立てて`document.body`に追加する）を踏襲すると、`templates/index.html`肥大化を避けつつ一貫した見た目を保てる。

**How to apply（画像加工系ツールの適用パイプライン）**: 選択中の画像を加工して置き換える機能（今回のハーフトーン/マンガ効果、既存のPixiJS FX等）を追加する際は、`pixiFxOpenForLayout()`が確立した「data URL取得→加工→`pushHistory()`→href置換→`isOverlay`判定→`saveOverlaySvg`/`savePanelSvg`」のパイプラインをそのまま再利用すること。保存経路の重複実装を避けられ、`deferThumb`によるサムネイル遅延生成などの既存最適化も自動的に効く。

---

## 2026-07-17（レイアウトタブの操作重さ改善 + 派生バグ修正 + 「作品を閉じる」機能）

「レイアウトタブの操作が重い」というユーザー相談を起点に、原因調査→改善実装→派生して見つかったバグの修正→新機能追加までを行った長めのセッション。

**原因調査**: `savePanelSvg`/`saveOverlaySvg`（コマ編集の保存を担う実質2関数、83箇所から呼ばれる）が、1操作ごとに「ライブSVGの`cloneNode(true)`→`dbPut`内で`buildMergedSvg`によるページ全体再構成→`_rasterizeSvgThumb`による画像デコード＋canvas再描画→`renderLayerPanel`のDOM全再構築」という重い処理を同期的にフルで実行していたことが主因。加えてドローツールの色/線幅/不透明度が`change`ではなく`input`イベントに直結しており、ドラッグ中に高頻度発火していた。

**実装した改善（Kaptureで実機計測して効果を確認）**:
1. `input`イベントに直結していたドローツールのプロパティ変更をDOM反映は即時のまま保存だけ300ms debounce化。実機で10回連続の`input`発火に対し保存処理が1回だけ実行されることを確認。
2. `dbPut`にサムネイル計算を後回しにする`deferThumb`オプションを追加し、`savePanelSvg`/`saveOverlaySvg`からのみ使用。DB書き込み自体はサムネイル計算を待たず即座に完了し、サムネイルは600ms debounce後にまとめて1回生成される。
3. `pushHistory`のディープクローン（`JSON.parse(JSON.stringify(...))`、base64画像込みの可能性がある文字列を含む）を、panels配列が常にイミュータブル更新されていることを確認した上で配列の浅いコピーに変更。

**非選択コマの低画質表示は効果なしと判明**: ユーザー提案で「非選択コマの画像だけ解像度を下げて表示すればズーム操作等が軽くなるのでは」という案を実装（`feature/layout-preview-quality`ブランチ）。保存データを一切劣化させない安全設計（`data-orig-href`に原本退避→保存直前に必ず復元）で作り込み、Kapture実機でLong Task計測を行ったところ、**画像54枚の状態でズーム操作のLong Task合計が高画質時(3870ms)より低画質時(4235ms)の方が悪化**するという結果に。原因は、SVGの`<image>`要素の`width`/`height`（表示領域サイズ）はそのままでソース解像度だけ下げたため、ブラウザ側のアップスケーリング補間コストが新たに発生し軽量化効果を相殺したため。効果が実証できなかったためmasterにはマージせずブランチのまま保留。

**外部プロジェクト調査**（`dlewissandy/comictools`, `pedrinho/comic-drawer`）: `comic-drawer`は元々手作りCanvas 2D実装で選択/移動/リサイズ/回転を自前実装していたが、Fabric.jsへ全面移行し自前実装コード約2,750行を削除していた（`FABRIC_MIGRATION.md`）。このアプリの`09c-balloon-handles.js`等の手作りハンドル描画と同種の課題であり、中長期的な検討材料として記録。`comictools`のlight table実装からは「ホイール操作は300ms debounce、選択解除前に必ずpending書き込みをflushする」という設計方針を確認し、次のバグ修正の着想を得た。

**バグ修正1: debounce待ち中のflush漏れ**: 上記のdebounce化（300ms）を入れた際、その間にパネル/オーバーレイを切り替えたりページを再読み込みしたりすると保留中の変更が保存されずに消えるという問題が残っていた。`_layerDrawFlushPendingSave()`を新設し、選択解除の共通処理（`_clearObjectSelection`）とページ再読み込み（`renderLayoutTab`、こちらはDBを読む前に保存完了を待つ必要があるため`await`）の直前で必ず呼ぶように修正。Kaptureで、色変更直後（300ms未満）に別パネルへ切り替えてからリロードし、DBに正しく保存されていることを実機確認。

**バグ修正2: メインタブ切替時に3Dポーズのループが止まらない**: 「レイアウトタブで編集を終了できた方が他タブ作業時のパフォーマンスに効果があるか」というユーザー質問を調査する過程で発見。3Dポーズ（`comfyui-vrm-pose-editor`ノードの`pose_editor_core.js`）の`requestAnimationFrame`ループは`stopLoop()`が呼ばれない限り無条件で自己再帰するが、`hidePose3DCanvas()`（`stopLoop()`を呼ぶ唯一の経路）はツールペインのサブタブ切替時にしか呼ばれておらず、メインタブ（レイアウト→画像等）の切替では呼ばれていなかった。`switchTab()`冒頭に、3Dポーズ表示中にレイアウトタブ以外へ移動する場合の`hidePose3DCanvas()`呼び出しを追加。`window.requestAnimationFrame`を直接フックして実測し、3Dポーズ表示中は1秒間に61回（約60fps）呼ばれていたのが、タブ切替後は1秒間に0回になることを確認（evaluateツールが一時的に切断されていたため、この検証だけ後から再接続後に実施）。

**バグ修正3: ページ番号「- / N」表示の更新漏れ**: ユーザーから「レイアウトタブのページが-/7と表示される」という報告を受けて調査。`updateLayoutPageNav()`は「今開いているページが作業中の作品のページ一覧に含まれない」場合にページ番号側を「-」にする実装だが、ページ管理タブでページを別グループへ移動する処理（`pagemgr-move-group-btn`・`pagemgr-remove-group-btn`のハンドラ）がこの表示更新を呼んでいなかったため、移動後も古いページ数のまま「- / 7」の表示が固まっていた。両ハンドラに`updateLayoutPageNav()`呼び出しを追加。Kaptureで実際にボタンクリック経由の移動を行い、「7 / 7」→「- / 6」に即座に更新されることを確認（余談：evaluateから直接Setに選択を追加しただけではボタンがdisabledのままで、実UIの選択操作を経由しないとdisabled解除ロジックが動かないことも実機で判明）。

**新機能: 「作品を閉じる」ボタン**: 上記の3Dポーズ調査で「タブ切替だけではレイアウトタブの巨大なSVG DOMがメモリに残り続ける」ことが分かったため、明示的に閉じる手段としてOCボタンの右隣に追加。`closeActiveWork()`（`11a-work-manager.js`）は3Dポーズ・マスク編集・ドロー描画オーバーレイを後片付けしてから`state.activePage`/`state.activeWork`をクリアし、`_workSetActive(null)`で`localStorage`の`active_work`も消去（次回起動時に自動で開かれないように）。保存データ自体はDBに残るため「開く」でいつでも再開できる。Kaptureで実機計測し、クリックでdomSizeが**73,703,347 → 163,516**まで減少（巨大な画像埋め込みSVGが実際に解放された）ことを確認。ヘルプタブにも説明を追記。

**How to apply（保存処理の重さ）**: SVGクローン＋シリアライズ＋DB書き込みのような「1操作ごとに走る重い保存処理」を扱う際は、①`input`ではなく`change`（またはdebounce）で保存をトリガーすること、②debounceを入れる場合は必ず「選択解除・画面遷移・ページ再読み込みの直前に保留中の処理をflushする」仕組みとセットで入れること（本セッションで一度この対策漏れによるデータロスト系バグを作った）。

**How to apply（表示軽量化の検証）**: 「画像の解像度を下げれば表示が軽くなるはず」という直感は、SVGの`<image>`要素のように表示サイズ（width/height属性）とソース解像度が分離している場合は必ずしも成立しない。実装前に、実際に負荷を再現する条件（本セッションでは画像を意図的に大量複製）を作ってLong Task等で定量比較してから投資判断すること。

**How to apply（アニメーションループの後片付け）**: `requestAnimationFrame`を使う機能を画面の一部（サブタブ等）に組み込む際は、「そのサブタブを離れる時」だけでなく「その機能を含む画面全体（メインタブ等）を離れる時」の両方で確実に停止処理が呼ばれることを確認すること。片方の経路にしか後片付けがないパターンは見落としやすい。

**リリース**: ユーザー承認のもとコミット→`git push origin master`→マイナーバージョンとして`v1.1.0`タグを作成・push→`gh release create v1.1.0`でGitHub Release公開（https://github.com/ketle-man/comfyui-comic-creator/releases/tag/v1.1.0 、日本語本文＋英語summary併記）。新機能（作品を閉じるボタン）を含むためマイナー版（v1.0.1→v1.1.0）とした。

---

## 2026-07-16（PixiJS FXモーダルのi18n対応）

ユーザーからの「レイアウトタブ・イメージタブのPixiJS FXのi18n化を確認して」という依頼を受けて調査→修正を実施。

**調査結果**: レイアウトタブ側のブリッジ処理（`main/15-pixifx-bridge.js`）は既にt()経由で完全対応済みだった一方、以下2点が未対応と判明した。
1. `pixifx.js`（レイアウト/Imageタブ共通で使われるPixiJS FXモーダル本体、940行）が**ファイル全体を通してt()呼び出しが一つも無く**、パーティクル種類の選択肢・ラベル・トグルボタン・アラート・キャンバス描画テキストまで全て日本語ハードコードだったため、言語設定を英語/中国語にしてもモーダルだけ常に日本語表示になっていた。
2. `image-tab.js`の`_openPixiFx()`のトースト文言が英語ハードコードで、既存の`image.pixifxNotLoaded`/`image.pixifxApplyError`キーが定義済みなのに使われていなかった（同ファイルの他メソッドはt()を使っているのにこの関数だけ取り残されていたパターン、G'MICブロックの取りこぼしと同種）。

**実装**: `i18n.js`に新規`pixifx.*`名前空間（52キー）をja/en/zh 3言語に追加し、`pixifx.js`の全ハードコード文字列をt()呼び出しに置換。`image-tab.js`の`_openPixiFx()`は既存キーへの置換＋不足していた`image.noImageLoaded`/`image.noActiveLayer`/`image.pixifxApplied`を新規追加。`index.html`のPixiJS FXボタン（レイアウト/Image両方）は可視ラベルにも`data-i18n`を付与し、他の同種ボタン（G'MIC等）と表記を統一（値自体は「✨ PixiJS FX」でブランド表記のため全言語共通）。

**検証**: `node --check`で3ファイルとも構文エラーなし。Node vmで`LANGUAGES`オブジェクトを読み込み、`pixifx.*`関連52キーがja/en/zh間で欠落なく完全一致することと、コード内の全`t('...')`呼び出しキーがja辞書に存在することを機械検証。

**How to apply**: 複数タブから共通で開かれる大きめのモーダル（今回のpixifx.jsのような外部カスタムノード連携UI）は、実装時にi18n対応を後回しにしたまま放置されがちなので、新規モーダルを追加した際は完成時に必ずi18n対応をチェックリストに含めること。トースト/アラート文言を追加する際は、まず既存の近い意味のキー（`image.pixifx*`等）が無いか確認してから再利用し、無ければ命名規則（タブ/機能単位のドット区切り）に従って新規キーをja/en/zh同時に追加すること。

**リリース**: ユーザー承認のもとコミット→`git push origin master`→パッチバージョンとして`v1.0.1`タグを作成・push→`gh release create v1.0.1`でGitHub Release公開（https://github.com/ketle-man/comfyui-comic-creator/releases/tag/v1.0.1 、日本語本文＋英語summary併記）。今回はUI文言の不具合修正のみでAPI/機能変更が無いためパッチ版（v1.0.0→v1.0.1）とした。

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

ユーザー要望「i18n化したい、作業計画を立ててほしい」。対象言語は英語＋中国語（日本語含め3言語）、翻訳文はClaudeが作成、**段階的に**進める方針で合意。

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
レイアウトタブ「3Dポーズ」サブタブが独自に持っていたThree.js/VRM実装（`static/js/pose3d.js`、ライトエディタ・ポーズライブラリなしの簡易版）を廃止し、別途インストール済みのComfyUIカスタムノード「comfyui-vrm-pose-editor」（インストール先: `custom_nodes/comfyui-vrm-pose-editor`、開発元は別リポジトリで管理）へ依存する薄いブリッジ構成に全面移行した。ノードの現在のフル機能（ポーズライブラリ・ライトエディタ・ミラー・Ground/BGWall/シャドウ）をレイアウトタブから直接利用できるようになった。

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
