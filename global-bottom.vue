<script setup lang="ts">
/* Sends the current slide to the BUSY Bar relay (see `src/plugin.ts`). Dev
   server only: the built site, the PDF export and embedded previews never
   talk to the bar. Fire-and-forget, errors ignored: the talk never depends on
   the bar. */
import type { BusyFrontmatter } from './src/slides'
import { configs, useNav } from '@slidev/client'
import { computed, watch } from 'vue'
import { slideInfo } from './src/slides'

const { slides, currentSlideNo, currentSlideRoute, isPrintMode, isEmbedded } = useNav()

const payload = computed(() => {
  const busy = slides.value.map(route => route.meta.slide.frontmatter?.busy as BusyFrontmatter | undefined)
  /* Outside any chapter (section slides…), the bar shows this title instead
     of falling back to its own default screen. */
  const title = currentSlideRoute.value?.meta.slide.title || configs.title
  return JSON.stringify(slideInfo(busy, currentSlideNo.value - 1, title))
})

if (import.meta.env.DEV && !isPrintMode.value && !isEmbedded.value) {
  watch(payload, (body) => {
    fetch('/__busy/slide', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      .catch(() => {})
  }, { immediate: true })
}
</script>

<template>
  <!-- Nothing to show: this component only follows the navigation. -->
</template>
