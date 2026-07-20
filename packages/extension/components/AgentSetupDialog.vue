<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

import type {
  AgentIntegrationAction,
  AgentIntegrationConfig,
  AgentIntegrationId
} from '@/mcp/config'

import Button from '@/components/Button.vue'
import Dialog from '@/components/Dialog.vue'
import IconButton from '@/components/IconButton.vue'
import BrandIcon from '@/components/icons/brands/BrandIcon.vue'
import Copy from '@/components/icons/Copy.vue'
import ExternalLink from '@/components/icons/ExternalLink.vue'
import { useCopy, useDeepLinkGuard } from '@/composables'
import {
  AGENT_INTEGRATIONS,
  AGENT_INTEGRATIONS_BY_ID,
  AGENT_SKILL_INSTALL_COMMAND,
  MCP_SERVERS_CONFIG_SNIPPET
} from '@/mcp/config'

type SetupTarget = Pick<AgentIntegrationConfig, 'actions' | 'name'> & {
  id: AgentIntegrationId | 'other'
}

type ActionGroupId = 'plugin' | 'mcp' | 'skill'

type SetupStep = {
  id: ActionGroupId
  actions: AgentIntegrationAction[]
}

const open = defineModel<boolean>({ default: false })

const actionGroups: Record<AgentIntegrationAction['id'], ActionGroupId> = {
  'plugin-prompt': 'plugin',
  'plugin-cli': 'plugin',
  'mcp-deep-link': 'mcp',
  'mcp-cli': 'mcp',
  'mcp-config': 'mcp',
  'skill-cli': 'skill'
}

const groupLabels: Record<ActionGroupId, string> = {
  plugin: 'TemPad Dev plugin',
  mcp: 'MCP server',
  skill: 'Design skill'
}

const otherSetup = {
  id: 'other',
  name: 'Manual setup',
  actions: [
    {
      id: 'mcp-config',
      label: 'MCP config',
      kind: 'config',
      value: MCP_SERVERS_CONFIG_SNIPPET
    },
    {
      id: 'skill-cli',
      label: 'Agent skill',
      kind: 'command',
      value: AGENT_SKILL_INSTALL_COMMAND
    }
  ]
} satisfies SetupTarget

const setupTargets: SetupTarget[] = [...AGENT_INTEGRATIONS, otherSetup]
const selectedTargetId = ref<SetupTarget['id']>('codex')
const selectedSetup = computed(() =>
  selectedTargetId.value === 'other' ? otherSetup : AGENT_INTEGRATIONS_BY_ID[selectedTargetId.value]
)
const selectedSteps = computed<SetupStep[]>(() => {
  const groups = new Map<ActionGroupId, AgentIntegrationAction[]>()

  for (const action of selectedSetup.value.actions) {
    const id = actionGroups[action.id]
    const actions = groups.get(id)

    if (actions) {
      actions.push(action)
    } else {
      groups.set(id, [action])
    }
  }

  return Array.from(groups, ([id, actions]) => ({ id, actions }))
})
const pluginStep = computed(() => selectedSteps.value.find(({ id }) => id === 'plugin'))
const displayedSteps = computed(() => (pluginStep.value ? [pluginStep.value] : selectedSteps.value))

const copy = useCopy()
const guardDeepLink = useDeepLinkGuard({ timeout: 800 })

function selectTarget(id: SetupTarget['id']): void {
  selectedTargetId.value = id
}

function selectManualSetup(): void {
  selectTarget('other')
  nextTick(() => document.querySelector<HTMLElement>('#tp-agent-tab-other')?.focus())
}

function getStepDescription(id: ActionGroupId): string {
  if (id === 'plugin') return 'Adds the MCP server and design skill together.'
  if (id === 'skill') return 'Adds the repo-aware workflow for implementing selected designs.'
  if (selectedSetup.value.id === 'other') return 'Adds the local TemPad Dev server.'
  return `Lets ${selectedSetup.value.name} access the Figma file open in this browser.`
}

