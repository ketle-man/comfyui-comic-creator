# vendor — 同梱サードパーティライブラリ

オフライン環境でも PDF/EPUB 出力・zip 保存・一括バックアップ／復元が動作するよう、
CDN（cdnjs）から取得していたライブラリをローカル同梱したもの。
各ファイルは cdnjs 配布物そのまま（改変なし）で、cdnjs API の SRI（SHA-512）ハッシュと
一致することを確認済み。ライセンス表記は各ファイル先頭のヘッダーコメントに含まれる。

| ファイル | ライブラリ | バージョン | ライセンス | 取得元 |
| --- | --- | --- | --- | --- |
| `jspdf.umd.min.js` | jsPDF | 2.5.1 | MIT | <https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js> |
| `jszip.min.js` | JSZip | 3.10.1 | MIT / GPLv3 デュアル | <https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js> |
| `opentype.module.js` | opentype.js | 1.3.4 | MIT | <https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.module.js> |

読み込みは `templates/index.html` の `<script src="/ccc_static/js/vendor/...">`。
バージョンを上げる場合は cdnjs から新しい min.js を取得してここを差し替え、
cdnjs API（`https://api.cdnjs.com/libraries/<name>/<version>?fields=sri`）の SRI と一致することを確認する。

`opentype.module.js` のみ例外: ESM ビルドは cdnjs に無いため jsdelivr（npm パッケージ
`opentype.js` の `dist/opentype.module.js`、無改変）から取得した。SRI（SHA-384、Base64）:
`36qqVeFl8X87+V6VbocV8y/B1FPRbYpH4ZV5WHQq2eIzJoA/Cu3kVG7+JCfI7Llz`。
3Dテキスト機能でのみ使用するため、jsPDF/JSZipと異なり `index.html` での常時
`<script>` 読込はせず、`static/js/text3d-font-loader.js` から初回使用時に
`import('/ccc_static/js/vendor/opentype.module.js')` として動的ロードする。
