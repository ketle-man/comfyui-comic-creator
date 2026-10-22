# Chapter 10 Making Pictures with AI: Nanobanana and Workflow Studio

In Chapters 10 to 12, you will use the AI-related features in order while building one sample work.

## 10-1 The Sample Work

The sample is a short two-page manga.

| Item | Details |
| --- | --- |
| Title | Morning at the Cat Café |
| Size | A4 portrait |
| Pages | 2 |
| Characters | Mike, a cat waitress, and a first-time customer |
| Synopsis | Mike is preparing the café before it opens. Then a customer arrives too early... |

What each chapter covers:

| Chapter | What you do |
| --- | --- |
| Chapter 10 (this chapter) | Create background and character pictures with AI and put them in panels |
| Chapter 11 | Write the script and have AI create the panel layout and dialogue |
| Chapter 12 | Finish with 3D poses and effects |

First, follow Chapter 4 to create the work "Morning at the Cat Café" (A4 portrait) and insert two pages using a three-panel template.

## 10-2 Two Methods Compared

Comic Creator offers two ways to make AI pictures.

| | Nanobanana | Workflow Studio integration |
| --- | --- | --- |
| Where images are generated | Google's servers (Gemini API) | ComfyUI on your own PC |
| What you need | A Gemini API key | ComfyUI-Workflow-Studio, plus image models and workflows |
| GPU | Not needed | Needed |
| Cost | Google may charge depending on usage | Free (just electricity) |
| Good for | Quick tries, keeping characters consistent with reference images | Using your favorite models, redrawing while viewing panels, partial fixes |

You can use just one of them. This chapter explains both.

> **Tip**
> There is also the "MOSS-Image" tab, which uses an image model that ComfyUI itself supports (10-6). It also runs on your own PC, and lets you specify where objects, characters, and dialogue go so you can generate a whole page at once.

## 10-3 Preparing Nanobanana

Nanobanana creates images with Google's Gemini API. It requires an API key.

1. Get a Gemini API key, for example from Google AI Studio (how to get it is not covered in this book).
2. Create a file named `.env` in the Comic Creator folder.

   ```
   ComfyUI/custom_nodes/comfyui-comic-creator/.env
   ```

3. Write the following line in `.env` and save it (replace `your-API-key` with your key).

   ```
   NANOBANANA_API_KEY=your-API-key
   ```

4. Restart ComfyUI.

Open the "Nanobanana" tab. If there is no message saying the API key is not set, you are ready.

> **Caution**
> An API key is private information. Do not share the `.env` file with others or publish it on the internet.

> **Caution**
> `.env` is read when ComfyUI starts. Always restart ComfyUI after adding or changing the key.

### Switching the engine: ComfyUI native node

Besides generating with your own Gemini API key, Nanobanana can use ComfyUI's own Nano Banana node. Switch with "Engine" under "Nanobanana" in the "Settings" tab.

- **Gemini API (your own API key)** (default): generates directly with Google's Gemini API. History is recorded in `history.jsonl`. Needs `NANOBANANA_API_KEY` in `.env`.
- **ComfyUI native node (Comfy credits)**: generates with ComfyUI's own Nano Banana node and uses Comfy credits. Needs `COMFY_API_KEY` in `.env` (issued at platform.comfy.org).

This setting applies to the Nanobanana tab, to Semi-Auto Manga in the Script tab, and to the Auto tab (when its image engine is Gemini). The same selector also appears in the Nanobanana tab's basic settings and stays in sync with the Settings tab.

- **History**: with the native node, the generation settings are embedded in the output PNG, so automatic history recording and the "Record in History" button do not appear.
- **Save location**: images from the Nanobanana tab are saved to `ComfyUI/output/cc_nanobanana_native/`.
- **Unsupported**: Nano Banana Pro (gemini-3-pro-image) is not supported, and Nano Banana 2 Lite is 1K only.

> **Caution**
> `COMFY_API_KEY` also takes effect only after you write it in `.env` and restart ComfyUI. Without it, the connection status reads "COMFY_API_KEY not set".

## 10-4 Making Backgrounds and Characters with Nanobanana

### Making a background

1. Open the "Nanobanana" tab and choose the "Generation" sub-tab.
2. Enter a Positive Prompt (a description of the picture you want).
   ```
   calm cafe interior, morning light, wooden counter, manga background, monochrome
   ```
3. Choose "Model:" and "Resolution:" (aspect ratio). For a wide panel, choose 3:2 or 16:9.
4. Press "Generate Images". After a while the result appears.

