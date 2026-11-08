# Chapter 12 Advanced Features Overview

This chapter introduces features that work together with other custom nodes and external software. The flow is explained using examples for finishing the sample work "Morning at the Cat Café".

| Feature | What you need | Use in the sample |
| --- | --- | --- |
| 3D Pose | comfyui-vrm-pose-editor and a 3D model such as VRM | Pose the customer and use it as a sketch for drawing |
| 3D Text | comfyui-vrm-pose-editor | Make the title on page 1 three-dimensional |
| PixiJS FX | comfyUI-particle-pixijs | Add steam over the coffee or sparkles |
| Video tool (experimental) | None (Workflow Studio if sending from it) | Cut one frame out of a video |
| Eagle integration | The image manager Eagle | Organize and save your images in Eagle |
| G'MIC integration | The image processor G'MIC (G'MIC Qt) | Apply G'MIC filters to images |

> **Caution**
> This chapter does not go deep into how to use each custom node or program. See their own manuals for details.

## 12-1 3D Pose and 3D Text

### 3D Pose: posing a model and putting it in a panel

Place a 3D model in VRM, GLB, or GLTF format in a panel, pose it, and put it into the panel as an image. Useful for character sketches and composition.

1. Click the panel where you want the pose.
2. Press "3D Pose" in the tool pane, then "Place in Panel". A 3D view with a red frame appears over the panel.
3. If no model is shown, press "Load Model" to load a .vrm / .glb / .gltf file from your PC.
4. Adjust the pose and camera.
5. Press "Commit to Panel" to put the current view into the panel as an image.

| Operation | How |
| --- | --- |
| Rotate / pan / zoom the camera | Left drag / right drag / wheel |
| Rotate joints | Drag a blue sphere (left-right = Y axis, up-down = X axis, Alt + up-down = Z axis) |
| Mirror the pose | "↔ Mirror" |
| Save / load poses | "Save Pose" (downloads JSON) / "Load Pose" |
| Detailed editing | "🎛 Editor": pose library, lights, expressions, keyframes, and more |

> **Tip**
> Put 3D models in the `model/` folder of comfyui-vrm-pose-editor to have them loaded automatically the first time you open "Place in Panel".

> **Tip**
> In the sample, create the pose of the customer opening the door on page 2, commit it, and use the image as a sketch. You can draw lines over it in the Image tab, or turn it into a manga-style picture with Chapter 10's "Generate" (I2I).

### Building it in detail with VRM Pose Studio

If the ComfyUI custom node "ComfyUI-VRM-Pose-Studio" (VRM Pose Studio, VPS below) is installed, you can switch "🎛 Editor" to open VPS. VPS is a 3D studio that handles several models, cameras, and a timeline. Only "🎛 Editor" changes; "Place in Panel", "Commit to Panel", and the rest work as before. In VPS, Comic Creator is shown as "CC".

1. In the Settings tab, set "3D Pose Editor" to "VRM Pose Studio (new tab)" (Chapter 13).
2. Select the panel and press "🎛 Editor" in "3D Pose". VPS opens in a new tab (Shift + click opens a separate window).
3. The shape of the selected panel appears in VPS as a red dashed frame with the panel name. The output size is locked to the panel.
4. Set the pose and camera inside the frame and press "📤 Send to CC panel". The view is inserted into the panel (clipped to the panel shape).

| Situation | What happens |
| --- | --- |
| You want another panel while VPS stays open | Select another panel in CC and press "🎛 Editor"; only the frame changes, without reopening VPS |
| You opened another page in CC before sending | The target is the panel selected when "🎛 Editor" was pressed, so nothing is inserted (go back to that page, or select a panel again) |
| Background and ground | When opened from CC, VPS starts with a transparent background and the ground hidden |
| You want to drop the panel size | "Release" at the top of VPS returns to the output size of the VPS project (the panel size is not saved in the project) |

### 3D Text: three-dimensional lettering

Turn text (including Japanese) or SVG shapes into an extruded 3D image and put it into a panel.

1. Select the panel (or overlay) for the text.
2. Press "3D Text" in the tool pane, then "Place in Panel". At first, the word "text" is shown in 3D.
3. Press "⚙ 3D Settings", type your text in the "Text" panel on the right, and adjust the font, colors, lights, and so on.
4. Adjust the 3D look with "Depth:" and "Bevel".
5. Press "Commit to Panel".

| Item | Description |
| --- | --- |
| Text / SVG | Make text 3D, or make the shapes in an SVG file 3D |
| Depth: | Extrusion thickness |
| Bevel | Cut the edges at an angle for highlights |
| ⚙ 3D Settings | Text, font, alignment, line spacing; material (color, finish, front and side colors); lights; camera |

Double-click a committed image (or press "Re-edit") to rebuild it with the same settings.

> **Tip**
> In the sample, add the title "Morning at the Cat Café" in 3D Text on the overlay of page 1 to make it look like a cover page.

## 12-2 PixiJS FX: Particles and Filters

With comfyUI-particle-pixijs installed, you can composite particle and filter effects onto images.

| Where to open | Result |
| --- | --- |
| Layout tab "Image" sub-tab > "✨ PixiJS FX" | Committing with a transparent background adds a new particles-only image. Committing with the background shown replaces the selected image with the result |
| Image tab action bar > "✨ PixiJS FX" | The selected layer's content is replaced with the result |

1. Select the image and press "✨ PixiJS FX".
2. Click an empty spot in the preview to place an emitter.
3. Adjust shape, size, spread, wind, and so on, and check the motion with "▶ Play".
4. Press "■ Stop & Capture" to commit that moment as a still image.

From "🎬 Filter Library" you can stack filters such as color adjustment, blur, glitch, and emboss. Combinations can be saved as presets.

> **Tip**
> In the sample, place an emitter above the coffee cup in panel 2 to add steam-like particles.

## 12-3 Video Tool (Experimental)

Place an MP4 video in a panel, play it, and cut out any frame as a still image.

1. Drag and drop an MP4 file onto a panel. The first frame appears in the panel, and it is shown with 🎬 in the layer panel.
2. Select the video in the layer panel and press "Video" in the tool pane.
3. Use ▶ play, ■ stop, and the seek bar to find the scene you want.
4. Press "Capture Frame as Still Image" to add that scene as an image in the same panel.

To move or resize the video, press "✥" (move mode), just left of the play button (▶). While it is on, the video preview is paused and you can drag, resize, and rotate the video like an ordinary image. Turn it off to bring the playback preview back at the new position.

You can also send a video by selecting it in the Workflow Studio gallery and pressing "Send CC".

> **Caution**
> The video tool is experimental and supports MP4 only (animated GIFs cannot be used). Video files are stored on the ComfyUI side and remain until deleted.

## 12-4 External Software: Eagle and G'MIC

### Eagle: organizing and saving images

You can save your images to the image manager "Eagle".

1. Start Eagle.
2. In the "Settings" tab, check the Eagle API URL in "Eagle Settings" (default `http://localhost:41595`).
3. Press "Eagle" in the Image tab's action bar to save to Eagle with a file name.

"Eagle Settings" can also save images generated with Nanobanana and results processed with G'MIC to Eagle automatically.

> **Point**
> "Auto-save ComfyUI generated images" in "Eagle Settings" is grayed out and cannot be chosen here. To save images made through Workflow Studio (Generate, I2I, and so on) to Eagle automatically, check "Auto-save generated images to Eagle" in Workflow Studio's Settings tab > "Eagle".

### G'MIC: using many filters

Open the screen of the image processor "G'MIC" (G'MIC Qt) and apply its many filters to images.

1. Install G'MIC Qt on your PC.
2. In the "Settings" tab, enter the full path (including folders) of the G'MIC Qt executable (`gmic_qt.exe`) in "G'MIC Settings" and save. No ComfyUI restart is needed.
3. In the Layout tab, select an image and press "Edit in G'MIC GUI" in the "Image" sub-tab. In the Image tab, use the Filter (★) tool.
4. Choose and apply a filter in G'MIC, then close it.
5. In the Layout tab, press "Insert Result" to add the result to the panel as a new image (the original remains).

> **Caution**
> If G'MIC Qt is not found at the specified location, a red warning appears in "G'MIC Settings".

> **Chapter summary**
> - 3D Pose and 3D Text need comfyui-vrm-pose-editor. "Place in Panel" → adjust → "Commit to Panel"
> - PixiJS FX needs comfyUI-particle-pixijs. Place emitters, play, and commit with "Stop & Capture"
> - The video tool places an MP4 in a panel; "Capture Frame as Still Image" cuts out one frame
> - Set up the connections for Eagle and G'MIC in the "Settings" tab before use
