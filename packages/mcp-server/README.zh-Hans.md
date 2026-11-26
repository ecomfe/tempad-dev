# @tempad-dev/mcp

[English](https://github.com/ecomfe/tempad-dev/blob/main/packages/mcp-server/README.md)

把编程助手连接到 Figma，让它读取选中图层的布局，在项目中实现设计。有文件编辑权限时，还可以让它在设计模式下直接修改画布。

## 连接 Figma

1. 安装 Node.js **22.x、24.x 或 26+**，以及 **1.0.0 或更高版本**的 [TemPad Dev 浏览器扩展](https://chromewebstore.google.com/detail/tempad-dev/lgoeakbaikpkihoiphamaeopmliaimpc)。
2. 打开 Figma Design 文件，保持 TemPad Dev 面板打开。在 **Preferences → Agent integration** 中启用 **MCP access**。
3. 点击 **Set up agents**，选择你的客户端，按提示完成配置。如果打开了多个 Figma 标签页，点击目标标签页里的 **MCP** 徽标。

在 Figma 里选中一个图层，试着问助手 **“我选中的图层是怎么布局的？”**

### 手动配置

如果客户端使用 `mcpServers`，将以下条目加入它的 MCP 配置。

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

<a id="运行时更新100"></a>
<a id="将托管-hub-升级到-20"></a>

## 更新

服务会在后台下载兼容更新。如果已连接的客户端都支持切换并启用了稳定版更新，服务就会在空闲时自动更新，客户端保持连接。详见[更新控制与 1.x 迁移说明](https://github.com/ecomfe/tempad-dev/blob/main/packages/mcp-server/RUNTIME.zh-Hans.md#运行时更新控制)。

[工具参考](https://github.com/ecomfe/tempad-dev/blob/main/README.zh-Hans.md#mcp-工具) · [配置与故障恢复](https://github.com/ecomfe/tempad-dev/blob/main/packages/mcp-server/RUNTIME.zh-Hans.md#配置)
