<script lang="ts" setup>
import { options } from "@/entrypoints/ui/state";
import IconButton from "../IconButton.vue";
import Section from "../Section.vue";
import Inspect from "../icons/Inspect.vue";
import Measure from "../icons/Measure.vue";
</script>

<template>
  <Section>
    <div class="tp-row tp-pref-tools">
      <IconButton
        title="Deep select"
        toggle="subtle"
        v-model:selected="options.deepSelectOn"
      >
        <Inspect class="tp-pref-tools-icon" />
      </IconButton>
      <IconButton
        title="Measure to selection"
        toggle="subtle"
        v-model:selected="options.measureOn"
      >
        <Measure class="tp-pref-tools-icon" />
      </IconButton>
    </div>
  </Section>
</template>

<style scoped>
.tp-pref-tools {
  gap: 4px;
}

.tp-pref-tools-icon {
  width: auto;
  height: 16px;
}
</style>
