# Chapter 4 Your First Page

In this chapter you will actually make one manga page and export it as a PNG image. Detailed settings are left for later chapters; first, let's go all the way through once.

Here is what you will do in this chapter:

| Step | What to do | Tab |
| --- | --- | --- |
| 4-1 | Make one panel-layout template | "Page" tab > "Templates" |
| 4-2 | Create a work | "Page" tab > "Works" |
| 4-3 | Insert the template as a page | "Layout" tab |
| 4-4 | Put images into panels | "Layout" tab |
| 4-5 | Add a balloon and dialogue | "Layout" tab |
| 4-6 | Save and add more pages | "Layout" tab |
| 4-7 | Export as PNG | "Page" tab > "Works" > "Export" |

What you need: two or three images to put in the panels (for example, images generated in ComfyUI; PNG or JPEG).

## 4-1 Make a Panel-Layout Template

The first time you start Comic Creator, two templates, "A4縦_3コマ" (A4 portrait, 3 panels) and "A4横_3コマ" (A4 landscape, 3 panels), are registered automatically. Here, to learn how the wizard works, you will make one template yourself. You can also simply use the A4 portrait one.

1. Open the "Page" tab and choose the "Templates" sub-tab at the top.
2. Press "Create Template". The wizard opens.

   [Image: The first screen of the template wizard (page orientation, width, height, frame width)]

3. Under "Page orientation", choose "Portrait". Leave width, height, and frame width as they are for now.
4. Press "Create Base". A white frame shaped like the page (the canvas) appears.
5. Check that "Cut mode" is set to "Cut All".
6. On the canvas, drag horizontally from left to right to draw a line. The panel is split in two along the line.

   [Image: Splitting the panel by drawing a line on the canvas]

7. In the same way, split the lower panel in two with a vertical line. If you switch "Cut mode" to "Cut Single Panel", only the panel where you start the line is split.
8. When you have three panels, press "Save as Template".
9. You are asked for a template name ("Template name:"). Enter an easy-to-recognize name such as `3 panels` and press OK.

You are done when the new template appears in the template list.

> **Tip**
> If you draw a line by mistake, press "Undo One". To start again from scratch, press "Start Over".

> **Tip**
> Check "Guide grid" to show grid lines on the canvas, and check "Snap" to make line ends stick to the grid. This is handy when you want panels of equal size.

## 4-2 Create a Work

Next, create a "work" to hold your pages.

1. Choose the "Works" sub-tab of the "Page" tab.
2. Press "New Work". The "Create New Work" dialog opens.

   [Image: The "Create New Work" dialog]

3. Enter a name in "Title:". Example: `my first work`
4. Choose the paper size in "Size:". Here, choose "A4 portrait (210×297mm)".
5. Press "Create".

The work is created and the screen switches to the "Layout" tab automatically. At this point the work has zero pages.

> **Tip**
> The creation date and time is automatically added after the work name (Chapter 1, 1-3).

## 4-3 Insert the Template as a Page

Add a page to your new work using the template from 4-1.

