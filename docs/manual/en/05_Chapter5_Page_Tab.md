# Chapter 5 Page Tab: Works, Templates, Export

The "Page" tab is where you organize works and pages, manage templates, and export finished pages. This chapter looks in detail at the operations used in Chapter 4.

The "Page" tab has three sub-tabs at the top.

| Sub-tab | What you can do |
| --- | --- |
| Works | Create, open, and delete works; reorder, duplicate, move, and delete pages; trash |
| Templates | Create, import, rename, and delete templates; group them |
| Export | Export pages as images, SVG, PDF, or EPUB |

## 5-1 Works

The Works screen consists of a toolbar at the top and three areas: left, center, and right.

| No. | Area | Role |
| --- | --- | --- |
| ① | Toolbar | "New Work", "Open", "Export". The current work's name and size are shown at the right end |
| ② | Left: works list / groups | Choose a work or group |
| ③ | Center: page list | Thumbnails of the pages in the chosen work or group |
| ④ | Right: panel | Information about the selected page, and operations on pages, groups, and works |

### Creating and opening works

| Button | What it does |
| --- | --- |
| New Work | Create a work by entering a name and size. The screen then switches to the "Layout" tab |
| Open | Open the first page of the selected work in the "Layout" tab. Double-clicking a work card also opens it |
| Export | Show only the pages of the selected work (or group) in the "Export" sub-tab (5-3) |

The sizes available in "New Work" are:

| Size | Dimensions |
| --- | --- |
| A4 portrait | 210×297 mm |
| A4 landscape | 297×210 mm |
| B5 portrait | 182×257 mm |
| B4 portrait | 257×364 mm |
| A5 portrait | 148×210 mm |
| Square | 210×210 mm |

For other sizes, type the width × height directly (unit: 0.01 mm; A4 is 21000×29700). Save sizes you use often as custom presets with the button to the right of the input fields.

> **Tip**
> The work size decides the page dimensions. The pixel size of exported images is decided by "Resolution:" in 5-3.

### Works list and groups

At the top of the left area are buttons to switch between "Works" and "Groups".

| View | Contents |
| --- | --- |
| Works | Work cards (first-page thumbnail, size, number of pages). The work you are working on is marked |
| Groups | Groups for sorting pages that are not works. stock and the trash are also here |

The difference between a "work" and a "group" is whether it has a size.

- **Work**: has a width and height. Inserted templates are stretched to fit the work's size
- **Group**: has no size. Use it to stock pages you did not use, for example

Pages can be moved freely between works and groups.

> **Tip**
> **stock** is a built-in group that cannot be deleted or renamed. Pages made without opening a work go here automatically (Chapter 1, 1-3).

### Reordering and selecting pages

Work with pages in the center page list.

| Operation | What it does |
| --- | --- |
| Click | Select one page |
| Ctrl (⌘ on Mac) + click | Select multiple pages |
| Select All / Deselect | Select all shown pages / clear the selection |
| ↑ ↓ | Move the selected page earlier or later (only when one page is selected) |
| Bulk Delete | Move all selected pages to the trash |

The order set here is the order of "◀" and "▶" in the Layout tab, the page that "Open" shows first, and the export order.

### Page operations (right panel)

| Button | What it does |
| --- | --- |
| Rename | Rename the selected page (only when one page is selected) |
| Sequential Rename | Rename the selected pages with sequential numbers in the form "name_000" |
| Duplicate Page | Duplicate the selected page and insert it right after (named "original name_copy") |
| Destination group + Move | Move the selected pages to another work or group |
| Move to stock | Move the selected pages to stock |
| Delete (Trash) | Move the selected pages to the trash |
| Delete Work | Delete the selected work. Its pages go to the trash |

In "Group Management" on the right panel, you can add, rename (✎), and delete (✕) groups.

### Restoring from the trash

Deleted pages are not erased immediately; they go to the trash.

1. In the left area, switch to "Groups" and choose "Trash".
2. Select the pages you want to bring back.
3. Choose the destination group (or work) and press "Restore".

Pages removed from the trash with "Delete Forever" cannot be restored.

> **Caution**
> Like works, the trash is stored inside the browser. If you clear the browser's site data, the trash is cleared too.

## 5-2 Templates

In the template list, each card shows the size and the frame width below its name (for example, `21000×29700 / Frame 63`).

| Button | What it does |
| --- | --- |
| Create Template from SVG | Import an SVG file as a template |
| Create Template | Make a template by drawing lines in the wizard |
| Quick | Make one page right away from the selected template and open it in the Layout tab (panel line width stays as in the template; not registered to a work; see the caution below) |
| Rename | Rename the selected template |
| Delete | Delete the selected template (cannot be undone) |
| Insert as Page | Insert the selected template into the open work as a new page |
| Send to Auto Layout | Send the selected template to Auto Layout in the "Auto" tab (Chapter 11) |

> **Caution**
> To add pages to a work, use **"Insert as Page"**, not "Quick". "Quick" creates a page at the template's own size and does not register it to the work. To change the panel line width, use "Panel border:" at the top of the Layout tab (Chapter 4, 4-3).

### Making a template with the wizard

In addition to the steps in Chapter 4, 4-1, the wizard has these settings:

