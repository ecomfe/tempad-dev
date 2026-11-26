# @tempad-dev/mcp

[简体中文](https://github.com/ecomfe/tempad-dev/blob/main/packages/mcp-server/README.zh-Hans.md)

Connect your coding agent to Figma. It can inspect selected layers and implement the design in your project. With edit access, it can also change the canvas in Design Mode.

## Connect to Figma

1. Install Node.js **22.x, 24.x, or 26+** and the [TemPad Dev Chrome extension](https://chromewebstore.google.com/detail/tempad-dev/lgoeakbaikpkihoiphamaeopmliaimpc) **1.0.0 or later**.
2. Open a Figma Design file and keep the TemPad Dev panel open. In **Preferences → Agent integration**, enable **MCP access**.
3. Click **Set up agents**, choose your client, and follow its instructions. If you have multiple Figma tabs open, click the **MCP** badge in the tab you want to use.

Select a layer in Figma and ask your agent **“How is my selection laid out?”**

### Manual configuration

For clients that use `mcpServers`, add the following entry to your MCP settings.

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

<a id="runtime-updates-100"></a>
<a id="moving-a-managed-hub-to-20"></a>

## Updates

The server downloads compatible updates in the background. If all connected clients support switching and have stable updates enabled, they stay connected while the server updates during an idle period. See [update controls and 1.x migration](https://github.com/ecomfe/tempad-dev/blob/main/packages/mcp-server/RUNTIME.md#runtime-update-controls).

[Tool reference](https://github.com/ecomfe/tempad-dev/blob/main/README.md#mcp-tools) · [Configuration and recovery](https://github.com/ecomfe/tempad-dev/blob/main/packages/mcp-server/RUNTIME.md#configuration)
