# Changelog

## 0.3.2

- Adapted toast and quirks mode hint to UI3.

## 0.3.1

- Fixed CSS unit for `stroke-width`.

## 0.3.0

- Added support for UI3.

## 0.2.10

- Fixed that `stroke-dash-pattern` may be unavailable.

## 0.2.9

- Updated text data retrieval for quirks mode.

## 0.2.8

- Added compatibility for `Tem.RichText`.

## 0.2.7

- Figma file paths may now start with `design`.

## 0.2.6

- Used overlay scrollbar to prevent layout shift.

## 0.2.5

- Quirks mode hint now shows how to duplicate to drafts upon click.

## 0.2.4

- Fixed paint data and stroke data might be undefined in quirks mode.

## 0.2.3

- Added codegen support for rotation in quirks mode.
- Stopped forcing into quirks mode by mistake.

## 0.2.2

- Fixed that font props were generated for non-text nodes in quirks mode.
- Fixed that rgba colors were treated as multiple fill data in quirks mode.

## 0.2.1

- Fixed `line-height` in quirks mode.

## 0.2.0

- Added support for font related CSS codegen for text nodes in quirks mode.
- Refactored quirks mode so that its now more modular and easier to maintain.

## 0.1.1

- Improved codegen for `padding` in quirks mode.

## 0.1.0

- Added experimental support for quirks mode that can run under view-only pages.

## 0.0.9

- Lowered z-index to prevent Figma's own menus and popups from being covered by TemPad Dev.
- Fixed the problem that double clicking pref button triggers the panel's toggle.

## 0.0.8

- Improved compatibility with TemPad icon names.

## 0.0.7

- Added lib name badge for TemPad components.
- Improved display name for icons for TemPad components.

## 0.0.6

- Fixed the problem that code copy doesn't update correctly.

## 0.0.5

- Improved selection updates via keyboard shortcuts.
- Improved TemPad code indentation.
- Improved panel sizing.

## 0.0.4

- Fixed lock mode when user <kbd>  </kbd> + drag with mouses.
- Fixed selection updates triggered by objects panel or <kbd>⌘</kbd>.
- Fixed display when multiple nodes are selected.

## 0.0.3

- Optimized panel drag range based on Figma's floating window handling to prevent dragging beyond visibility.

## 0.0.2

- Added preferences: CSS unit and root font size.
- Added toggling minimized mode by double clicking the header.
- Improved JavaScript style object output.
- Fixed `z-index` so that the panel won't be covered by nav bar.
- Fixed text-overflow style for node names.

## 0.0.1

- First version.
