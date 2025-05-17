export const REWRITE_PATTERN =
  /({userID:(\w+)}=(\w+),(\w+)=(\w+)\|\|!!\2&&(\w+);)if\(!\4\){([\s\S]+?);\4&&/

export const REWRITE_REPLACER = '$1if(false){$7;true&&'

const MARKERS = ['.resetGlobalPluginAPI', '.createAPI()']

export function matchFile(content: string) {
  return MARKERS.every((marker) => content.includes(marker))
}
