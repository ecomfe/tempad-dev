---
name: figma-canvas-authoring
description: Guide Figma authoring requests from older standalone TemPad Dev installations to the design-in-figma skill.
---

Use the installed `design-in-figma` skill for this request. If it is missing,
show the user the command to install it from the TemPad Dev repository:

```sh
npx skills add https://github.com/ecomfe/tempad-dev/tree/main/agent-plugin/targets/standard/skills --skill design-in-figma
```

After refreshing the host's skill list, invoke `design-in-figma`. The old
`figma-canvas-authoring` entry can then be removed from the standalone installation.
