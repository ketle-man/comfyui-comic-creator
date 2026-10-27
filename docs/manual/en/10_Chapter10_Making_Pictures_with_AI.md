# Chapter 10 Making Pictures with AI: Nanobanana+, Workflow Studio, MOSS-Image, and OCR

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
> The "Nanobanana+" tab also has a "Local" mode. It lets you use workflows saved in Workflow Studio (Flux.3 Image Klein, Qwen Image 2.1, and so on) on the same screen as Nanobanana (10-7).

> **Tip**
> There is also the "MOSS-Image" tab, which uses an image model that ComfyUI itself supports (10-6). It also runs on your own PC, and lets you specify where objects, characters, and dialogue go so you can generate a whole page at once.

## 10-3 Preparing Nanobanana

Nanobanana creates images with Google's Gemini API. It requires an API key. The tab is named "Nanobanana+" (it can also use local workflows; see 10-7). In this book, generating with the Gemini API is called "Nanobanana" mode.

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

Open the "Nanobanana+" tab and choose "Nanobanana" at the top. If there is no message saying the API key is not set, you are ready.

> **Caution**
> An API key is private information. Do not share the `.env` file with others or publish it on the internet.

> **Caution**
> `.env` is read when ComfyUI starts. Always restart ComfyUI after adding or changing the key.

### Switching the engine: ComfyUI native node

Besides generating with your own Gemini API key, Nanobanana can use ComfyUI's own Nano Banana node. Switch with "Engine" under "Nanobanana" in the "Settings" tab.

- **Gemini API (your own API key)** (default): generates directly with Google's Gemini API. History is recorded in `history.jsonl`. Needs `NANOBANANA_API_KEY` in `.env`.
- **ComfyUI native node (Comfy credits)**: generates with ComfyUI's own Nano Banana node and uses Comfy credits. Needs `COMFY_API_KEY` in `.env` (issued at platform.comfy.org).

This setting applies to the Nanobanana+ tab, to Semi-Auto Manga in the Script tab, and to the Auto tab (when its image engine is Gemini). The same selector also appears in the Nanobanana+ tab's basic settings and stays in sync with the Settings tab.

- **History**: with the native node, the generation settings are embedded in the output PNG, so automatic history recording and the "Record in History" button do not appear.
- **Save location**: images from the Nanobanana+ tab are saved to `ComfyUI/output/cc_nanobanana_native/`.
- **Unsupported**: Nano Banana Pro (gemini-3-pro-image) is not supported, and Nano Banana 2 Lite is 1K only.

> **Caution**
> `COMFY_API_KEY` also takes effect only after you write it in `.env` and restart ComfyUI. Without it, the connection status reads "COMFY_API_KEY not set".

## 10-4 Making Backgrounds and Characters with Nanobanana

### Making a background

The screen is split in two: prompts and basic settings on the left, reference images (Image-to-Image) on the right. Below the tab name there is a "Nanobanana / Local" switch, and the sub-tabs are "Generation" and "Nanobanana History".

1. Open the "Nanobanana+" tab and choose "Nanobanana" at the top.
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
2. Return to the "Nanobanana+" tab and press "Insert into Panel" below the result.

> **Caution**
> If "Batch size:" is 2 or more, thumbnails appear below the result. Click a thumbnail to show that image in the preview; it is the one inserted by "Insert into Panel" (the first image is selected at first). All generated images are also kept in the save folder below.

Generated images are saved automatically in this ComfyUI folder:

```
ComfyUI/output/cc_nanobanana/
```

### Keeping a character consistent with reference images (I2I)

In manga, the same character must appear in many panels. Adding reference images in "Image-to-Image" on the right lets you generate while showing them, which helps keep a character's look consistent.

1. First, make one full-body picture of Mike.
   ```
   calico cat girl character, cafe waitress apron, full body, white background, manga style
   ```
2. In "Image-to-Image" on the right, press "Add Images" to add the picture of Mike (up to 14 images; you can also drag and drop images from your PC here).
3. Describe the scene in the Positive Prompt on the left and generate.
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
| "wsI2I" in the Image tab | Sends the current image to Workflow Studio's I2I input. Press "Send CC (Image)" in the Workflow Studio gallery to bring the result back to the Image tab (as a new layer if you are working on layers, otherwise as a new canvas). Needs Workflow Studio v0.8.11 or later |

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
7. When the result appears, press "Layout overlay". The image goes into the full-page overlay. To fix details, send it to the Image tab with "Open in Image tab".

