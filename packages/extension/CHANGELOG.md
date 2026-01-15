# Changelog

## 0.14.8

- Improved MCP troubleshooting and error messaging.
- Added support for gradient fills in code output.
- Updated Codex branding in MCP configuration.

## 0.14.7

- Adjusted panel overflow clipping so resize handles stay clickable while keeping rounded corners.

## 0.14.6

- Set a minimum panel height and refined max-height calculation.
- Improved key lock behavior when hovering the canvas.
- Improved Figma availability checks and layout readiness handling.

## 0.14.5

- Only show the panel visual hint when the panel significantly overlaps with Figma's own panels.

## 0.14.4

- Improved MCP tool output.
- Improved the visual hint for TemPad Dev panel.
- Significantly improved the performance of `get_code` tool.
- Made TemPad Dev work seamlessly across soft navigation between pages in Figma.

## 0.14.3

- Fixed the missing `host_permissions` in manifest.json.

## 0.14.2

- Fixed the styles of MCP client buttons.

## 0.14.1

- Added a visual hint to help users find TemPad Dev panel easier when it overlaps with Figma's own panels.
- Improve cursor display when measure mode is active.
- Improved button styles.

## 0.14.0

- Added MCP server support to let agents/IDEs pull code, structure, and screenshots from your current Figma selection.
- The inspect panel can be resized horizontally by dragging either its left or right edge. (Suggested and implemented by @molinla at [#34](https://github.com/ecomfe/tempad-dev/pull/34))
- Measure mode won't trigger node duplication anymore when dragging a node in design mode.
- Improved the error message when `window.figma` is unavailable.
- Improved error handling for retrieving dev resources.

## 0.13.1

- Fixed select component style under dark mode.
- Redeployed the rewrite script so users on older versions can continue using the extension normally.

## 0.13.0

- Updated to comply with Chrome Web Store policies by moving DNR redirection rules to the extension side.
- Improved select component style in preferences panel to match Figma's UI.

## 0.12.0

- Added support for documentation links and dev resource links.
- Switch to always use `figma.notify`.
- Remove Quirks mode.

## 0.11.4

- Strip trailing whitespaces and newlines from code blocks.

## 0.11.3

- Added color preview for color tokens in code blocks.
- Cleaned up view-only mode alert messages and CTA buttons.

## 0.11.2

- Improved code block styles.

## 0.11.1

- Fixed loading error on Figma slides and site pages.

## 0.11.0

- Improved compatibility with Figma's lazy loading mechanism.
- Improved rewriting rules.

## 0.10.2

- Fixed an issue with CSS code generation when optimizing dimension code.

## 0.10.1

- Fixed the copy button for code blocks.
- Improved error handling when fetching live rules.

## 0.10.0

- Variables in code panels are now copyable.

## 0.9.0

- Updated the script rewrite logic.
- Moved the rewriter script to a remote URL on GitHub repo.
- Added dynamic DNR rules syncing mechanism.

## 0.8.5

- Update WXT to fix the problem that multiple WXT-based web extensions invalidates each other.

## 0.8.4

- Updated the script rewrite logic.

## 0.8.3

- Improved user instructions when `window.figma` is unavailable.
- Trime string props for codegen.

## 0.8.2

- Fixed script replacement after Figma update.

## 0.8.1

- Fixed script replacement after Figma update.

## 0.8.0

- Fixed `window.figma` recovery for clients that are loading script files without `.br` extension.
- Quirks mode is no longer available as Figma removed the `window.DebuggingHelpers.logSelected` API.

## 0.7.1

- Improved component codegen.

## 0.7.0

- Added a new option: `scale`.

## 0.6.3

- Improved component codegen, remove `undefined` values automatically.

## 0.6.2

- Added `visible` info to component codegen.

## 0.6.1

- No longer supports built-in plugins.

## 0.6.0

- Provided a brand new icon for the extension.

## 0.5.9

- Fixed vector fills extraction.

## 0.5.8

- Added vector node support for component codegen plugin.

## 0.5.7

- Added main component info for component codegen plugins.

## 0.5.6

- Fixed the problem that worker requester isn't properly cached.

## 0.5.5

- Fixed that plugin update was not working.

## 0.5.4

- Added plugin update support.
- Improved focus styles.

## 0.5.3

- Improve HTML escaping and indentation for component codegen.

## 0.5.2

- Fix indentation for component codegen.

## 0.5.1

- Improved the code output for component codegen.
- Fixed a tiny UI issue under UI2.

## 0.5.0

- Added children support to `DesignComponent` for component codegen.

## 0.4.10

- Improved component codegen.

## 0.4.9

- Fixed plugin import regression.
- Improved component event handler codegen.

## 0.4.8

- Added `transformComponent` support for plugins.

## 0.4.7

- Fixed rule priority for removing CSP header.

## 0.4.6

- Fixed CSP issue by temporarily remove `main_frame` CSP header.

## 0.4.5

- Added a badge to show what plugin is transforming the code.

## 0.4.4

- Added plugin registry.
- Improved error reporting when importing plugins.

## 0.4.3

- Plugins can now be exported with default exports.
- Plugin transform hooks now accepts a new `options` parameter.

## 0.4.2

- Fixed the regression that preferences were not reactive.

## 0.4.1

- Added `host_permissions` so that `declarativeNetworkResources` can take effect.

## 0.4.0

- Added plugins support.
- Added experimental support for enabling `window.figma` in view-only mode.

## 0.3.5

- Excluded individual border if `border-width` is `0` in quirks mode.

## 0.3.4

- Fixed the problem that borders are not correctly recognized in quirks mode.
- Fixed a style detail when the extension is minimized.

## 0.3.3

- Improved toast.

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