function selectAdjacentTarget(direction: -1 | 1): void {
  const index = setupTargets.findIndex(({ id }) => id === selectedTargetId.value)
  const nextIndex = (index + direction + setupTargets.length) % setupTargets.length
  selectedTargetId.value = setupTargets[nextIndex]?.id ?? 'codex'

  nextTick(() => {
    document.querySelector<HTMLElement>(`#tp-agent-tab-${selectedTargetId.value}`)?.focus()
  })
}

function handleSetupAction(action: AgentIntegrationAction): void {
  if (action.kind === 'deep-link') {
    guardDeepLink(action.value, {
      message: `No response from ${selectedSetup.value.name}. Please install it first.`,
      fallbackDeepLink: action.fallbackValue
    })
    return
  }

  const message = action.kind === 'command' ? 'Copied setup command' : 'Copied MCP configuration'
  copy(action.value, message)
}

function getActionLabel(action: AgentIntegrationAction): string {
  if (action.id === 'plugin-prompt') return `Continue in ${selectedSetup.value.name}`
  return `Install in ${selectedSetup.value.name}`
}

function getCopyHint(action: AgentIntegrationAction, index: number): string {
  if (index > 0) {
    return action.kind === 'config' ? 'Or configure manually:' : 'Or run in your terminal:'
  }

  return action.kind === 'config' ? "Copy into your agent's MCP settings:" : 'Run in your terminal:'
}

function getCopyTitle(action: AgentIntegrationAction): string {
  return action.kind === 'config' ? 'Copy configuration' : 'Copy command'
}
</script>

<template>
  <Dialog v-model="open" title="Set up agents">
    <div class="tp-agent-dialog-layout">
      <nav
        class="tp-agent-dialog-nav"
        role="tablist"
        aria-label="Setup target"
        aria-orientation="vertical"
      >
        <button
          v-for="target in setupTargets"
          :id="`tp-agent-tab-${target.id}`"
          :key="target.id"
          type="button"
          role="tab"
          class="tp-agent-dialog-tab"
          :class="{ 'tp-agent-dialog-tab-selected': selectedTargetId === target.id }"
          :aria-selected="selectedTargetId === target.id"
          aria-controls="tp-agent-setup-panel"
          :tabindex="selectedTargetId === target.id ? 0 : -1"
          @click="selectTarget(target.id)"
          @keydown.up.prevent="selectAdjacentTarget(-1)"
          @keydown.left.prevent="selectAdjacentTarget(-1)"
          @keydown.down.prevent="selectAdjacentTarget(1)"
          @keydown.right.prevent="selectAdjacentTarget(1)"
        >
          <span class="tp-ellipsis">{{
            target.id === 'other' ? 'Other agents' : target.name
          }}</span>
        </button>
      </nav>

      <div
        id="tp-agent-setup-panel"
        class="tp-agent-dialog-content"
        role="tabpanel"
        :aria-labelledby="`tp-agent-tab-${selectedSetup.id}`"
      >
        <div class="tp-agent-dialog-intro">
          <div class="tp-agent-dialog-brand-heading">
            <span v-if="selectedSetup.id !== 'other'" class="tp-agent-dialog-brand">
              <BrandIcon :id="selectedSetup.id" />
            </span>
            <h2>{{ selectedSetup.name }}</h2>
          </div>
          <p v-if="pluginStep">Install the plugin to add both MCP access and the design skill.</p>
          <p v-else-if="selectedSetup.id === 'other'">
            Use the same two parts with any compatible agent.
          </p>
          <p v-else>Connect the MCP server, then add the design skill.</p>
        </div>

        <section class="tp-agent-dialog-plan">
          <h3 class="tp-agent-dialog-plan-title">
            {{ pluginStep ? 'Recommended' : 'Setup steps' }}
          </h3>
          <ol class="tp-agent-dialog-steps">
            <li
              v-for="(step, stepIndex) in displayedSteps"
              :key="step.id"
              class="tp-agent-dialog-step"
              :class="{ 'tp-agent-dialog-step-single': pluginStep }"
            >
              <span v-if="!pluginStep" class="tp-agent-dialog-step-number">
                {{ stepIndex + 1 }}
              </span>
              <div class="tp-agent-dialog-step-copy">
                <h4>{{ groupLabels[step.id] }}</h4>
                <p>{{ getStepDescription(step.id) }}</p>
              </div>
              <div class="tp-agent-dialog-actions">
                <template v-for="(action, actionIndex) in step.actions" :key="action.id">
                  <Button
                    v-if="action.kind === 'deep-link'"
                    class="tp-agent-dialog-action"
                    variant="secondary"
                    @click="handleSetupAction(action)"
                  >
                    <ExternalLink />
                    <span>{{ getActionLabel(action) }}</span>
                  </Button>
                  <div v-else class="tp-agent-dialog-copy-action">
                    <p class="tp-agent-dialog-action-hint">
                      {{ getCopyHint(action, actionIndex) }}
                    </p>
                    <div class="tp-agent-dialog-code-well">
                      <code>{{ action.value }}</code>
                      <IconButton
                        class="tp-agent-dialog-copy-button"
                        :title="getCopyTitle(action)"
                        @click="handleSetupAction(action)"
                      >
                        <Copy />
                      </IconButton>
                    </div>
                  </div>
                </template>
              </div>
            </li>
          </ol>

          <p v-if="pluginStep" class="tp-agent-dialog-manual-note">
            Prefer a direct MCP setup? Use
            <button type="button" @click="selectManualSetup">Manual setup</button>.
          </p>
        </section>
      </div>
    </div>

    <template #footer="{ close }">
      <Button variant="primary" @click="close">Done</Button>
    </template>
  </Dialog>