> **Tip**
> To keep text from being drawn in the image, check "Generate with text disabled" under "Generate Images". It leaves the layout's text boxes in place and just does not send them when generating. Words such as "cover", "magazine", or "typography" in the overall prompt make text more likely to be drawn.

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
- **Shift + click a box (without dragging)**: add it to (or remove it from) the selection. Selected boxes can be moved together.
- **Drag inside an unselected box**: draw a new box on top of it (so you can put a dialogue box over a panel).
- **Click inside an unselected box**: select it.
- **Shift + drag**: always draw a new box.
- **Delete key**: delete the selected box.

"Bring to front", "Bring forward", "Send backward", and "Send to back" change the stacking order (the first and last jump straight to the top or bottom). "New", to the left of "Draw as", removes every box and starts a blank layout. When you select a box, "Selected item" appears in the middle where you can edit its type, caption (English recommended), and more.

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
- "Clear Imported" removes only the imported panel, balloon, and dialogue boxes; boxes you drew yourself stay. Panel boxes imported by an older version are not removed; use "New" in that case.
- If the canvas aspect ratio differs from the page, you are asked whether to fit the canvas and scale existing boxes too.
- Editing the text of an imported box does not shrink the box ("Fit the box to the text size" is off).
- Rotated text is imported as the outer rectangle of the rotated shape, because MOSS-Image boxes cannot express rotation.
- The caption of text outside any balloon is always "narration". It used to be a sound effect for 6 characters or fewer, which mislabeled names and the like, so that guess was removed. To have something drawn as a sound effect, add that in English to the caption in "Selected item".

### Seed behavior

- **Random** (default): a different seed every time. The value in the box is not used.
- **Fixed**: uses the value in the box, so the same settings give a similar result.
- **Increment per run**: starts from the value in the box and goes up by one each time you generate.

The seed actually used under Random is shown as "Last seed". If you like a result, press "Fix this seed" beside it to switch to Fixed.

### Other settings

- Check "Enhance the prompt" to have the ComfyUI text encoder (LLM) rewrite a short idea into a detailed English description before generating. It suits trying a short phrase. It does not work in "Whole page" mode with layout boxes (it would break the box specification), and the rewritten text is not shown on screen.
- The middle "JSON" tab shows what is actually sent (the layout JSON). Check "Edit the JSON directly and send it" to send hand-written JSON as it is (the layout is ignored).
- The "Model / Sampler" tab has presets (Standard, Light, Fast DMD 8-step, Fast Turbo 4-step) and the model, LoRA, steps, CFG, and so on.
- Generated images are saved in ComfyUI's `output/cc_moss/`.
- Settings and the layout are saved in the browser and come back when you reopen the tab.
- "VRAM Management (Ollama)" in the Settings tab (Chapter 13) also works before MOSS-Image generation.

## 10-7 Local Mode in Nanobanana+

Choose "Local" in the "Nanobanana / Local" switch at the top of the "Nanobanana+" tab to generate on your own PC's ComfyUI with a workflow you saved in Workflow Studio. You use the same screen as Nanobanana (prompt, reference images, results, "Insert into Panel"). No Gemini API key is needed.

> **Caution**
> Local mode needs Workflow Studio (a version that supports this feature) and a workflow that can generate images. This book does not cover how to build workflows or where to get models.

### Registering a workflow

1. Choose "Local" at the top of the "Nanobanana+" tab.
2. Press the "⚙" (gear button) that appears next to it.
3. Choose a label (for example, Flux.3 Klein) and a workflow saved in Workflow Studio, then press "Add". You can register several.
4. Press "Close" and choose the workflow you want in the dropdown.

You can register Image Edit workflows that have LoadImage nodes for the input images (for example, Flux.3 Image Klein or Qwen Image 2.1). What you register is stored in the browser.

### How to use it

1. Write the Positive Prompt on the left.
2. Put the reference (source) images in "Image-to-Image" on the right. In Local mode you can add **as many images as the workflow can use** (the limit is shown as "(count/limit)" next to the "Image-to-Image" heading).
3. Press "Generate Images". Results are saved to the same `ComfyUI/output/cc_nanobanana/` as Nanobanana and can be used with "Insert into Panel".

Reference images go into the workflow's image inputs in order, starting from the first.

- **Qwen Image 2.1 (up to 10 image inputs)**: up to 10 images. The inputs are added or removed automatically to match the number of images you add (you can also use a single image, for example to replace one picture).
- **Workflows with a fixed number of image inputs (such as Flux.3 Image Klein)**: up to that number. Extra images are not used and a warning appears.