| Item | Description |
| --- | --- |
| Model: | gemini-3.1-flash-lite-image / gemini-3.1-flash-image / gemini-3-pro-image / gemini-nano-banana-2.1 |
| Resolution: | Aspect ratio (1:1, 2:3, 3:2, 9:16, 16:9) |
| Output Size: | 1K (default) / 2K / 4K. Models that do not support it may stay at 1K |
| Batch size: | Number of images per run |
| Negative Prompt | A description of what you do not want |

### Putting it in a panel

1. In the "Layout" tab, click the panel for the background (for example, panel 1 on page 1).
2. Return to the "Nanobanana" tab and press "Insert into Panel" below the result.

> **Caution**
> If "Batch size:" is 2 or more, thumbnails appear below the result. Click a thumbnail to show that image in the preview; it is the one inserted by "Insert into Panel" (the first image is selected at first). All generated images are also kept in the save folder below.

Generated images are saved automatically in this ComfyUI folder:

```
ComfyUI/output/cc_nanobanana/
```

### Keeping a character consistent with reference images (I2I)

In manga, the same character must appear in many panels. Nanobanana's "I2I Input" lets you generate while showing reference images, which helps keep a character's look consistent.

1. First, make one full-body picture of Mike.
   ```
   calico cat girl character, cafe waitress apron, full body, white background, manga style
   ```
2. Open the "I2I Input" sub-tab and press "Add Images" to add the picture of Mike (up to 14 images).
3. Go back to "Generation", describe the scene in the Positive Prompt, and generate.
   ```
   the character in the reference image is making coffee at the counter, manga panel, monochrome
   ```

> **Tip**
> Gemini's image generation has no setting that controls "how much to change from the original" as a number. Adjust the strength of change through your prompt wording ("change only the pose", "keep the clothes", etc.).

### Keeping a history

Turn on "Automatically add to history on generate" to record the date, model, prompt, and so on for each generation. Even when it is off, press "Add to History" on a result to record only the ones you like. View records in the "History" sub-tab.

> **Tip**
> History is appended one entry per line to `ComfyUI/output/cc_nanobanana/history.jsonl`. It cannot be deleted inside the app; to remove an entry, open this file in a text editor and delete the line.

## 10-5 Working with Workflow Studio

With ComfyUI-Workflow-Studio (Workflow Studio below) installed, you can generate images with your own ComfyUI. From Comic Creator you can direct the generation while looking at pages and panels.

> **Caution**
> How to use Workflow Studio, and preparing models and workflows, are not covered in this book. Make sure Workflow Studio can generate images first.

### "Generate" in the Layout tab

Press "Generate" in the Layout tab's control bar to open the generation window.

| Item | Description |
| --- | --- |
| Target | Selected Image / Whole Page / Selected Tab (table below) |
| Prompt tabs | "Overall" plus tabs for each panel. Each panel can have its own prompt |
| T2I | When on, generate from text only, without using the current image. Off (default) regenerates from the current image (I2I) |
| Denoise | For I2I, how much to change from the original (higher = more change) |
| batch | Shown only for "Whole Page". When on, generates panel by panel |
| Run | Start generating |

| Target | Prompt used | Where the result goes |
| --- | --- | --- |
| Selected Image | "Overall" tab | Added as a new image |
| Whole Page (batch off) | "Overall" tab | Added to the overlay at full page size (for rough checks) |
| Whole Page (batch on) | "Overall" + each panel's tab | Added to each panel at full panel size |
| Selected Tab | Only the selected panel's tab | Added to that panel at full panel size |

> **Caution**
> For every target, the original image is not deleted; the generated image is layered on top. Delete original images you no longer need in the layer panel.

### Trying it on the sample: regenerating panel by panel

Let's make the three panels of page 1 with a prompt for each panel.

1. Open "Generate", choose "Whole Page" as the target, and turn on "batch" and "T2I".
2. In the "Overall" tab, describe the mood of the whole work.
   ```
   manga style, monochrome, cafe interior, morning
   ```
3. In each panel tab, describe the scene.
   ```
   Panel 1: wide shot of an empty cafe before opening
   Panel 2: a calico cat girl in an apron wiping the counter
   Panel 3: the door opens, surprised cat girl
   ```
4. Press "Run". The panels are generated in order, starting with panel 1, and inserted.

To redo only a panel that did not turn out well, choose "Selected Tab" as the target, select that panel's tab, and press "Run".

