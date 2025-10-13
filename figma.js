"use strict";
(() => {
  // node_modules/.pnpm/p-timeout@6.1.4/node_modules/p-timeout/index.js
  var TimeoutError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "TimeoutError";
    }
  };
  var AbortError = class extends Error {
    constructor(message) {
      super();
      this.name = "AbortError";
      this.message = message;
    }
  };
  var getDOMException = (errorMessage) => globalThis.DOMException === void 0 ? new AbortError(errorMessage) : new DOMException(errorMessage);
  var getAbortedReason = (signal) => {
    const reason = signal.reason === void 0 ? getDOMException("This operation was aborted.") : signal.reason;
    return reason instanceof Error ? reason : getDOMException(reason);
  };
  function pTimeout(promise, options) {
    const {
      milliseconds,
      fallback,
      message,
      customTimers = { setTimeout, clearTimeout }
    } = options;
    let timer;
    let abortHandler;
    const wrappedPromise = new Promise((resolve, reject) => {
      if (typeof milliseconds !== "number" || Math.sign(milliseconds) !== 1) {
        throw new TypeError(`Expected \`milliseconds\` to be a positive number, got \`${milliseconds}\``);
      }
      if (options.signal) {
        const { signal } = options;
        if (signal.aborted) {
          reject(getAbortedReason(signal));
        }
        abortHandler = () => {
          reject(getAbortedReason(signal));
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      }
      if (milliseconds === Number.POSITIVE_INFINITY) {
        promise.then(resolve, reject);
        return;
      }
      const timeoutError = new TimeoutError();
      timer = customTimers.setTimeout.call(void 0, () => {
        if (fallback) {
          try {
            resolve(fallback());
          } catch (error) {
            reject(error);
          }
          return;
        }
        if (typeof promise.cancel === "function") {
          promise.cancel();
        }
        if (message === false) {
          resolve();
        } else if (message instanceof Error) {
          reject(message);
        } else {
          timeoutError.message = message ?? `Promise timed out after ${milliseconds} milliseconds`;
          reject(timeoutError);
        }
      }, milliseconds);
      (async () => {
        try {
          resolve(await promise);
        } catch (error) {
          reject(error);
        }
      })();
    });
    const cancelablePromise = wrappedPromise.finally(() => {
      cancelablePromise.clear();
      if (abortHandler && options.signal) {
        options.signal.removeEventListener("abort", abortHandler);
      }
    });
    cancelablePromise.clear = () => {
      customTimers.clearTimeout.call(void 0, timer);
      timer = void 0;
    };
    return cancelablePromise;
  }

  // node_modules/.pnpm/p-wait-for@5.0.2/node_modules/p-wait-for/index.js
  var resolveValue = Symbol("resolveValue");
  async function pWaitFor(condition, options = {}) {
    const {
      interval = 20,
      timeout = Number.POSITIVE_INFINITY,
      before = true
    } = options;
    let retryTimeout;
    let abort = false;
    const promise = new Promise((resolve, reject) => {
      const check = async () => {
        try {
          const value = await condition();
          if (typeof value === "object" && value[resolveValue]) {
            resolve(value[resolveValue]);
          } else if (typeof value !== "boolean") {
            throw new TypeError("Expected condition to return a boolean");
          } else if (value === true) {
            resolve();
          } else if (!abort) {
            retryTimeout = setTimeout(check, interval);
          }
        } catch (error) {
          reject(error);
        }
      };
      if (before) {
        check();
      } else {
        retryTimeout = setTimeout(check, interval);
      }
    });
    if (timeout === Number.POSITIVE_INFINITY) {
      return promise;
    }
    try {
      return await pTimeout(promise, typeof timeout === "number" ? { milliseconds: timeout } : timeout);
    } finally {
      abort = true;
      clearTimeout(retryTimeout);
    }
  }
  pWaitFor.resolveWith = (value) => ({ [resolveValue]: value });

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
  async function waitRuntimeReady() {
    const getQueue = () => window.webpackChunk_figma_web_bundler ||= [];
    await pWaitFor(() => {
      const queue = getQueue();
      return typeof queue.push === "function" && queue.push !== Array.prototype.push;
    });
  }
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
        console.log(`Rewrote script: ${src}`);
      }
      const content = afterRules.replaceAll("delete window.figma", "window.figma = undefined");
      await waitRuntimeReady();
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
