# Appendix

## A Glossary

| Term | Meaning | Chapter |
| --- | --- | --- |
| Work | A set of pages with a width and height | Chapters 1, 5 |
| Page | One sheet within a work | Chapter 1 |
| Template | A panel-layout pattern for a page | Chapters 4, 5 |
| Panel | A frame on the page. Its contents are clipped to its shape | Chapter 1 |
| Sub-panel | A small panel created inside a panel | Chapter 6 |
| Overlay | The front layer covering the whole page | Chapter 6 |
| Draft layer | The front-most sketch layer. Never exported | Chapter 6 |
| stock | A built-in group holding pages that are not in a work | Chapter 5 |
| Asset | Material that can be inserted from the asset panel | Chapter 6 |
| Balloon | A speech bubble for dialogue | Chapter 7 |
| Extension balloon | A follow-on balloon joined by a narrow neck | Chapter 7 |
| Outline (bag text) | Text with a thick border around the outside | Chapters 7, 8 |
| Style | Settings for text appearance (fill, stroke, outline, shadow, etc.) | Chapter 8 |
| Preset | A combination of font + size + style | Chapter 8 |
| Mask | A layer for hiding or showing parts of an image | Chapters 7, 9 |
| Halftone | Dot patterns like screentone | Chapter 7 |
| Layer | A level on which images and text are stacked | Chapters 6, 9 |
| Adjustment layer | A layer that adjusts the brightness or color of the images below without altering them (Image tab) | Chapter 9 |
| T2I | Making an image from text (Text to Image) | Chapter 10 |
| I2I | Regenerating an image from an image (Image to Image) | Chapter 10 |
| Inpaint | Redrawing only part of an image with AI | Chapter 10 |
| Outpaint | Extending an image beyond its edges with AI | Chapter 10 |
| Denoise | In I2I, how much to change from the original | Chapter 10 |
| API key | Your personal key for using services such as Gemini | Chapter 10 |
| Local LLM | A text-generating AI running on your own PC (Ollama, etc.) | Chapter 11 |
| Decision model | An AI that answers questions with probabilities instead of writing text | Chapters 11 and 10 |
| OCR | Reading the text in an image. In the OCR tab, it also finds each text's position (box) | Chapter 10 |
| bbox (box) | A rectangle within an image. Used in the MOSS-Image layout and in OCR results | Chapter 10 |
| Chat TE | A ComfyUI custom node that lets you chat with a text encoder (such as Qwen3-VL). Used for OCR's whole-image read | Chapter 10 |
| VRAM | GPU memory | Chapter 13 |
| dpi | Dots per inch. How fine a print is | Chapter 5 |

## B Keyboard and Mouse Operations

### Layout tab

| Operation | Effect |
| --- | --- |
| Delete / Backspace | Delete the selected image, balloon, etc. |
| Alt + drag a handle | Resize an image without keeping its aspect ratio |
| Shift + drag a blue handle | Slant text |
| Alt + click 👁 in the layer panel | Show / hide all items of the same kind |
| Double-click (text, balloon) | Retype the text |
| Double-click (image) | Open in the Image tab |
| Ctrl+Enter | Confirm in the "Text Input" window (Esc closes it) |
| Esc (Polygon, Vector Curve) | Remove the last point |
| Enter (Vector Curve) | Finish without closing |

In the Layout tab, use the "Undo" button in the control bar to undo.

### MOSS-Image tab (layout editor)

| Operation | Effect |
| --- | --- |
| Shift + drag | Always draw a new box |
| Shift + click (without dragging) | Add a box to (or remove it from) the selection; selected boxes move together |
| Delete | Delete the selected box |
| Esc / Ctrl + Enter | Finish typing in a text box |
| Press a text box twice quickly | Edit its text again |

### Page tab

| Operation | Effect |
| --- | --- |
| Ctrl (⌘ on Mac) + click | Select multiple pages |
| Double-click a work card | Open the work |

### Image tab

| Key | Effect |
| --- | --- |
| V / B / T / S / G | Switch to Select / Draw / Text / Shape / Fill |
| Space + drag | Pan the view |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Delete / Backspace | Delete the selected layer (Select tool) |
| Enter / Ctrl+Enter | New line / confirm in the text input box |
| Esc | Cancel the eyedropper |

### 3D Pose and 3D Text

| Operation | Effect |
| --- | --- |
| Left drag / right drag / wheel | Rotate / pan / zoom the camera |
| Drag a blue sphere | Rotate a joint (Alt + up-down for the Z axis) |

## C Reference Links

| Name | Location |
| --- | --- |
| ComfyUI Comic Creator (GitHub) | https://github.com/ketle-man/comfyui-comic-creator |
| In-app help | The "Help" tab in Comic Creator |
| Sample SVG templates | The `sample_svg` folder on GitHub |

For companion custom nodes and software (ComfyUI-Workflow-Studio, comfyui-vrm-pose-editor, comfyUI-particle-pixijs, Eagle, G'MIC, Ollama, etc.), check their distribution pages for the latest information.
