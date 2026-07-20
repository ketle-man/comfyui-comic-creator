# ComfyUI Comic Creator

[English](README_en.md) | [日本語](README.md) | **中文**

一款运行在 ComfyUI 之上的漫画页面制作单页应用（SPA）。以"作品"（页面组）为单位管理页面，可从模板创建页面，在分格中放置图像、对话气泡、文字、图形和 3D 姿势，并可导出为 JPEG/PNG/WebP/PDF/EPUB 格式。内置基于图层的图像编辑器、字体管理、AI 图像生成（Nanobanana）以及脚本管理，力求用单个节点完成漫画创作的整个流程。

![ComfyUI Comic Creator](docs/1_top.png)

## 主要功能

### 页面/作品管理
- **作品（页面组）管理** — 页面以带有宽高信息的"作品"为单位分组管理，插入模板时会自动缩放到作品尺寸
- **模板功能** — 通过导入 SVG 或使用向导（画线分割页面）创建并注册分格模板
- **输出** — 导出为 JPEG/PNG/WebP/PDF/EPUB 格式，支持多页面批量导出与自动编号文件名。相关库（jsPDF/JSZip）已随应用打包，所有格式在离线环境中也可导出
- **通过分辨率自动计算输出尺寸** — "分辨率"下拉框（72〜600dpi）根据作品尺寸（mm）自动计算输出像素值（也可手动输入）。PDF 按所选 dpi 换算，保持物理纸张尺寸（A4 等）
- **输出元数据** — 将标题・作者・主题・关键词嵌入所有格式（PDF=文档属性 / EPUB=Dublin Core / PNG=iTXt / JPEG・WebP=XMP）
- **一键备份／恢复** — 将所有作品・页面・模板・设置保存为一个 zip 文件，可随时恢复（合并方式：同名覆盖）