</template>

<style scoped>
.tp-agent-dialog-layout {
  display: grid;
  grid-template-columns: minmax(128px, 150px) minmax(0, 1fr);
  height: 100%;
}

.tp-agent-dialog-nav {
  padding: var(--spacer-1) 0;
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
}

.tp-agent-dialog-tab {
  display: flex;
  align-items: center;
  width: 100%;
  height: var(--spacer-5);
  padding: 0 var(--spacer-3);
  color: var(--color-text);
  outline: none;
}

.tp-agent-dialog-tab:hover,
.tp-agent-dialog-tab:focus-visible {
  background: var(--color-bg-hover);
}

.tp-agent-dialog-tab-selected {
  background: var(--color-bg-secondary);
}

.tp-agent-dialog-tab:focus-visible {
  outline: 1px solid var(--color-border-selected);
  outline-offset: -1px;
}

.tp-agent-dialog-content {
  min-width: 0;
  padding: var(--spacer-3);
  overflow-y: auto;
}

.tp-agent-dialog-intro {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
  margin-bottom: var(--spacer-3);
}

.tp-agent-dialog-brand-heading {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
}

.tp-agent-dialog-brand {
  flex: 0 0 var(--spacer-5);
  width: var(--spacer-5);
  height: var(--spacer-5);
}

.tp-agent-dialog-intro h2,
.tp-agent-dialog-intro p,
.tp-agent-dialog-plan-title,
.tp-agent-dialog-step h4,
.tp-agent-dialog-step-copy p,
.tp-agent-dialog-manual-note {
  margin: 0;
}

.tp-agent-dialog-intro h2 {
  font-family: var(--text-body-large-strong-font-family);
  font-size: var(--text-body-large-strong-font-size);
  font-weight: var(--text-body-large-strong-font-weight);
  letter-spacing: var(--text-body-large-strong-letter-spacing);
  line-height: var(--text-body-large-strong-line-height);
}

