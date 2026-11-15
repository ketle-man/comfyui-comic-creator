# Chapter 13 Settings and Backup

This chapter explains the items in the "Settings" tab and how to protect your works with backup and restore.

## 13-1 Settings Tab Items

The "Settings" tab has the following items, from top to bottom.

| Item | Description | Chapter |
| --- | --- | --- |
| Language | Display language (日本語 / English / 中文). The screen reloads when you switch | Chapter 2 |
| Backup & Restore | Save all data to a zip / restore from a zip | 13-2 in this chapter |
| VRAM Management (Ollama) | Unload Ollama's models before image generation to free GPU memory | Table below |
| Prompt Translation (Workflow Studio) | Turn on or off translating prompts in your own language into English before sending | Below, and Chapter 10 |
| Nanobanana | Nanobanana engine (Gemini API / ComfyUI native node), shared by the Nanobanana+ tab (Nanobanana mode), Semi-Auto Manga, and Auto | Chapter 10 |
| 3D Pose Editor | Editor opened by "🎛 Editor" in the Layout tab's 3D Pose (3D Pose Editor / VRM Pose Studio) | Chapter 12 |
| Eagle Settings | Eagle connection and auto-save | Chapter 12 |
| G'MIC Settings | Location of the G'MIC Qt executable | Chapter 12 |
| Inpaint Settings | Workflow used by Inpaint in the Image tab | Chapter 10 |
| Outpaint Settings | Workflow used by Outpaint in the Image tab | Chapter 10 |

### VRAM Management (Ollama)

Using a local AI (Ollama) and image generation with Workflow Studio, MOSS-Image, or Nanobanana+ (Local) on the same PC can run GPU memory (VRAM) short. This setting makes Comic Creator unload Ollama's models right before generating images.

| Item | Description |
| --- | --- |
| Before generating | Do nothing (default) / Unload only as much as needed when free VRAM is below the target / Unload everything every time |
| Target free VRAM (GB) | How much to free in the "only as much as needed" mode |
| Unload all now | Unload the Ollama models currently loaded, right away |

Unloaded models are reloaded the next time they are used. Only Ollama on your own PC is affected (not LM Studio and others, nor ComfyUI's own models).

This setting also works in the OCR tab: before detection, before judging with a decision model, and before a whole-image read with ComfyUI's Chat TE (Chapter 10, 10-8).

Models that use no GPU memory (such as a prompt translation model running "CPU-resident") are not unloaded, because unloading them frees no GPU memory. The result of "Unload all now" says "Kept ... (CPU-resident, uses no VRAM)".

### Prompt Translation (Workflow Studio)

Settings for translating prompts written in your own language into English with the Workflow Studio translator before sending (how to use it: Chapter 10, 10-5). Requires Workflow Studio v0.9.10 or later.

| Item | Description |
| --- | --- |
| Status | "Available — model: ... (CPU-resident / GPU)", or "Not available: requires Workflow Studio v0.9.10 or later" |
| Use prompt translation | When on, a 🌐 button appears under the supported fields. Until you change it, it follows the Workflow Studio "Prompt Translation" on/off |
| Translate automatically when generating | On by default. Translates only what is sent when generating (the fields keep your text). If translation fails, nothing is generated |
| MOSS-Image target language | English (default) / Chinese (Simplified). MOSS-Image officially supports English and Chinese |

The translation model, Ollama URL, source language, and where it runs (GPU / CPU-resident) come from the Workflow Studio settings. Comic Creator cannot change them.

### Inpaint Settings and Outpaint Settings

Specify a workflow that Workflow Studio loads automatically when you run Inpaint or Outpaint in the Image tab.

1. Check "Use default workflow".
2. Enter the name of a workflow saved in Workflow Studio in "Workflow filename".

When unchecked, the workflow currently open in Workflow Studio is used.

> **Tip**
> Workflows for I2I and T2I are not set in the Settings tab, but in "Workflow Settings" at the bottom of the Layout tab's "Generate" window and in "I2I settings" of the Image tab's Select tool (Chapter 10).

## 13-2 Backup and Restore

As explained in Chapter 1, Comic Creator stores your works inside the browser. If you clear browser data or replace your PC, your works can no longer be seen. Make backups regularly.

### Making a backup

1. Open the "Settings" tab.
2. Press "Backup" under "Backup & Restore".
3. When the save dialog opens, choose where to save (the file name is `ccc_backup_date-time.zip`). In browsers without a save dialog, it is saved to your downloads folder.
4. When the zip is finished, "Saved." is shown. With many works it can take a few tens of seconds.

> **Tip**
> Before v1.72.0, with a lot of data the backup could fail with "Failed to save: Failed to execute 'showSaveFilePicker'..." (the save dialog was opened only after the zip was made). v1.72.0 asks for the save location first.

### What is and is not included

| Included (data inside the browser) | Not included (files in folders on your PC) |
| --- | --- |
| Works, pages, groups, trash | Assets in the `assets` folder (asset panel "A") |
| Templates and template groups | Items saved with "Project" in the Image tab (asset panel "I") |
| Script tab works | Images saved in `ComfyUI/output/` (Nanobanana, Gallery, etc.) |
| Auto works and AI settings | `.env` (API keys) |
| Font tab styles, presets, and categories | G'MIC Settings |
| Integration settings (Eagle, workflows, PixiJS FX, VRAM Management, prompt translation, decision model, etc.) | ComfyUI's own settings |
| Nanobanana+, MOSS-Image, and OCR tab settings (including layouts saved in MOSS-Image) | |
| The Image tab Draw palette | |
| Display language, export settings, etc. | |

> **Caution**
> The "not included" items cannot be protected by Comic Creator's backup. In particular, copy the `ComfyUI/custom_nodes/comfyui-comic-creator/assets/` folder (assets and Image tab projects) somewhere else.

### Restoring

1. Press "Restore" under "Backup & Restore" in the "Settings" tab.
2. Choose the backup zip file.
3. Press OK in the confirmation. When it finishes, the screen reloads automatically.

Restore merges data: items with the same name are overwritten by the zip contents, and other existing data is kept.

> **Tip**
> To erase everything and return exactly to the backup's state, clear the browser's site data before restoring.

### Moving to another PC

1. Make a backup on the old PC. Also copy the `assets` folder.
2. Install ComfyUI and Comic Creator on the new PC (Chapter 2).
3. Copy the `assets` folder into the Comic Creator folder on the new PC.
4. Open Comic Creator and use "Restore" in the "Settings" tab.

> **Caution**
> Restore in your usual browser at your usual address. If you restore while opened at a different address, the data is saved for that address (Chapter 1).

> **Chapter summary**
> - The "Settings" tab has language, backup, VRAM Management, prompt translation, Eagle, G'MIC, and Inpaint/Outpaint settings
> - "Backup" saves all data inside the browser (including layouts saved in MOSS-Image) to one zip. The save location is chosen first
> - Copy the `assets` folder (assets, Image tab projects) and the images in `output` separately
> - "Restore" overwrites items with the same name and keeps everything else