### 排版标签
- **图像放置** — 拖放图像到分格中，通过手柄调整大小（默认锁定纵横比，按住 Alt 拖动可解除锁定自由变形）和旋转
- **对话气泡** — 在分格内放置椭圆、圆角矩形、思考、爆炸等形状的对话气泡，支持8点调整手柄。素材中的自定义SVG气泡放置后也可修改填充色・边框色
- **文字** — 支持横排/竖排，Google Fonts / 系统字体，可设置填充、描边、勾边字、阴影的样式弹窗。填充除纯色外还支持渐变、纹理和无填充（排版/Image标签通用）
- **形状绘制（绘制）** — 直接在SVG图层上绘制矩形、椭圆、直线、曲线、多边形、锁链、绳索、My Curve
- **3D姿势** — 在分格内放置 VRM/GLB/GLTF 模型并摆姿势后烘焙到图像中（通过 [comfyui-vrm-pose-editor](#可选依赖) 联动）
- **分组功能与图层面板** — 对象分组、层叠顺序管理、显示切换、锁定，以及**通过 Delete / Backspace 键删除**
- **I2I联动** — 将选中图像发送到 Workflow Studio 的 Generate UI，并可将生成结果送回（通过 [ComfyUI-Workflow-Studio](#可选依赖) 联动）
- **PixiJS FX** — 在"图像"子标签中为选中图像应用粒子・滤镜效果（通过 [comfyUI-particle-pixijs](#可选依赖) 联动）
- **漫画工具** — 「半调网点」（"转换图像"模式将选中图像转换为网点，"创建图案"模式仅生成分格/浮层尺寸的网点图案）与「漫画效果」（生成暗角、网点噪点、集中线（放射状／海胆闪／海胆（环）／线性 4 种）并作为分格尺寸的透明对象插入）两个弹窗。两者均可在选中图像／默认／白色之间切换预览背景，边确认效果边调整

### Image标签（基于图层的Canvas 2D编辑器）
- **Select / Text / Draw / Shape / Fill / Mask / Blur / Filter / BG Remove / Upscale** 各工具
- **Draw工具的滴管** — 通过取色器旁的按钮直接从画布拾取颜色作为笔刷颜色
- **Shape工具的Same Layer模式** — 每次绘制图形时叠加到同一图层，而不是新建图层
- **Fill工具** — 单色填充，或线性/放射状渐变填充（颜色渐变条与方向面板）
- **Mask工具** — Paint/Color/Alpha/Text/Vector/Shape各子工具，也支持SAM3分割和ABR笔刷（工具构成参考了 [comfyui-mask-editor-one](#致谢) 实现）
- **PixiJS FX** — 通过工具栏按钮为当前图层应用粒子・滤镜效果（通过 [comfyUI-particle-pixijs](#可选依赖) 联动）
- **图层面板** — 添加、复制、删除、调整层叠顺序、不透明度，以及12种调整图层（明度、对比度、饱和度等）
- **项目保存** — 完整保存图层构成，随时可恢复继续编辑

### 字体管理
- Google Fonts、系统字体预览，分类管理
- 创建并保存汇总填充・描边・勾边字・阴影的"样式"，以及字体+尺寸+样式的"预设"，可从排版/Image标签立即调用

### Nanobanana（AI图像生成）
- 使用 Gemini API 生成图像（正向/负向提示词、模型、分辨率）
- 生成的图像会自动保存到 ComfyUI 本体的 `output/cc_nanobanana` 文件夹

### 脚本标签
- 以 作品名 → 大纲 → 剧情［页面 → 分镜（场景、要素、台词/说明等）］的层级结构管理脚本
- 可一键将分镜内容作为文字插入到排版标签中

### 外部联动
- **Workflow Studio** — 嵌入式图库显示，I2I（图像↔工作流）双向传输
- **Eagle** — 自动或手动将生成/编辑的图像保存到 Eagle
- **G'MIC** — 与 G'MIC Qt GUI 联动的滤镜编辑

### 其他
- **多语言界面（i18n）** — 在设置标签中切换日语・英语・中文（帮助标签的全部内容也支持三种语言）
- **帮助标签** — 覆盖所有功能的可搜索应用内参考文档

## 安装

### 手动安装

将此文件夹放置在 ComfyUI 的 `custom_nodes/` 目录下：

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

该节点不需要任何额外的 Python 依赖包（`aiohttp` / `Pillow` 已随 ComfyUI 本体自带），因此无需 `requirements.txt`。

重启 ComfyUI 后，顶部工具栏会出现 **CC** 按钮，点击即可在新标签页中打开 Comic Creator（`/ccc`）。

<img src="docs/10_cc_topbar.png" width="400" alt="ComfyUI 顶部工具栏的 CC 按钮">

### ComfyUI Manager

可通过 ComfyUI Manager 的"Install via Git URL"输入以下地址安装：

```
https://github.com/ketle-man/comfyui-comic-creator
```

## 可选设置

### 使用 Nanobanana（Gemini API）

在此文件夹根目录下创建 `.env` 文件，填写 Gemini API 密钥：

```
NANOBANANA_API_KEY=你的API密钥
```

保存后需要重启 ComfyUI。

### 使用 G'MIC

在设置标签的"G'MIC设置"中指定 G'MIC Qt 可执行文件（`gmic_qt.exe`）的完整路径。保存后立即生效，无需重启 ComfyUI。

### 使用 Eagle 联动

在设置标签的"Eagle设置"中确认/修改 Eagle 的 API URL（默认：`http://localhost:41595`）。需要保持 Eagle 应用处于运行状态。

### 可选依赖

安装以下自定义节点后可启用对应功能。未安装时不影响其他功能的使用。

| 联动节点 | 启用的功能 |
|---|---|
| **comfyui-vrm-pose-editor** | 排版标签的 3D姿势 子标签 |
| **ComfyUI-Workflow-Studio** | I2I联动、workflow studio标签的嵌入式图库 |
| **comfyUI-particle-pixijs** | 排版标签"图像"子标签及Image标签的 PixiJS FX（粒子・滤镜效果弹窗） |

## 使用方法

1. 通过顶部工具栏的 **CC** 按钮打开 Comic Creator
2. 在"页面"标签的"作品管理"中输入作品名称和尺寸，点击"新建"（会自动跳转到排版标签）
3. 在排版标签左侧的素材面板"模板"中选择模板，点击"作为页面插入"
4. 在分格中放置并编辑图像、对话气泡、文字，然后点击"保存"
5. 重复使用◀▶翻页和插入模板来创建多个页面
6. 在"页面"标签的"输出"中指定格式和范围后保存

完整使用说明请参阅应用内的"帮助"标签（支持日语・英语・中文，并可搜索）。

## 截图

<p>
  <img src="docs/2_layout.png" width="260" alt="排版标签">
  <img src="docs/3_image.png" width="260" alt="Image标签">
  <img src="docs/4_font.png" width="260" alt="字体管理标签">
</p>
<p>
  <img src="docs/5_nanobanana.png" width="260" alt="Nanobanana标签">
  <img src="docs/6_script.png" width="260" alt="脚本标签">
  <img src="docs/7_help.png" width="260" alt="帮助标签">
</p>
<p>
  <img src="docs/8_template_create.png" width="260" alt="模板创建向导">
  <img src="docs/9_wfmgallery.png" width="260" alt="workflow studio 图库标签">
</p>

## 架构

```
comfyui-comic-creator/
├── __init__.py              # ComfyUI扩展入口（WEB_DIRECTORY、路由注册）
├── py/
│   ├── ccc.py                 # aiohttp 路由处理程序
│   └── config.py              # 路径・常量定义
├── templates/
│   └── index.html             # SPA主体（静态HTML，带data-i18n属性）
├── static/
│   ├── js/
│   │   ├── main/                # main.js拆分文件（状态管理、各标签逻辑）
│   │   ├── image-tab.js         # Image标签控制器
│   │   ├── image-tab/           # Image标签专用工具（DrawTool/ShapeTool/FillTool/MaskTool等）
│   │   ├── i18n.js              # 多语言词典（ja/en/zh）+ t()
│   │   ├── nanobanana.js        # Nanobanana（Gemini API）联动
│   │   ├── pixifx.js            # PixiJS FX联动
│   │   └── vendor/              # 随应用打包的库（jsPDF/JSZip，用于离线环境）
│   └── css/
├── web/comfyui/
│   └── ccc_menu.js             # 在ComfyUI顶部工具栏注册启动按钮
├── assets/                     # 内置模板、对话气泡、素材文件夹
└── docs/                       # README用截图
```

### API 接口（节选）

| 方法 | 路径 | 用途 |
|----------|------|------|
| GET | `/ccc` | SPA 入口 |
| GET | `/api/ccc/refresh-assets` | 重新生成素材列表 |
| POST | `/api/ccc/nanobanana/generate` | 生成 Nanobanana 图像 |
| POST | `/api/ccc/save-image-project` | 保存 Image 标签项目 |
| POST | `/api/ccc/eagle/add` | 保存图像到 Eagle |
| POST | `/api/ccc/local-gmic/open_in_gui_b64` | 启动 G'MIC Qt GUI |
| GET | `/api/ccc/local-gmic/status/{job_id}` | 获取 G'MIC 任务状态 |

## 许可证

MIT License — 详见 [LICENSE](LICENSE)。

## 致谢

- **[comfyui-vrm-pose-editor](https://github.com/ketle-man/comfyui-vrm-pose-editor)** — 提供3D姿势编辑功能的配套节点
- **[ComfyUI-Workflow-Studio](https://github.com/ketle-man/ComfyUI-Workflow-Studio)** — 提供I2I联动和嵌入式图库功能的配套节点
- **[comfyUI-particle-pixijs](https://github.com/ketle-man/comfyUI-particle-pixijs)** — 提供PixiJS FX（粒子・滤镜效果）功能的配套节点
- **[comfyui-mask-editor-one](https://github.com/ketle-man/comfyui-mask-editor-one)** — 实现Image标签Mask工具及图层机制时参考的节点
- [G'MIC](https://gmic.eu/) — 滤镜编辑功能（通过G'MIC Qt GUI外部可执行文件联动）
