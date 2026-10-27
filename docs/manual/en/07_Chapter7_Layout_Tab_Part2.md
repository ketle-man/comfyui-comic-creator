# Chapter 7 Layout Tab (Part 2): Balloons, Text, Drawing

This chapter explains how to add balloons and dialogue, text, shapes and painting, masks, and manga-style effects.

If you want to add text to a single image, reading 7-1 and 7-2 is enough to put a title or dialogue on an image placed on the page.

## 7-1 Balloons

Use "Balloon" in the tool pane to place and shape balloons. The basic way to place one was explained in Chapter 4, 4-5.

### Balloon types

You can choose from seven types under "Type:".

| Type | Good for |
| --- | --- |
| Normal (Ellipse) | Ordinary conversation |
| Rounded Rect | Calm conversation, explanations |
| Caption (square, no tail) | Narration, place and time captions |
| Thought (Bubbles) | Inner voice (the tail becomes small bubbles) |
| Burst | Shouting, surprise |
| Cloud (puffy) | Inner voice, soft lines |
| Cloud (wavy) | Anxiety, wavering feelings |

### Placing and adjusting

1. Click the panel where you want the balloon.
2. Choose a "Type:" and press "Insert". A balloon is placed in the center of the panel.
3. Resize it with the handles and drag to move it.

| Item | Description |
| --- | --- |
| Edit: ON / OFF | While ON, you can move and reshape balloons. It turns ON automatically when you insert one |
| Color: | Fill color inside the balloon |
| Border: | Color of the balloon's outline |
| Tail: Angle, Length, W | Direction, length, and base width of the tail |
| No tail | Check to remove the tail. Uncheck to restore the previous length |

With the eight round handles, only the side you grab stretches (the opposite side stays put).

Depending on the type, these extra settings appear:

| Type | Extra settings |
| --- | --- |
| Burst | Seed (spike arrangement), Spikes, Length, Variance, Inner curve (rounds the valleys between spikes) |
| Thought | Bubble size, Count, Offset (gap between the body and the bubbles) |
| Rounded Rect | Radius (corner roundness) |
| Cloud | Seed, Count, Bumpiness, Variance |

> **Tip**
> "Seed" for Burst and Cloud is a pattern number. Changing it changes only the shape while keeping the other settings. Try different numbers until you like the shape.

### Adding dialogue

Select a balloon and press "Embed Text" to open the "Embed Text" window (Chapter 4, 4-5).

| Item | Description |
| --- | --- |
| Text | The dialogue. Line breaks are allowed |
| Font size, Line height | Size of the characters and spacing between lines |
| Vertical | Check for vertical text |
| Text color | Black, White, Red, Blue |
| Bold | Check for bold |
| Vertical / horizontal alignment | Where the text sits inside the balloon |
| Font | Choose from three tabs: Google, System, Category |

Dialogue wraps automatically to fit the balloon. The balloon itself does not grow, so if text overflows, enlarge the balloon with its handles. Double-click a balloon to edit its dialogue.

### Moving the dialogue by dragging

When you select a balloon that has dialogue, a purple dotted box appears around the text, with a small triangle corner at its lower left.

