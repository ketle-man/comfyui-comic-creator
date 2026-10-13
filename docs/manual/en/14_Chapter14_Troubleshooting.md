# Chapter 14 Troubleshooting

When something does not work, try these three things first. They solve most problems.

## 14-1 Three Things to Try First

| Order | What to do | Problems it often solves |
| --- | --- | --- |
| 1 | Reload the Comic Creator tab in your browser (F5) | Strange display, unresponsive buttons, outdated lists |
| 2 | Restart ComfyUI and reopen Comic Creator | Settings (such as `.env`) not applied, companion nodes not found |
| 3 | Search the "Help" tab for the feature you are having trouble with | Unclear button meanings, version differences from this book |

> **Caution**
> Before reloading, press "Save" in the Layout tab for the page you are working on.

## 14-2 Problems and Solutions

### Launching and display

| Problem | Cause | Solution |
| --- | --- | --- |
| No CC button | ComfyUI not restarted, folder in the wrong place, old ComfyUI frontend | Chapter 2, 2-7. You can also open it by adding `/ccc` to the address |
| Works you made before are missing | Opened in a different browser or at a different address (`127.0.0.1` vs `localhost`, port number) | Open it in your usual browser at your usual address (Chapter 1) |
| Shown in Japanese though you want English | You chose Japanese before, or your browser language is Japanese or one that is not supported (the first time, it follows the browser language) | Choose English in "設定" (Settings) > "言語" (Language) |
| Some text stays in Japanese / some names stay in English | Some parts of the app, such as tool and button names in the Image tab, are not translated | This is how v1.53.2 works. This book follows the screen |

### Works and pages

| Problem | Cause | Solution |
| --- | --- | --- |
| The templates are gone | You deleted them (the "A4縦_3コマ" and "A4横_3コマ" that are there at first do not come back automatically once deleted) | Make one with "Page" tab > "Templates" > "Create Template" (Chapter 4) |
| A page you made is not in the works list | You made it without opening a work | Look in "Works" > "Groups" > stock, and use "Move" to put it in a work |
| Page size does not match the work | The page was made with "Quick" | Use "Insert as Page" in the asset panel's "T" tab (Chapter 4, 4-3) |
| You deleted a page | — | "Works" > "Groups" > "Trash", then "Restore" (Chapter 5) |

### Images, balloons, and text

| Problem | Cause | Solution |
| --- | --- | --- |
| An image went into the wrong panel | It was dropped outside a panel | Drop it on the panel you want. Afterwards, "Move" in the layer panel can move it |
| You can no longer grab an image | It went outside the panel | Select it in the layer panel and press "OC" (Chapter 6) |
| An image or balloon cannot be selected or moved | It is locked (🔒) | Unlock it (🔓) in the layer panel |
| Balloons cannot be moved | "Edit: OFF" | Set "Edit: ON" in "Balloon" |
| Dialogue overflows a balloon | The balloon is too small | Enlarge the balloon with its handles (Chapter 7) |
| Clicking a panel does not place text | Text mode is off | Turn on the "T" button in "Text" |
| Text is not confirmed in the Image tab | Enter starts a new line there | Press Ctrl+Enter (⌘+Enter on Mac) to confirm (Chapter 9) |
| The original image disappeared after processing | Processing in the "Image" sub-tab hides the original image | Show the original again with the 👁 button in the layer panel (Chapter 6) |
| Background removal fails | No internet connection, or the BiRefNet model or Mask Editor One is not set up correctly | Choose "Light (@imgly)". The first use needs internet. If "BiRefNet" is grayed out, check Mask Editor One and the model |
| System fonts do not appear | A browser other than Chrome/Edge, or access not allowed | Press "Load system fonts" in Chrome or Edge and allow access (Chapter 8) |

### Exporting

| Problem | Cause | Solution |
| --- | --- | --- |
| Only some pages are exported | You changed the range in "Pages:" | Check the range and set it to "1 to the last page" (Chapter 4, 4-7) |
| Pages from another work were exported | You cleared the filter above the list | Select the work in "Works" and open it with the "Export" button |
| The font changed in the export | A web font was not loaded yet (e.g., offline) | Connect to the internet, display the page once, then export |
| The draft is not exported | The draft layer is never exported | Put things you want exported in a panel or the overlay |

### AI and integrations

| Problem | Cause | Solution |
| --- | --- | --- |
| Nanobanana says the API key is not set | No `.env`, wrong format, or ComfyUI not restarted | Chapter 10, 10-3. `.env` goes directly in the Comic Creator folder |
| Nanobanana's second and later images cannot be inserted | You have not chosen them from the thumbnails (the first image is selected at first) | Click a thumbnail below the result to choose it, then press "Insert into Panel". The images are also kept in `ComfyUI/output/cc_nanobanana/` |
| The "workflow studio" tab says "was not found" | ComfyUI-Workflow-Studio is not installed | Install it and restart ComfyUI (or ignore it if you do not use it) |
| After Generate, the original image is still there | Generated images are layered on top | Delete unneeded originals in the layer panel |
| Auto shows "Failed to fetch" | The local LLM URL and the address you opened do not match | Match the host name (`http://127.0.0.1:11434` if you opened `127.0.0.1`) |
| The decision model shows "not set" | Opened at a different address from Workflow Studio | Open at the same address as Workflow Studio, including the port number |
| 3D Pose / 3D Text shows an error | comfyui-vrm-pose-editor is not installed, or the folder name differs | Install it with the folder name `comfyui-vrm-pose-editor` (Chapter 2) |
| PixiJS FX shows an error when opened | comfyUI-particle-pixijs is not installed | Install it and restart ComfyUI |
| GPU memory runs out during image generation | Ollama models are using VRAM | "Settings" > "VRAM Management (Ollama)" (Chapter 13) |
| G'MIC does not open | The executable path is wrong | Check for a red warning in "Settings" > "G'MIC Settings" |

> **Chapter summary**
> - When stuck, try reloading, restarting ComfyUI, and searching the Help tab, in that order
> - If works are missing, check the browser and address
> - Always check the "Pages:" range when exporting
> - For integration errors, check that the required custom node is installed and that ComfyUI was restarted
