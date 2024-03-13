# TemPad Dev

Dev Mode brought by TemPad. A Figma Dev Mode alternative as a Web Extension.

Built with [WXT](https://wxt.dev/), TypeScript and Vue 3.

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
- Locking the Deep Select mode (originally requiring pressing ⌘ and clicking)
- Locking the Measure to Selection mode (originally requiring moving the cursor while holding ⌥ to view)
- Scrolling the selected elements back into the viewport

## Acknowledgements

Inspired by the following projects:

- https://github.com/leadream/figma-viewer-chrome-plugin
- https://github.com/zouhangwithsweet/fubukicss-tool
