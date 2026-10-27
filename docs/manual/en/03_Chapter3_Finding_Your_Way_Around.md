# Chapter 3 Finding Your Way Around

This chapter explains where things are on the Comic Creator screen. You do not need to memorize everything. Use it as a "map" to come back to when you get lost.

## 3-1 The Tabs

When you open Comic Creator, twelve tabs are lined up at the top of the screen. The first time you open it, the "Page" tab is shown.

The twelve tabs are easier to understand when grouped by role into three groups.

### Create

Tabs for making manga pages and images. You will use these the most.

| Tab | What you can do | Chapter |
| --- | --- | --- |
| Page | Create and manage works, manage templates, export | Chapters 4 and 5 |
| Layout | Place and edit images, balloons, and text in the panels of a page. Your main workspace | Chapters 4, 6, and 7 |
| Image | A layer-based image editor. Also used to add text to a single image | Chapter 9 |
| Font | Check fonts and save text appearance (styles) | Chapter 8 |

### Create with AI

Tabs for creating images and scripts with AI. They require AI setup.

| Tab | What you can do | Chapter |
| --- | --- | --- |
| Nanobanana+ | Generate images with Google's Gemini API (Nanobanana) or with Workflow Studio workflows (Local) | Chapter 10 |
| MOSS-Image | Generate images on ComfyUI on your own PC, specifying where objects, characters, and text go | Chapter 10 |
| OCR | Read the text and positions in an image with AI and pass them to MOSS-Image or the layout | Chapter 10 |
| Auto | Create a story, script, and panel layout from a theme with AI | Chapter 11 |
| Script | Write and manage scripts (synopsis, plot, dialogue per panel). Works without AI | Chapter 11 |

### Support

Tabs that help your work.

| Tab | What you can do | Chapter |
| --- | --- | --- |
| workflow studio | Show the Workflow Studio gallery (requires ComfyUI-Workflow-Studio) | Chapter 10 |
| Settings | Display language, backup and restore, settings for external software | Chapter 13 |
| Help | The in-app manual. You can search it by keyword | 3-4 in this chapter |

> **Tip**
> "ws reload" and "Open ws in new tab" at the right end of the tab bar are buttons for Workflow Studio. If you do not use Workflow Studio, you can ignore them.

## 3-2 The Layout Tab Screen

The tab you will use the longest is the "Layout" tab. From left to right, the screen is divided as follows.

| No. | Area | Role |
| --- | --- | --- |
| ① | Asset panel (far left) | Lists of image assets, pages, templates, etc. Choose from here to add to the page |
| ② | Tool pane (right of ①) | A vertical row of buttons to switch tools such as "Balloon" and "Text" |
| ③ | Control bar (top) | Operations used with any tool, such as page navigation, saving, and panel selection |
| ④ | Tool settings (below ③) | Settings for the tool selected in ② |
| ⑤ | Preview (center) | The page being edited. Click and drag here to edit directly |
| ⑥ | Layer panel (far right) | A list of panels, images, balloons, etc. on the page, and their stacking order |

### ① Asset panel

At the top of the asset panel is a row of one-letter tabs. Hover over one to see its name.

| Tab | Name | Contents |
| --- | --- | --- |
| A | Assets | Image assets and group assets. "Insert into Panel" adds one to the selected panel |
| P | Page | Thumbnails of pages |
| T | Templates | Panel-layout templates. "Insert as Page" creates a new page |
| F | Font | Styles and presets made in the Font tab |
| I | Image | Image projects saved in the Image tab |

If a list is out of date, press "↺" (Refresh asset list) at the top right.

The asset panel is not shown on the "Page" tab. On the "Image" tab only A, F, and I are shown; on the "Script" tab only S (Saved Works / Page Works) is shown.

### ② Tool pane

The tool pane is shown only on the Layout tab. Pressing a button switches the settings in ④.

