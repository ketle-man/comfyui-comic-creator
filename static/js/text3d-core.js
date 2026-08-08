// text3d-core.js — 3Dテキストエディタのコアロジック（THREE非依存）
//
// comfyui-vrm-pose-editor の pose_editor_core.js（initPoseEditor3D）を範に、
// モデル管理の代わりにテキストジオメトリ管理を行う。THREE / OrbitControls は
// 呼び出し側（text3d.js）が動的importして注入する。このファイル自身は
// どこからThree.jsを取得するかを一切知らない。
//
// 日本語グリフの立体化: opentype.js の Font.getPath() が返すパスコマンド(M/L/C/Q)を
// THREE.ShapePath に変換 → toShapes() → THREE.ExtrudeGeometry で押し出す。
//
// SVG立体化: SVGLoader.parse() が返すパスを SVGLoader.createShapes() で Shape[] に変換し、
// 同じ ExtrudeGeometry で押し出す（テキストモードと押し出し/ベベル設定を共有）。
// SVGLoaderの座標系はSVG標準の「Y軸下向き正」のため、テキストモードと同様にYを反転する。
//
// 表面/側面カラー: THREE.ExtrudeGeometryは標準で「キャップ面(表裏)=materialIndex 0」
// 「側面(押し出し面)=materialIndex 1」の2グループを自動生成するため、
// new THREE.Mesh(geometry, [frontMaterial, sideMaterial]) と配列を渡すだけで
// 表面/側面を別マテリアルにできる（three.js本体のExtrudeGeometry実装に基づく挙動）。
// 分離しない場合はfrontMaterialをそのままsideにも使い回す（同一インスタンス参照）。

