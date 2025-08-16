"use strict";
(() => {
  // rewrite/config.ts
  var SRC_PATTERN = /\/figma_app/;
  var REWRITE_PATTERN = /\.appModel\.isReadOnly/g;
  var REWRITE_REPLACER = ".appModel.__isReadOnly__";
  var MARKERS = [".appModel.isReadOnly"];
  function matchFile(src, content) {
    return SRC_PATTERN.test(src) && MARKERS.every((marker) => content.includes(marker));
  }

  // rewrite/patch.ts
  var EXT_SCHEMES = /(?:chrome|moz)-extension:\/\//g;
  var PATCHED = Symbol();
  function sanitizeStack(text = "") {
    return text.replace(EXT_SCHEMES, "");
  }
  function patchErrorStack() {
    if (globalThis[PATCHED]) return;
    const NativeError = globalThis.Error;
    function Error(...args) {
      const error = new NativeError(...args);
      if (typeof NativeError.captureStackTrace === "function") {
        NativeError.captureStackTrace(error, Error);
      }
      let rawStack;
      try {
        rawStack = error.stack;
      } catch {
      }
      if (typeof rawStack === "string") {
        let stored = rawStack;
        Object.defineProperty(error, "stack", {
          configurable: true,
          enumerable: false,
          get() {
            return sanitizeStack(stored);
          },
          set(v) {
            stored = v;
          }
        });
      }
      return error;
    }
    Object.setPrototypeOf(Error, NativeError);
    Error.prototype = NativeError.prototype;
    globalThis.Error = Error;
    Object.defineProperty(globalThis, PATCHED, {
      value: true,
      writable: false,
      enumerable: false,
      configurable: false
    });
  }

  // rewrite/figma.ts
  patchErrorStack();
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
    try {
      let content = await (await fetch(src)).text();
      if (matchFile(src, content)) {
        content = content.replace(REWRITE_PATTERN, REWRITE_REPLACER);
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
