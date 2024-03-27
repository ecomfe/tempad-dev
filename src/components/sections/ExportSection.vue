<script lang="ts" setup>
import { computed, ref } from 'vue'
import Section from '../Section.vue'
import Copyable from '../Copyable.vue'
import IconButton from '../IconButton.vue'
import Badge from '../Badge.vue'
import Plus from '../icons/Plus.vue'

import {
  selection,
  selectedNode,
  options,
  selectedTemPadComponent,
  ScaleSelectionType,
  useGlobalState
} from '@/entrypoints/ui/state'

const { scaleInputs } = useGlobalState()

const currentSelection = computed(() => scaleInputs.value[0])

const scaleOptions = [
  { value: '0.5x', label: '0.5x' },
  { value: '1x', label: '1x' },
  { value: '1.5x', label: '1.5x' },
  { value: '2x', label: '2x' },
  { value: '3x', label: '3x' },
  { value: '4x', label: '4x' },
  { value: '512w', label: '512w' },
  { value: '512h', label: '512h' }
]

const fileTypes = [
  { value: 'PNG', label: 'PNG' },
  { value: 'JPG', label: 'JPG' },
  { value: 'SVG', label: 'SVG' }
]

function downloadBlobAsImage(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName || 'download.png' // 设置下载的文件名，默认为 'download.png'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function exportImage() {
  const node = selectedNode.value
  const exportSetting: ExportSettings = {
    format: currentSelection.value.fileType,
    suffix: currentSelection.value.suffix
  }
  if (currentSelection.value.fileType !== 'SVG') {
    Object.assign(exportSetting, {
      constraint: {
        type: 'SCALE',
        value: parseFloat(currentSelection.value.scale)
      }
    })
  }
  const u8Array = await node.exportAsync(exportSetting)
  const blob = new Blob([u8Array], {
    type: `image/${currentSelection.value.fileType.toLowerCase()}`
  })
  downloadBlobAsImage(blob, selectedNode.value.name + '.png')
}

function handleFileSelectChange(select: ScaleSelectionType) {
  if (select.fileType === 'SVG') {
    select.scale = '1x'
  }
}
</script>

<template>
  <Section class="tp-export" v-if="scaleInputs.length">
    <div
      class="tp-row tp-row-justify tp-pref-field tp-export-item"
      v-for="(selection, index) in scaleInputs"
      :key="`scale-${index}`"
    >
      <select
        id="scale"
        class="tp-pref-input"
        v-model="selection.scale"
        :disabled="selection.fileType === 'SVG'"
      >
        <option v-for="scale in scaleOptions" :value="scale.value">{{ scale.label }}</option>
      </select>
      <input
        id="suffix"
        class="tp-export-input"
        type="number"
        placeholder="Suffix"
        v-model="selection.suffix"
      />
      <select
        id="fileType"
        class="tp-pref-input"
        v-model="selection.fileType"
        @change="handleFileSelectChange(selection)"
      >
        <option v-for="fileType in fileTypes" :value="fileType.value">{{ fileType.label }}</option>
      </select>
    </div>
    <Button class="tp-export-button" @click="exportImage">Export Image</Button>
  </Section>
</template>

<style scoped>
.tp-export-item {
  margin-bottom: 4px;
}

.tp-export-input {
  padding-left: 7px;
  padding-right: 7px;
  margin-left: 7px;
  margin-right: 7px;

  min-width: 0;

  outline: none;

  border-bottom: 1px solid var(--color-border);
}

.tp-export-button {
  margin-top: 8px;

  --btn-height: 2rem;
  --btn-padding: 0 0.5rem;

  border-radius: 0.375rem;
  font-weight: var(--text-body-medium-strong-font-weight);
  letter-spacing: var(--text-body-medium-strong-letter-spacing);

  background: transparent;
  color: var(--btn-text);
  outline-width: 0.0625rem;
  outline-offset: -0.0625rem;
  outline-style: solid;

  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  height: var(--btn-height);
  box-sizing: border-box;
  place-items: center;
  user-select: none;
}
</style>
