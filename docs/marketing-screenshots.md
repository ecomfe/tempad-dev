# Marketing screenshot workflow

README and site screenshots are captured from a real, logged-in Figma tab in the user's existing
Chrome profile. Do not replace the Figma runtime with a mock page: the extension UI depends on
Figma's fonts, theme tokens, CSS variables, canvas overlays, and patched `window.figma` API.

The canonical source file is
[TemPad Dev fixtures](https://www.figma.com/design/4HPsWWxVESGJ9ka4CDdVMx/TemPad-Dev-fixtures).
Do not create README scenes in another Figma file.

## Source of truth

- `packages/extension/screenshots/scenarios.json` defines the expected scenarios, fixtures, output
  dimensions, and light/dark variants.
- `packages/extension/screenshots/fixture-runtime.js` creates the deterministic geometry and binds
  the real Kong button instance used by the plugin scenario.
- `packages/site/public/marketing/` contains the generated files consumed by both READMEs and the
  marketing site.

The fixture runtime only replaces nodes carrying its managed markers inside the Figma page named
`README Fixtures`. It preserves the real Kong `Button` instance, marks and repositions it, and
recreates the synthetic geometry around it. It does not modify other pages or detach the component
instance. The script stops if a real button instance is unavailable; it never draws a substitute.

`scenarios.json` is the capture contract, not just a list of filenames. A scenario is authored
once; later capture runs must take its intent, Figma focus and selection, panel controls, plugins,
MCP state, pointer target, tooltip, crop, and assertions from that file. Do not reconstruct those
choices from memory or make new visual decisions during a routine capture.

All PNG assets use 2× density: the standard `720 × 480` README viewport becomes `1440 × 960`, the
complete `240 × 206` Agent integration section becomes `480 × 412`, and the `360 × 160` status
crop becomes `720 × 320`.

## Scenario intent

| Scenario          | Visual state that must be preserved                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `code`            | Selected frame with blue handles and size label beside CSS and JavaScript output; pointer hidden.                                 |
| `unit`            | Same selected frame, preferences open, `rem` active, root size `16` focused with its text selected, arrow pointer over the field. |
| `deep`            | No Figma selection, Deep Select active, arrow pointer over the nested frame, hover-only blue outline without handles.             |
| `measure`         | Inner frame selected, Measure active, outer frame under the pointer, orange target outline and four `20` distance labels.         |
| `scroll`          | Frame selected in the native code view, arrow pointer hovering Scroll Into View with its tooltip visible.                         |
| `plugins`         | Real Kong Button instance selected with Figma's purple instance highlight and Kong UI-specific output; pointer hidden.            |
| `mcp-config`      | Agent integration with MCP enabled, Codex selected, and its plugin prompt/CLI paths visible.                                      |
| `mcp-unavailable` | Preferences visible with the gray-dot, dashed MCP badge.                                                                          |
| `mcp-inactive`    | Preferences visible with the green-dot, dashed MCP badge.                                                                         |
| `mcp-active`      | Preferences visible with the green-dot, solid-green MCP badge.                                                                    |

## Composition contract

The capture rectangle is measured in CSS pixels in the minimized `1728 × 837` Figma viewport.
The standard crop starts at `(300, 0)`; the TemPad Dev panel starts at `(676, 51)`, so its left
edge is consistently 376 px into the final view. Fixtures are separated by 2,000 Figma units and
the runtime frames only the marker declared by the active scenario. No other scenario geometry may
appear in the crop.

| Scenario                 | Canvas placement and panel framing                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `code`, `scroll`         | Frame top-left `(392, 151)`, Figma zoom `1.5`; preserves the original 180 × 120 visual weight.                       |
| `unit`                   | Frame top-left `(392, 179)`, zoom `1.5`; crop starts at y=100 to show controls and the first generated rem values.   |
| `deep`                   | Outer frame top-left `(402, 151)`, zoom `1`; centers the nested hover target without selection handles.              |
| `measure`                | Outer frame top-left `(400, 151)`, zoom `1`; leaves room for all four distance labels and the right-side pointer.    |
| `plugins`                | Button top-left `(431, 180)`, zoom `1.3`; gives the real 66 × 40 Kong instance the same visual weight as the source. |
| `mcp-config`             | Panel-section crop `(676, 272, 240, 206)`; includes the complete Agent integration section without canvas padding.   |
| `mcp-*` status snapshots | Header/context crop `(617, 26, 360, 160)`; no canvas geometry is included.                                           |

The dark canvas stays black while fixture surfaces switch to `#333` and nested outer frames to
`#555`. Generated code updates with the selected fixture, so the canvas and TemPad Dev output
remain consistent. Light fixtures keep their original white and neutral-gray fills.

## Regression comparison

Never write a fresh capture directly over the committed asset. Capture all candidates to a
temporary directory and compare every light/dark pair with the current repository version at the
same displayed CSS width. The review is blocking and covers:

- the original screenshot's product intent and information hierarchy;
- canvas zoom, fixture anchor, panel position, panel scroll, and crop boundaries;
- selection/hover/measurement colors, handles, size labels, pointer shape, pointer target, and
  tooltip;
- light/dark canvas and fixture fills, syntax colors, shadows, and contrast;
- isolation from every other fixture and from Figma chrome outside the declared view box;
- native text and vector sharpness at 2×, with no JPEG enlargement or black compositor tiles.

Record whether each difference is an intentional improvement, a necessary UI-update adjustment,
or a regression. Fix regressions before replacing any file in `packages/site/public/marketing/`.

Every scenario is captured in both themes. Theme changes must go through Figma's visible
`Preferences → Theme → Light/Dark` menu so the canvas, extension runtime variables, syntax colors,
shadows, and controls all change together. The fixture also sets the real Figma page background to
the manifest's `#F5F5F5` or `#000000`; this preserves the established README composition without
simulating any extension CSS variables. Selection blue, instance purple, and measurement orange
remain Figma-owned highlight colors in either theme.

## Prerequisites

1. Open the canonical `TemPad Dev fixtures` file in the Chrome profile already connected to Codex.
2. Keep its verified Kong `Button` component instance. On the first run the fixture runtime finds
   the page containing that instance, renames the page to `README Fixtures`, and binds the instance
   to the `plugins` fixture marker.
3. Run the current TemPad Dev extension build in that tab.
4. Keep Chrome at its normal macOS device scale. The workflow captures the user's real runtime;
   it does not launch a separate browser or log in again.
5. Expose the already-open Chrome through a CDP endpoint. Set `TEMPAD_SCREENSHOT_CDP_URL` when it
   is not `http://127.0.0.1:9222`. When Codex owns the Chrome connection, Codex supplies this outer
   adapter and runs the same repository capture contract.

## Automated capture procedure

The normal path is candidate capture, visual comparison, then explicit promotion:

```sh
pnpm screenshots capture
pnpm screenshots compare
open .artifacts/marketing-screenshots/comparison.html
pnpm screenshots promote --yes
pnpm screenshots verify
```

`pnpm screenshots capture` defaults to every scene except MCP unavailable/inactive. Use `--only` to
rerun a subset, for example `--only code,unit,deep`, and `--themes light` for one theme. Candidates
never overwrite committed assets. `pnpm screenshots compare --baseline-dir <path>` can compare
against an archived or checked-out baseline instead of the working tree.

The runner performs these steps:

1. Claim the open Figma tab through the configured Chrome CDP adapter.
2. Confirm Chrome's minimized Figma capture is exactly `1728 × 837`, then evaluate
   `fixture-runtime.js` in
   the page's main JavaScript world through CDP. Verify that the returned page is `README Fixtures`
   and that every marker from the scenario manifest exists.
3. Reset TemPad Dev to the manifest baseline, then configure the scenario through its visible
   controls. The baseline has no codegen plugins enabled; only `plugins` may enable Kong UI, and it
   is captured last within each theme. Do not read or write browser local storage.
4. Stage the Figma canvas through the helper installed by the fixture runtime. This separates the
   node used to frame the canvas from the actual selection, which is required for hover-only and
   measurement scenes:

   ```js
   await __TEMPAD_README_SCREENSHOTS__.stage({
     focus: scenario.figma.focus,
     selection: scenario.figma.selection,
     theme,
     x: scenario.figma.captureAnchor?.x ?? manifest.capture.canvasAnchor.x,
     y: scenario.figma.captureAnchor?.y ?? manifest.capture.canvasAnchor.y,
     zoom: scenario.figma.zoom ?? 1
   })
   ```

5. Drag the TemPad Dev panel to the manifest coordinates. Capture every selected native scenario
   for one theme before switching themes, with `plugins` last. Use Figma's real theme menu for the
   requested variant; do not modify `data-preferred-theme` directly.
6. Resolve the scenario pointer target after layout settles. Canvas targets use
   `__TEMPAD_README_SCREENSHOTS__.bounds(marker)`; panel targets use their declared accessible role
   and name. The resolved point is the arrow-tip hotspot; interactive controls use an interior
   bottom-right anchor so the cursor body does not cover their content. Move the real Chrome pointer
   to that point and verify its declared shape, hover outline, focus selection, and tooltip. For
   hidden-pointer scenes, move it to the manifest's out-of-crop coordinate.
7. Keep Figma in its minimized UI mode and capture the manifest's clip rectangle. The clip starts
   to the right of Figma's file island and ends before the properties panel; the bottom toolbar is
   below it. Do not fully hide the Figma UI: TemPad Dev intentionally hides after Figma removes the
   left panel entirely, which creates a capture race.
8. Capture the manifest clip at Playwright/CDP device scale. Chrome renders the 1728 × 837 CSS
   viewport at macOS device scale 2, producing the final 2× PNG directly without resizing a JPEG.
   The real mouse still drives hover, Figma overlays, focus, and tooltips. Because CDP does not
   rasterize the operating-system pointer, the runner adds the declared deterministic arrow cursor
   at the same hotspot immediately before capture. A transparent off-crop compositor guard keeps
   Figma's extension layer painted for panel-only crops and is removed with the cursor afterward.
9. Run every scenario assertion and generate the side-by-side HTML regression report. Only after
   reviewing every row should `pnpm screenshots promote --yes` replace repository assets. The lower
   level processor accepts an already cropped 2× PNG, a 1× CSS-viewport capture, or a native 2×
   viewport capture and validates the output path and dimensions:

   ```sh
   pnpm screenshots process \
     --scenario code \
     --theme light \
     --input /tmp/tempad-code-light.png
   ```

   Pass `--output <path>` when testing the processor without replacing a committed asset. For an
   anchor-based crop, resolve the anchor in the live panel and pass `--clip-x` and `--clip-y`; the
   numeric coordinates in the manifest are the reference-layout fallback. The command uses macOS
   `sips`, so it adds no repository dependency.

10. The runner restores Light mode and removes its cursor overlay before disconnecting. Run:

```sh
pnpm screenshots verify
```

11. Always restore Figma through `Preferences → Theme → Light` and call
    `__TEMPAD_README_SCREENSHOTS__.setCanvasTheme('light')` before handing the tab back.

## Stability rules

- Wait for the expected selection title and code headings before capture.
- Treat the manifest assertions as blocking checks. A mismatched title, control value, highlight,
  pointer, tooltip, theme, or MCP badge means the scene is not ready.
- Disable or wait out panel transitions; never capture during a Vue transition.
- MCP status images must first reach real browser bridge states. Use no server for `unavailable`,
  one additional MCP-enabled Figma tab for `inactive`, and the active fixture tab for `active`.
  Prepare preferences before activating the additional client, then run the status scenario alone.
  The runner brings the fixture tab forward without touching TemPad Dev, asserts the real badge
  class, and captures it; it never invents a status appearance.
- Abort without overwriting assets when the fixture page, marker, theme, selection, or MCP state
  does not match the scenario.
- Never leave the canonical fixture file or TemPad Dev panel in dark mode after a capture run.
- Keep the hero SVG outside this workflow; it is a static brand asset rather than a UI screenshot.
