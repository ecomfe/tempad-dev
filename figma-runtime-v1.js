"use strict";
var TemPadRewriteRuntimeV1 = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // rewrite/remote.ts
  var remote_exports = {};
  __export(remote_exports, {
    default: () => bundledRuntime
  });

  // public/rules/figma.json
  var figma_default = [
    {
      id: 1,
      priority: 10,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          {
            header: "Content-Security-Policy",
            operation: "remove"
          }
        ]
      },
      condition: {
        resourceTypes: ["main_frame"]
      }
    },
    {
      id: 2,
      priority: 1,
      action: {
        type: "redirect",
        redirect: {
          extensionPath: "/figma.js"
        }
      },
      condition: {
        regexFilter: "/webpack-artifacts/assets/(?:figma_app[^.]+|[0-9a-zA-Z-]+)\\.min\\.js(?:\\.br)?$",
        resourceTypes: ["script"]
      }
    },
    {
      id: 3,
      priority: 20,
      action: { type: "allow" },
      condition: {
        urlFilter: "tempad-fallback=1",
        requestDomains: ["www.figma.com"],
        resourceTypes: ["script"]
      }
    },
    {
      id: 99,
      priority: 1e3,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "Access-Control-Allow-Origin", operation: "set", value: "*" },
          { header: "Access-Control-Allow-Methods", operation: "set", value: "GET, OPTIONS" },
          { header: "Access-Control-Allow-Headers", operation: "set", value: "*" }
        ]
      },
      condition: {
        resourceTypes: ["xmlhttprequest"],
        initiatorDomains: ["www.figma.com"],
        requestDomains: ["ecomfe.github.io"],
        regexFilter: "/tempad-dev/(?:figma\\.(?:json|comply\\.json)|figma-runtime-v1\\.js)$"
      }
    }
  ];

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
  var REWRITE_RULE_ID = 2;
  function isRecord(value) {
    return value !== null && typeof value === "object";
  }
  function isRule(value) {
    if (!isRecord(value)) return false;
    return typeof value.id === "number" && isRecord(value.action) && isRecord(value.condition);
  }
  function isRules(value) {
    return Array.isArray(value) && value.every(isRule);
  }
  function getRewriteTargetRegex(source) {
    try {
      const rule = source.find((item) => item.id === REWRITE_RULE_ID);
      return rule?.condition?.regexFilter ? new RegExp(rule.condition.regexFilter, "i") : null;
    } catch {
      return null;
    }
  }
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

  // rewrite/transform.ts
  var REWRITE_RUNTIME_PROTOCOL = 1;
  function rewriteSource(source, groups) {
    return applyGroups(source, groups).content.replaceAll(
      "delete window.figma",
      "window.figma = undefined"
    );
  }
  var bundledRuntime = {
    protocol: REWRITE_RUNTIME_PROTOCOL,
    targetPattern: isRules(figma_default) && getRewriteTargetRegex(figma_default)?.source || "a^",
    rewrite: (source) => rewriteSource(source, GROUPS)
  };
  return __toCommonJS(remote_exports);
})();
