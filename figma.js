"use strict";
(() => {
  // rewrite/config.ts
  var GROUPS = [
    {
      markers: [".appModel.isReadOnly"],
      replacements: [
        {
          pattern: /\.appModel\.isReadOnly/g,
          replacer: ".appModel.__isReadOnly__"
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
    }
  ];

  // rewrite/shared.ts
  function groupMatches(content, group) {
    const markers = group.markers || [];
    return markers.every((marker) => content.includes(marker));
  }
  function applyGroups(content, groups) {
    let out = content;
    for (const group of groups) {
      if (!groupMatches(out, group)) {
        continue;
      }
      for (const { pattern, replacer } of group.replacements) {
        if (typeof pattern === "string") {
          out = out.replaceAll(pattern, replacer);
        } else {
          out = out.replace(pattern, replacer);
        }
      }
    }
    return { content: out, changed: out !== content };
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
        console.log(`[tempad-dev] Rewrote script: ${src}`);
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
      console.error(e);
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
