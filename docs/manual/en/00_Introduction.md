# Introduction

This book is a step-by-step beginner's guide to "ComfyUI Comic Creator" (Comic Creator below), a custom node for ComfyUI.

Comic Creator is a manga-making app that runs inside ComfyUI. In a single browser screen you can lay out panels on a page, place images, add speech balloons and dialogue, and export the result as images, PDF, or EPUB.

## Who This Book Is For

- **People who want to make manga with ComfyUI**
  You want to turn images made in ComfyUI into manga pages with panels, balloons, and dialogue.
- **People who want to edit images, such as adding text to pictures**
  Even if you do not plan to draw manga, you want to put a title or dialogue on a single image, or stack layers to edit it.

No experience with manga or image-editing software is needed. If you can start ComfyUI, you can follow this book.

> **Tip**
> If you want to add text to a single image or edit images, read Chapter 4 "Your First Page" to get the overall flow, then focus on Chapter 7 (balloons and text) and Chapter 9 (the Image tab).

## What This Book Covers and Does Not Cover

| Covered | Not covered |
| --- | --- |
| Installing and launching Comic Creator | Installing ComfyUI itself |
| The screens and operations of each tab | Building ComfyUI workflows (connecting nodes) |
| The flow of making a work (create → place → export) | Detailed use of Workflow Studio |
| The flow of using AI image generation and AI script writing | Details of signing up for or installing the Gemini API, Ollama, etc. |
| What to do when something goes wrong | How to use external software (Eagle, G'MIC, Inkscape, etc.) |

Many integration features require another custom node or external software. For each such feature, this book lists what you need.

## Target Version

This book is based on **Comic Creator v1.53.2**.
Comic Creator is updated frequently, so in other versions button positions or names may differ. In that case, also check the in-app "Help" tab (Chapter 3).

## Notation

| Notation | Meaning | Example |
| --- | --- | --- |
| **Bold** or "quotes" | Names of buttons, tabs, and items shown on screen | the "Save" button, the "Page" tab |
| `monospace` | Folder names, file names, and text you type | `ComfyUI/custom_nodes/` |
| > | Follow menus or tabs in order | "Page" tab > "Works" |

Screen names follow the app's English UI. Note that a few parts of the app may still show Japanese text even in English mode; this book points those out where they appear.

Paths are written starting from `ComfyUI/`. Replace this with the folder where ComfyUI is installed on your machine (explained in Chapter 2).

There are two kinds of boxes:

> **Tip**
> Something useful to know.

> **Caution**
> Something that can lead to lost work or failure. Please read these.

## What Makes Comic Creator Unique

- **Everything from page creation to export in one screen**
  Manage works, lay out panels, place images, add balloons and dialogue, apply finishing effects, and export, all without switching apps.
- **Use images made in ComfyUI as they are**
  Drag and drop ComfyUI output images into a panel to place them. Combined with Workflow Studio, you can even regenerate an image on the spot while looking at the page.
- **Vertical text and manga-style balloons**
  Vertical and horizontal text, balloons such as oval, thought, burst, and cloud, and manga effects such as halftone dots are included.
- **A layer-based image editor**
  The "Image" tab is an image editor with layers, drawing, masks, and filters. It is useful for image editing beyond manga.
- **Make pages from a script with AI**
  The "Auto" tab creates a story and script from a theme, and even generates the panel layout automatically (AI setup required).
- **Export in many formats**
  Export as JPEG, PNG, WebP, SVG, PDF, or EPUB. The export libraries are bundled with the app, so you can export without an internet connection.

Let's start with Chapter 1, which covers the basic terms of manga making and the workflow in Comic Creator.
