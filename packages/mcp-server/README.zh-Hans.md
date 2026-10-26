# @tempad-dev/mcp

TemPad Dev 的 MCP server 将 coding agent 连接到浏览器中打开的 Figma 文件，支持读取设计信息、创建和编辑原生图层，并为项目中的 UI 实现提供上下文。

需要安装 TemPad Dev 扩展，保持面板打开并启用 **MCP access**。画布写入还需要 Figma Design 文件的编辑权限。完整配置与使用说明见 [使用指南](../../README.zh-Hans.md#agent-集成)。

## 用法

```json
{
  "mcpServers": {
    "tempad-dev": {
      "command": "npx",
      "args": ["-y", "@tempad-dev/mcp@latest", "--runtime-updates=stable"]
    }
  }
}
```

如需针对不同 agent 配置，请打开 TemPad Dev 的 **Preferences → Agent integration → Set up agents**。界面提供 Codex、Cursor、Claude Code、Gemini、VS Code、OpenCode 和 TRAE 的引导路径；未列出的兼容客户端可选择 **Other**。

### 运行时更新（0.12.0+）

经过校验的正式包在 macOS、Linux 和 Windows 上默认启用后台下载与兼容 Hub 自动更新，既有 `npx @latest` 配置
重启到 0.12.0 或更高版本后也会启用。上述配置和 Agent Plugin 0.5.10 通过
`--runtime-updates=stable` 明确选择此策略。首次启用需关闭所有现有 TemPad MCP 连接，再重新启动；
已有 release 任务和资源存储保持不变。
在这次重启之前，新客户端继续使用仍在运行的旧 Hub，不会中断它。
Checkout 开发构建使用独立的本地配置，始终不会获取线上运行时。

在使用相同运行配置的终端中：

- `npx -y @tempad-dev/mcp@latest --runtime-update-status`：查看运行版本、候选版本和阻止切换的原因。
- `npx -y @tempad-dev/mcp@latest --check-runtime-update`：查找不超过 npm `latest` 标签的最新兼容稳定版。
  版本较多时分批继续查找；状态中会显示剩余进度，以及跳过最新版本的原因。
- `npx -y @tempad-dev/mcp@latest --update-runtime <version>`：确认具体版本及完整性摘要后切换。
  工具契约或指导语不兼容、操作尚未结束、旧版 Claude hook，或仍有未启用更新的客户端连接时，均不会激活。

自动激活要求所有 MCP 客户端均已初始化、启用稳定版更新并支持切换等待。
Claude 还需要已验证的会话和支持回执与重试的 hook；身份未确认或 hook 过旧时保持暂存。
工具调用、传输和原生操作结束并空闲五秒后，supervisor 再次检查条件并执行本地切换。
尚未派发的新请求最多等待十秒，已派发的写入绝不重放。
忙碌时延后更新，下载或网络故障不会停止当前 Hub；跨破坏性版本边界、契约或指导语不兼容时，仍需显式更新或重启。
兼容切换时，已有 MCP
会话保留原有工具说明；Figma 会重新连接，设计任务可能需要 resume 和读回。正在运行的入口进程、
supervisor、Node、浏览器扩展和已安装插件仍需按原方式升级或重启。
使用 `--runtime-updates=off`，最后一个启用更新的客户端断开后就会停止后台检查。
若必须严格使用启动包的版本，请在固定 npm 版本的配置中加 `--runtime-updates=pinned`；
与当前 Hub 冲突时会提示重启，不会另起一个 Hub。
未经校验的本地构建继续运行随包版本，不下载线上版本，且会拒绝显式启用更新。
Windows 的托管更新使用命名管道和经过 ACL 校验的私有存储；
[进程级 CI](../../TESTING.md#windows-runtime-ci) 与已安装桌面宿主的交互验收分别进行。

### 工具和资源

- `get_code`：以 Tailwind 优先的 JSX/Vue 标记输出，并附带资源和变量引用。
- `get_design_system`：创建不可变、确定性的紧凑目录，按资源类型平衡分页返回可访问页面的
  组件定义，以及本地或被定义直接引用的变量、集合/模式、样式和 shader 定义，不扫描画布
  中的使用情况。游标可继续读取遗漏定义；使用同一目录精确查询某个引用时，返回该资源的
  有界定义。使用 `scope: "fonts"` 可查询当前可用字体家族和精确原生样式，不读取文件资源。
  `scope: "pages"` 无需扫描组件即可列出页面 ID；资源读取传入 `pageId` 时只扫描该页组件，
  变量、样式和 shader 定义仍按文件范围读取。
- `manage_design_task`（`begin`、`resume`、`complete`、`cancel`）和 `set_design_anchor`：将画布写入绑定到设计任务，
  恢复暂停的任务、设置状态栏锚点，以及结束或取消任务。Stop 会永久禁止旧任务写入，重新连接也不会恢复。
  兼容 Codex App 的原生评论支持 Queue 和 Steer；确认接收后清空已提交草稿，无需等待执行完成。
  详细行为与宿主验证范围见[评论指南](https://github.com/ecomfe/tempad-dev/blob/main/agent-plugin/src/README.zh-Hans.md#使用)。
- `get_design_task`：读取任务状态及当前写入 lease。
- `list_design_sessions`：列出已连接的 Figma 文件，供精确指定会话读取。
- `apply_canvas`：使用受限 HTML、可确定转换的 Tailwind utility、类型化原生状态、SVG 和图片资源，
  对精确页面或托管根节点执行创建、更新、删除或激活。变量 utility 和命名文字样式 class 可绑定
  既有资源或同次调用中声明的资源；仅操作页面或更新 native 状态时可省略标记。
  扩展会在本地解析、验证、计算与实时画布的差异、应用修改并校验结构。
- `upload_asset`：Hub 内的受限桥梁，把程序化串联生成的 PNG/JPEG/GIF data URL 存成供
  `apply_canvas` 使用的 content-addressed `assetHash`，且不会返回编码后的图片字节。
- `get_screenshot`：为每个请求的节点返回有大小限制的渲染 PNG，用于按需视觉验证。
- `get_structure`：精确节点、页面或当前选中的一个或多个可见节点的层级/几何结构信息，并返回 TemPad 已管理节点的稳定 authoring key；
  还可按需读回原生遮罩、IMAGE paint、布局网格与画框参考线。

说明：

- `get_code`、`get_structure` 和 `get_screenshot` 接受 `nodeIds` 或当前多选，单个 `nodeId`
  调用保留原有返回格式。代码和截图批量返回 `{ nodeId, result }` 或 `{ nodeId, error }`，
  使用返回的 `remainingNodeIds` 作为 `nodeIds`，并保留原参数，即可继续读取。结构读取保留
  真实根节点，在 `errors` 中报告失败节点；`options.depth: 0` 只读取根节点。多节点读取要求
  Hub 和扩展使用匹配的 bridge protocol 15 构建，旧版不会静默忽略新的节点选择参数。
- `get_code.resolveTokens` 只控制代码；无论是否启用，`tokens` 都保留定义、全部模式和 alias。
  启用后按每个实际消费节点的 Figma 有效模式解析；无法解析的引用保留在代码中，并返回
  `token-resolution` warning。定义缺失或名称有歧义时返回 `token-definition` warning；
  warning 按节点独立去重并限制大小。旧版启用该选项时会把 `tokens` 展开为字面量，
  旧扩展需要升级才能使用 `resolveTokens: true`。
- 工具响应共用 `64 KiB` 的 inline budget，按 `CallToolResult` 整体响应体积计算。若选区过大而超出 `get_code` 的预算，TemPad Dev 可能返回 shell response 而不是直接失败。shell 会保留当前节点的包裹结构，并在内联代码注释中列出被省略的直接子节点 id，方便 agent 逐个继续拉取；配套 warning 只保留最小化的提示信息，用来指向这条注释。
- 启用 MCP access 且当前 Figma Design 文件可编辑时，`apply_canvas` 即可使用；Dev Mode 和
  只读文件仍不可写。
- 上述多节点读取与 token 定义语义要求 Hub 和扩展均使用匹配的 protocol 15 构建。
  扩展 0.22.0 仍通过 protocol 13 支持既有读取、会话、任务和画布写入。新版读取选项会提示升级，响应会标注旧版选区和 token 语义。
  请更新扩展并重新加载 Figma 以启用新版能力，再更新 plugin 或已安装的 skill，
  将固定 alpha 版本的 MCP 配置改为 `@tempad-dev/mcp@latest`，然后重新连接 MCP client 并新建任务。
  最低版本要求和更新步骤详见[升级指南](https://github.com/ecomfe/tempad-dev/blob/main/agent-plugin/src/README.zh-Hans.md#升级)。
- 资源是临时且与工具调用关联的。本地 stdio client 在 Hub 持有字节时会收到
  `asset.localPath`，可直接打开而不必经过 loopback 下载；其他 client 使用带 capability 的
  HTTP `asset.url`。完整 URL 应视作临时密钥，不要持久化到日志中。
- 画布创作可通过完整 SHA-256 摘要引用本地资源仓库中已有的内容；字节只经过扩展内部桥接，
  不会进入工具参数。
- MCP 不再暴露 `resources/list` / `resources/read` 用于 asset 内容读取。
- HTTP 回退 URL 使用 `/{capability}/assets/{hash}`，也可能带图片扩展名（例如 `/{capability}/assets/{hash}.png`），两种文件名形式都支持。

## 配置

可选环境变量：

- `TEMPAD_MCP_TOOL_TIMEOUT`：常规工具调用超时时间（毫秒，默认 `15000`）。
- `TEMPAD_MCP_GET_CODE_TIMEOUT`：`get_code` 超时时间（毫秒，默认 `30000`；设置 `TEMPAD_MCP_TOOL_TIMEOUT` 时以其作为回退值）。
- `TEMPAD_MCP_GET_DESIGN_SYSTEM_TIMEOUT`：`get_design_system` 首次资源目录发现的超时时间（毫秒，默认 `45000`；续页、精确引用、字体和页面列表读取仍使用常规超时）。设置 `TEMPAD_MCP_TOOL_TIMEOUT` 时以其作为回退值。
- `TEMPAD_MCP_PAGE_STRUCTURE_TIMEOUT`：指定页面 ID 或 key 的 `get_structure` 超时时间（毫秒，默认 `45000`；冷页面可能需要先加载，节点和当前选择的读取仍使用常规超时）。设置 `TEMPAD_MCP_TOOL_TIMEOUT` 时以其作为回退值。
- `TEMPAD_MCP_APPLY_CANVAS_TIMEOUT`：`apply_canvas` 慢调用告警阈值（毫秒，默认 `120000`；设置 `TEMPAD_MCP_TOOL_TIMEOUT` 时以其作为回退值）。达到阈值的两倍时，Hub 会报告结果未知。继续写入前，既需要明确操作已结束或完成会话恢复，也需要读取该文件并获得至少一个结构根节点或代码结果，或通过 `get_structure` 获得指定页面的快照（含空页面）；空选区和失败的节点读取不计入。`CANVAS_APPLY_FAILED` 也要求读回，因为回滚结果未获确认，旧版扩展的此类错误同样如此。`CANVAS_APPLY_ABORTED` 确认写入前准备失败，无需额外读回文件。Undo 边界内的失败仍保留读回要求，因为回滚验证仅覆盖部分原生状态。重启 Hub 不会清除读回要求。请先检查画布，不要重放写入。
- `TEMPAD_MCP_AUTO_ACTIVATE_GRACE`：仅一个扩展连接时自动激活前的延迟（默认 `1500`）。
- `TEMPAD_MCP_MAX_ASSET_BYTES`：截图/资源捕获的最大上传体积（字节，默认 `8388608`）。
- `TEMPAD_MCP_MAX_ASSET_STORE_BYTES`：本地资源存储总量上限（字节，默认 `268435456`）。
- `TEMPAD_MCP_MAX_CONCURRENT_ASSET_UPLOADS`：资源并发上传上限（默认 `4`）。
- `TEMPAD_MCP_MAX_EXTENSION_CONNECTIONS`：单个 Hub 同时允许的浏览器扩展连接上限（默认 `16`）。
- `TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS`：允许连接的精确 `chrome-extension://...` Origin，以逗号分隔。配置值无效时启动会直接失败，而不会弱化策略；未配置时为了向后兼容会接受所有格式合法的 Chrome 扩展 Origin。
- `TEMPAD_MCP_ASSET_TTL_MS`：资源基于最近访问时间的清理 TTL（毫秒）；设置为 `0` 表示禁用（默认 `2592000000`）。
- `TEMPAD_MCP_RUNTIME_DIR`：运行时目录覆盖（默认为下述临时根目录中的 `run`）。
- `TEMPAD_MCP_STATE_DIR`：任务与反馈持久化目录覆盖（默认为 `~/.tempad-dev/state`；显式覆盖运行时目录时，默认为其中的 `state`）。隔离 Hub 检查使用临时目录。
- `TEMPAD_MCP_LOG_DIR`：日志目录覆盖（默认为临时根目录中的 `log`）。
- `TEMPAD_MCP_ASSET_DIR`：资源存储目录覆盖（默认为临时根目录中的 `assets`）。

Hub 在加载状态和资源之前，会独占锁定两个存储目录，即使另一个 Hub 使用了不同的运行时目录。
这些锁一直保留到进程退出，防止关闭期间的写入与接替的 Hub 重叠。旧版本不遵守新增的存储锁，
请勿让旧版本与当前版本同时使用同一存储目录。

Unix 上，覆盖后的运行时、状态、日志和资源目录必须属于当前用户，不能是符号链接，
并且不能允许用户组或其他用户访问（例如使用 `0700` 权限）。

首次连接前，临时连接故障有一个有界恢复窗口，覆盖 Hub 孤儿锁的 60 秒租期及后续启动时间；其他故障仍在三次尝试后停止。
重试耗尽时，CLI 会向 stderr 报告错误并退出。解决报告的问题后，重新连接 MCP 客户端即可重试。
桥接成功后，临时连接故障会持续自动重试；连续三次权限、信任或无效桥接故障仍会使 CLI 退出。

每个进程的日志文件上限为 10 MiB。超过上限时会丢弃该文件中的旧记录；单条超大记录会截断并注明。
已退出进程的日志在七天未写入后清理。这是单文件限制，不是整个目录的总配额。

Linux 上，运行时会以 `0700` 权限创建 `<系统临时目录>/tempad-dev`，或复用属于当前用户且权限为
`0700` 的既有目录，确保重启及升级后旧 hooks 和客户端仍连接同一个 Hub 与生命周期锁。
旧目录不安全（包括属于其他用户）时，改用 `<系统临时目录>/tempad-dev-<uid>`。
一旦已有私有 UID 目录，旧目录消失或后来出现空目录都不会切回；两个目录同时存在 socket 或 Hub
锁，或当前用户目录中的这些文件权限不安全时，会拒绝自动迁移。请先关闭既有运行时并修正所有者和权限。
其他平台仍使用 `<系统临时目录>/tempad-dev`；显式目录覆盖优先。Unix 客户端与生命周期 hooks
连接前会检查 socket 类型、所有者和私有权限，不可信时直接拒绝，不另启 Hub。Windows 保留已发布的
兼容管道名，托管运行时的控制与数据管道按用户和运行目录隔离。Windows 使用实际 ACL 校验，将托管
存储和端点的访问限制为当前用户、SYSTEM 与 Administrators，不依赖 Unix 权限位；路径或权限不可信时拒绝启动。

Hub 仅接受来自 Chrome 扩展 Origin、且目标为根路径的 WebSocket 握手。如需收紧安装环境，请将浏览器中显示的 TemPad Dev 扩展 Origin 写入 `TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS`。Origin 校验与每次进程启动生成的 asset capability 可以降低跨 Origin 的 loopback 滥用，但不能认证本机进程，包括先占用端口的其他操作系统用户进程；详见[本地 MCP 威胁模型](../../docs/security/local-mcp-threat-model.md)。

## 任务存储恢复

可能仍在执行的操作会在 Hub 重启后继续阻止该文件的写入；读取或恢复任务不会解除它。
重新连接原来的 Figma 浏览器后，经过验证的完成回执、标签页关闭或文档替换可以解除执行阻塞，随后仍须读回。
如果原来的浏览器无法再连接，请运行 `npx -y @tempad-dev/mcp@latest --runtime-status`
查看文件和执行环境，再在交互式终端运行 `npx -y @tempad-dev/mcp@latest --resolve-runtime-block <block-id>`。
只有关闭原来的执行环境后才能确认。命令无法停止远端代码；它会注销该次执行，保留 Stop 保护，
并要求显式恢复任务和读回，不会重放请求或重置任务存储。此操作仅提供终端入口，不向 MCP 工具或 Figma 页面开放。

不兼容的任务记录可能由新版 Hub 写入。这种情况下，请升级 MCP 运行时并重新连接所有客户端。
如果当前版本仍拒绝该记录，请保留快照用于诊断，或恢复经过验证、包含最新 Stop 保护的完整备份。
恢复命令会主动拒绝可读取的存储；不要删除存储来绕过保护。

任务存储无法安全读取时，错误会指出受影响的快照路径。读取仍然可用，但画布写入会在重启后
继续被阻止，因为快照可能包含永久 Stop 保护。Hub 会尽可能将无法读取的状态保存在 `.corrupt` 文件中。

恢复前，请断开所有 MCP 客户端，等待 Hub 退出，再修改状态。保留快照和任何 `.corrupt` 文件的副本，
将经过验证、包含最新 Stop 保护的完整快照原子替换到原路径，然后重新连接客户端。
恢复的有效快照可以正常使用，无需删除 `.corrupt` 中保留的证据。
如果旧版本曾隔离它无法识别的新格式数据，升级后 `.corrupt` 本身可能有效。
恢复前仍须确认它是最新的完整快照，不能仅凭文件名判断。

旧备份或残留 `.tmp` 文件可能早于某次 Stop 操作。没有可信的完整快照时，请断开所有 MCP 客户端，
运行 `npx -y @tempad-dev/mcp@latest --recover-task-storage`。请使用与 MCP 客户端配置相同的
`TEMPAD_MCP_STATE_DIR` 和 `TEMPAD_MCP_RUNTIME_DIR` 环境变量；命令不会读取客户端配置。
即使拒绝恢复，命令也会输出实际快照路径，请确认它指向受影响的存储。
命令会拒绝仍有写入者或可正常读取的存储，将原文件保存到输出的备份目录，并创建新一代任务状态。
所有旧任务继续失效：旧评论不能恢复执行，无任务的写入仍被阻止。此后每次 begin 都必须提供
`recoveryGeneration`，包括新会话和 Hub 重启之后。被拒绝的 begin 会在 `_meta.recoveryGeneration`
中向客户端提供该值，并在错误文本中向 agent 提供。每个新任务写入前都必须读取目标，此要求不会过期。
读取仍然可用。请保留备份；此操作不会恢复任务历史。不要删除隔离标记或用空状态绕过保护。

## 要求

- Node.js 22.x、24.x 或 26+。MCP 0.8.0 的运行时依赖要求较新的 Node.js 版本，已不再支持
  Node.js 18 或 20。
