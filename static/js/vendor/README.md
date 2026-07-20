# vendor — 同梱サードパーティライブラリ

オフライン環境でも PDF/EPUB 出力・zip 保存・一括バックアップ／復元が動作するよう、
CDN（cdnjs）から取得していたライブラリをローカル同梱したもの。
各ファイルは cdnjs 配布物そのまま（改変なし）で、cdnjs API の SRI（SHA-512）ハッシュと
一致することを確認済み。ライセンス表記は各ファイル先頭のヘッダーコメントに含まれる。

| ファイル | ライブラリ | バージョン | ライセンス | 取得元 |
| --- | --- | --- | --- | --- |
| `jspdf.umd.min.js` | jsPDF | 2.5.1 | MIT | <https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js> |
| `jszip.min.js` | JSZip | 3.10.1 | MIT / GPLv3 デュアル | <https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js> |

読み込みは `templates/index.html` の `<script src="/ccc_static/js/vendor/...">`。
バージョンを上げる場合は cdnjs から新しい min.js を取得してここを差し替え、
cdnjs API（`https://api.cdnjs.com/libraries/<name>/<version>?fields=sri`）の SRI と一致することを確認する。
