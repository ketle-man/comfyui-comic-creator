# Chapter 6 Layout Tab (Part 1): Panels and Placement

This chapter explains how to choose where to put images in the Layout tab, organize them in the layer panel, fix the panel layout afterwards, and register assets. Balloons, text, and drawing are covered in Chapter 7.

## 6-1 Where to Put Images and How

### Three places

In the Layout tab, you can put images in three places.

| Place | Characteristics | Included in exports? |
| --- | --- | --- |
| Panel | Clipped to the panel's shape. This is the usual place | Yes |
| Overlay (full) | A front layer covering the whole page. Shown across panel borders (but not outside the page) | Yes |
| Draft (full) | A sketch layer in front of even the overlay. Images only | **No** |

Choose the place by clicking a panel in the preview, or by clicking the "Overlay (full)" or "Draft (full)" row in the layer panel. The selected panel is outlined in blue.

> **Tip**
> The draft layer accepts clicks and drags only while it is selected. When it is not selected, clicks pass through to the overlay or panels below. You can keep a rough sketch on it and still work underneath.

### Three ways to insert images

| Method | Steps |
| --- | --- |
| Drag and drop | Drop an image file from your PC onto the panel you want (Chapter 4, 4-4) |
| Insert Image | Select a panel, press "Insert Image" in the control bar, and choose a file |
| Asset panel | Choose an asset in the asset panel's "A" tab and press "Insert into Panel" (6-5) |

The image is aligned to the top left of the panel and sized to the full width of the panel.

### Moving, resizing, and rotating images

Click an image to show handles around it.

| Operation | How |
| --- | --- |
| Move | Drag the image |
| Resize | Drag a green handle (the aspect ratio is kept) |
| Free transform | Hold Alt while dragging a green handle (the image stretches too) |
| Rotate | Drag the yellow handle |
| Re-center | Press "OC" in the control bar |
| Delete | "Delete" in the control bar, or the Delete / Backspace key |

> **Tip**
> If you move an image outside the panel and can no longer grab it, select its row in the layer panel and press "OC" to bring it back to the center of the panel.

## 6-2 The Layer Panel

The layer panel lists what is on the page in the order "panel → items inside it".

### Buttons on panel rows

| Button | What it does |
| --- | --- |
| ✕ | Delete the panel (its images, balloons, and sub-panels are deleted too; "Undo" brings them back) |
| □ / − | Show (□) / hide (−) the panel's border |
| 🔓 / 🔒 | Lock / unlock everything inside the panel at once |

### Buttons on image, balloon, and other rows

| Button | What it does |
| --- | --- |
| 👁 | Show / hide |
| Alt + click on 👁 | Show / hide every item of the same kind on the whole page (only balloons, only images, etc.) |
| 🔓 / 🔒 | Lock / unlock. A locked item cannot be selected, moved, or deleted |
| ✕ | Delete |

> **Tip**
> Alt + click on 👁 to "hide all balloons" and check just the artwork. Alt + click again to bring them back.

### Controls at the top and bottom of the panel

| Location | Control | What it does |
| --- | --- | --- |
| Top | ↑ ↓ | Move the selected item up or down in the stacking order (higher = in front) |
| Top | G+ / G- | Group / ungroup (6-3) |
| Top | 📦+ | Register the one checked item as an asset (6-5) |
| Top | Opacity: | How transparent the selected item is |
| Bottom | Duplicate / Move | Duplicate / move the selected item to the panel (or overlay, draft) chosen in the drop-down |
| Bottom | View size: | Zoom the preview in or out (25–300%) |

## 6-3 Grouping

To move several items together, make them a group.

1. In the layer panel, check the checkboxes of two or more items.
2. Press "G+" at the top.

Click a group row (marked [G]) to show an orange dotted frame. Drag to move the items together, and use the handles to resize and rotate them together. To ungroup, select the group and press "G-".

> **Caution**
> Only items in the same panel can be grouped.

## 6-4 Fixing the Panel Layout Afterwards

You can change the panel layout even after inserting a page from a template. Use "Sub-panel", "Split", and "Deform" in the tool pane.

### Sub-panel: a small panel inside a panel

Create a small panel (sub-panel) inside a panel to insert a different shot. You can put images and balloons in a sub-panel just like in a normal panel.

1. Press "Sub-panel" in the tool pane.
2. Set "Add sub-panel:" to "ON" and choose a shape: "Rect" or "Circle".
3. In the preview, drag inside the panel where you want the sub-panel.

After creation, "Add sub-panel:" switches back to "OFF" automatically.

| Operation | How |
| --- | --- |
| Move | Drag the sub-panel's border (black line) |
| Resize / rotate | Drag the round handles / yellow handle shown when selected |
| Border thickness | Enter a value in "Selected sub-panel border width:" |
| Delete | ✕ on the sub-panel's row in the layer panel |

> **Tip**
> Clicking inside a sub-panel normally selects the image inside it. To move the whole sub-panel with its frame, turn on the checkbox on the sub-panel's row in the layer panel.

### Split: divide one panel into two

1. Press "Split" in the tool pane.
2. Set "Split panel:" to "ON".
3. In the preview, drag inside the panel along the line where you want to split it. Diagonal lines are fine.

Only the chosen panel is split in two; other panels do not change.

