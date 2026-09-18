# Product descriptions

TemPad Dev connects Figma with developers and their coding agents. Keep this positioning consistent across the website, user guides, and distribution listings. The product name remains **TemPad Dev**.

The website introduces the workflows and setup. The root READMEs are also the complete user guide: keep manual inspection, output plugins, agent setup, and troubleshooting expanded there. Agent-facing tool and skill descriptions should remain precise about their scope.

## Design comments

The user-facing feature is **Comments**. A **comment** is a user's written design request to their agent. Use this noun consistently in controls, help text, accessibility labels, and copied requests.

| Term               | Product meaning                                                            | Usage                                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comment / Comments | One written request / the collection of requests                           | Default UI noun; use **TemPad Dev comments** when distinguishing the feature from Figma's native comments.                                                                    |
| General comment    | A comment about the current design task as a whole, with no element target | The review composer's label; placeholder **Add a general comment…**. It does not apply to the whole Figma file or every task in the agent conversation.                       |
| Element comment    | A comment bound to one exact Figma element                                 | Used when scope needs to be explicit. The target can be a frame, component, text layer, or another supported element. A frame is an element, not a separate comment category. |
| Feedback           | The process or aggregate payload of conveying comments to the agent        | Appropriate in integration and protocol documentation; do not alternate it with Comment in UI labels.                                                                         |
| Annotation         | A visual annotation or technical anchoring concept                         | Not the name of this feature or its written content. Call its numbered canvas indicator a **comment marker**.                                                                 |

General and element describe scope, not different kinds of content or delivery modes. Both may contain a question, direction, or requested change. The current review contains at most one general comment and one saved comment per element. A general comment can be sent alone; when sent with element comments, all belong to the same request. General scope is attached to the current design task and its original conversation/file binding, not the current selection.

Use **Review comments**, **Add comment**, **Save comment**, **Save & Queue**, **Queue comments**, and **Steer now** for the corresponding controls. In the element editor, Command/Ctrl changes Save comment to Save & Queue; in the general composer, it changes Queue comments to Steer now. Contextual accessibility labels name the target, such as **Add comment to Header**. The element editor's field is **Element comment**. Keep Queue and Steer distinct because they deliver at different times; saving a draft does not send it.

The trigger's number counts saved element comments and matches the numbered canvas markers. The general comment has no marker and does not increment that count or add a notification dot. The trigger remains available with no element comments. Draft, queued, and delivered describe lifecycle independently of scope.

These comments belong to TemPad Dev's design task. They are not Figma-native comments or native annotations, and do not imply collaboration threads or replies. Existing `feedback` type names, payload fields, storage keys, and transport actions remain stable; terminology changes do not redefine those contracts. See [design task implementation](./extension/mcp-design-tasks.md) for behavior and delivery details.

## Website design direction

Keep TemPad Dev's wordmark, product captures, and original carousel transition in the inspection section. Use restrained typography, spacing, and surface details to organize the page around the product.

- Use the existing Manrope family for headings with a clear scale and carefully spaced lines. Keep the hero to a heading, one description, and its actions.
- Use a neutral page background, fine shared borders, and low-contrast surfaces. Explain Figma, agent, and codebase relationships with a clearly illustrative hero: two aligned design and code modules, a square selection outline with centered corner handles, and restrained strokes that travel in both directions on each agent connection. Keep connection labels clear of the paths and place the TemPad Dev plugin mark inside the coding-agent node; keep actual inspection captures with the inspection features.
- Place supporting copy directly below each section heading. Align agent steps and inspection details to the same column grid and reuse the same icon, title, body, and row spacing.
- Place supporting links and requirements in a shared footer below each content section, spanning the section width with the same fine rule and spacing. Keep link hit areas sized to their content and allow footer items to wrap on narrow screens.
- Present extension setup and agent setup in two open columns. Switch agents with logo buttons: inactive logos are grayscale, the active logo retains its brand colors, and keyboard focus stays visible without a heavy ring. Keep commands visible with immediate copy feedback.
- Treat transparent dialog screenshots as standalone objects, with captions below rather than inside a second image card.
- Make agent workflows concrete with compact segmented tabs, selectable example requests, and their expected process. Keep the request and process on an open surface, with a copy icon aligned to the request text and spaced through layout. Label examples as requests rather than portraying them as completed agent runs. Open both skill guides in the shared, multi-file reader with a fixed file selector above the independently scrolling document and page contents; bundle the source so reading and downloads do not depend on an unpublished GitHub path.
- Use the shared OverlayScrollbars theme for the page, reader, file options, and code blocks. Preserve native scroll APIs, modal scroll locking, anchors, and file history.
- Keep duplicate screenshots and redundant section introductions, captions, file paths, and labels out of the page. Use fine rules to distinguish feature rows, extension and agent setup, supporting links, the footer, and independent reader panes. Use whitespace within each group. Retain complete setup instructions and operational requirements.

Visual references: [Vercel's Geist system](https://vercel.com/geist/introduction), [VoidZero](https://voidzero.dev/), and [Linear](https://linear.app/). The intended application is precise type hierarchy, shared alignment, and subtle interaction feedback within TemPad Dev's own identity.

## Browser extension listing

Use the extension package description for the short listing. The following text is the long description for store submission; updating this file does not publish the listing.

TemPad Dev connects Figma with your development workflow. Inspect designs directly in the browser, customize code output, and use your coding agent to read and edit Figma designs.

In the extension:

- Read CSS and JavaScript styles for the selected element.
- Inspect variable references and values; configure units and scale.
- Select nested layers, measure spacing, and bring a selection into view.
- Use output plugins to map components and transform styles for your codebase.

With a connected coding agent:

- Read design structure, styles, variables, and assets to implement UI in your project.
- Create and edit native Figma layers.
- Reuse accessible components, variables, and styles when needed.

Agent access is optional and enabled in Preferences → Agent integration. It requires a compatible agent and Node.js 22.x, 24.x, or 26+. Keep TemPad Dev open while connected. Canvas editing requires edit access to a Figma Design file. Your agent handles the final code implementation and validation.

TemPad Dev is free and open source under the MIT license.

## Other distribution surfaces

- Browser manifest and short store text: `packages/extension/package.json`.
- npm MCP description: `packages/mcp-server/package.json`.
- Shared Agent Plugin description: `agent-plugin/src/plugin.json`.
- Codex display text: `agent-plugin/src/clients/codex/interface.json`.
- Website title and search description: `packages/site/index.html`.
- Product screenshots and capture contracts: [marketing screenshot workflow](./marketing-screenshots.md).

Run `pnpm agent-plugin:build` after changing anything under `agent-plugin/src/`. Review the generated packages and marketplace files. Store submission, repository-hosted About text, and deployment remain separate release actions.