> **Tip**
> If you create a script with "Auto" in Chapter 11, "Fetch from Auto" fills each panel tab automatically with the scene descriptions and acting directions from the script.

> **Tip**
> In "Workflow Settings" at the bottom of the window, specify workflow file names for I2I and T2I so that the workflow is loaded automatically for each generation. If not specified, the workflow currently open in Workflow Studio is used.

### Partial fixes in the Image tab

In the Image tab you can use Workflow Studio to redraw only part of an image with AI (Chapter 9).

| Feature | Where | Description |
| --- | --- | --- |
| I2I | Right panel of the Select tool | Regenerate from the whole image (All) or the selected layer (Layer). The result becomes a new layer |
| Inpaint | Mask tool | Redraw only the area painted white in the mask |
| Outpaint | Mask tool | Add margins on any side and draw beyond the image's edges |

Example: if Mike's hand looks wrong, paint around the hand with the Mask tool, choose "Inpaint", enter something like "cat paw holding a coffee cup", and press "Run".

### Other integrations

| Feature | Description |
| --- | --- |
| "workflow studio" tab | Shows the Workflow Studio gallery. "ws reload" reloads it; "Open ws in new tab" opens it in a separate tab |
| "wsI2I" in the Image tab | Sends the current image to Workflow Studio's I2I input. Press "Send CC" in the Workflow Studio gallery to bring the result back to the Image tab as a new layer |

### Using it alongside Ollama

If you write scripts with a local AI (Ollama) while also generating images, GPU memory (VRAM) can run short. In the "Settings" tab, "VRAM Management (Ollama)" can unload Ollama's models before image generation (Chapter 13).

## 10-6 Making a Whole Page in the MOSS-Image Tab

The "MOSS-Image" tab generates images on your own PC with MOSS-Image, an image model that ComfyUI itself supports. It needs no Comfy credits and no API key.

Its main feature is the "layout editor". You place boxes for "Object", "Character", and "Text" in the image to say what goes where. Because you can even fix where Japanese dialogue and sound effects go, you can generate a whole page (panel layout and dialogue) at once.

### What you need

- A ComfyUI that supports MOSS-Image (an older ComfyUI shows "ComfyUI is too old (please update)"; update ComfyUI)
- The model files placed in ComfyUI

| Kind | Where | Example file |
| --- | --- | --- |
| Diffusion model | `ComfyUI/models/diffusion_models/` | `moss_image_sft_int8_convrot.safetensors`, etc. |
| Text encoder | `ComfyUI/models/text_encoders/` | `qwen3.5_9b_w4a8_gptq.safetensors` |
| VAE | `ComfyUI/models/vae/` | `flux2-vae.safetensors` |
| LoRA (optional) | `ComfyUI/models/loras/` | DMD 8-step for fast generation, etc. |

A status line at the top of the tab shows one of "MOSS-Image: ready", "model not found", "ComfyUI is too old (please update)", or "cannot reach ComfyUI". After adding models, press "Reload model lists".

> **Tip**
> Check the model's distribution page for file names and where to get them; this book does not cover that. English and Chinese are MOSS-Image's officially supported languages; Japanese is outside official support, so the text in a box may not always come out accurately. Check the result after generating.

### The screen

- **Left**: the layout editor, where you draw boxes to place objects, characters, and text.
- **Middle**: three tabs, "Prompt", "JSON", and "Model / Sampler".
- **Right**: the generate button, the seed, the results, and the buttons that place an image in the page.

### Your first image: generate a whole page

1. In the "Layout" tab, open a page that already has its dialogue.
2. Open the "MOSS-Image" tab. In "Target" on the middle "Prompt" tab, set Mode to "Whole page".
3. Press "Import panels from current page" on the left. The page's panels come in as "Object" boxes, and the canvas changes to the page's aspect ratio (about 2MP).
4. Press "Import balloons and lines". Balloons with dialogue come in as "Text" boxes.
5. In "Prompt", describe the whole image (English is recommended).
6. Press "Generate Images" on the right.
7. When the result appears, press "Place selected image over the whole page". The image goes into the full-page overlay.

> **Tip**
> For speed, choose "Fast DMD 8-step" as the preset in the "Model / Sampler" tab (a LoRA is required). The standard preset uses 50 steps and takes longer.

### Generation modes

- **Whole page**: generates the whole canvas as one image and places it over the page (the layout specifies every panel and text).
- **Per panel**: generates for each chosen panel at that panel's aspect ratio and places it in that panel. You can enter content for each panel (English recommended).
- **Free size**: generates only, without placing.

