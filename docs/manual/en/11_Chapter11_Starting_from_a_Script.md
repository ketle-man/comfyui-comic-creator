# Chapter 11 Starting from a Script: Script Tab and Auto

In this chapter you create the script for the sample work "Morning at the Cat Café" and pour the dialogue and balloons into the pages.

## 11-1 Two Methods

| | Script tab | Auto tab |
| --- | --- | --- |
| Who writes the script | You | AI (you then revise it) |
| AI | Not required | A local LLM (Ollama, etc.) or Gemini is required. "Sample" can be tried without AI |
| Panel layout | Poured into a page where you already inserted a template in the Layout tab | Generated automatically from the script |
| Result | Balloons and dialogue are added to pages of an existing work | A new work with panel layouts and balloons is created |

To add dialogue to the work from Chapter 10, use the Script tab (11-2, 11-3). To build everything from a script, use Auto (11-4 to 11-6).

## 11-2 Writing a Script in the Script Tab

### Creating a work

1. Open the "Script" tab.
2. Press "New Work".
3. Enter `Morning at the Cat Café` as the title and choose "Manga" as the "Media type:".

> **Caution**
> The media type cannot be changed after creation. "Manga" and "Semi-Auto Manga" use the same screen; only their saved data is kept separately. "Novel" and "Screenplay" are still in development in v1.53.2, and their plot screens cannot be used.

> **Tip**
> If you click a work name under "Page Works" in the asset panel's "S" tab and then press "New Work", that name is used as the title.

### Registering characters (Elements)

Register characters and proper nouns in the "Elements" sub-tab so you can pick them in the plot.

1. Open the "Elements" sub-tab and press "+ Add Element".
2. Enter `Mike` as the element and something like `Calico cat waitress. Reliable, but bad at mornings` in "Details".
3. Register `Customer` in the same way.

You can write a synopsis of the whole work in the field on the right.

### Writing the plot

In the "Plot" sub-tab, write the script page by page and panel by panel.

