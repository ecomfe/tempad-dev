import { useClipboard } from "@vueuse/core";
import { toValue } from "vue";
import type { MaybeRefOrGetter } from "vue";

export function useCopy(
  content: MaybeRefOrGetter<HTMLElement | string | undefined>
) {
  const { copy } = useClipboard();

  return () => {
    try {
      const value = toValue(content);
      copy(typeof value === "string" ? value : value?.textContent || "");
      figma.notify("Copied to clipboard");
    } catch (e) {
      console.error(e);
    }
  };
}