.tp-agent-dialog-intro p,
.tp-agent-dialog-step p,
.tp-agent-dialog-manual-note {
  color: var(--color-text);
}

.tp-agent-dialog-plan-title {
  margin-bottom: var(--spacer-3);
  color: var(--color-text-secondary);
  font-family: var(--text-body-medium-font-family);
  font-size: var(--text-body-medium-font-size);
  font-weight: var(--text-body-medium-font-weight);
  letter-spacing: var(--text-body-medium-letter-spacing);
  line-height: var(--text-body-medium-line-height);
}

.tp-agent-dialog-steps {
  margin: 0;
  padding: 0;
  list-style: none;
}

.tp-agent-dialog-step {
  display: grid;
  grid-template-columns: var(--spacer-3) minmax(0, 1fr);
  column-gap: var(--spacer-3);
  padding: 0 0 var(--spacer-3);
}

.tp-agent-dialog-step-single {
  grid-template-columns: minmax(0, 1fr);
}

.tp-agent-dialog-step-number {
  display: grid;
  place-items: center;
  width: var(--spacer-3);
  height: var(--spacer-3);
  border-radius: var(--radius-full);
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  font-family: var(--text-body-small-font-family);
  font-size: var(--text-body-small-font-size);
  font-weight: var(--text-body-small-font-weight);
  letter-spacing: var(--text-body-small-letter-spacing);
  line-height: var(--text-body-small-line-height);
}

.tp-agent-dialog-step-copy {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
  min-width: 0;
}

.tp-agent-dialog-step h4 {
  font-family: var(--text-body-medium-strong-font-family);
  font-size: var(--text-body-medium-strong-font-size);
  font-weight: var(--text-body-medium-strong-font-weight);
  letter-spacing: var(--text-body-medium-strong-letter-spacing);
  line-height: var(--text-body-medium-strong-line-height);
}

.tp-agent-dialog-manual-note {
  padding-top: var(--spacer-3);
  border-top: 1px solid var(--color-border);
}

.tp-agent-dialog-manual-note button {
  color: var(--color-text-brand);
}

.tp-agent-dialog-manual-note button:hover {
  text-decoration: underline;
}

.tp-agent-dialog-manual-note button:focus-visible {
  border-radius: var(--radius-small);
  outline: 1px solid var(--color-border-selected);
  outline-offset: 1px;
}

.tp-agent-dialog-actions {
  display: flex;
  grid-column: 2;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--spacer-2);
  min-width: 0;
  margin-top: var(--spacer-2);
}

.tp-agent-dialog-step-single .tp-agent-dialog-actions {
  grid-column: 1;
}

.tp-agent-dialog-action {
  flex: 0 0 auto;
}

.tp-agent-dialog-action > svg {
  width: var(--spacer-3);
  height: var(--spacer-3);
}

.tp-agent-dialog-copy-action {
  width: 100%;
  min-width: 0;
}

.tp-agent-dialog-action-hint {
  margin: 0 0 var(--spacer-2);
  color: var(--color-text);
}

.tp-agent-dialog-code-well {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  min-height: 34px;
  padding-left: var(--spacer-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  background: var(--color-bg);
}

.tp-agent-dialog-code-well:has(.tp-agent-dialog-copy-button:hover) {
  border-color: var(--color-border-selected);
  background: var(--color-bg-selected);
}

.tp-agent-dialog-code-well code {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--spacer-1) 0;
  font-family: var(--text-mono-medium-font-family);
  font-size: var(--text-mono-medium-font-size);
  font-weight: var(--font-weight-default);
  letter-spacing: var(--text-mono-medium-letter-spacing);
  line-height: var(--text-mono-medium-line-height);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  user-select: text;
  cursor: text;
}

.tp-agent-dialog-copy-button {
  flex: 0 0 var(--spacer-4);
  margin: var(--spacer-1);
}
</style>
