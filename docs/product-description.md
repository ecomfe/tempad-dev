# Product descriptions

TemPad Dev connects Figma with developers and their coding agents. Keep this positioning consistent across the website, user guides, and distribution listings. The product name remains **TemPad Dev**.

The website introduces the workflows and setup. The root READMEs are also the complete user guide: keep manual inspection, output plugins, agent setup, and troubleshooting expanded there. Agent-facing tool and skill descriptions should remain precise about their scope.

## Website design direction

Keep TemPad Dev's wordmark, product captures, and original carousel transition in the inspection section. Use restrained typography, spacing, and surface details to organize the page around the product.

- Use the existing Manrope family for headings with a clear scale and carefully spaced lines. Keep the hero to a heading, one description, and its actions.
- Use a neutral page background, fine shared borders, and low-contrast surfaces. Explain Figma, agent, and codebase relationships with a clearly illustrative hero: two aligned design and code modules, a square selection outline with centered corner handles, and restrained strokes that travel in both directions on each agent connection. Keep connection labels clear of the paths and place the TemPad Dev plugin mark inside the coding-agent node; keep actual inspection captures with the inspection features.
- Place supporting copy directly below each section heading. Align agent steps and inspection details to the same column grid and reuse the same icon, title, body, and row spacing.
- Present extension setup and agent setup in two open columns. Switch agents with logo buttons: inactive logos are grayscale, the active logo retains its brand colors, and keyboard focus stays visible without a heavy ring. Keep commands visible with immediate copy feedback.
- Treat transparent dialog screenshots as standalone objects, with captions below rather than inside a second image card.
- Make agent workflows concrete with compact segmented tabs, selectable example requests, and their expected process. Keep the request and process on an open surface, with a copy icon aligned to the request text and spaced through layout. Label examples as requests rather than portraying them as completed agent runs. Open both skill guides in the shared, multi-file reader with a fixed file selector above the independently scrolling document and page contents; bundle the source so reading and downloads do not depend on an unpublished GitHub path.
- Use the shared OverlayScrollbars theme for the page, reader, file options, and code blocks. Preserve native scroll APIs, modal scroll locking, anchors, and file history.
- Keep duplicate screenshots and redundant section introductions, captions, file paths, and labels out of the page. Use whitespace between list rows and setup columns; reserve rules for section boundaries and independent reader panes. Retain complete setup instructions and operational requirements.

Visual references: [Vercel's Geist system](https://vercel.com/geist/introduction), [VoidZero](https://voidzero.dev/), and [Linear](https://linear.app/). The intended application is precise type hierarchy, shared alignment, and subtle interaction feedback within TemPad Dev's own identity.

## Browser extension listing

Use the extension package description for the short listing. The following text is the long description for store submission; updating this file does not publish the listing.

### English

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

### 简体中文

TemPad Dev 连接 Figma 与开发工作流。你可以直接在浏览器中检查设计、定制代码输出，也可以通过 coding agent 读取和编辑 Figma 设计。

在扩展中：

- 查看选中元素的 CSS 和 JavaScript 样式。
- 查看变量引用和解析值，配置单位与缩放比例。
- 选择嵌套图层、测量间距、定位选中项。
- 使用输出插件映射组件，将样式转换为项目需要的格式。

连接 coding agent 后：

- 读取设计结构、样式、变量和素材，为项目中的 UI 实现提供上下文。
- 创建和修改原生 Figma 图层。
- 按需复用可访问的组件、变量和样式。

Agent 访问是可选功能，在 Preferences → Agent integration 中启用，需要兼容的 agent 和 Node.js 22.x、24.x 或 26+。连接期间请保持 TemPad Dev 打开。画布编辑需要 Figma Design 文件的编辑权限；最终代码由 agent 结合项目实现并验证。

TemPad Dev 免费、开源，使用 MIT 许可证。

## Other distribution surfaces

- Browser manifest and short store text: `packages/extension/package.json`.
- npm MCP description: `packages/mcp-server/package.json`.
- Shared Agent Plugin description: `agent-plugins/tempad-dev/plugin.json`.
- Codex display text: the `interface` in `agent-plugins/tempad-dev/.codex-plugin/plugin.json`.
- Website title and search description: `packages/site/index.html`.
- Product screenshots and capture contracts: [marketing screenshot workflow](./marketing-screenshots.md).

Run `pnpm agent-plugin:dev` after changing the portable plugin or its generator inputs. Review synchronized client wrappers and marketplace files. Store submission, repository-hosted About text, and deployment remain separate release actions.
