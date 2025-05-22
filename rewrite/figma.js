// rewrite/config.ts
var SRC_PATTERN = /\/figma_app/;
var REWRITE_PATTERN = /\.appModel\.isReadOnly/g;
var REWRITE_REPLACER = ".appModel.__isReadOnly__";
var MARKERS = [".appModel.isReadOnly"];
function matchFile(src, content) {
  return SRC_PATTERN.test(src) && MARKERS.every((marker) => content.includes(marker));
}

// rewrite/figma.ts
async function rewriteScript() {
  const current = document.currentScript;
  const src = current.src;
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
    }
    content = content.replaceAll("document.currentScript.src", `"${src}"`);
    content = content.replaceAll("delete window.figma", "window.figma = undefined");
    new Function(content)();
  } catch {
    replaceScript(`${src}?fallback`);
  }
}
rewriteScript();
