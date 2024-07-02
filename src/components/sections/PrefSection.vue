<script lang="ts" setup>
import { ref, watch } from 'vue'
import { options } from '@/entrypoints/ui/state'
import { useSelectAll } from '@/entrypoints/ui/composables/input'
import IconButton from '../IconButton.vue'
import Section from '../Section.vue'
import Inspect from '../icons/Inspect.vue'
import Measure from '../icons/Measure.vue'

const root = ref<InstanceType<typeof Section> | null>(null)

watch(
  () => options.value.prefOpen,
  (open) => {
    if (open) {
      root.value?.$el.scrollIntoView()
    }
  },
  {
    flush: 'post'
  }
)

const input = ref<HTMLInputElement | null>(null)
useSelectAll(input)
</script>

<template>
  <Section ref="root">
    <div class="tp-row tp-row-justify tp-pref-field">
      <label>Tools</label>
      <div class="tp-row tp-gap">
        <IconButton title="Deep select" toggle="subtle" v-model:selected="options.deepSelectOn">
          <Inspect />
        </IconButton>
        <IconButton
          title="Measure to selection"
          toggle="subtle"
          v-model:selected="options.measureOn"
        >
          <Measure />
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
        ref="input"
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

.tp-pref-input {
  width: 80px;
}

label {
  cursor: default;
}

[data-fpl-version='ui3'] label {
  color: var(--color-text-secondary);
}
</style>
