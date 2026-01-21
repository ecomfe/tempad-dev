"use strict";
(() => {
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
      markers: ["const __html__ = (() => {"],
      replacements: [
        {
          pattern: /([A-Za-z_$][A-Za-z0-9_$]*)=\(0,([A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$][A-Za-z0-9_$]*)\)\(\)\|\|([A-Za-z_$][A-Za-z0-9_$]*);if\(!\1\)/,
          replacer: "$1=(0,$2)()||$3;if(false)"
        },
        {
          pattern: /if\(\(0,([A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$][A-Za-z0-9_$]*)\)\(\)\)return;([A-Za-z_$][A-Za-z0-9_$]*)&&/,
          replacer: "if((0,$1)())return;true&&"
        }
      ]
    },
    {
      markers: ["dispnf.fyufotjpo;00", "np{.fyufotjpo;00"],
      replacements: [
        {
          pattern: /dispnf\.fyufotjpo;00|np{\.fyufotjpo;00/g,
          replacer: "FIGMA_PLEASE_STOP"
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
      markers: ["ext_init_wdf"],
      replacements: [
        {
          pattern: "ext_init_wdf",
          replacer: "__ext_init_wdf__"
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

  // rewrite/shared.ts
  function groupMatches(content, group) {
    const markers = group.markers || [];
    return markers.every((marker) => content.includes(marker));
  }
  function applyGroups(content, groups) {
    let out = content;
    const matchedGroups = [];
    const rewrittenGroups = [];
    for (const [index, group] of groups.entries()) {
      if (!groupMatches(out, group)) {
        continue;
      }
      matchedGroups.push(index);
      let groupChanged = false;
      for (const { pattern, replacer } of group.replacements) {
        const before = out;
        if (typeof pattern === "string") {
          out = out.replaceAll(pattern, replacer);
        } else {
          out = out.replace(pattern, replacer);
        }
        if (out !== before) {
          groupChanged = true;
          logger.log(`Applied replacement: ${pattern} -> ${replacer}`);
        } else {
          logger.warn(`Replacement had no effect: ${pattern} -> ${replacer}`);
        }
      }
      if (groupChanged) {
        rewrittenGroups.push(index);
      }
    }
    return { content: out, changed: out !== content, matchedGroups, rewrittenGroups };
  }

  // rewrite/figma.ts
  async function rewriteScript() {
    const current = document.currentScript;
    const src = current?.src;
    if (!current || !src) {
      return;
    }
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, "currentScript");
    function replaceScript(src2) {
      const script = document.createElement("script");
      script.src = src2;
      script.defer = true;
      current.replaceWith(script);
    }
    try {
      const response = await fetch(src);
      const original = await response.text();
      const { content: afterRules, changed } = applyGroups(original, GROUPS);
      if (changed) {
        logger.log(`Rewrote script: ${src}`);
      }
      const content = afterRules.replaceAll("delete window.figma", "window.figma = undefined");
      Object.defineProperty(document, "currentScript", {
        configurable: true,
        get() {
          return current;
        }
      });
      new Function(content)();
    } catch (e) {
      logger.error(e);
      replaceScript(`${src}?fallback`);
    } finally {
      if (desc) {
        Object.defineProperty(document, "currentScript", desc);
      } else {
        delete document.currentScript;
      }
    }
  }
  rewriteScript();
})();