| Item | Description |
| --- | --- |
| Page orientation | Portrait / Landscape |
| W, H | Template size (unit: 0.01 mm). Since it is stretched to fit the work when inserted, matching the ratio is enough |
| Frame width | Width of the outer margin and the gaps between panels |
| Design | When on, makes a template with no margins or gaps (for flyers, etc.) |
| Cut mode | Cut All: split every panel the line crosses / Cut Single Panel: split only the panel where the line starts |
| Guide grid, Snap | Show grid lines, and make line ends stick to the grid. Settings are remembered by the browser |

> **Tip**
> Templates made with "Design" on have no line thickness at panel borders. After inserting the page, set the thickness with "Panel border:" in the Layout tab. Set it to 0 to hide the border lines.

### Making a template from an SVG file

You can draw panel borders in drawing software such as Inkscape, Affinity Designer, or Illustrator, save as SVG, and turn the file into a template.

1. Press "Create Template from SVG" and choose an SVG file.
2. If a scale adjustment is needed to match other templates' border thickness, a confirmation appears. Press OK with the suggested value to apply it. Enter `1` to skip the adjustment.
3. If a template with the same name exists, you are asked for another name.

> **Tip**
> The Comic Creator page on GitHub has sample SVGs for each drawing application (the `sample_svg` folder). This folder is not included when you install with the Nodes Manager, so download it from GitHub if you want to use it. How to make templates in drawing software is described in the appendix of the in-app Help.

### Grouping templates

When you have many templates, grouping makes them easier to find.

1. In "Group Management" on the right, enter a group name and press "Add".
2. Select a template, choose a group, and press "Add to Group".

Choose a group in the drop-down above the list to show only that group's templates. The "T" tab of the Layout tab's asset panel also shows them in collapsible groups.

## 5-3 Export

### Export steps

1. In "Works", select a work and press the "Export" button (Chapter 4, 4-7).
2. Choose "Format:".
3. Choose "Resolution:". The width and height (px) are calculated automatically.
4. Set the range in "Pages:".
5. If needed, enter "Filename:" and "Metadata:".
6. Press "Save".

### Choosing a format

| Format | Good for |
| --- | --- |
| JPEG | Posting on social media, etc. Small files |
| PNG | Saving without losing quality |
| WebP | Small files while keeping quality |
| SVG | Editing text and shapes later in Inkscape, etc. |
| PDF | Printing, or sending several pages as one file |
| EPUB | Reading as an e-book |

### Resolution and size

Choose 72–600 dpi in "Resolution:" and the pixel size of exported images is calculated from the work size. For example, an A4 work at 300 dpi becomes 2480×3508 px.

| Resolution guide | Use |
| --- | --- |
| 72–150 dpi | Viewing on screen, social media |
| 300–350 dpi | Printing |
| 600 dpi | Printing fine black-and-white line art |

- If you type the width or height directly, "Resolution:" switches to "Manual"
- With "Keep aspect ratio" checked, the width-to-height ratio is kept
- The maximum export size is 8000 px. Larger sizes are scaled down, keeping the aspect ratio
- For PDF, the paper size is calculated from the chosen resolution. An A4 work exported at 300 dpi gives an A4 (210×297 mm) PDF page

### Pages and file names

| Item | Description |
| --- | --- |
| Pages: | The range of pages to export (from which page to which page) |
| Filename: | If blank, the page name is used as the file name |
| Numbering | When exporting two or more pages, `01_`, `02_`, … is added to the start of each file name |
| Save as zip | Bundle all pages into one zip (for JPEG, PNG, WebP, and SVG; grayed out and unavailable for PDF and EPUB) |

> **Caution**
> "Pages:" is filled in automatically as "1 to the last page" to match the number of pages in the list. To export only some of the pages, change the range. If you are working on a work, only that work's pages are listed even when you open the "Export" sub-tab directly (to list all pages, press "Remove" in the filter display).

### Metadata

Enter a title, author, subject, and keywords in "Metadata:" to embed them in the exported files (except SVG). Separate multiple keywords with commas. Your entries are kept for next time.

### Other items

| Item | Description |
| --- | --- |
| Background only | Export only the page base, such as panel frames, without images, balloons, or text (for JPEG, PNG, WebP, and SVG; grayed out and unavailable for PDF and EPUB) |
| + Import Images | Import images from your PC as pages |
| Sort | Reorder by the numbers typed in the page list (when not filtered by a work) |

### Exporting SVG to edit in other software

The SVG format exports the page as shapes and text data instead of a picture. Text stays as text, balloons stay as shapes, and the fonts used are embedded in the file.

| Software | How well it can re-edit |
| --- | --- |
| Inkscape, Affinity Designer/Publisher | Can edit almost as-is |
| Adobe Illustrator | Opens, but image links break, so each image must be re-linked |
| CorelDraw | Freezes while loading, so it cannot be used |

> **Tip**
> The export libraries are built into the app, so every format can be exported without an internet connection. However, pages using web fonts such as Google Fonts may be exported with a substitute font if the font has not been loaded yet.

> **Chapter summary**
> - In "Works", create, open, and export works, and reorder, move, and delete pages. Deleted pages can be restored from the trash
> - Make or import templates in "Templates". Use "Insert as Page" to add pages to a work
> - In "Export", check the format, resolution, and pages before pressing "Save". Use 300–350 dpi for printing
> - Exporting as SVG lets you re-edit text and shapes in Inkscape and similar software
