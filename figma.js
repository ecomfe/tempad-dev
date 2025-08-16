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

  // rewrite/figma.ts
  async function rewriteScript() {
    const current = document.currentScript;
    const src = current.src;
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, "currentScript");
    function replaceScript(src2) {
      const script = document.createElement("script");
      script.src = src2;
      script.defer = true;
      current.replaceWith(script);
    }
    function applyGroup(content, group) {
      const markers = group.markers || [];
      if (!markers.every((marker) => content.includes(marker))) {
        return content;
      }
      let out = content;
      for (const { pattern, replacer } of group.replacements) {
        if (typeof pattern === "string") {
          out = out.replaceAll(pattern, replacer);
        } else {
          out = out.replace(pattern, replacer);
        }
      }
      return out;
    }
    try {
      const original = await (await fetch(src)).text();
      let content = original;
      for (const group of GROUPS) {
        content = applyGroup(content, group);
      }
      if (content !== original) {
        console.log(`Rewrote script: ${src}`);
      }
      content = content.replaceAll("delete window.figma", "window.figma = undefined");
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
      Object.defineProperty(document, "currentScript", desc);
    }
  }
  rewriteScript();
})();