[Image: The Script tab plot (Scene, Panel #, Image Prompt, Line #, Elements, Dialogue / Description, Balloon Shape)]

| Column | What to write |
| --- | --- |
| Scene | What happens on that page (spans all rows of the page) |
| Panel # | The panel number |
| Image Prompt | A description of the panel's picture (used for image generation) |
| Line # | The number of the line within the panel |
| Elements | The speaker. Choose from registered elements (free input is also allowed) |
| Dialogue / Description | Dialogue or a description of the situation |
| Balloon Shape | Default, Normal (Ellipse), Rounded Rect, Thought (Bubbles), Burst, Cloud (puffy), Cloud (wavy) |

For example, page 1 of the sample could look like this:

| Panel | Elements | Dialogue | Balloon Shape |
| --- | --- | --- | --- |
| 1 | (narration) | 30 minutes before opening | Rounded Rect |
| 2 | Mike | Yawn... let's do our best today, meow | Normal (Ellipse) |
| 3 | Mike | What!? A customer already!? | Burst |

| Operation | How |
| --- | --- |
| Move between pages | ◀ ▶ |
| Add / delete pages | "+ Add Page" / "Delete Page" |
| Change the number of panels | ▲ ▼ next to "Panels:" (4 panels at first) |
| Match the panel count to the layout | "Get from Layout". Matches the panel count of the page shown in the Layout tab |
| Add / remove dialogue lines | Click a row to select it, then "+" / "−" for dialogue |

> **Tip**
> Press the "L" button next to "Image Prompt" to have the AI set up in Workflow Studio (Ollama, etc.) suggest an image prompt from the scene and dialogue.

### Saving

Enter the title and press "Save". To open a saved work, choose it under "Saved Works" in the asset panel's "S" tab and press "Load".

The "Preview (H)" and "Preview (V)" sub-tabs show the script of all pages as easy-to-read text.

> **Caution**
> Script works are saved inside the browser. They are included in backups (Chapter 13).

## 11-3 Pouring the Script into Pages

Automatically add balloons and dialogue from the Script tab to a page in the Layout tab.

1. In the "Layout" tab, show page 1 of "Morning at the Cat Café" (with a template already inserted).
2. Go back to the "Script" tab and show page 1 of the plot.
3. Press "Get from Layout" to match the panel count to the layout page.
4. Press "Map this page to the layout". The panel-by-panel mapping is listed.
5. Press "Auto-generate balloons". Balloons are created for each line in the panels that have dialogue, and the screen switches to the Layout tab.

[Image: A page with auto-generated balloons]

Balloon shapes follow the "Balloon Shape" column; rows left at "Default" become Rounded Rect. Balloon and text sizes are decided automatically according to the amount of dialogue. Then adjust positions and shapes as in Chapter 7.

> **Caution**
> Panels are matched only by panel-number order. If the script and the page have different panel counts, a warning appears and only the smaller number of panels are matched. Use "Get from Layout" first to match them.

### Generating images in bulk

The Script tab also has buttons to generate images in bulk from each panel's "Image Prompt".

| Button | Uses |
| --- | --- |
| Batch-generate images (T2I) | Workflow Studio (from text) |
| Batch-generate images (I2I) | Workflow Studio (regenerating from the current image) |
| Batch-generate images (Nanobanana) | Nanobanana (Chapter 10) |

> **Caution**
> Features that use Workflow Studio use the Workflow Studio embedded in Comic Creator's "workflow studio" tab. Switching workflows in Workflow Studio opened in a separate browser tab is not reflected.

## 11-4 Preparing Auto

In the "Auto" tab, AI creates a story and script from a theme, and even the panel layout automatically.

### Setting the AI engine

1. Open the "Auto" tab and choose the "Settings" tab in the right pane.
2. Under "AI ENGINE", choose "Local LLM" or "Gemini".
3. Set the required items and press "Save Settings".

| AI engine | What to set |
| --- | --- |
| Local LLM | BACKEND (Ollama / LM Studio / Lemonade / Unsloth), URL, MODEL. Check with "Test Connection" |
| Gemini | Gemini model. The API key is shared with Nanobanana (`NANOBANANA_API_KEY` in `.env`) |

> **Caution**
> Match the local LLM URL to the address you use to open Comic Creator. If you open it at `127.0.0.1`, use something like `http://127.0.0.1:11434` (for Ollama). Mixing it with `localhost` can make the browser block the connection, resulting in "Failed to fetch".

> **Caution**
> Gemini charges according to usage.

> **Tip**
> Even without AI, you can try the whole Auto flow with "Sample" in 11-5.

## 11-5 Creating a Story and Script with Auto

### Creating the story

1. In the "Story & Script" sub-tab, press "Enter a theme / prompt".
2. Enter a theme and the number of pages, then press "Create".

   ```
   Theme: a heartwarming comedy where Mike, a calico cat waitress, is preparing a cat café before opening when a customer arrives too early
   Pages: 2
   ```

3. The title, characters, synopsis, and page breakdown appear in the "Story" tab in the center. You can edit it directly.

> **Tip**
> Without AI, press "Sample" in the theme window. A prepared theme (a Shiba Inu astronaut story) loads a story and a two-page script immediately.

> **Tip**
> The AI is instructed to write the story and script in the display language chosen in the "Settings" tab.

### Creating the script

1. In the "Script" tab in the center, press "Create script from story".
2. A script is created in the form page → panel → dialogue.

[Image: The Auto Script tab]

| Panel item | Description |
| --- | --- |
| Importance | High, medium, low. Used by Auto Layout to decide panel size |
| Scene description / acting directions | A description of the panel's picture (a guide for sketching; also usable as an image prompt) |
| Dialogue | Speaker, text, and balloon type |

Pages, panels, and dialogue can also be added or deleted.

> **Tip**
> Even if the AI output is broken, the script is recovered as far as it can be read. If it does not work, open "Raw LLM output" to check the content and create it again.

### Consulting the Chat

In the "Chat" tab of the right pane, you can ask the AI about the story and script.

| Feature | Description |
| --- | --- |
| Include the current story and script as context | When on, the AI answers based on what you are editing |
| Tool | Script from story / polish dialogue / tidy up the story / create character profiles |
| Buttons below a reply | "Apply to story", "Apply to script", "To image prompt", "Copy" |
| Undo apply | Return to the state before applying (up to 10 times) |

Example: send "Make Mike's lines sound more cat-like" and press "Apply to script" on the reply.

### Saving

Give the work a name in the work bar at the top and press "Save". Your work is also saved automatically as you go.

## 11-6 Turning It into Pages with Auto Layout

In the "Auto Layout" sub-tab, create panel layouts from the script and send them to the Layout tab.

[Image: Auto Layout (settings on the left, preview in the center, properties on the right)]

### Creating the panel layout

1. Open the "Auto Layout" sub-tab.
2. In the "Page" tab on the left, set size, style, reading order, and margins.
3. Press "Generate (all pages)". Panel layouts are created for all pages of the script.

| Item | Description |
| --- | --- |
| Style | Balanced / Asymmetric / Diagonal seams / Single column / Single row |
| Reading order | Right to left (Japanese manga) / Left to right |
| Panel gap, Outer margin | Gaps between panels and the margin around the page |

Panel sizes are decided by the script's "Importance". Asymmetric and Diagonal seams change each time you press the button, so press again until you like the result.

> **Tip**
> To use your own template, press "Send to Auto Layout" in the Page tab's Templates, then click it in the "Template" tab on the left to assign it to the page.

### Adjusting by hand

| Operation | How |
| --- | --- |
| Split a panel | Click a panel with the "Split (V)" / "Split (H)" tools in the center |
| Edit dialogue | Select a panel, choose a line in the properties on the right, and press "Edit"; "Add" adds a line |
| Add an image | Enter a description in the properties on the right and press "Generate & assign" |

In "Details" on the left, set the default font, default size, and panel border width for balloon text (the Font tab's "Set as default font" also changes it).

### Sending to the Layout tab

Press "Detailed edit (transfer to Layout tab)".

- A new work named "Auto work name + date and time" is created containing all pages
- Panel layouts, balloons, dialogue, and assigned images become pages
- Balloons are placed in front of images
- The screen switches to the Layout tab automatically

Then finish by adding pictures and adjusting balloons as in Chapters 6 and 7. With "Fetch from Auto" in Chapter 10's "Generate", you can use each panel's scene description and acting directions from the script as image prompts.

> **Tip**
> If you enable the "decision model" in the "Settings" tab, AI estimates balloon shapes (normal, thought, shout, narration) from dialogue and the importance of panels. The decision model's connection uses Workflow Studio's settings.

> **Chapter summary**
> - Write it yourself in the Script tab, or let AI create it with Auto
> - In the Script tab: "Get from Layout" → "Map this page to the layout" → "Auto-generate balloons"
> - Choose the AI in Auto's "Settings". Even without AI, try the flow with "Sample"
> - Auto goes story → script → Auto Layout → "Detailed edit (transfer to Layout tab)". Transferring creates a new work
