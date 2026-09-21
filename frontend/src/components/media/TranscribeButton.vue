<template>
  <!-- Кнопка расшифровки — ЗНАЧКОМ, как в Telegram (владелец: «пусть как значок
       будет как в телеграме»): в строке голосового подписи места нет (рядом имя
       файла и скорость), а на телефоне подсказка всё равно не видна. Смысл несёт
       форма глифа («↳A»), а слова остались в `title`/`aria-label` — их читают
       скринридеры, их же видно при наведении мышью. -->
  <button
    v-if="available"
    class="am-transcribe"
    :class="{ busy: action === 'cancel', active: action === 'hide' }"
    :title="hint"
    :aria-label="hint"
    @click="toggle"
  >
    <q-icon :name="icon('transcribe')" size="20px" aria-hidden="true" />
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

import { icon } from '@/utils/icons'
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

/** Что сейчас делает кнопка: распознать, отменить или скрыть текст. */
const action = computed(() => transcriptActionFor(transcript.value))

/**
 * Подсказка по состоянию — единственный текст у этого значка.
 *
 * Она же уходит в `aria-label`: иконка без подписи обязана быть понятной тем,
 * кто её не видит.
 */
const hint = computed(() => {
  if (action.value === 'cancel') return 'Распознаём — нажмите, чтобы отменить'
  if (action.value === 'hide') return 'Скрыть текст расшифровки'
  return 'Расшифровать запись в текст'
})

const toggle = () => {
  if (action.value === 'recognize') {
    void recognizeVoice(props.messageId, props.src)
    return
  }
  clearTranscript(props.messageId)
}
</script>

<style scoped>
/* Значок расшифровки — как в Telegram: голый глиф без подложки и без ореола
 * (владелец: «сделай как в телеграме, и размер соответствующий»). Цвет — текста
 * сообщения: он единственный, который уже гарантированно читаем и на своём
 * пузыре, и на входящем, в обеих темах (голубой меты владелец отверг: «нам не в
 * тему, этот цвет у нас нигде не используется»). Нажимаемость показываем цветом
 * акцента, а не заливкой. Размер: глиф 20 при поле 28 — вровень с иконкой
 * проигрывания в строке записи (24), и в поле можно попасть пальцем. */
.am-transcribe {
  border: none;
  background: transparent;
  color: inherit;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

/* Наведение и показанный текст — акцент: действие называется цветом, а не
 * подложкой (поэтому же нет и «ореола»). */
.am-transcribe:hover,
.am-transcribe.active {
  color: var(--ms-accent, #2ea25e);
}

/* Идёт распознавание: приглушаем, но значок остаётся на месте — по нему видно,
 * где ждать текст. */
.am-transcribe.busy {
  color: var(--ms-muted, #71808d);
  cursor: default;
}
</style>