> **Tip**
> Even if the registered workflow has only two image inputs (for example, a workflow labeled "Qwen2.1 (2 images)"), a Qwen Image 2.1 workflow also uses the third and later images.

### Basic settings and seed

- **Batch size**: the number of images per run. With several images, the seed goes up by 1 for each image.
- **Image size**: workflow default / preset / custom.
- **Steps, CFG, sampler, scheduler, Denoise**: left on "default" or blank, the workflow's own values are used.
- **Seed**: Random / Fixed / Increment per run (the same as the MOSS-Image tab). "Last seed" and "Fix this seed" let you reproduce a result you like.

> **Caution**
> Some workflows ignore the image size and similar settings. For example, Flux.3 Image Klein decides the output size from the input image. The prompt, images, Steps, CFG, and seed still take effect.

In "Nanobanana" mode you see the model, resolution, API key, history, and so on; in Local mode they are hidden (the seed appears only in Local mode).

## 10-8 Reading Text and Positions from an Image in the OCR Tab

The "OCR" tab reads the text in an image and lists it together with its position (a box). It works on magazine covers and posters as well as manga pages. You can send the result to the MOSS-Image tab as a layout, or insert it as text in the Layout tab or the Image tab.

Text and box detection use models running in Ollama (a local AI). No cloud API key is needed.

### What you need

- Ollama running (set its address in "URL" on the screen; the default is your own PC)
- A model that reads text. Install it like this (choose it in "OCR model:" on the screen).

  ```
  ollama pull maternion/LightOnOCR-3:4b
  ```

- A vision-capable model for "layout detection" (default: `gemma4:e4b`), used to find panels, characters, balloons, and so on.
- To read vertical and decorative text more accurately, a model for re-reading (optional; see "Re-read" below).

A status line at the top of the tab shows "OCR: ready", "OCR: no OCR model found", or "OCR: cannot reach Ollama". After installing a model, press "Reload models".

### The screen

- **Left**: the image to read and the detected boxes. Drop an image here (or paste with Ctrl+V).
- **Upper right**: "Mode" and the settings (models, re-read, judging, whole-image read, overall prompt, classes to detect).
- **Lower right**: "Run detection", the list of results, copy buttons, and sending to MOSS-Image.

### Your first read

1. Drop an image on the left (you can also use "Open image").
2. Choose a "Mode" on the right that fits the image (if unsure, "Auto (recommended)").
3. Press "Run detection". After a while boxes appear on the image and the text is listed under "Results" on the right.
4. To fix a wrong reading, edit the text in the list. You can drag a box to move it and drag its corners to resize it.

> **Caution**
> The first model you use takes a while to load, and switching models can run GPU memory (VRAM) short. If "VRAM Management (Ollama)" in the "Settings" tab (Chapter 13) is on, other Ollama models are unloaded before detection.

### Modes

Choosing a "Mode" switches the individual settings below all at once. If you change an individual setting by hand, the mode switches to "Custom" automatically.

- **Auto (recommended)**: for when you cannot decide. If the aspect ratio is extreme it uses the tall mode; otherwise an AI looks at the image and chooses. If it cannot decide, it uses "Manga page". Experimental.
- **Manga page**: a manga page with panels. Besides text it detects panels, characters, balloons, and so on, and also runs re-reading, type judging, and the overall prompt.
- **Magazine cover / poster**: dense text over a colored background. Text detection only; if it fails, it retries automatically in grayscale. Also runs the whole-image read and the overall prompt.
- **Text only (document / sign)**: images where text is the main content. Text detection only, the fastest setup. Also runs the whole-image read.
- **Illustration (no text)**: pictures or photos without text. It does not read text; it creates boxes for panels, characters, faces, and objects, and an overall prompt.
- **Tall page (read in tiles)**: very tall pages (webtoons and the like). It splits the page vertically, reads each part, and merges the results.
- **Custom**: uses the individual settings as they are.

### What is detected and the box kinds

Each box has a kind (class). You can change it later with the selector at the left of its row in the list.

- **text**: the text itself. Detected by the OCR model.
- **balloon / sfx / caption**: frames that hold text (balloon, sound effect, caption). Detected by layout detection (a separate AI).
- **panel / character / face / object**: panels, characters, faces, objects (picture frames). Detected by layout detection.

"Classes to detect" chooses what layout detection looks for (text is always detected by OCR).

### Settings that improve accuracy

