# Chapter 1 Manga-Making Basics

This chapter explains the terms used in Comic Creator and the flow from start to a finished work. There is no hands-on work yet; the goal is to get the big picture.

## 1-1 Terms to Know

These words appear again and again on screen and in this book. Learning them first will make the following chapters easier to read.

| Term | Meaning |
| --- | --- |
| Work | A set of pages, like one book or one episode. A work has a **width and height (paper size)** |
| Page | One sheet within a work. When exported it becomes one image (or one PDF page) |
| Template | A panel-layout pattern for a page. Choose a template and click "Insert as Page" to create a page with that layout |
| Panel | A frame on the page. Images, balloons, and text are placed inside panels. Anything outside the panel is hidden |
| Overlay | The front-most layer that covers the whole page. Use it for things that cross panel borders (such as large sound-effect text). Shown as "Overlay (full)" |
| Draft layer | A sketch-only layer in front of even the overlay. **It is not included in exported images.** Shown as "Draft (full)" |
| Balloon | A speech bubble for dialogue. Shapes include oval, rounded rectangle, thought, burst, and cloud |
| Layer | The stacking order of images, balloons, text, and so on. Change the order in the layer panel on the right |

> **Tip**
> The difference between a panel and the overlay is whether things are clipped by the frame. An image placed in a panel is clipped to the panel's shape. Anything placed on the overlay is shown across the whole page (but not outside the page).

## 1-2 What You Can Do with Comic Creator

Making a work in Comic Creator follows this flow:

| Step | What to do | Tab | Chapter |
| --- | --- | --- | --- |
| 1 | Create a work (decide the title and paper size) | "Page" tab > "Works" | Chapters 4 and 5 |
| 2 | Choose a template and insert it as a page | "Layout" tab | Chapters 4 and 5 |
| 3 | Place images in panels | "Layout" tab | Chapter 6 |
| 4 | Add balloons, dialogue, and effects | "Layout" tab | Chapter 7 |
| 5 | Repeat steps 2–4 to add pages | "Layout" tab | Chapter 4 |
| 6 | Export (PNG, PDF, EPUB, etc.) | "Page" tab > "Export" | Chapter 5 |

Combine the basic flow with the following tasks as needed:

| What you want to do | Tab | Chapter |
| --- | --- | --- |
| Edit images in detail with layers, or add text to an image | "Image" tab | Chapter 9 |
| Choose fonts and save text styles (outline, shadow, etc.) | "Font" tab | Chapter 8 |
| Create images with AI | "Nanobanana" tab, "MOSS-Image" tab, Workflow Studio integration | Chapter 10 |
| Write a script before making pages, or have AI create the script and panel layout | "Script" tab, "Auto" tab | Chapter 11 |

## 1-3 Common Stumbling Points

Here are the points beginners most often get confused about.

### Your work is saved inside the browser

Works, pages, templates, and other data are saved **inside the browser you use to open Comic Creator**, not in the ComfyUI folder.

So in the following cases your earlier works will not appear (they have not been deleted):

- You opened it in a different browser (for example, you made it in Chrome but opened it in Edge)
- You opened it at a different address (for example, switching between `127.0.0.1` and `localhost`, or the port number changed)

> **Caution**
> If you clear site data (cookies, etc.) with your browser's "Clear browsing data", your works are deleted too. You also cannot move works to another PC as they are. Back up important works regularly to a zip file with "Settings" tab > "Backup & Restore" (Chapter 13).

### Work size and templates

The "width × height" you set when creating a work becomes the page size of that work. When you insert a template, it is automatically stretched to fit the work's size.

The unit is not mm but **a number where 1 = 0.01 mm**. For example, A4 (210 mm × 297 mm) is `21000×29700`. If you choose a preset, you do not need to calculate this yourself.

### Open a work before making pages

As a rule, create pages with a work open. If you insert a template and save without opening a work, the page goes into a group named **stock** under the "Groups" list in "Page" tab > "Works". It does not appear in the "Works" list, so check stock if you cannot find it.

### What the "Save" button does

The "Save" button on the Layout tab saves the current page and registers the page to the work you are working on. Make a habit of pressing it at good stopping points, even in the middle of editing.

### A date and time is added to the work name

When you create a new work, the creation date and time is appended to the name you entered (for example, `mycomic` → `mycomic_20261013153000`, a 14-digit year-month-day-hour-minute-second). This keeps works distinguishable even if you create several with the same name. If you leave the name blank, it becomes `name`.

> **Chapter summary**
> - The containers get smaller in the order work > page > panel. A template is a panel-layout pattern for a page
> - The overlay is a front layer covering the whole page; the draft layer is a sketch layer that is never exported
> - The basic flow is "create a work → insert a template → images, balloons, dialogue → export"
> - Data is saved inside the browser. It is not visible from a different browser or address. Don't forget to back up