| Item | Description |
| --- | --- |
| Gap between panels: | The gap between the two new panels. It is filled in automatically from the page's existing gaps, so you usually do not need to change it |
| Existing items | Only items that fit completely inside the new panel move to it. Everything else stays in the original panel |
| Panel numbers | The new panel gets the next number after the original, and later numbers shift by one |

### Deform: change a panel's shape or delete it

1. Press "Deform" in the tool pane.
2. Set "Deform panel:" to "ON" and click the panel you want to change. Its corners (●) and edges appear.
3. Drag a corner to move only that corner. Drag an edge to move that edge in parallel.

| Operation | How |
| --- | --- |
| Remove a corner | Click a corner to select it, then "Delete vertex" (or the Delete key). Turns a rectangle into a triangle |
| Delete the panel | "Delete panel". Images and other items inside are deleted too |
| Move the page's outer edge | Turn off "Lock outer edge" (on by default; corners on the outer edge are shown in gray and cannot be moved) |

> **Caution**
> Deform moves only the selected panel. It does not stop even if the panel overlaps a neighbor or goes outside the page. If the result is not what you wanted, use "Undo".

> **Tip**
> Locked (🔒) panels cannot be split or deformed. Sub-panels cannot be split or deformed either.

## 6-5 Using Assets

Register images you use often, or balloon combinations you made, as "assets" to insert them quickly from the asset panel's "A" tab.

### Using your own image folders as assets

The asset panel's "A" tab shows the contents of the `assets` folder inside the Comic Creator folder.

```
ComfyUI/custom_nodes/comfyui-comic-creator/assets/
└── (any folder name)/
    ├── background01.png
    └── speedlines.png
```

1. Create a folder inside the `assets` folder and put images (PNG, JPEG, WebP, SVG) in it. Images placed directly in `assets` are not shown.
2. Press "↺" in the asset panel to show them in the list.
3. Click an asset to select it and press "Insert into Panel".

> **Caution**
> Alt + clicking an asset in the asset panel deletes it, after confirmation, **including the file on your PC** (cannot be undone).

> **Caution**
> The `assets` folder is inside the Comic Creator folder. If you delete and reinstall Comic Creator, the assets are deleted too. Copy the `assets` folder somewhere else before reinstalling.

### Registering your creations as assets

You can register balloons, text, and shapes made in the Layout tab, or groups of them, as assets.

| What to register | How |
| --- | --- |
| A group | The 📦 button on the group's row in the layer panel |
| A single item (image, balloon, text, shape) | Check only that one item and press the 📦+ button at the top |

After pressing the button, choose a destination folder or create a new one, enter a file name, and press the register button. It appears in the asset panel right away.

Balloons and text registered this way are inserted as editable balloons and text when you later use "Insert into Panel".

### Other asset panel tabs

| Tab | Use |
| --- | --- |
| P (Page) | Pages of the current work. Click to switch to that page |
| T (Templates) | Select and press "Insert as Page" (or double-click) to add a page |
| F (Font) | Styles made in the Font tab. Click to insert as text into the selected panel (if text is selected, the style is applied to it) (Chapter 8) |
| I (Image) | Image projects saved in the Image tab. In the Layout tab, the image is inserted into the panel (Chapter 9) |

## 6-6 Processing Images (Image Sub-tab)

"Image" in the tool pane lets you apply simple processing to the selected image.

| Item | Description |
| --- | --- |
| BG Remove | When checked, keeps the subject (such as a person) and makes the background transparent |
| Model | Use "Light (@imgly)" |
| Quality | Low quality / light (42MB), Standard quality (84MB), High quality (168MB). Higher quality gives cleaner edges but a larger first download |
| Scale: | How many times larger to make the image (up to 4×) |
| Sharpen: | How strongly to sharpen edges |
| Denoise | When checked, reduces graininess |
| Run | Process with the settings above |

1. Click the image you want to process.
2. Set the items and press "Run".

The processed image is **added as a new image** at the same position and size (and rotation) as the original, and the original image is automatically **hidden**. The original is not deleted, so if you want to compare them, show it again with the 👁 button in the layer panel. Delete the one you do not need.

> **Caution**
> BG Remove needs an internet connection the first time, to download the model. To use the "BiRefNet" model, you need the custom node "Mask Editor One" and the BiRefNet model. If they are not installed, "BiRefNet" is grayed out and cannot be chosen.

The Image sub-tab also has these buttons:

| Button | Description | Chapter |
| --- | --- | --- |
| ↔ ↕ | Flip the image horizontally / vertically | — |
| Edit in G'MIC GUI / Insert Result | Edit the image in the external software G'MIC | Chapter 12 |
| ✨ PixiJS FX | Add particle and filter effects | Chapter 12 |
| 🎨 Halftone | Turn into halftone dots (screentone style) | Chapter 7 |

> **Chapter summary**
> - Images can go in three places: panel, Overlay (full), and Draft (full). The draft layer is not exported
> - Green handles resize (Alt for free transform), the yellow handle rotates
> - Manage stacking order, visibility, locks, and groups in the layer panel. Alt + click on 👁 hides all items of the same kind
> - Fix the panel layout afterwards with "Sub-panel", "Split", and "Deform"
> - Put images in a folder inside the `assets` folder to use them from the asset panel's "A" tab
> - Results from the "Image" sub-tab are added at the same position and size as the original, and the original is hidden (restore it with 👁)
