<script lang="ts" setup>
import { options } from '@/entrypoints/ui/state'
import IconButton from '../IconButton.vue'
import Section from '../Section.vue'
import Inspect from '../icons/Inspect.vue'
import Measure from '../icons/Measure.vue'
</script>

<template>
  <Section>
    <div class="tp-row tp-row-justify tp-pref-field">
      <label>Tools</label>
      <div class="tp-row tp-pref-tools">
        <IconButton title="Deep select" toggle="subtle" v-model:selected="options.deepSelectOn">
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
    </div>
    <div class="tp-row tp-row-justify tp-pref-field">
      <label for="css-unit">CSS unit</label>
      <select id="css-unit" class="tp-pref-input" v-model="options.cssUnit">
        <option value="px">px</option>
        <option value="rem">rem</option>
      </select>
    </div>
    <div class="tp-row tp-row-justify tp-pref-field">
      <label for="root-font-size">Root font size</label>
      <input
        id="root-font-size"
        class="tp-pref-input"
        type="number"
        v-model.number="options.rootFontSize"
      />
    </div>
  </Section>
</template>

<style scoped>
.tp-pref-field + .tp-pref-field {
  margin-top: 8px;
}

.tp-pref-tools {
  gap: 4px;
}

.tp-pref-tools-icon {
  width: auto;
  height: 16px;
}

.tp-pref-input {
  width: 80px;
}

label {
  cursor: default;
}
</style>
