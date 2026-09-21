<script setup lang="ts">
import { computed, onMounted } from 'vue'

import { t } from '@/i18n'
import { icon } from '@/utils/icons'
import { useCallStore } from '@/stores/call'
import {
  MASK_SCALE_MAX,
  MASK_SCALE_MIN,
  isVideoEffectsSupported
} from '@/utils/videoEffectSettings'
import { VIDEO_EFFECTS, VIDEO_MASKS } from '@/utils/videoEffects'

/**
 * Окно «Эффекты видео»: цвет кадра и маска-наклейка (кошачьи ушки, очки…).
 *
 * Эффекты применяются сразу: обработка идёт в canvas и подменяет дорожку
 * собеседникам (см. `stores/call/videoPipeline.ts`), поэтому после выбора ничего
 * подтверждать не нужно. Маску можно двигать пальцем прямо на своём видео —
 * подсказка об этом есть в окне, размер меняется кнопками.
 *
 * Здесь только выбор; состояние живёт в сторе звонка, чтобы настройки переживали
 * закрытие окна, смену камеры и возврат после показа экрана.
 */

const emit = defineEmits<{ (e: 'close'): void }>()

const callStore = useCallStore()

/** Поддержка проверяется при открытии: до этого браузер не трогаем. */
const supported = computed(() => isVideoEffectsSupported())

onMounted(() => {
  if (!supported.value) {
    callStore.videoEffectsUnavailable = t(
      'Браузер не умеет обрабатывать видео на лету — эффекты недоступны'
    )
  }
})

const canScaleUp = computed(() => callStore.videoMaskLayout.scale < MASK_SCALE_MAX - 0.001)
const canScaleDown = computed(() => callStore.videoMaskLayout.scale > MASK_SCALE_MIN + 0.001)

const scaleMask = (delta: number) => {
  callStore.setVideoMaskLayout({
    ...callStore.videoMaskLayout,
    scale: callStore.videoMaskLayout.scale + delta
  })
}

const resetMask = () => {
  callStore.setVideoMaskLayout({ x: 0.5, y: 0.3, scale: 0.45 })
}
</script>

<template>
  <div class="ms-overlay fx-overlay" @mousedown.self="emit('close')">
    <div
      class="ms-overlay-card fx-card"
      role="dialog"
      aria-modal="true"
      :aria-label="t('Эффекты видео')"
      tabindex="-1"
    >
      <div class="ms-overlay-head">
        <h2 class="ms-overlay-title">{{ t('Эффекты видео') }}</h2>
        <button class="icon-btn" type="button" :title="t('Закрыть')" @click="emit('close')">
          <q-icon :name="icon('close')" size="20px" />
        </button>
      </div>

      <div class="ms-overlay-body fx-body">
        <p v-if="!supported || callStore.videoEffectsUnavailable" class="fx-note" role="status">
          {{ callStore.videoEffectsUnavailable || t('Эффекты недоступны на этом устройстве') }}
        </p>

        <template v-else>
          <h3 class="fx-title">{{ t('Цвет') }}</h3>
          <div class="fx-chips" role="radiogroup" :aria-label="t('Эффект кадра')">
            <button
              v-for="preset in VIDEO_EFFECTS"
              :key="preset.id"
              type="button"
              class="fx-chip"
              :class="{ active: callStore.videoEffect === preset.id }"
              role="radio"
              :aria-checked="callStore.videoEffect === preset.id"
              @click="callStore.setVideoEffect(preset.id)"
            >
              {{ t(preset.title) }}
            </button>
          </div>

          <h3 class="fx-title">{{ t('Маска') }}</h3>
          <div class="fx-chips" role="radiogroup" :aria-label="t('Маска на видео')">
            <button
              type="button"
              class="fx-chip"
              :class="{ active: callStore.videoMask === null }"
              role="radio"
              :aria-checked="callStore.videoMask === null"
              @click="callStore.setVideoMask(null)"
            >
              {{ t('Без маски') }}
            </button>
            <button
              v-for="mask in VIDEO_MASKS"
              :key="mask.id"
              type="button"
              class="fx-chip"
              :class="{ active: callStore.videoMask === mask.id }"
              role="radio"
              :aria-checked="callStore.videoMask === mask.id"
              @click="callStore.setVideoMask(mask.id)"
            >
              {{ t(mask.title) }}
            </button>
          </div>

          <template v-if="callStore.videoMask !== null">
            <!-- Размер — кнопками, положение — пальцем на своём видео: так не
                 нужны ни ползунки, ни отдельный редактор. Знаки «−/+» — текстом:
                 своего глифа для «минуса» в урезанном шрифте иконок нет. -->
            <div class="fx-mask-row">
              <button
                type="button"
                class="fx-btn fx-size"
                :disabled="!canScaleDown"
                :title="t('Маска меньше')"
                :aria-label="t('Маска меньше')"
                @click="scaleMask(-0.08)"
              >
                −
              </button>
              <button
                type="button"
                class="fx-btn fx-size"
                :disabled="!canScaleUp"
                :title="t('Маска больше')"
                :aria-label="t('Маска больше')"
                @click="scaleMask(0.08)"
              >
                +
              </button>
              <button type="button" class="fx-btn" @click="resetMask">{{ t('По центру') }}</button>
            </div>
            <p class="fx-hint">
              {{ t('Потяните маску на своём видео, чтобы поставить её по лицу.') }}
            </p>
          </template>

          <button
            v-if="callStore.videoEffect !== 'none' || callStore.videoMask !== null"
            type="button"
            class="fx-btn fx-reset"
            @click="callStore.resetVideoEffects()"
          >
            {{ t('Убрать все эффекты') }}
          </button>

          <p class="fx-note">
            {{
              t(
                'Эффекты считаются на вашем устройстве: кадр никуда не отправляется и собеседник видит уже готовую картинку.'
              )
            }}
          </p>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fx-card {
  width: min(420px, 100%);
}

.fx-body {
  display: flex;
  flex-direction: column;
  gap: var(--ms-space-2);
}

.fx-title {
  margin: var(--ms-space-2) 0 0;
  font-size: var(--ms-fs-sm);
  font-weight: 600;
  color: var(--ms-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.fx-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ms-space-2);
}

.fx-chip {
  padding: 8px 12px;
  border: 1px solid var(--ms-border);
  border-radius: var(--ms-radius-pill);
  background: var(--ms-surface-2);
  color: var(--ms-text);
  font-family: inherit;
  font-size: var(--ms-fs-md);
  cursor: pointer;
}

.fx-chip.active {
  border-color: var(--ms-accent);
  background: var(--ms-accent-soft);
  color: var(--ms-text-strong);
  font-weight: 600;
}

.fx-mask-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ms-space-2);
}

.fx-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid var(--ms-border);
  border-radius: var(--ms-radius-sm);
  background: var(--ms-surface-2);
  color: var(--ms-text);
  font-family: inherit;
  font-size: var(--ms-fs-md);
  cursor: pointer;
}

.fx-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* Кнопки размера: квадрат со знаком — по ним легко попасть пальцем. */
.fx-size {
  width: 40px;
  justify-content: center;
  font-size: var(--ms-fs-lg);
  line-height: 1;
}

.fx-reset {
  align-self: flex-start;
  color: var(--ms-danger);
  border-color: var(--ms-danger-bg);
}

.fx-hint,
.fx-note {
  margin: 0;
  font-size: var(--ms-fs-xs);
  line-height: 1.45;
  color: var(--ms-muted);
}
</style>