- **Re-read text boxes from crops with another model**: crops each detected text box and reads it again with another model. Strong on vertical and decorative text; takes time per box. `ollama pull hf.co/LunarOilRig/PaddleOCR-VL-manga-GGUF:Q4_K_M` (manga-tuned PaddleOCR-VL) suits this.
- **Re-read selected**: re-reads only the selected box (a toolbar button).
- **Judge crops with a decision model after detection (optional)**: a vision-capable decision model judges the kind of each text box (balloon / caption / sfx / text) and drops boxes with no text. It takes time, so use it only when needed.
- **OCR preprocessing**: on dense images such as magazine covers, if OCR returns nothing or repeats the same words, it is retried once automatically in grayscale.
- **Whole-image read (Chat TE / ComfyUI)**: explained below.
- **Overall prompt**: describes the whole image in 2-3 English sentences. When ON, sending to MOSS-Image replaces its prompt with this text. You can edit it.

### Reading vertical text accurately with the whole-image read (Chat TE)

On images with many large vertical headlines, such as magazine covers, OCR models can miss text. "Whole-image read (Chat TE / ComfyUI)" helps here.

It uses the ComfyUI custom node "Chat TE" ([comfyui-chat-te](https://github.com/ketle-man/comfyui-chat-te)) to have an AI (Qwen3-VL) read all the text in the image at once. In a test on four magazine covers, the whole-image read picked up more vertical text than the OCR model. However, it returns **text only, without positions**. So its lines are matched to the OCR boxes and only the box text is replaced. Lines that match no box stay in this field.

1. Install Chat TE in ComfyUI (see Chat TE's own instructions).
2. In the "Whole-image read (Chat TE / ComfyUI)" section, check that "URL" holds your ComfyUI's address (the default is the ComfyUI you are using).
3. In "Model:", choose a Qwen3-VL-8B text encoder (or 4B if you have no 8B).
4. Check "Read the whole image with Chat TE and replace the box text" and press "Run detection". The model is loaded automatically if needed.

"Run whole-image read only" runs just the whole-image read on an image that is already loaded. The text it read appears in the field below (when there are no boxes, every line stays as it is).

> **Tip**
> In the "Magazine cover / poster" and "Text only" modes, this checkbox turns on automatically (it stays off if no Chat TE model is found).

> **Caution**
> The whole-image read loads a large model on the ComfyUI side. If Ollama models stay in GPU memory, loading can fail. It is safer to turn on "VRAM Management (Ollama)".

### Using the results

- **Copy all text**: copies the text in reading order (top to bottom, right to left).
- **Copy JSON**: copies each box's position, kind, and text as JSON.
- **Send to MOSS-Image tab**: puts the result into the MOSS-Image layout as object, panel, character, and text boxes (10-6). Boxes from a previous OCR import are replaced. "Merge text into balloon / sound effect / caption frames" chooses whether text inside a frame is combined into one.

Pressing "Insert" in the Layout tab's "Text" tool, or in the Image tab's text tool, opens the "Insert text" screen. Choose "OCR (text detected in the OCR tab)" as the source to insert the detected text as text at the positions of its boxes (Chapters 7 and 9).

> **Tip**
> The text and boxes are a temporary result for the current image. Finish what you need (send to MOSS-Image, copy, insert as text) before moving on to the next image.

> **Chapter summary**
> - Nanobanana ("Nanobanana" mode of the Nanobanana+ tab) generates with Google's Gemini API. Write `NANOBANANA_API_KEY` in `.env` and restart ComfyUI
> - When Nanobanana makes two or more images, "Insert into Panel" inserts the one you chose from the thumbnails. All images are also kept in `output/cc_nanobanana`
> - Adding reference images in "Image-to-Image" on the right helps keep a character's look consistent
> - With Workflow Studio, "Generate" in the Layout tab can generate panel by panel. The original image remains underneath
> - Inpaint and Outpaint in the Image tab fix parts or extend the image
> - "Nanobanana" in the Settings tab switches between the Gemini API and the native node (`COMFY_API_KEY`)
> - The MOSS-Image tab generates a whole page on your own PC, with boxes that say where objects, characters, and text go. Panels and dialogue can be imported from the page
> - In the layout, "New" removes every box and "Clear Imported" removes only imported ones. Stacking order can also be changed with "Bring to front" and "Send to back"
> - The "Local" mode of Nanobanana+ generates with Workflow Studio workflows. With Qwen Image 2.1, the inputs grow or shrink to match the number of images you add (up to 10)
> - The OCR tab reads the text and positions in an image with Ollama models. For covers with lots of vertical text, replacing box text with the "Whole-image read (Chat TE)" helps. Results can be sent to MOSS-Image or inserted as text