### Using the layout editor

Choose what to draw under "Draw as": Object (green), Character (pink), Text (light blue), or Panel (yellow), then drag on the canvas to draw a box.

- **Drag on an empty spot**: draw a new box of the chosen kind.
- **Drag a box's edge, number, or the inside of the selected box**: move it.
- **Drag a box's corner**: resize it.
- **Drag inside an unselected box**: draw a new box on top of it (so you can put a dialogue box over a panel).
- **Click inside an unselected box**: select it.
- **Shift + drag**: always draw a new box.
- **Delete key**: delete the selected box.

"Bring forward" and "Send backward" change the stacking order, and "Clear All" removes every box. When you select a box, "Selected item" appears in the middle where you can edit its type, caption (English recommended), and more.

### Text boxes

- Right after you draw a "Text" box, you can type directly into it. Finish with Esc, Ctrl+Enter, or a click outside (Enter adds a line break).
- Press a text box twice quickly to edit it again.
- You can set the font size (px on the image). The box fits the typed text (an approximation).
- The "Horizontal / Vertical" toggle next to "Text" sets the writing direction of boxes you draw next. To change it after drawing, use "Writing" in "Selected item".

> **Tip**
> MOSS-Image has no setting for vertical writing, so for a vertical box an English instruction is added automatically to the end of its caption. You can check it in the JSON tab.

> **Caution**
> A "Text" box with no text is not sent when you generate (sending it can make a lined-paper-like patch appear in that spot). It is shown faintly with a dashed outline.

### Importing from the page

- **Import panels from current page**: brings in the open page's panel frames. If "Import panels with the panel label" is checked they become "Panel" (yellow); otherwise "Object".
- **Import balloons and lines**: brings in balloons with dialogue as "Text" boxes sized to the balloon outline, keeping the balloon shape (normal, thought, shout, etc.), vertical writing, and font size.
- **Also import text without a balloon** (on by default): also turns text placed with the Text tool, outside any balloon, into "Text" boxes.

Notes on importing:

- Imported boxes are arranged in reading order (top to bottom; within a row, right to left).
- Importing again replaces only the boxes imported before; boxes you added yourself stay.
- If the canvas aspect ratio differs from the page, you are asked whether to fit the canvas and scale existing boxes too.
- Editing the text of an imported box does not shrink the box ("Fit the box to the text size" is off).
- Rotated text is imported as the outer rectangle of the rotated shape, because MOSS-Image boxes cannot express rotation.
- Whether text is a sound effect or narration is a simple guess from its length (6 characters or fewer: sound effect; otherwise: narration).

### Seed behavior

- **Random** (default): a different seed every time. The value in the box is not used.
- **Fixed**: uses the value in the box, so the same settings give a similar result.
- **Increment per run**: starts from the value in the box and goes up by one each time you generate.

The seed actually used under Random is shown as "Last seed". If you like a result, press "Fix this seed" beside it to switch to Fixed.

### Other settings

- The middle "JSON" tab shows what is actually sent (the layout JSON). Check "Edit the JSON directly and send it" to send hand-written JSON as it is (the layout is ignored).
- The "Model / Sampler" tab has presets (Standard, Light, Fast DMD 8-step, Fast Turbo 4-step) and the model, LoRA, steps, CFG, and so on.
- Generated images are saved in ComfyUI's `output/cc_moss/`.
- Settings and the layout are saved in the browser and come back when you reopen the tab.
- "VRAM Management (Ollama)" in the Settings tab (Chapter 13) also works before MOSS-Image generation.

> **Chapter summary**
> - Nanobanana generates with Google's Gemini API. Write `NANOBANANA_API_KEY` in `.env` and restart ComfyUI
> - When Nanobanana makes two or more images, "Insert into Panel" inserts the one you chose from the thumbnails. All images are also kept in `output/cc_nanobanana`
> - Adding reference images in "I2I Input" helps keep a character's look consistent
> - With Workflow Studio, "Generate" in the Layout tab can generate panel by panel. The original image remains underneath
> - Inpaint and Outpaint in the Image tab fix parts or extend the image
> - "Nanobanana" in the Settings tab switches between the Gemini API and the native node (`COMFY_API_KEY`)
> - The MOSS-Image tab generates a whole page on your own PC, with boxes that say where objects, characters, and text go. Panels and dialogue can be imported from the page
