import { onMounted } from "vue";
import { selection } from "../state";

export function useSelection(canvas: HTMLElement) {
  onMounted(() => {
    selection.value = figma.currentPage.selection;

    canvas.addEventListener("click", () => {
      selection.value = figma.currentPage.selection;
    })
  })
}