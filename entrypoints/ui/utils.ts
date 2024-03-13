const metaKey = Reflect.getOwnPropertyDescriptor(
  MouseEvent.prototype,
  "metaKey"
)!;
const altKey = Reflect.getOwnPropertyDescriptor(
  MouseEvent.prototype,
  "altKey"
)!;

export function setLockMetaKey(lock: boolean) {
  if (lock) {
    Reflect.defineProperty(MouseEvent.prototype, "metaKey", {
      get: () => true,
    });
  } else {
    Reflect.defineProperty(MouseEvent.prototype, "metaKey", metaKey);
  }
}

export function setLockAltKey(lock: boolean) {
  if (lock) {
    Reflect.defineProperty(MouseEvent.prototype, "altKey", {
      get: () => true,
    });
  } else {
    Reflect.defineProperty(MouseEvent.prototype, "altKey", altKey);
  }
}

export function serializeCSS(style: Record<string, string>, toJS = false) {
  if (toJS) {
    return (
      "{\n" +
      Object.entries(style)
        .map(
          ([key, value]) => `  ${kebabToCamel(key)}: ${JSON.stringify(value)},`
        )
        .join("\n") +
      "\n}"
    );
  }

  return Object.entries(style)
    .map(([key, value]) => `${key}: ${value};`)
    .join("\n");
}

export function kebabToCamel(str: string) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

const COMPONENT_RE =
  /<>[\s\n]+<Stack[^>]*>[\s\n]+([\s\S]+?)[\s\n]+<\/Stack>[\s\n]+<\/>/;
const COMPONENT_PROVIDER_RE =
  /<ProviderConfig[^>]*>[\s\n]+<Stack[^>]*>[\s\n]+([\s\S]+?)[\s\n]+<\/Stack>[\s\n]+<\/ProviderConfig>/;
export function extractJSX(code: string) {
  const [, jsx] =
    code.match(COMPONENT_RE) || code.match(COMPONENT_PROVIDER_RE) || [];
  return jsx || "";
}
