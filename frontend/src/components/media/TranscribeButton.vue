<template>
  <!-- Кнопка расшифровки — БЕЙДЖЕМ, как в МАКСе (владелец: «другой значок, посмотри
       как в МАКСе» + скриншот): скруглённый квадрат со значком «→Т» (стрелка вправо
       на большую букву Т — «запись → текст»). Голый глиф в строке записи выглядел
       «уродливым и большим» — в бейдже он читается как отдельная кнопка и не спорит
       с иконкой звука. Слова живут в `title`/`aria-label`. -->
  <button
    v-if="available"
    class="am-transcribe"
    :class="{ busy: action === 'cancel', active: action === 'hide' }"
    :title="hint"
    :aria-label="hint"
    @click="toggle"
  >
    <span class="am-transcribe-badge">
      <q-icon :name="icon('transcribe')" size="15px" aria-hidden="true" />
    </span>
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
import { t } from '@/i18n'
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
  if (action.value === 'cancel') return t('Распознаём — нажмите, чтобы отменить')
  if (action.value === 'hide') return t('Скрыть текст расшифровки')
  return t('Расшифровать запись в текст')
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
 * акцента, а не заливкой. Размер: поле 28 (палец), глиф 18 — вровень с иконкой
 * звука висящей записи (15) и меньше кнопки проигрывания (24), а не «на весь
 * бокс»: при 20 глиф читался крупнее соседей и выглядел нарисованным поверх
 * строки. */
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

/* Кнопка расшифровки — как в МАКСе: скруглённый квадрат со значком «→Т».
 * Цвет — как у смайла в поле ввода, КОГДА ПАНЕЛЬ ЗАКРЫТА (владелец, 25.09.2026:
 * «только смайл пока не включён, он другого цвета»): приглушённый, не акцентный.
 * Берём не `--ms-icon-2` напрямую, а оттенок текста пузыря — тогда бейдж одинаково
 * читается и в чужом светлом пузыре (серый значок), и в своём цветном (светлая
 * вуаль), и в тёмной теме. Акцент остаётся для нажатого состояния: там человек уже
 * знает, что кнопка нажал, и выделять её снова не надо.
 * Поле кнопки 28 — палец, сам бейдж 24. */
.am-transcribe {
  border: none;
  background: transparent;
  color: inherit;
  width: 28px;
  height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  /* В строке плеера справа от волны: бейдж не должен сжиматься при длинной
     подписи времени (иначе превратился бы в прямоугольник). */
  flex-shrink: 0;
}

.am-transcribe-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--ms-radius-xs, 6px);
  background: color-mix(in srgb, var(--ms-bubble-text, #111111) 8%, transparent);
  color: color-mix(in srgb, var(--ms-bubble-text, #111111) 62%, transparent);
  transition: background var(--ms-dur-fast, 0.15s) var(--ms-ease, ease);
}

/* Наведение: подложка чуть плотнее, значок — акцентным цветом (то же действие,
 * что у смайла при включённой панели). */
.am-transcribe:hover .am-transcribe-badge {
  background: color-mix(in srgb, var(--ms-bubble-text, #111111) 12%, transparent);
  color: var(--ms-accent, #2ea25e);
}

/* Текст расшифровки показан: состояние видно по акцентному значку, без заливки. */
.am-transcribe.active .am-transcribe-badge {
  color: var(--ms-accent, #2ea25e);
}

/* Идёт распознавание: приглушаем, но бейдж остаётся на месте — по нему видно,
 * где ждать текст. */
.am-transcribe.busy {
  cursor: default;
}

.am-transcribe.busy .am-transcribe-badge {
  color: color-mix(in srgb, var(--ms-bubble-text, #111111) 35%, transparent);
}
</style>