1. At the far left of the "Layout" tab, press the "T" (Templates) tab of the asset panel.
2. Click the template you made in 4-1 to select it.
3. Press "Insert as Page" at the bottom of the asset panel.

   [Image: Selecting a template in the asset panel's T tab and pressing "Insert as Page"]

A three-panel page appears in the preview. The template has been automatically stretched to fit the work's size (A4 portrait). Also check that the page number in the control bar reads "1 / 1".

> **Caution**
> The "Page" tab > "Templates" sub-tab also has a "Quick" button. It creates one page right away from the selected template and opens it in the Layout tab, but it creates the page at the template's own size and does not register it to the work. To add pages to a work, use **"Insert as Page"**.

## 4-4 Put Images into Panels

The easiest way is to drag and drop images from a folder on your PC.

1. Open the folder containing your images in File Explorer (Finder on Mac).
2. Drag an image file over the panel in the preview where you want it, and release.

   [Image: Dragging and dropping an image file onto a panel]

The image is aligned to the top left of the panel and sized to the full width of the panel. Parts outside the panel are hidden.

### Adjusting position and size

| What you want to do | How |
| --- | --- |
| Move it | Drag the image |
| Resize it | Select the image and drag the handles (round dots) that appear around it |
| Center it in the panel | Select the image and press "OC" in the control bar |
| Undo a mistake | Press "Undo" in the control bar |
| Remove the image | Select the image and press "Delete" in the control bar (the Delete key also works) |

Put images into the remaining panels in the same way.

> **Tip**
> You can drop only one image at a time. If you drop several files together, only the first one is inserted.

> **Caution**
> Release the image over the panel you want. If you release it outside a panel (such as the page margin), it may go into the panel you selected before, or into the overlay that covers the whole page.

## 4-5 Add a Balloon and Dialogue

### Place a balloon

1. Press "Balloon" in the tool pane.
2. In the preview, click the panel where you want the balloon. The panel is outlined in blue.
3. Under "Type:", choose "Normal (Ellipse)".
4. Press "Insert". A balloon is placed in the center of the selected panel.

   [Image: A balloon just inserted (with handles)]

Drag the handles around the balloon to resize it. Change the direction and length of the tail (the pointed part) with "Angle:" and "Length:" under "Tail".

> **Tip**
> When you insert a balloon, the mode switches to "Edit: ON", so you can move and reshape balloons. Switch to "Edit: OFF" to avoid moving balloons by accident.

### Add dialogue

1. Click the balloon to select it.
2. Press "Embed Text". The "Embed Text" window opens.

   [Image: The "Embed Text" window]

3. Type the dialogue in "Text". You can use line breaks.
4. Check "Vertical" if you want vertical text.
5. Adjust "Font size:" and other settings, then press "Create".

The dialogue is wrapped automatically inside the balloon. To change it later, double-click the balloon to open this window again.

## 4-6 Save and Add More Pages

### Save

Press "Save" in the control bar. The current page is saved and registered to the work.

> **Tip**
> Each operation on images and balloons is recorded in the browser as you go. Even so, it is a good habit to press "Save" at good stopping points.

### Make page 2

1. Select the template in the asset panel's "T" tab.
2. Press "Insert as Page". Page 2 is created and the page number becomes "2 / 2".
3. Add images and a balloon as in 4-4 and 4-5, then press "Save".

Use "◀" and "▶" in the control bar to move between pages 1 and 2.

## 4-7 Export as PNG

Export your finished pages as PNG images.

1. Open the "Works" sub-tab of the "Page" tab.
2. Click the work you just made in the works list on the left.
3. Press the "Export" button at the top. The screen switches to the "Export" sub-tab, and only this work's pages are listed.

   [Image: The Export sub-tab (settings on the left, page list on the right)]

4. Choose "PNG" under "Format:".
5. Enter the range of pages to export in "Pages:". To export both pages, enter `1` to `2`.
6. Press "Save".
7. When asked, choose where to save.

> **Caution**
> "Pages:" is filled in automatically as "1 to the last page" to match the number of pages in the list. To export only some of the pages, change the range.

> **Caution**
> Even if you open the "Export" sub-tab directly instead of with the "Export" button in "Works", only the pages of the work you are currently working on are listed (if there is one). To list all pages, including those of other works, press "Remove" in the filter display above the list. The numbers in "Pages:" are positions in the list.

> **Tip**
> When exporting several pages in Chrome or Edge, you are asked for a destination folder once, and a file for each page is saved there. Check "Save as zip" to save all pages together in one zip file.

Open the exported PNGs in an image viewer to check your pages. Your first page is complete.

> **Chapter summary**
> - "A4縦_3コマ" and "A4横_3コマ" are there from the start. To make your own, use "Page" tab > "Templates" > "Create Template"
> - Create a work with "Page" tab > "Works" > "New Work". The screen then switches to the "Layout" tab
> - Add pages to the work with the asset panel's "T" tab > "Insert as Page"
> - Drag and drop images onto panels. Balloons: "Balloon" > "Insert". Dialogue: "Embed Text"
> - To export, select the work in "Works" and press "Export". Always check the "Pages:" range
