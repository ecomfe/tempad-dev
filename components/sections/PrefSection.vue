<script setup lang="ts">
import Select, { type SelectOption } from '@/components/Select.vue'
import IconButton from '@/components/IconButton.vue'
import Inspect from '@/components/icons/Inspect.vue'
import Measure from '@/components/icons/Measure.vue'
import Section from '@/components/Section.vue'
import PluginsSection from '@/components/sections/PluginsSection.vue'
import { useSelectAll } from '@/composables/input'
import { options } from '@/ui/state'

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

const fontSizeInput = useTemplateRef('fontSizeInput')
useSelectAll(fontSizeInput)

const scaleInput = useTemplateRef('scaleInput')
useSelectAll(scaleInput)

const cssUnitOptions = [
  { label: 'px', value: 'px' },
  { label: 'rem', value: 'rem' }
] as const satisfies SelectOption[]
</script>

<template>
  <Section ref="root" class="tp-pref">
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
      <Select
        id="css-unit"
        class="tp-pref-input"
        :options="cssUnitOptions"
        v-model="options.cssUnit"
      />
    </div>
    <div class="tp-row tp-row-justify tp-pref-field">
      <label for="root-font-size">Root font size</label>
      <input
        id="root-font-size"
        class="tp-pref-input"
        ref="fontSizeInput"
        type="number"
        v-model.number="options.rootFontSize"
      />
    </div>
    <div class="tp-row tp-row-justify tp-pref-field">
      <label for="scale">Scale</label>
      <input
        id="scale"
        class="tp-pref-input"
        ref="scaleInput"
        type="number"
        step="1"
        v-model.number="options.scale"
      />
    </div>
    <PluginsSection class="tp-pref-plugins" />
  </Section>
</template>

<style scoped>
.tp-pref {
  --tp-section-padding-bottom: 0;
}

.tp-pref-field + .tp-pref-field {
  margin-top: 8px;
}

.tp-pref-input {
  width: 80px;
}

.tp-pref-plugins {
  margin-top: 8px;
}

label {
  cursor: default;
}

[data-fpl-version='ui3'] label {
  color: var(--color-text-secondary);
}
</style>