| Button | Use | Chapter |
| --- | --- | --- |
| Balloon | Place balloons | Chapter 7 |
| Text | Place text | Chapter 7 |
| Draw | Draw shapes and lines, paint | Chapter 7 |
| Image | Image processing such as background removal, halftone, PixiJS FX | Chapters 6, 7, and 12 |
| Video | Place a video in a panel (experimental) | Chapter 12 |
| Mask | Hide or show parts of images or panels | Chapter 7 |
| 3D Pose / 3D Text | Place 3D models or 3D text | Chapter 12 |
| Manga | Manga effects (speed lines, etc.), background patterns | Chapter 7 |
| Sub-panel / Split / Deform | Fix the panel layout afterwards | Chapter 6 |

### ③ Control bar

| Item | What it does |
| --- | --- |
| Page: ◀ ▶ | Switch to the previous or next page of the current work |
| "3 / 12" display | Current page number / number of pages in the work |
| Delete Page | Move the current page to the trash |
| Save | Save the current page and register it to the work |
| Panel: | Choose the panel to work on (you can also click a panel in the preview) |
| Panel border: | Thickness of panel borders |
| Delete | Delete the selected image, balloon, etc. |
| Undo | Undo the last operation |
| Insert Image | Add a chosen image file to the panel |
| Edit in Image tab | Open the selected image in the Image tab |
| Generate | Generate images with Workflow Studio (Chapter 10) |
| OC | Move the selected object to the center of the panel (or of the page, for the overlay) |
| Close | Close the current work. Saved data is not lost |

> **Tip**
> You can also add images by dragging and dropping them from a folder on your PC onto the preview.

### ⑥ Layer panel

Everything on the page is listed here. Items higher in the list appear in front.

- Click a row to select that item (and the panel containing it)
- Use "↑" and "↓" to change the stacking order
- Use "G+" to group items and "G-" to ungroup
- Use "Opacity:" to change how transparent the selected item is
- Use "View size:" at the bottom to zoom the preview in or out (25–300%)

Details are explained in Chapter 6.

## 3-3 Other Tabs

Other tabs are explained in their own chapters. Here is just how to tell them apart.

| Tab | What the screen looks like |
| --- | --- |
| Page | Three sub-tabs at the top: "Works", "Templates", and "Export". No asset panel |
| Image | Asset panel (A, F, I) on the left, tool buttons at the top, layers on the right |
| Font | A list of fonts and a preview |
| Nanobanana+ | A "Nanobanana / Local" switch at the top, and two sub-tabs, "Generation" and "Nanobanana History" (the right half of "Generation" holds the reference images) |
| OCR | The image and boxes on the left; mode, settings, and results on the right |
| MOSS-Image | Layout editor on the left; three tabs in the middle ("Prompt", "JSON", "Model / Sampler"); the generate button and results on the right |
| Auto | Two sub-tabs: "Story & Script" and "Auto Layout" |
| Script | Asset panel (S) on the left, plot in the center |

## 3-4 Using the Help Tab

The "Help" tab is a manual built into Comic Creator. It covers features in even more detail than this book.

1. Open the "Help" tab.
2. Type what you want to look up in the search box at the top left ("Search features..."). Examples: `balloon`, `backup`
3. Choose a topic from the list on the left to see its explanation on the right.
4. Press "Open tab →" in the explanation to jump to that feature's tab.

Help is available in Japanese, English, and Chinese, and follows the language chosen in the "Settings" tab.

> **Tip**
> This book is based on v1.66.0. If button names or positions differ from this book, search the Help tab to find the explanation for your current version.

> **Chapter summary**
> - The twelve tabs fall into three groups: "Create", "Create with AI", and "Support". The ones you use most are "Page" and "Layout"
> - From left to right, the Layout tab has the asset panel, the tool pane, the control bar and tool settings, the preview, and the layer panel
> - A, P, T, F, and I in the asset panel are Assets, Page, Templates, Font, and Image
> - If you are unsure about something, search the Help tab
