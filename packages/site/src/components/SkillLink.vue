<script setup lang="ts">
import { BookOpen } from 'lucide-vue-next'

import type { SiteSkill } from '@/content/landing'

defineProps<{ skill: SiteSkill }>()
</script>

<template>
  <button type="button" class="site-text-link site-skill-link" aria-haspopup="dialog">
    <BookOpen aria-hidden="true" />
    <span>Read the {{ skill === 'canvas' ? 'canvas' : 'design-to-code' }} skill</span>
  </button>
</template>

<style scoped>
.site-skill-link {
  text-align: left;
}
</style>
