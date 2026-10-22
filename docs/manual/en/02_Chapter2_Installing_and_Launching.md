# Chapter 2 Installing and Launching

In this chapter you will install Comic Creator into ComfyUI and open its first screen.

## 2-1 What You Need

| What you need | Notes |
| --- | --- |
| ComfyUI | It should already start. Installing ComfyUI is not covered in this book |
| A browser | Chrome, Edge, etc. Comic Creator opens in a new browser tab |
| An internet connection | Needed for installation. After installation, basic editing and exporting work offline |

### Where your ComfyUI folder is

This book writes the ComfyUI folder as `ComfyUI/`. Replace it with the folder on your machine.

| Environment | Example of the folder that corresponds to `ComfyUI/` |
| --- | --- |
| Portable version (Windows) | `ComfyUI_windows_portable/ComfyUI/` |
| ComfyUI Desktop | The folder you chose at installation (the one containing `custom_nodes`) |
| Stability Matrix | `StabilityMatrix/Data/Packages/ComfyUI/` (may vary by settings) |
| Installed with git | The folder you ran `git clone` into |

In every environment, custom nodes go inside `ComfyUI/custom_nodes/`.

## 2-2 Installing with the Nodes Manager

ComfyUI has a "Nodes Manager" where you can search for and install custom nodes. This is the easiest way.

1. Start ComfyUI and open the "Extensions" menu at the top of the screen.
2. Choose "Nodes Manager".
3. Type `comic creator` in the search box.

4. Install "ComfyUI Comic Creator" from the search results.
5. When installation finishes, restart ComfyUI.

> **Tip**
> If nodes with similar names appear, choose the one whose author is "statsu" (ketle-man on GitHub).

## 2-3 Installing Manually

If you do not use the Nodes Manager, or installation there does not work, put the Comic Creator folder into the `custom_nodes` folder.

1. In a command prompt (terminal), go to `ComfyUI/custom_nodes/`.
2. Run the following command.
   ```
   git clone https://github.com/ketle-man/comfyui-comic-creator
   ```
   If you do not use git, download the ZIP from the GitHub page, extract it, and put it inside `custom_nodes`.
3. Restart ComfyUI.

After that, the folders look like this:

```
ComfyUI/
└── custom_nodes/
    └── comfyui-comic-creator/
        ├── __init__.py
        ├── py/
        ├── static/
        ├── templates/
        └── web/
```

> **Caution**
> Extracting a ZIP can create a doubled folder (`comfyui-comic-creator/comfyui-comic-creator/__init__.py`). Make sure `__init__.py` is in the folder directly under `custom_nodes`.

### About additional packages

The basic features need no additional Python packages.

Only opening and saving PSD (Photoshop) files in the "Image" tab uses a package called `psd-tools`. It is installed automatically when you install with the Nodes Manager. If you installed manually, run the following command with the Python that ComfyUI uses:

```
pip install -r requirements.txt
```

(Run it inside the `comfyui-comic-creator` folder. For the portable version and similar setups, use the Python bundled with ComfyUI.)

Everything except PSD works without `psd-tools`.

## 2-4 Opening Comic Creator

After restarting ComfyUI, a **CC** button is added to the bar at the top of the screen (the top bar).

1. Open ComfyUI in your browser.
2. Click the **CC** button in the top bar.
3. Comic Creator opens in a new browser tab.

The address of the new tab is ComfyUI's address followed by `/ccc`. For example, if you open ComfyUI at `http://127.0.0.1:8188`, Comic Creator is at `http://127.0.0.1:8188/ccc`.

The `:8188` part is called the "port number", and it can differ by environment (for example, ComfyUI Desktop). Just remember: **add `/ccc` to the address you use to open ComfyUI**, and it works in any environment.

> **Tip**
> Bookmark the `/ccc` address so that next time you can open it directly without going through ComfyUI's screen (ComfyUI still needs to be running).

> **Caution**
> As explained in Chapter 1, your work data is stored in the browser **per address**. `127.0.0.1` and `localhost` point to the same PC but are treated as different addresses. Always open it at the same address.

## 2-5 Switching to English

Comic Creator can be displayed in Japanese, English, or Chinese. **The first time you open it, it is shown in the language of your browser (Japanese, English, or Chinese; Japanese for any other language).** To switch the language, do the following.

1. Click the "設定" tab (Settings). It is the second tab from the right in the tab bar at the top.
2. Under "言語" (Language), choose "English".
3. The whole screen reloads and is shown in English.

Your choice is remembered by the browser, so it opens in English from then on.

> **Note**
> The tooltip of the **CC** button in ComfyUI's top bar is shown in Japanese regardless of this setting.

## 2-6 Useful Companion Nodes

If the following custom nodes are installed, Comic Creator gains more features. Without them, other features are not affected. Install them when you need them.

| Custom node | Features enabled | Chapter |
| --- | --- | --- |
| ComfyUI-Workflow-Studio | Image generation with ComfyUI workflows (Generate, I2I, Inpaint, Outpaint), the gallery in the "workflow studio" tab | Chapter 10 |
| comfyui-vrm-pose-editor | 3D Pose, 3D Text | Chapter 12 |
| comfyUI-particle-pixijs | PixiJS FX (particle and filter effects) | Chapter 12 |

> **Caution**
> Comic Creator can only find comfyui-vrm-pose-editor if its folder is named exactly `comfyui-vrm-pose-editor`. Do not rename the folder when installing manually.

Settings for the AI image service (Nanobanana) and external software (Eagle, G'MIC) are explained in the chapters where they are used.

## 2-7 If It Will Not Start

| Symptom | Possible cause | Fix |
| --- | --- | --- |
| No CC button | ComfyUI was not restarted | Restart ComfyUI and reload the browser |
| No CC button | The folder is in the wrong place (doubled folder, etc.) | Check that `ComfyUI/custom_nodes/comfyui-comic-creator/__init__.py` exists |
| No CC button | ComfyUI's screen (frontend) is old | Update ComfyUI. Even without the button, you can open it by adding `/ccc` to the address |
| Opening `/ccc` gives "404" or another error | Comic Creator was not loaded | Check the screen shown when ComfyUI starts (the console) for lines starting with `[ccc] ERROR` |
| Works you made before do not appear | You opened it in a different browser or at a different address | Open it in your usual browser at your usual address (Chapter 1) |
| The "workflow studio" tab says "was not found" | ComfyUI-Workflow-Studio is not installed | Install it and restart ComfyUI if you want to use it. Otherwise you can ignore it |

> **Chapter summary**
> - Install by searching for `comic creator` in "Extensions" > "Nodes Manager", or manually by placing the folder in `custom_nodes`
> - Restart ComfyUI after installing. Open it with the **CC** button in the top bar
> - Comic Creator's address is "ComfyUI's address + `/ccc`". Always use the same address
> - It starts in Japanese. Switch with "設定" (Settings) > "言語" (Language) > "English"
> - Install companion nodes only when you need them
