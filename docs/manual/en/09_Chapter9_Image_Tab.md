# Chapter 9 Image Tab: Layered Image Editor

The "Image" tab is an image editor that works with stacked layers. You work on a single canvas, separate from the pages of the Layout tab.

- Put a title or dialogue on a single image
- Crop an image, add margins, remove the background
- Stack layers to paint and process
- Send the edited image back to a panel in the Layout tab

## 9-1 The Screen

| No. | Area | Role |
| --- | --- | --- |
| ① | Toolbar (left) | Tool buttons. Hover over an icon to see its name |
| ② | Action bar (top) | Open, new, close, undo, save, send |
| ③ | Options bar (below ②) | Settings for the selected tool |
| ④ | Canvas (center) | The image being edited |
| ⑤ | Right panel | Properties of the selection and the list of layers |

Press "Fit" below the canvas to fit it to the screen, or "100%" for actual size. Hold Space and drag to pan the view.

The asset panel (A, F, I) also appears on the left. Assets in "A" can be added as a new layer with "Insert as Layer".

## 9-2 Adding Text to a Single Image

First, let's go through the most common task: adding text to an image and saving it.

1. Open the "Image" tab.
2. Drag and drop the image file onto the canvas (or choose it with "File Open").
3. Press "T" (Text) in the toolbar.
4. In the options bar, choose Color, Size, and Font. Check "Vertical" for vertical text.
5. Click where you want the text. An input box opens; type the text and press "OK".

6. To reposition the text, press "▲" (Select) and drag the text.
7. To add an outline or shadow, select the text and press "Style" in the options bar (the same window as in Chapter 7, 7-2).
8. Press "PNG" in the action bar to save.

> **Caution**
> In the text input box, **Enter starts a new line** and **Ctrl+Enter (⌘+Enter on Mac) confirms**. This is the same as the Layout tab's text input window. Esc cancels.

> **Tip**
> Double-click text you placed to retype it. Styles saved in the Font tab can be applied by clicking them in the asset panel's "F" tab.

## 9-3 Opening and Creating Images

| Button | What it does |
| --- | --- |
| File Open | Open an image from your PC. Dragging and dropping onto the canvas also works. If an image is already open, the new one is added as a new layer (sized to fit the canvas) |
| Open PSD | Open a PSD (Photoshop) file with its layers (up to 50 MB) |
| New | Enter the size as `WxH` (for example, `1024x1024`) to create a blank canvas (max 8192) |
| Draft | Create a light canvas with the same aspect ratio as the current work (for rough sketches; requires an open work) |
| Close | Close the current image. You are asked whether to save |
| ↩ ↪ | Undo (Ctrl+Z) / Redo (Ctrl+Y) |

> **Tip**
> In the Layout tab, double-click an image in a panel or press "Edit in Image tab" to open it in the Image tab. When you finish editing, press "Layout" to write it back to the original image (9-6).

> **Caution**
> "Open PSD" and saving as PSD require the `psd-tools` package (Chapter 2, 2-3).

## 9-4 Tools

| Button | Tool | Key | What it does |
| --- | --- | --- | --- |
| ▲ | Select | V | Select, move, resize, and rotate layers. Crop and add margins |
| ✏ | Draw | B | Paint with a brush |
| T | Text | T | Add text |
| ◪ | 3D Text | — | 3D lettering (requires comfyui-vrm-pose-editor; Chapter 12) |
| □ | Shape | S | Draw shapes |
| 🪣 | Fill | G | Bucket fill (solid or gradient) |
| 🎭 | Mask | — | Create masks |
| ≈ | Blur | — | Blur / mosaic |
| ★ | Filter | — | G'MIC filters (Chapter 12) |
| ⬚ | BG Remove | — | Remove the background |
| ⤢ | Upscale | — | Enlarge, denoise, sharpen |

### Select: cropping and adding margins

Besides moving layers, the Select tool can change the canvas size.

