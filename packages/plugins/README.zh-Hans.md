# @tempad-dev/plugins

用于在 TemPad Dev 内创建自定义代码生成器的开发者工具。本包提供类型安全的辅助函数、转换钩子和遍历工具，帮助你将检查器的输出适配到你自己的设计系统或工作流程中。

## 安装

```sh
# npm
npm install -D @tempad-dev/plugins
```

## 快速开始

创建一个新的 JavaScript 或 TypeScript 文件，使用 `definePlugin` 导出一个插件：

```ts
import { definePlugin } from '@tempad-dev/plugins'

export default definePlugin({
  name: 'My Plugin',
  code: {
    css: {
      title: 'SCSS',
      lang: 'scss',
      transform({ code }) {
        return code.replace(/px/g, 'rem')
      }
    },
    js: false // 隐藏内置的 JavaScript 代码块
  }
})
```

当该文件托管在某个可访问的位置后（例如 GitHub 的 raw URL），将 URL 粘贴到
TemPad Dev 的 **Preferences → Plugins** 面板中即可加载。

## 插件结构

每个插件都会导出一个包含 `name` 与 `code` 映射的对象。`code` 映射决定 TemPad Dev 会渲染哪些代码块。你可以覆盖内置的 `css` 和 `js` 代码块，也可以引入自己的代码块：

```ts
definePlugin({
  name: 'Tailwind Adapter',
  code: {
    css: false,
    tailwind: {
      title: 'Tailwind',
      lang: 'js',
      transform({ style }) {
        return toTailwind(style)
      }
    }
  }
})
```

`code` 中的每一项都支持以下配置：

- `title`：覆盖代码块标题。
- `lang`：设置语法高亮语言（`css`、`scss`、`js`、`json` 等）。
- `transform`：接收生成的 CSS 字符串，以及解析后的 `style` 对象。
- `transformVariable`：允许在输出前重映射 CSS 变量。
- `transformPx`：转换数值型像素值（会遵循用户设置，例如 `useRem`）。
- `transformComponent`：将 Figma 实例转换为更高层级的开发侧组件表示。

将某个代码块设置为 `false`，即可将其从 UI 中完全移除。

### 详解 Transform 钩子

```ts
transform({ code, style, options })
```

- `code`：TemPad Dev 生成的规范化 CSS 字符串。
- `style`：以 CSS 属性为 key 的普通对象。
- `options.useRem`：用户偏好，表示是否应将 px 转换为 rem。
- `options.rootFontSize`：用于 rem 计算的参考字体大小。

```ts
transformVariable({ code, name, value, options })
```

- `code`：完整的 `var(--token, fallback)` 片段。
- `name`：变量令牌名称。
- `value`：若存在，原始的 fallback 值。

```ts
transformPx({ value, options })
```

- `value`：TemPad Dev 即将输出的数值型像素值。

```ts
transformComponent({ component })
```

- `component`：表示当前被检查的 Figma 实例的 `DesignComponent`。
  返回值可以是可序列化的 `DevComponent` 树（通过 `h` 构建），也可以是字符串。

### 构建组件树

使用类 JSX 的 `h` 辅助函数来组合嵌套结构：

```ts
import { definePlugin, h } from '@tempad-dev/plugins'

export default definePlugin({
  name: 'React Output',
  code: {
    component: {
      title: 'Component',
      lang: 'tsx',
      transformComponent({ component }) {
        return h('Card', { variant: component.properties.variant }, [
          h('Heading', { level: 2 }, [component.properties.title]),
          h('Button', { intent: 'primary' }, ['Submit'])
        ])
      }
    }
  }
})
```

TemPad Dev 会将返回的 `DevComponent` 序列化为 JSX/TSX 并展示出来。

### 遍历设计节点

插件经常需要在被检查的节点树中查找内容。我们导出了以下辅助函数：

```ts
findChild(container, query)
findChildren(container, query)
findOne(container, query)
findAll(container, query)
queryOne(container, queries)
queryAll(container, queries)
```

查询条件既可以是简单的属性过滤（例如 `{ type: 'TEXT', name: /Title/ }`），也可以是自定义谓词函数。
`queryAll` 和 `queryOne` 支持串联多个查找步骤，例如先找到 footer 的 frame，再找到其中的所有 button。
完整文档以及 `DesignNode`、`DesignComponent` 等相关结构的类型定义，请参见 `plugins/src/index.ts`。

## 调试与测试

- 使用 TemPad Dev 的预览面板检查插件最终渲染出的代码块。
- 开发期间，你可以把插件通过开发服务器（Vite、Next 等）在本地跑起来，然后在 TemPad Dev 中引用本地网络 URL。
- 建议为 transform 函数编写单元测试：直接导入这些函数，并传入模拟的节点数据。

## 发布

1. 构建你的插件产物（如果使用 TypeScript 或较新的语法）。
2. 将生成文件托管在支持跨域请求的位置（GitHub raw、CDN 等）。
3. 可选：向 `packages/extension/plugins/available-plugins.json` 贡献条目，让用户可以通过名称加载你的插件。

## 更多资源

- 项目根目录 README：了解 TemPad Dev 的功能，以及插件注册表的约定与期望。
- `plugins/src/index.ts`：所有导出类型的权威来源，包含大量内联文档与示例。
- 示例插件：<https://github.com/Justineo/tempad-dev-plugin-kong>

如果你遇到限制，或对新的辅助 API 有想法，欢迎在本仓库提交 issue 或 pull request，让插件开发更轻松。
