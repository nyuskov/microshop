<template>
  <!-- Перевод сообщения: встроенный переводчик браузера, текст никуда не уходит.
       Блок показывается только когда перевод запросили и убирается кликом мимо
       (как меню) — иначе он «прилипает» к ленте.

       Лежит в `common/`, а не в `messenger/`: зовут его и лента сообщений
       (пункт меню у текста), и медиа-сообщение (кнопка под расшифровкой). -->
  <div v-if="state" ref="root" class="msg-translation">
    <div class="mt-head">
      <span class="mt-caption"
        >{{ t('Перевод') }} {{ state.source && state.target ? caption : '' }}</span
      >
      <!-- Язык выбирается тут же: направление зависит от того, на каком языке
           человек читает, а не от настроек аккаунта. -->
      <div class="mt-targets">
        <button
          v-for="item in TRANSLATION_TARGETS"
          :key="item.code"
          class="mt-target"
          :class="{ active: state.target === item.code }"
          :aria-pressed="state.target === item.code"
          @click="onTarget(item.code)"
        >
          {{ item.code.toUpperCase() }}
        </button>
      </div>
    </div>

    <p v-if="state.status === 'ready'" class="mt-text">{{ state.text }}</p>
    <template v-else-if="state.status === 'running'">
      <p class="mt-note">{{ state.note ?? t('Переводим…') }}</p>
      <!-- Проценты скачивания: без движения непонятно, ждать или уже зависло.
           Крестик стоит В КОНЦЕ полоски и появляется ВМЕСТЕ с ней: он отменяет
           именно скачивание, а не прячет перевод (владелец: «а то непонятно для
           чего он» и «должен появляться только когда полоска появляется»). -->
      <div v-if="percent !== null" class="mt-run">
        <div
          class="mt-progress"
          role="progressbar"
          :aria-valuenow="percent"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="t('Скачано {percent}%', { percent })"
        >
          <div class="mt-progress-fill" :style="{ width: `${percent}%` }"></div>
        </div>
        <button
          class="mt-cancel"
          :title="t('Остановить скачивание')"
          :aria-label="t('Остановить скачивание')"
          @click="cancel"
        >
          <q-icon :name="icon('close')" size="14px" aria-hidden="true" />
        </button>
      </div>
    </template>
    <p v-else-if="state.status === 'download'" class="mt-note">
      {{
        t(
          'Нужно один раз скачать модель перевода (десятки мегабайт) — это делает браузер, текст никуда не уходит.'
        )
      }}
    </p>
    <p v-else class="mt-error">{{ state.error }}</p>

    <div class="mt-actions">
      <button v-if="state.status === 'download'" class="mt-btn" @click="downloadAndTranslate">
        {{ t('Скачать и перевести') }}
      </button>
      <button v-if="state.status === 'ready'" class="mt-btn" @click="copy">
        {{ t('Скопировать') }}
      </button>
      <!-- «Ещё раз» только когда работа закончилась: во время скачивания повтора
           нет — его либо ждут, либо отменяют крестиком. -->
      <button
        v-if="state.status === 'ready' || state.status === 'failed'"
        class="mt-btn"
        @click="retry"
      >
        {{ t('Ещё раз') }}
      </button>
    </div>

    <p class="mt-hint">
      {{ t('Переводит браузер устройства; текст в E2EE-чате на сервер не уходит.') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { icon } from '@/utils/icons'
import { t } from '@/i18n'
import {
  cancelTranslation,
  clearTranslation,
  setTranslationTarget,
  stopTranslationWork,
  TRANSLATION_TARGETS,
  translateMessage,
  translationCaption,
  translationOf
} from '@/utils/translation'

const props = defineProps<{
  /** Id сообщения: по нему помним перевод при перерисовке ленты. */
  messageId: number
  /** Текст сообщения (уже расшифрованный на устройстве, если чат E2EE). */
  text: string
}>()

const state = computed(() => translationOf(props.messageId))
const root = ref<HTMLElement | null>(null)

const caption = computed(() => (state.value ? translationCaption(state.value) : ''))

/** Проценты скачивания модели (null — если модель не качается). */
const percent = computed<number | null>(() => {
  const progress = state.value?.progress
  return typeof progress === 'number' ? Math.round(progress * 100) : null
})

/** Смена языка перевода: тот же текст переводим заново на выбранный язык. */
const onTarget = (code: string) => {
  setTranslationTarget(code)
  void translateMessage(props.messageId, props.text)
}

const retry = () => {
  void translateMessage(props.messageId, props.text)
}

/** Скачивание модели запускает НАЖАТИЕ: API требует действия человека. */
const downloadAndTranslate = () => {
  void translateMessage(props.messageId, props.text, { download: true })
}

/** Крестик: останавливаем только скачивание/перевод, блок остаётся на месте. */
const cancel = () => stopTranslationWork(props.messageId)

const copy = async () => {
  const text = state.value?.text
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* нет разрешения на буфер обмена — текст видно и так */
  }
}

/** Закрыть блок: он всплывающий (как меню), поэтому «мимо» его убирает. */
const dismiss = () => {
  if (!state.value) return
  if (state.value.status === 'running') {
    cancelTranslation(props.messageId)
    return
  }
  clearTranslation(props.messageId)
}

/** Клик мимо блока (в фазе захвата — как в других всплывающих панелях). */
const onPointerDownOutside = (event: PointerEvent) => {
  if (event.target instanceof Node && root.value?.contains(event.target)) return
  dismiss()
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') dismiss()
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDownOutside, true)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDownOutside, true)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.msg-translation {
  margin-top: 6px;
  padding: 6px 8px;
  border-left: 2px solid var(--ms-accent, #2ea25e);
  border-radius: 6px;
  background: var(--ms-accent-soft, rgba(46, 162, 94, 0.12));
}

.mt-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mt-caption {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted, #71808d);
}

.mt-targets {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  /* Чипы языков — к правому краю: подпись и «отменить» стоят слева. */
  margin-left: auto;
}

.mt-cancel {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--ms-muted, #71808d);
  padding: 2px;
  cursor: pointer;
}

.mt-target {
  border: 1px solid var(--ms-border, #dfe5ea);
  border-radius: 7px;
  background: transparent;
  color: var(--ms-muted, #71808d);
  font-size: var(--ms-fs-xs);
  line-height: 1.2;
  padding: 2px 5px;
  cursor: pointer;
}

.mt-target.active {
  border-color: var(--ms-accent, #2ea25e);
  color: var(--ms-accent, #2ea25e);
}

.mt-text {
  margin: 4px 0 0;
  font-size: var(--ms-fs-sm);
  line-height: 1.35;
  color: var(--ms-text);
  white-space: pre-wrap;
  word-break: break-word;
}

.mt-note,
.mt-error,
.mt-hint {
  margin: 4px 0 0;
  font-size: var(--ms-fs-xs);
  line-height: 1.3;
}

.mt-note,
.mt-hint {
  color: var(--ms-muted, #71808d);
}

.mt-error {
  color: var(--ms-danger, #d64545);
}

/* Полоска скачивания модели: тонкая, в тон акцентного блока. */
.mt-run {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  /* Высота строки задана крестиком, чтобы полоска не «прыгала» без него. */
  min-height: 18px;
}

.mt-progress {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--ms-border, #dfe5ea);
  overflow: hidden;
}

.mt-progress-fill {
  height: 100%;
  background: var(--ms-accent, #2ea25e);
  transition: width 0.2s ease;
}

.mt-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.mt-btn {
  border: none;
  background: transparent;
  color: var(--ms-accent, #2ea25e);
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  padding: 0;
  cursor: pointer;
}
</style>
