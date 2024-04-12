# TemPad Dev

Inspect panel on Figma, for everyone.

Built with [WXT](https://wxt.dev/), TypeScript and Vue 3.

> [!IMPORTANT] > <img height="200" alt="image" align="right" src="https://github.com/ecomfe/tempad-dev/assets/1726061/ac185c15-b7b1-4deb-984b-45027a84650c">
>
> On March 19, Figma removed the `window.figma` in view-only mode pages (which the TemPad Dev extension relies on to function properly). After our proactive communication, the Figma team promised to re-add the `window.figma` interface within a few weeks. During the waiting period, TemPad Dev cannot work properly in view-only mode. You can use it in edit mode by using the “Duplicate to your drafts” feature and use it in edit mode.
>
> You can follow [this post](https://forum.figma.com/t/figma-removed-window-figma-on-view-only-pages-today/67292) to get the latest updates.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/dark.png 2x">
    <source media="(prefers-color-scheme: light)" srcset="assets/light.png 2x">
    <img alt="Shows a screenshot of the extension panel." src="assets/light.png">
  </picture>
</p>

## Features

Currently supported features include:

- Viewing/copying the CSS code of the selected node
- Viewing/copying the JavaScript form of the CSS code of the selected node
- Viewing/copying the component code of the selected component (inputted through the TemPad Figma plugin), with the ability to jump to the TemPad Playground for preview/debugging
- Locking the Deep Select mode (originally requiring pressing <kbd>⌘</kbd> and clicking)
- Locking the Measure to Selection mode (originally requiring moving the cursor while holding <kbd>⌥</kbd> to view)
- Scrolling the selected elements back into the viewport
- Toggling CSS units between `px` and `rem` (supports setting root font size)

## Acknowledgements

Inspired by the following projects:

- https://github.com/leadream/figma-viewer-chrome-plugin
- https://github.com/zouhangwithsweet/fubukicss-tool