| Button | Description |
| --- | --- |
| ✂ Crop | Crop the canvas. Drag the dotted frame, or enter X, Y, width, and height in the right panel, then press "Apply" |
| ⛶ Extend Canvas | Add margins to the top, right, bottom, and left of the canvas. Check "Link all sides" to use one value. Choose the "Margin color": extend edge pixels, transparent, white, or black |

Press Delete to delete the selected layer (nothing is deleted when only one layer remains).

### Draw: painting with a brush

Set the brush color, size, and opacity, then drag to paint. Press the eyedropper next to the color picker and click the canvas to pick that color. Pen pressure is supported.

### Shape: drawing shapes

Draw rectangles, ellipses, lines, chains, ropes, My Curve, and more. When "Same Layer" at the left of the options bar is on (default), shapes are drawn on the same layer instead of adding a new layer each time. Rectangles and ellipses can be filled with a solid color, gradient, or texture.

### Fill: bucket fill

Fills the clicked spot and the connected area of similar color. Raise "Tolerance" to include slightly different colors. Choose "Gradient" to fill with a gradient.

### Mask

Create mask layers to hide parts of an image or to mark areas for AI to redraw. Besides Paint (brush), there are sub-tools that define areas by color, transparency, text, or shapes.

When Workflow Studio is installed, the Mask tool shows "Inpaint" (redraw an area with AI) and "Outpaint" (extend the image outward with AI) (Chapter 10).

### Blur, BG Remove, Upscale

| Tool | Description |
| --- | --- |
| Blur | Blur or mosaic the whole image or a rectangular area |
| BG Remove | Remove the background. Choose the quality in Quality (42MB / 84MB / 168MB). The first use needs an internet connection to download the model |
| Upscale | Enlarge the image. Denoise and sharpen are also available |

> **Caution**
> The "BiRefNet" model in BG Remove can be chosen only when the custom node "Mask Editor One" and the BiRefNet model are installed. If they are not, it is grayed out, so use the light model.

## 9-5 The Layer Panel

| Button | What it does |
| --- | --- |
| + | Add a new layer |
| M | Add a mask layer |
| − | Delete the selected layer |
| ↑ ↓ | Change the stacking order |
| 📁 Group | Select two or more layers with Shift+click and press to put them in a folder-like group |
| Flatten | With two or more layers selected, merge them into one. With one or none selected, flatten all layers into one |

On each layer row you can toggle visibility and lock, and change opacity. The duplicate button below the opacity slider duplicates the selected layer.

From the bottom of the panel you can add 12 kinds of **adjustment layers**, such as brightness, contrast, and saturation. An adjustment layer changes the colors of the layers below it without altering the original images.

## 9-6 Saving and Sending

Save and send buttons are on the right side of the action bar.

### Save

| Button | What is saved | Where |
| --- | --- | --- |
| PNG | One image combining all layers | Downloaded to your PC |
| PSD | A PSD file with layers kept (adjustment layers are baked into the layer below) | Downloaded to your PC |
| Project | The editing state including the layer structure, so you can continue later | The asset panel's "I" tab |
| Gallery | One image combining all layers | ComfyUI's `output/cc` folder |

> **Tip**
> Save images you may revise later with "Project". Choose one in the asset panel's "I" tab and press "Open" to restore it with all its layers. A PNG cannot have its text retyped.

### Send

| Button | Destination |
| --- | --- |
| Layout | The Layout tab. An image opened with "Edit in Image tab" is written back to the original; otherwise it is inserted as a new image into the selected panel |
| Eagle | The image manager Eagle (Chapter 12) |
| wsI2I | The I2I (image-to-image) input of Workflow Studio (Chapter 10) |
| LI Node | The Load Image node selected in ComfyUI's screen (only when opened from the CC button) |

> **Tip**
> A canvas made with "Draft" and sent with "Layout" goes into the page-wide draft layer, not a panel.

> **Chapter summary**
> - The Image tab is a single layered canvas. Open images by drag and drop or "File Open"
> - To add text: "T" → click → type → OK. Enter is a new line; Ctrl+Enter confirms
> - Use Select's "✂ Crop" to crop and "⛶ Extend Canvas" to add margins
> - Save with "PNG", or "Project" if you will revise it. "Layout" sends it back to a panel
