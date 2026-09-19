<template>
  <!-- Кнопка расшифровки: подпись по состоянию, чтобы на телефоне (где подсказка
       не видна) было понятно, что произойдёт. -->
  <button
    v-if="available"
    class="am-transcribe"
    :class="{ busy: transcript?.status === 'running' }"
    :title="hint"
    :aria-label="hint"
    @click="toggle"
  >
    {{ label }}
  </button>
</template>

<script setup lang="ts">
/**
 * Кнопка «В текст» для голосового и видеосообщения (кружка).
 *
 * Вынесена отдельно, потому что рисовать её нужно в разных местах: у голосового
 * она стоит в строке с названием и скоростью, у кружка — под кругом, где места
 * для чипов нет. Логика одна: состояние расшифровки решает и подпись, и действие
 * (`transcriptActionFor`).
 */
import { computed } from 'vue'

import {
  clearTranscript,
  recognizeVoice,
  speechRecognitionSupported,
  transcriptActionFor,
  transcriptOf
} from '@/utils/voiceRecognition'

const props = defineProps<{
  /** Id сообщения: по нему помним расшифровку при перерисовке ленты. */
  messageId: number
  /** Ссылка на файл записи (голосовое или видеосообщение). */
  src: string
}>()

const transcript = computed(() => transcriptOf(props.messageId))

/** Умеет ли это устройство распознавать записи — иначе кнопки нет вовсе. */
const available = speechRecognitionSupported()

const hint = computed(() => {
  const action = transcriptActionFor(transcript.value)
  if (action === 'cancel') return 'Распознаём — нажмите, чтобы отменить'
  if (action === 'hide') return 'Скрыть расшифровку'
  return 'Расшифровать в текст'
})

const label = computed(() => {
  const action = transcriptActionFor(transcript.value)
  if (action === 'cancel') return 'Распознаём…'
  if (action === 'hide') return 'Скрыть текст'
  return 'В текст'
})

const toggle = () => {
  if (transcriptActionFor(transcript.value) === 'recognize') {
    void recognizeVoice(props.messageId, props.src)
    return
  }
  clearTranscript(props.messageId)
}
</script>

<style scoped>
.am-transcribe {
  border: none;
  background: transparent;
  color: var(--ms-accent, #2ea25e);
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 8px;
  cursor: pointer;
}

.am-transcribe:hover {
  background: var(--ms-accent-soft, rgba(46, 162, 94, 0.12));
}

.am-transcribe.busy {
  color: var(--ms-muted, #71808d);
  cursor: default;
}
</style>
