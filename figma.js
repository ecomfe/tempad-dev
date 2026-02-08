"use strict";
(() => {
  // rewrite/config.ts
  var GROUPS = [
    {
      markers: [".appModel.isReadOnly"],
      replacements: [
        {
          pattern: ".appModel.isReadOnly",
          replacer: ".appModel.__isReadOnly__"
        }
      ]
    },
    {
      markers: ['{type:"global",closePluginFunc:'],
      replacements: [
        {
          pattern: /{type:"global",closePluginFunc:[A-Za-z_$][A-Za-z0-9_$]*}/,
          replacer: '{type:"global",closePluginFunc:()=>{}}'
        }
      ]
    },
    {
      markers: ["let{canRunExtensions:"],
      replacements: [
        {
          pattern: /let\{canRunExtensions:([A-Za-z_$][A-Za-z0-9_$]*),canAccessFullDevMode:([A-Za-z_$][A-Za-z0-9_$]*)\}=([A-Za-z_$][A-Za-z0-9_$]*).openFile;/,
          replacer: "let{canRunExtensions:$1,canAccessFullDevMode:$2}=$3.openFile;$1=true;"
        }
      ]
    }
  ];

  // utils/log.ts
  var PREFIX = "[tempad-dev]";
  var withPrefix = (args) => {
    if (!args.length) return [PREFIX];
    const [first, ...rest] = args;
    if (typeof first === "string") {
      if (first.startsWith(PREFIX)) return args;
      return [`${PREFIX} ${first}`, ...rest];
    }
    return [PREFIX, ...args];
  };
  var logger = {
    log: (...args) => {
      console.log(...withPrefix(args));
    },
    warn: (...args) => {
      console.warn(...withPrefix(args));
    },
    error: (...args) => {
      console.error(...withPrefix(args));
    },
    debug: (...args) => {
      if (!__DEV__) return;
      if (typeof console.debug === "function") {
        console.debug(...withPrefix(args));
        return;
      }
      console.log(...withPrefix(args));
    }
  };

  // rewrite/shared.ts
  function applyReplacement(content, replacement) {
    const { pattern, replacer } = replacement;
    if (typeof pattern === "string") {
      if (typeof replacer === "string") {
        return content.replaceAll(pattern, replacer);
      }
      return content.replaceAll(pattern, replacer);
    }
    if (typeof replacer === "string") {
      return content.replace(pattern, replacer);
    }
    return content.replace(pattern, replacer);
  }
  function groupMatches(content, group) {
    const markers = group.markers || [];
    return markers.every((marker) => content.includes(marker));
  }
  function applyGroups(content, groups, options = {}) {
    let out = content;
    const matchedGroups = [];
    const rewrittenGroups = [];
    const replacementStats = [];
    const { logReplacements = true } = options;
    for (const [index, group] of groups.entries()) {
      if (!groupMatches(out, group)) {
        continue;
      }
      matchedGroups.push(index);
      let groupChanged = false;
      for (const [replacementIndex, replacement] of group.replacements.entries()) {
        const { pattern, replacer } = replacement;
        const before = out;
        out = applyReplacement(out, replacement);
        const changed = out !== before;
        replacementStats.push({ groupIndex: index, replacementIndex, changed });
        if (changed) {
          groupChanged = true;
          if (logReplacements) {
            logger.log(`Applied replacement: ${pattern} -> ${replacer}`);
          }
        } else {
          if (logReplacements) {
            logger.warn(`Replacement had no effect: ${pattern} -> ${replacer}`);
          }
        }
      }
      if (groupChanged) {
        rewrittenGroups.push(index);
      }
    }
    return {
      content: out,
      changed: out !== content,
      matchedGroups,
      rewrittenGroups,
      replacementStats
    };
  }

  // rewrite/runtime.ts
  var FIGMA_DELETE_PATCH_TARGET = "delete window.figma";
  var FIGMA_DELETE_PATCH_VALUE = "window.figma = undefined";
  function getCurrentScript() {
    const current = document.currentScript;
    if (!(current instanceof HTMLScriptElement) || !current.src) {
      return null;
    }
    return current;
  }
  function replaceScript(current, src) {
    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    current.replaceWith(script);
  }
  function withCurrentScript(current, run) {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "currentScript");
    Object.defineProperty(document, "currentScript", {
      configurable: true,
      get() {
        return current;
      }
    });
    try {
      run();
    } finally {
      if (descriptor) {
        Object.defineProperty(document, "currentScript", descriptor);
      } else {
        Reflect.deleteProperty(document, "currentScript");
      }
    }
  }
  function patchFigmaDelete(code) {
    return code.replaceAll(FIGMA_DELETE_PATCH_TARGET, FIGMA_DELETE_PATCH_VALUE);
  }
  async function rewriteCurrentScript(groups) {
    const current = getCurrentScript();
    if (!current) {
      return;
    }
    const src = current.src;
    try {
      const response = await fetch(src);
      const original = await response.text();
      const { content: rewritten, changed } = applyGroups(original, groups);
      if (changed) {
        logger.log(`Rewrote script: ${src}`);
      }
      const content = patchFigmaDelete(rewritten);
      withCurrentScript(current, () => {
        new Function(content)();
      });
    } catch (error) {
      logger.error(error);
      replaceScript(current, `${src}?fallback`);
    }
  }

  // rewrite/figma.ts
  rewriteCurrentScript(GROUPS);
})();