export function initText3DEditor(THREE, OrbitControls, MToonMaterial, SVGLoaderClass, canvas, options = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(canvas.width || 1, canvas.height || 1, false);

    // ---- スーパーサンプリング（アンチエイリアス強化）----
    // WebGLコンテキストのMSAA(antialias:true)だけでは、⚙設定モーダルのプレビューのように
    // CSS transform:scale()で拡大表示するケースで輪郭が荒く見える（ラスターを単純拡大するため）。
    // devicePixelRatioを底上げして実解像度を上げることで緩和する。ON/OFFはlocalStorageに永続化し、
    // 3Dポーズ側(pose_editor_core.js)と同じキーを共有する（どちらで切り替えても連動する）。
    const _SUPERSAMPLE_STORAGE_KEY = 'vrmPoseEditor_superSample';
    function _loadSuperSample() {
        try { return localStorage.getItem(_SUPERSAMPLE_STORAGE_KEY) === '1'; } catch (e) { return false; }
    }
    let _superSample = _loadSuperSample();
    function _applyPixelRatio() {
        const base = window.devicePixelRatio || 1;
        // setPixelRatio()内部で現在のwidth/heightを使ってsetSize()が再実行されるため、
        // ここで改めてrenderer.setSize()を呼ぶ必要はない
        renderer.setPixelRatio(_superSample ? Math.min(base * 2, 4) : base);
    }
    _applyPixelRatio();

    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 0, 4);
    camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(2, 3, 4);
    dirLight.castShadow = false;
    scene.add(dirLight);
    const backLight = new THREE.DirectionalLight(0xffffff, 0.4);
    backLight.position.set(-2, -1, -3);
    scene.add(backLight);

    const orbit = new OrbitControls(camera, canvas);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.1;
    orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

    // ユーザーがドラッグ/ホイールでカメラを操作したら、以後は_fitCameraToText()による
    // 自動フィットで上書きしない（テキスト編集の都度ズームが強制リセットされる問題への対応）。
    // 「カメラ位置リセット」ボタン(resetCamera)を押すと自動フィットに戻る。
    let userAdjustedCamera = false;
    orbit.addEventListener('start', () => { userAdjustedCamera = true; });

    // ---- ズーム操作モード切り替え（pose_editor_core.jsと同じ仕組み・同じlocalStorageキーを共有） ----
    // PC環境・グラフィックドライバによってはホイールズームが機能しないため、
    // 何もない場所でのCtrl+右ドラッグでズームする操作モードに切り替えられるようにする。
    // 設定はlocalStorageに永続化され、3Dポーズ側の設定パネルとも共有される。
    const _ZOOM_MODE_STORAGE_KEY = 'vrmPoseEditor_zoomMode';
    function _loadZoomMode() {
        try {
            return localStorage.getItem(_ZOOM_MODE_STORAGE_KEY) === 'ctrlDrag' ? 'ctrlDrag' : 'wheel';
        } catch (e) {
            return 'wheel';
        }
    }
    let _zoomMode = _loadZoomMode(); // 'wheel' | 'ctrlDrag'
    let _ctrlRightDrag = false;
    let _ctrlRightDragLastY = 0;

    function _applyZoomMode() {
        orbit.enableZoom = (_zoomMode === 'wheel');
    }
    _applyZoomMode();

    // ctrlDragモード時はホイールでページがスクロールしてしまわないよう阻止
    canvas.addEventListener('wheel', (e) => {
        if (_zoomMode === 'ctrlDrag') e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('pointerdown', (e) => {
        if (_zoomMode !== 'ctrlDrag' || e.button !== 2 || !e.ctrlKey) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        _ctrlRightDrag = true;
        _ctrlRightDragLastY = e.clientY;
        orbit.enableRotate = false;
        orbit.enablePan = false;
    }, true);

    canvas.addEventListener('pointermove', (e) => {
        if (!_ctrlRightDrag) return;
        const dy = e.clientY - _ctrlRightDragLastY;
        _ctrlRightDragLastY = e.clientY;
        const dir = new THREE.Vector3().subVectors(camera.position, orbit.target).normalize();
        camera.position.addScaledVector(dir, dy * 0.01);
        orbit.update();
    }, true);

    function _endCtrlRightDrag() {
        if (!_ctrlRightDrag) return;
        _ctrlRightDrag = false;
        orbit.enableRotate = true;
        orbit.enablePan = true;
    }
    window.addEventListener('pointerup', _endCtrlRightDrag);
    window.addEventListener('blur', _endCtrlRightDrag);

    function _lightById(id) {
        return { ambient, key: dirLight, fill: backLight }[id];
    }

    let mesh = null;
    let currentFont = null; // opentype.Font
    let lastSvgWarnings = []; // 直近のSVGパース結果に対する警告キー配列（getSvgWarnings()で参照）
    const params = {
        text: '',
        fontFamily: '',
        fontSource: 'google',
        fontSizeWorld: 1.2,
        renderMode: 'text',        // 'text' | 'svg'
        svgData: '',               // SVG立体化モード時の生SVG文字列
        svgSize: 1.5,              // SVGのバウンディングボックス最大辺を合わせるワールドサイズ（fontSizeWorldと同オーダー）
        depth: 0.15,
        bevelEnabled: false,
        bevelThickness: 0.02,
        bevelSize: 0.01,
        bevelSegments: 2,
        frontColor: '#ffffff',
        sideColor: '#ffffff',
        separateSides: false,      // trueならfrontColor/sideColorを別マテリアルにする
        metalness: 0.1,
        roughness: 0.6,
        materialType: 'standard', // 'standard' | 'toon'
        shadeColor: '#999999',    // MToonの陰色（shadeColorFactor）
        toony: 0.9,               // MToonの階調の硬さ（shadingToonyFactor。1に近いほどくっきりした2階調）
        align: 'center',
        lineHeight: 1.4,
    };

    // opentype.Font のグリフパス(M/L/C/Q コマンド)を THREE.ShapePath に変換し、
    // toShapes() で穴あき文字（O/回/あ等）も正しく処理できる Shape[] を得る。
    //
    // 注意1: opentype.js の getPath() はSVGと同じ「Y軸下向き正」の座標系でパスを返す
    // （実機検証済み: 反転しないとbboxがベースラインの下側に来て文字が上下逆さまになる）。
    // three.js の数学座標系（Y軸上向き正）に合わせるため、Y座標はすべて符号反転する。
    //
    // 注意2: 文字列全体を1本のShapePathにまとめてtoShapes()を1回だけ呼ぶと、
    // ShapePath.toShapes()の外形/穴判定（サブパス間の包含関係の解析）が文字同士を
    // 誤って包含関係とみなし、一部の文字のシェイプが欠落することが実機検証で判明した
    // （例: "3D Text" で "xt" が消える）。three.js標準のFont.generateShapes()と同様に
    // 文字ごとに個別のShapePathを作ってtoShapes()し、結果をすべて連結する。
    //
    // 注意3: isCCWの向きは「TrueTypeならtrue」ではなく逆（実機のExtrudeGeometry検証で判明）。
    // toShapes(isCCW)の面積比較で確認済み: TrueType(Y軸反転後の本実装の座標系)は isCCW=false
    // で「外形の面積 > 穴の面積」という正しい判定になる。isCCW=trueだと外形/穴が入れ替わり、
    // ExtrudeGeometryが穴の内側だけを塗りつぶす不具合が発生する（"a"や"b"で確認）。
    // CFF(OTF)はTrueTypeと巻き方向規則が逆なので isCCW=true が正しい想定（未実機検証）。
    function _buildShapesForText(font, text, fontSizeWorld, align, lineHeight) {
        const lines = text.split('\n');
        const allShapes = [];
        const isCCW = font.outlinesFormat === 'cff';

        lines.forEach((line, i) => {
            let penX = 0;
            if (align === 'center') penX = -font.getAdvanceWidth(line, fontSizeWorld) / 2;
            else if (align === 'right') penX = -font.getAdvanceWidth(line, fontSizeWorld);
            const y = -i * fontSizeWorld * lineHeight;

            for (const ch of line) {
                const glyph = font.charToGlyph(ch);
                const glyphPath = glyph.getPath(penX, y, fontSizeWorld);
                const shapePath = new THREE.ShapePath();
                for (const cmd of glyphPath.commands) {
                    switch (cmd.type) {
                        case 'M': shapePath.moveTo(cmd.x, -cmd.y); break;
                        case 'L': shapePath.lineTo(cmd.x, -cmd.y); break;
                        case 'C': shapePath.bezierCurveTo(cmd.x1, -cmd.y1, cmd.x2, -cmd.y2, cmd.x, -cmd.y); break;
                        case 'Q': shapePath.quadraticCurveTo(cmd.x1, -cmd.y1, cmd.x, -cmd.y); break;
                        // 'Z' はグリフの輪郭閉じ。toShapes() 側が各サブパスを自動的に閉じるため何もしない
                    }
                }
                allShapes.push(...shapePath.toShapes(isCCW));
                penX += glyph.advanceWidth * (fontSizeWorld / font.unitsPerEm);
            }
        });

        return allShapes;
    }

    function _disposeMesh() {
        if (!mesh) return;
        scene.remove(mesh);
        mesh.geometry.dispose();
        // mesh.materialは常に[front, side]の配列（分離しない場合は同一インスタンスを共有）。
        // Setで重複除去してから破棄する。
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        new Set(mats).forEach((m) => m.dispose());
        mesh = null;
    }

    // mesh.material（常に[front, side]の配列。非分離時はfront===sideの同一インスタンス）を
    // 重複なく巡回する。setMetalness等のライブ更新系セッターが使う。
    function _forEachMaterial(fn) {
        if (!mesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        new Set(mats).forEach(fn);
    }

    // ExtrudeGeometryの側面・キャップ面の法線向きが文字形状によって不安定になるケースへの
    // 安全策として両面描画にする（片面カリングによる欠け表示を防ぐ）。Standard/Toon共通。
    function _createMaterial(colorHex) {
        if (params.materialType === 'toon' && MToonMaterial) {
            return new MToonMaterial({
                color: colorHex,
                shadeColorFactor: params.shadeColor,
                shadingToonyFactor: params.toony,
                side: THREE.DoubleSide,
            });
        }
        return new THREE.MeshStandardMaterial({
            color: colorHex,
            metalness: params.metalness,
            roughness: params.roughness,
            side: THREE.DoubleSide,
        });
    }

    // 表面(materialIndex 0)・側面(materialIndex 1)用マテリアルを生成する。
    // separateSidesがfalseの場合はsideにfrontと同一インスタンスを使い回す
    // （setFrontColor()の1回のcolor.set()だけで両方に反映されるようにするため）。
    function _buildMaterials() {
        const front = _createMaterial(params.frontColor);
        const side = params.separateSides ? _createMaterial(params.sideColor) : front;
        return [front, side];
    }

    // SVG文字列をパースしてExtrudeGeometryを生成する（3d-text-generator/src/utils/svgToShapes.ts を
    // vanilla js化して移植）。テキストモードと同じdepth/bevel設定を共有する。
    // opts.forceNoBevel: trueの場合ベベルを無効化して押し出す（面取りがSVGの細い部分で自己交差し
    // NaN頂点を生んだ場合の再構築フォールバック。_rebuildGeometry()から呼ばれる）。
    // 戻り値: { geometry, warnings, hasTextNodes, hasImageNodes, pathCount, shapeCount }
    // geometryがnullの場合はパース失敗/有効パスなし（warningsに理由キーが入る）。
    function _buildSvgGeometry(svgString, targetSize, opts = {}) {
        if (!svgString || !svgString.trim() || !SVGLoaderClass) return null;

        const warnings = [];
        const hasTextNodes = /<(text|tspan)[\s>]/i.test(svgString);
        const hasImageNodes = /<(image|img)[\s>]/i.test(svgString);
        if (hasTextNodes) warnings.push('svgTextNode');
        if (hasImageNodes) warnings.push('svgImageNode');

        let svgData;
        try {
            svgData = new SVGLoaderClass().parse(svgString);
        } catch (err) {
            console.error('[text3d] SVGパースに失敗しました:', err);
            return { geometry: null, warnings: ['svgParseFailed', ...warnings], hasTextNodes, hasImageNodes, pathCount: 0, shapeCount: 0 };
        }

        const paths = svgData.paths || [];
        if (paths.length === 0) {
            return { geometry: null, warnings: ['svgNoPath', ...warnings], hasTextNodes, hasImageNodes, pathCount: 0, shapeCount: 0 };
        }

        const allShapes = [];
        paths.forEach((path) => {
            // 標準: SVGLoaderの通常のシェイプ生成
            let shapes = [];
            try { shapes = SVGLoaderClass.createShapes(path); } catch (err) { /* ignore */ }

            // フォールバック1: createShapes()が空を返した場合（stroke-onlyやfill:noneのパス）にtoShapes()を強制
            if ((!shapes || shapes.length === 0) && typeof path.toShapes === 'function') {
                try { shapes = path.toShapes(); } catch (err) { /* ignore */ }
            }

            // フォールバック2: それでも空ならsubPathの点列から直接Shapeを構築する（線画向け救済策）
            if ((!shapes || shapes.length === 0) && path.subPaths && path.subPaths.length > 0) {
                path.subPaths.forEach((subPath) => {
                    const points = subPath.getPoints();
                    if (points && points.length >= 3) {
                        const shape = new THREE.Shape();
                        shape.moveTo(points[0].x, points[0].y);
                        for (let i = 1; i < points.length; i++) shape.lineTo(points[i].x, points[i].y);
                        shapes.push(shape);
                    }
                });
            }

            if (shapes && shapes.length > 0) allShapes.push(...shapes);
        });

        if (allShapes.length === 0) {
            return { geometry: null, warnings: ['svgNoPath', ...warnings], hasTextNodes, hasImageNodes, pathCount: paths.length, shapeCount: 0 };
        }

        const geometry = new THREE.ExtrudeGeometry(allShapes, {
            depth: params.depth,
            bevelEnabled: opts.forceNoBevel ? false : params.bevelEnabled,
            bevelThickness: params.bevelThickness,
            bevelSize: params.bevelSize,
            bevelSegments: params.bevelSegments,
            curveSegments: 8,
            steps: 1,
        });

        // SVGLoaderの座標系はSVG標準の「Y軸下向き正」のため、テキストモードと同じくY反転する
        geometry.scale(1, -1, 1);

        // バウンディングボックスの最大辺をsvgSize（テキストのfontSizeWorldと同オーダー）に正規化する
        geometry.computeBoundingBox();
        const rawSize = new THREE.Vector3();
        geometry.boundingBox.getSize(rawSize);
        const maxDim = Math.max(rawSize.x, rawSize.y, 0.0001);
        const scale = (targetSize || 1.5) / maxDim;
        geometry.scale(scale, scale, 1);

        return { geometry, warnings, hasTextNodes, hasImageNodes, pathCount: paths.length, shapeCount: allShapes.length };
    }

    // ジオメトリが健全かどうかを検証する。ExtrudeGeometryは面取り(bevelSize/bevelThickness)が
    // 形状の細い部分（鋭い先端や薄い線幅）に対して大きすぎると、ベベル輪郭が自己交差して破綻することが
    // ある（three.js本体の既知の制約。実機検証でSVGモードにて確認）。破綻のパターンは2種類あり、
    // 頂点座標そのものがNaNになるケースと、面積0の三角形が生じて法線ベクトルが(0,0,0)になり、
    // シェーダー側の正規化(0/0)でNaN化して真っ黒に描画されるケース（コンソールエラーは出ない）がある。
    // 後者はbbox（頂点座標）だけを見ても検出できないため、normal属性も併せて走査する。
    function _isGeometryValid(geometry) {
        const pos = geometry.attributes.position;
        if (!pos) return false;
        const parr = pos.array;
        for (let i = 0; i < parr.length; i++) {
            if (!Number.isFinite(parr[i])) return false;
        }
        const nrm = geometry.attributes.normal;
        if (nrm) {
            const narr = nrm.array;
            for (let i = 0; i < narr.length; i += 3) {
                const x = narr[i], y = narr[i + 1], z = narr[i + 2];
                if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
                if (x === 0 && y === 0 && z === 0) return false;
            }
        }
        return true;
    }

    function _buildTextExtrudeGeometry(bevelEnabled) {
        const shapes = _buildShapesForText(currentFont, params.text, params.fontSizeWorld, params.align, params.lineHeight);
        if (shapes.length === 0) return null;
        return new THREE.ExtrudeGeometry(shapes, {
            depth: params.depth,
            bevelEnabled,
            bevelThickness: params.bevelThickness,
            bevelSize: params.bevelSize,
            bevelSegments: params.bevelSegments,
            curveSegments: 8,
            steps: 1,
        });
    }

    // 直近に生成したジオメトリのサイズ（カメラのフィット計算に使う。テキストが空ならゼロのまま）
    let lastBBoxSize = { width: 0, height: 0, depth: 0 };

    function _rebuildGeometry() {
        _disposeMesh();

        let geometry;
        if (params.renderMode === 'svg') {
            const result = _buildSvgGeometry(params.svgData, params.svgSize);
            lastSvgWarnings = result ? result.warnings : [];
            if (!result || !result.geometry) { lastBBoxSize = { width: 0, height: 0, depth: 0 }; return; }
            geometry = result.geometry;
        } else {
            lastSvgWarnings = [];
            if (!currentFont || !params.text.trim()) { lastBBoxSize = { width: 0, height: 0, depth: 0 }; return; }
            geometry = _buildTextExtrudeGeometry(params.bevelEnabled);
            if (!geometry) { lastBBoxSize = { width: 0, height: 0, depth: 0 }; return; }
        }

        geometry.computeBoundingBox();

        // 面取りが原因でジオメトリが破綻した場合、真っ黒なまま無音で失敗させず、
        // 面取りを無効化して再構築することで必ず何かが表示される状態に復旧する。
        if (params.bevelEnabled && !_isGeometryValid(geometry)) {
            console.warn('[text3d] 面取り(ベベル)が形状に対して大きすぎて破綻したため、面取りを無効化して再構築しました');
            geometry.dispose();
            if (params.renderMode === 'svg') {
                const fallback = _buildSvgGeometry(params.svgData, params.svgSize, { forceNoBevel: true });
                lastSvgWarnings = [...(fallback ? fallback.warnings : []), 'svgBevelTooLarge'];
                if (!fallback || !fallback.geometry) { lastBBoxSize = { width: 0, height: 0, depth: 0 }; return; }
                geometry = fallback.geometry;
            } else {
                geometry = _buildTextExtrudeGeometry(false);
                if (!geometry) { lastBBoxSize = { width: 0, height: 0, depth: 0 }; return; }
            }
            geometry.computeBoundingBox();
        }

        const bb = geometry.boundingBox;
        lastBBoxSize = {
            width: bb.max.x - bb.min.x,
            height: bb.max.y - bb.min.y,
            depth: bb.max.z - bb.min.z,
        };
        // bbox中心を原点に揃える（カメラ・回転操作の基準を文字数/SVG形状に依らず一定にするため）
        geometry.translate(
            -(bb.max.x + bb.min.x) / 2,
            -(bb.max.y + bb.min.y) / 2,
            -(bb.max.z + bb.min.z) / 2,
        );

        mesh = new THREE.Mesh(geometry, _buildMaterials());
        scene.add(mesh);
    }

    // テキスト全体がカメラのフレーム内に収まるよう、正面(0,0,z)からの距離を自動調整する。
    // 長いテキストや複数行テキストがビューからはみ出て見切れる問題（実機検証で発覚）への対応。
    // ユーザーがカメラを手動操作した後は呼び出し側(userAdjustedCameraガード)で自動フィットを止める。
    function _fitCameraToText() {
        const { width, height, depth } = lastBBoxSize;
        if (width <= 0 || height <= 0) return;
        const aspect = camera.aspect || 1;
        const vFOV = THREE.MathUtils.degToRad(camera.fov);
        const hFOV = 2 * Math.atan(Math.tan(vFOV / 2) * aspect);
        const distForHeight = (height / 2) / Math.tan(vFOV / 2);
        const distForWidth  = (width  / 2) / Math.tan(hFOV / 2);
        const MARGIN = 1.25; // 端が枠ぎりぎりにならないよう25%の余白を持たせる
        const dist = Math.max(distForHeight, distForWidth) * MARGIN + depth;
        camera.position.set(0, 0, Math.max(dist, 1.5));
        camera.lookAt(0, 0, 0);
        orbit.target.set(0, 0, 0);
        orbit.update();
    }

    let animFrameId = null;
    function animate() {
        animFrameId = requestAnimationFrame(animate);
        if (renderer.getContext().isContextLost()) return;
        orbit.update();
        renderer.render(scene, camera);
    }

    function onVisibilityChange() {
        if (document.visibilityState === 'visible' && animFrameId === null) animate();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); }, false);
    canvas.addEventListener('webglcontextrestored', () => {
        renderer.setSize(canvas.width, canvas.height, false);
        renderer.setPixelRatio(window.devicePixelRatio);
    }, false);

    return {
        setFont(opentypeFont, fontFamily, fontSource) {
            currentFont = opentypeFont;
            params.fontFamily = fontFamily;
            params.fontSource = fontSource;
            _rebuildGeometry();
        },
        setText(text) { params.text = text; _rebuildGeometry(); if (!userAdjustedCamera) _fitCameraToText(); },
        setFontSize(v) { params.fontSizeWorld = v; _rebuildGeometry(); if (!userAdjustedCamera) _fitCameraToText(); },
        setDepth(v) { params.depth = v; _rebuildGeometry(); },
        setBevel(enabled, opts = {}) {
            params.bevelEnabled = enabled;
            if (opts.bevelThickness != null) params.bevelThickness = opts.bevelThickness;
            if (opts.bevelSize != null) params.bevelSize = opts.bevelSize;
            if (opts.bevelSegments != null) params.bevelSegments = opts.bevelSegments;
            _rebuildGeometry();
        },
        // 面取り厚み/サイズ/分割数を個別に変更する（⚙設定モーダルの詳細スライダー用。ON/OFF自体はsetBevelで扱う）
        setBevelThickness(v) { params.bevelThickness = v; _rebuildGeometry(); },
        setBevelSize(v) { params.bevelSize = v; _rebuildGeometry(); },
        setBevelSegments(v) { params.bevelSegments = Math.round(v); _rebuildGeometry(); },
        setAlign(align) { params.align = align; _rebuildGeometry(); },
        setLineHeight(v) { params.lineHeight = v; _rebuildGeometry(); if (!userAdjustedCamera) _fitCameraToText(); },
        // ---- SVG立体化モード ----
        setRenderMode(mode) {
            params.renderMode = mode === 'svg' ? 'svg' : 'text';
            _rebuildGeometry();
            if (!userAdjustedCamera) _fitCameraToText();
        },
        setSvgData(svgString) {
            params.svgData = svgString || '';
            _rebuildGeometry();
            if (!userAdjustedCamera) _fitCameraToText();
        },
        setSvgSize(v) {
            params.svgSize = v;
            _rebuildGeometry();
            if (!userAdjustedCamera) _fitCameraToText();
        },
        // 直近のSVGパース結果に対する警告キー配列（'svgTextNode'/'svgImageNode'/'svgNoPath'/'svgParseFailed'）。
        // 呼び出し側がi18nメッセージへ変換して表示する。
        getSvgWarnings() { return lastSvgWarnings.slice(); },
        // ---- 表面/側面カラー ----
        // 非分離時はmesh.material[0]===mesh.material[1]（同一インスタンス）のため、
        // frontのcolor.set()だけで両方に反映される。
        setFrontColor(hex) {
            params.frontColor = hex;
            if (mesh) {
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                mats[0].color.set(hex);
            }
        },
        setColor(hex) { this.setFrontColor(hex); }, // 後方互換エイリアス（旧API。表面色として扱う）
        setSideColor(hex) {
            params.sideColor = hex;
            if (mesh && params.separateSides) {
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                if (mats[1]) mats[1].color.set(hex);
            }
        },
        // マテリアルインスタンスの共有/分離自体が切り替わるため再構築する
        setSeparateSides(v) { params.separateSides = !!v; _rebuildGeometry(); },
        setMetalness(v) { params.metalness = v; _forEachMaterial((m) => { if (m.isMeshStandardMaterial) m.metalness = v; }); },
        setRoughness(v) { params.roughness = v; _forEachMaterial((m) => { if (m.isMeshStandardMaterial) m.roughness = v; }); },
        // マテリアルクラス自体が変わるため、ライブ更新ではなくジオメトリごと再構築する
        setMaterialType(type) { params.materialType = type; _rebuildGeometry(); },
        setShadeColor(hex) { params.shadeColor = hex; _forEachMaterial((m) => { if (m.isMToonMaterial) m.shadeColorFactor.set(hex); }); },
        setToony(v) { params.toony = v; _forEachMaterial((m) => { if (m.isMToonMaterial) m.shadingToonyFactor = v; }); },
        resetCamera() {
            userAdjustedCamera = false;
            if (lastBBoxSize.width > 0 && lastBBoxSize.height > 0) {
                _fitCameraToText();
                return;
            }
            camera.position.set(0, 0, 4);
            camera.lookAt(0, 0, 0);
            orbit.target.set(0, 0, 0);
            orbit.update();
        },
        resizeRenderer(w, h) {
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        },
        // ---- スーパーサンプリング（アンチエイリアス強化）----
        getSuperSample() { return _superSample; },
        setSuperSample(v) {
            _superSample = !!v;
            try { localStorage.setItem(_SUPERSAMPLE_STORAGE_KEY, _superSample ? '1' : '0'); } catch (e) { /* localStorage不可の環境は無視 */ }
            _applyPixelRatio();
        },
        startLoop() { if (animFrameId === null) animate(); },
        stopLoop() { if (animFrameId !== null) { cancelAnimationFrame(animFrameId); animFrameId = null; } },
        // frameRect/displaySize省略時はcanvas全体をキャプチャする（pose_editor_core.capture()と同じ仕様）
        capture(frameRect, displaySize) {
            renderer.render(scene, camera);

            const scaleX = canvas.width / (displaySize ?? canvas.width);
            const scaleY = canvas.height / (displaySize ?? canvas.height);
            const sx = Math.round((frameRect?.x ?? 0) * scaleX);
            const sy = Math.round((frameRect?.y ?? 0) * scaleY);
            const sw = Math.round((frameRect?.w ?? canvas.width) * scaleX);
            const sh = Math.round((frameRect?.h ?? canvas.height) * scaleY);

            const crop = document.createElement('canvas');
            crop.width = sw;
            crop.height = sh;
            crop.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
            return crop.toDataURL('image/png');
        },
        exportParams() { return JSON.stringify(params); },
        getParams() { return { ...params }; },
        // ---- ライト設定（Ambient/Key/Fillの3灯固定。pose_editor_core.jsの自由追加式Light Editorと違い、
        // text3dは常にこの3灯のみを色・強度・位置(Ambient以外)で調整する簡易版） ----
        getLights() {
            return [
                { id: 'ambient', type: 'ambient', color: '#' + ambient.color.getHexString(), intensity: ambient.intensity },
                { id: 'key', type: 'directional', color: '#' + dirLight.color.getHexString(), intensity: dirLight.intensity,
                  position: { x: dirLight.position.x, y: dirLight.position.y, z: dirLight.position.z } },
                { id: 'fill', type: 'directional', color: '#' + backLight.color.getHexString(), intensity: backLight.intensity,
                  position: { x: backLight.position.x, y: backLight.position.y, z: backLight.position.z } },
            ];
        },
        setLightColor(id, hex) { _lightById(id)?.color.set(hex); },
        setLightIntensity(id, v) { const l = _lightById(id); if (l) l.intensity = v; },
        setLightPosition(id, x, y, z) { const l = _lightById(id); if (l && l.isDirectionalLight) l.position.set(x, y, z); },
        // ---- ズーム操作モード（pose3d設定と同じlocalStorageキーを共有） ----
        getZoomMode() { return _zoomMode; },
        setZoomMode(mode) {
            _zoomMode = mode === 'ctrlDrag' ? 'ctrlDrag' : 'wheel';
            try { localStorage.setItem(_ZOOM_MODE_STORAGE_KEY, _zoomMode); } catch (e) { /* localStorage不可の環境は無視 */ }
            _applyZoomMode();
        },
        dispose() {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('pointerup', _endCtrlRightDrag);
            window.removeEventListener('blur', _endCtrlRightDrag);
            if (animFrameId !== null) { cancelAnimationFrame(animFrameId); animFrameId = null; }
            _disposeMesh();
            renderer.dispose();
        },
    };
}
