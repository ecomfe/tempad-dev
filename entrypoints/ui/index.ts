import waitFor from "p-wait-for";
import { createApp } from "vue";
import App from "./App.vue";

import "./style.css";

export default defineUnlistedScript(async () => {
  await waitFor(() => window.figma != null);

  createApp(App).mount("tempad");
});
