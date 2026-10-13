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

## 10-4 Making Backgrounds and Characters with Nanobanana

### Making a background

[Image: The Nanobanana tab (Generation sub-tab)]

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

[Image: The Generate window (Target, prompt tabs, T2I, Run)]

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

> **Chapter summary**
> - Nanobanana generates with Google's Gemini API. Write `NANOBANANA_API_KEY` in `.env` and restart ComfyUI
> - When Nanobanana makes two or more images, "Insert into Panel" inserts the one you chose from the thumbnails. All images are also kept in `output/cc_nanobanana`
> - Adding reference images in "I2I Input" helps keep a character's look consistent
> - With Workflow Studio, "Generate" in the Layout tab can generate panel by panel. The original image remains underneath
> - Inpaint and Outpaint in the Image tab fix parts or extend the image