- **Drag the triangle corner**: moves only the dialogue, leaving the balloon where it is (on a rotated balloon, it moves along the balloon's direction).
- **Double-click the triangle corner or the balloon**: opens the dialogue input screen, as before.

> **Caution**
> If you change the vertical alignment or text alignment in the input screen, the offset you dragged is reset and the alignment takes priority.

> **Tip**
> Burst and Cloud balloons have bumpy outlines, so the text area is a little inside the shape.

### Extension balloons: splitting long dialogue

You can split long dialogue across two or more connected balloons.

1. Select the original balloon.
2. Press "Add Extension". A balloon of the same shape and color is added, joined by a narrow neck.
3. Move the new balloon where you like and use "Embed Text" to add the rest of the dialogue.

| Behavior | Description |
| --- | --- |
| Moving the original | The extension moves with it |
| Moving the extension | Only the neck stretches |
| Outline | No line appears where they overlap; only the outer edge of the whole is drawn as one line |
| Deleting | Deleting only the extension keeps the original. Deleting the original deletes its extensions too |

### Turning a balloon into an image

"Convert to image" adds a PNG image of the selected balloon at the same position and size. The original balloon remains, so delete it if you do not need it.

## 7-2 Text

To place text without a balloon, use "Text" in the tool pane. Use it for titles, sound effects, handwritten-style lettering, and so on.

### Placing text

1. Press "Text" in the tool pane.
2. Choose the font, "Vertical" (whether to write vertically), and "Color:".
3. Press the "T" button to enter text-placing mode.
4. In the preview, click where you want the text. The "Text Input" window opens.
5. Type the text and press OK. Line breaks are allowed.

Double-click placed text to retype it.

### Changing size and shape

Click text to show a frame and handles around it.

| Operation | How |
| --- | --- |
| Move | Drag the text |
| Font size | Drag a green corner handle (the opposite corner stays fixed, and the size follows how far you pull from it) |
| Stretch tall or wide | Drag a blue handle at the middle of an edge |
| Slant | Hold Shift and drag a blue edge handle |
| Undo stretching and slanting | Press "Reset deform" |
| Vertical ⇔ horizontal | Select the text and toggle the "Vertical" checkbox |

### Choosing fonts

| Tab | Contents |
| --- | --- |
| Google | Google Fonts (the same list as the Font tab) |
| System | Fonts installed on your PC |
| Category | Fonts you sorted in the Font tab (Chapter 8) |

If a font does not appear in the list, press "Reload".

### Style: outlines, shadows, gradients

Press "Style" to open a window for detailed text appearance.

| Item | Description |
| --- | --- |
| Fill | Text color: solid, gradient, or texture (an image pattern). Uncheck for no fill |
| Stroke | The outline of the characters |
| Outline (bag text) | A thick border around the outside of the text (common for manga sound effects and titles) |
| Shadow | A shadow under the text |
| Bold, italic, underline | Text decoration |
| Line height, vertical position, alignment | How multiple lines are arranged |

Adjust while watching the preview. If text is selected, the change applies to it immediately. If not, the result is inserted as new text in the center of the selected panel.

> **Tip**
> Styles you make can be saved and are shared with the "Styles" list in the Font tab. Saved styles can be applied with one click from the asset panel's "F" tab (Chapter 8).

> **Tip**
> The thickness of strokes, outlines, and shadows is stored relative to the font size. Even if you enlarge the text later, the balance stays the same.

### Other buttons

| Button | Description |
| --- | --- |
| Text→PNG | Convert the selected text into a transparent PNG image |
| Insert | Opens the "Insert text" screen. Choose the source, "Script (cell selected in the plot)" or "OCR (text detected in the OCR tab)", to insert it as text (see the Tip below, 10-8, and Chapter 11) |

## 7-3 Drawing Shapes and Painting (Draw)

"Draw" in the tool pane has four modes at the top.

| Mode | What you can do |
| --- | --- |
| Draw | Draw shapes such as rectangles, ellipses, and lines (shape and color can be changed later) |
| Paint | Paint freely with a brush |
| SVG Colors | Change the colors of an SVG image inserted from assets |
| SVG→PNG | Convert an SVG image into a PNG image |

### Draw: drawing shapes

1. Click the panel where you want to draw.
2. In "Draw" mode, choose the shape.
3. Set "Draw:" to "ON" and drag inside the panel.

Set "Draw:" to "OFF" to select drawn shapes and move or reshape them.

| Shape | How to draw |
| --- | --- |
| Rect, Ellipse, Line | Drag. "Rounded" rounds the corners of a rectangle |
| Curve | Draws a free line that follows your drag |
| Polygon | Click to add corners, then click near the start point to close |
| Vector Curve | Click to add points joined by a smooth curve. Click near the start point to close, or press Enter to finish without closing |
| Chain, Rope | Draw a chain or rope pattern along the path you drag |
| My Curve | Place the image chosen with the image-select button repeatedly along the path you drag (a default image is already set) |

For Polygon and Vector Curve, press Esc to remove the last point.

| Item | Description |
| --- | --- |
| Fill: | Solid, Gradient, or Texture (an image pattern). "None" for no fill |
| Stroke: | Line color and width. "None" for no line |
| Opacity: | Transparency |
| Shape to PNG | Convert the selected shape into a PNG image added at the same position |

If a shape is selected, changing fill or stroke applies to it immediately. If not, the settings apply to the next shape you draw.

### Paint: drawing with a brush

1. Select the panel (or overlay, draft) where you want to paint.
2. In "Paint" mode, press "Add Paint". A transparent image the size of the panel is added for painting, ready to draw on.
3. Set "Brush color:", "Size:", and "Opacity:", then drag to paint.

| Item | Description |
| --- | --- |
| Background | Check and choose a color to add an image filled with that color instead of a transparent one |
| x5 | When on (orange), makes the brush five times thicker |
| Eraser | When on (red), erases what you painted |
| Merge Selected | Merge images and paint layers checked in the layer panel into one image |

With a pen tablet, thickness and opacity change with pen pressure. The brush can paint not only on paint images but also directly on normal images placed in panels.

> **Tip**
> Paint is also handy for making rough sketches or reference images for I2I (making images from images) with Workflow Studio. Some models treat transparent areas as black, so set "Background" to white to be safe (Chapter 10).

### SVG Colors and SVG→PNG

SVG images inserted from assets can be recolored or converted to PNG.

| Mode | How to use |
| --- | --- |
| SVG Colors | Select an SVG image, press "Extract Colors", choose a new color for each, then "Apply Changes" |
| SVG→PNG | Select an SVG image, enter the width and height (blank = original size), and press "Convert to PNG & Insert" |

## 7-4 Mask: Hiding or Showing Parts

A mask hides parts of an image or panel like an eraser. The original image is not erased, so you can fix it as many times as you like.

### Mask types

| Type | Behavior |
| --- | --- |
| Hide mask (painted areas are hidden) | Areas you paint become invisible |
| Show mask (only painted areas are shown) | Only the areas you paint are visible |

### Applying a mask

1. Select the image (or panel, overlay) to mask. It is shown in "Target:".
2. Press "Mask" in the tool pane and choose the mask type.
3. Set "Edit:" to "ON".
4. Set the brush "Size:" and "Hardness:", then drag over the areas to hide (or show).

| Item | Description |
| --- | --- |
| Brush: Paint / Erase | Paint = add to the mask, Erase = remove from the mask |
| Show hidden areas in red | Shows the hidden areas in translucent red |
| Apply mask | Uncheck to disable the mask temporarily (to compare) |
| Invert | Swap painted and unpainted areas |
| Clear | Remove all painting |
| Fill All | Paint everything |
| + Add Layer / Delete Layer | Stack several masks on one target |

> **Tip**
> To soften the edge of an image, lower "Hardness:" before painting for a gentler border.

## 7-5 Adding Manga Effects

Manga effects are in two places.

| Place | Button | What you can do |
| --- | --- | --- |
| "Image" in the tool pane | 🎨 Halftone | Turn an image into halftone dots, or make a dot pattern |
| "Manga" in the tool pane | ✨ Manga Effects | Vignette (darkened edges), screentone noise, speed lines |
| "Manga" in the tool pane | 🎴 Background Pattern | Stripes, dots, Japanese patterns, and other backgrounds |

Each button opens a window with a preview. Switch the preview background with "Selected image / Default / White" above it to check how the effect looks when layered.

### Halftone

| Mode | Description |
| --- | --- |
| Convert image | Replace the selected image with a halftone version. Adjust tone with Brightness, Contrast, Binarize, and Min darkness |
| Generate pattern | Create only a dot pattern the size of the selected panel (or overlay). Use it like applying a screentone sheet |

If you open it with only a panel selected (no image), it opens in "Generate pattern".

| Common item | Description |
| --- | --- |
| Color mode | Monochrome / Duotone (ink color and paper color) |
| Dot shape | Dot, Line, Square, Cross |
| Dot size, Angle, Coverage | Size, direction, and density of the dots |
| Invert | Swap dark and light |
| Darkness, Gradient | (Generate pattern) Overall darkness and fading dots |
| Transparent background | (Generate pattern) Make areas without dots transparent |

### Manga Effects: vignette, screentone noise, speed lines

Creates a transparent effect image the size of the selected panel (or overlay) and adds it with "Add to panel".

| Effect | Description |
| --- | --- |
| Vignette | Darkens the edges to draw the eye to the center. The color can be chosen |
| Screentone noise | Paper-like graininess. Adjust with "Grain size" |
| Speed lines | Choose Radial, Uni flash, Uni ring, or Linear (flow lines) |

Main speed-line settings:

| Item | Description |
| --- | --- |
| Density | Number of lines |
| Range/Length | Size of the empty center. Larger values let lines reach closer to the center |
| Outer thickness | Thickness at the base of the lines. Large values merge lines into solid black |
| Center X, Center Y | Position of the center (Radial, Uni) |
| Outer length | How far the spikes reach outward (Uni) |
| Angle | Direction of flow (Linear) |

> **Tip**
> Set the Uni flash color to white for a "flash" effect showing inspiration or surprise.

Added effects can be moved, made more transparent, or deleted in the layer panel like any other image.

### Background Pattern

Creates a pattern image the size of the selected panel (or overlay).

| Pattern | Types |
| --- | --- |
| Stripes | Horizontal, Vertical, Diagonal |
| Shapes | Dots, Check |
| Japanese patterns | Asanoha (hemp leaf), Ichimatsu (checkerboard), Shippou (linked circles), Uroko (scales) |
| Custom SVG | Tile an SVG image you prepared (such as a logo) |

You can set color, opacity, size (repeat spacing), and rotation. Uncheck "Transparent background" to fill the background with the background color.

> **Chapter summary**
> - There are seven balloon types. Add dialogue with "Embed Text", and split long dialogue with "Add Extension"
> - To place text alone, turn on "T" in "Text" and click. Use "Style" for outlines, shadows, and gradients
> - Use "Draw" for shapes and "Paint" for brush drawing. Pen pressure is supported
> - Use "Mask" to hide or show parts of an image. The original is not erased, so you can fix it anytime
> - Halftone is under "Image"; speed lines, vignette, and background patterns are under "Manga"
