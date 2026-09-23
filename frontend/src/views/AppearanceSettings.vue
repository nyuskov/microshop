<template>
  <div class="appearance-settings">
    <!-- Тема -->
    <section class="appearance-section">
      <h3 class="appearance-title">{{ t('Тема оформления') }}</h3>
      <div class="opt-row">
        <button
          v-for="opt in THEME_OPTIONS"
          :key="opt.mode"
          class="opt-pill"
          :class="{ active: themeStore.mode === opt.mode }"
          @click="themeStore.setThemeMode(opt.mode)"
        >
          <q-icon :name="icon(opt.icon)" size="18px" />
          <span>{{ t(opt.label) }}</span>
        </button>
      </div>

      <!-- Расписание: тёмная вечером, светлая днём. Окно может идти через
           полночь, а подпись говорит, действует ли оно прямо сейчас — иначе
           непонятно, почему тема именно такая. -->
      <div v-if="themeStore.scheduleActive" class="schedule-block">
        <div class="schedule-times">
          <div class="schedule-field">
            <label for="ap-dark-from">{{ t('Тёмная с') }}</label>
            <SelectField
              id="ap-dark-from"
              :model-value="themeStore.darkFrom"
              :options="SCHEDULE_TIME_OPTIONS"
              :aria-label="t('Начало тёмной темы')"
              @update:model-value="onScheduleChange('from', $event)"
            />
          </div>
          <div class="schedule-field">
            <label for="ap-dark-to">{{ t('до') }}</label>
            <SelectField
              id="ap-dark-to"
              :model-value="themeStore.darkTo"
              :options="SCHEDULE_TIME_OPTIONS"
              :aria-label="t('Конец тёмной темы')"
              @update:model-value="onScheduleChange('to', $event)"
            />
          </div>
        </div>
        <p class="hint">{{ scheduleHint }}</p>
      </div>

      <!-- Чёрный фон (AMOLED) — не четвёртая тема в ряду, а уточнение тёмной:
           на OLED-экране чёрный пиксель не светится. Поэтому тумблер, который
           гасится в светлой теме — там чёрный фон смысла не имеет. -->
      <div class="toggle-row" :class="{ 'toggle-row-off': !themeStore.darkActive }">
        <div class="toggle-text">
          <span class="toggle-name">{{ t('Чёрный фон (AMOLED)') }}</span>
          <span class="toggle-desc">
            {{
              themeStore.darkActive
                ? t('Чистый чёрный вместо тёмно-серого — экономит заряд на OLED')
                : t('Доступно в тёмной теме')
            }}
          </span>
        </div>
        <q-toggle
          :model-value="themeStore.amoled"
          color="primary"
          keep-color
          :disable="!themeStore.darkActive"
          @update:model-value="themeStore.setAmoled(!!$event)"
        />
      </div>

      <!-- Повышенная контрастность — тоже флаг, а не пятая тема: работает в
           любой схеме и только усиливает текст и рамки. Нужна на солнце и при
           слабом зрении; при первом запуске включается по системной настройке
           (`prefers-contrast: more`), дальше решает тумблер. -->
      <div class="toggle-row">
        <div class="toggle-text">
          <span class="toggle-name">{{ t('Повышенная контрастность') }}</span>
          <span class="toggle-desc">
            {{ t('Текст и границы темнее — легче читать на солнце') }}
          </span>
        </div>
        <q-toggle
          :model-value="themeStore.highContrast"
          color="primary"
          keep-color
          @update:model-value="themeStore.setHighContrast(!!$event)"
        />
      </div>
    </section>

    <!-- Акцентный цвет -->
    <section class="appearance-section">
      <h3 class="appearance-title">{{ t('Акцентный цвет') }}</h3>
      <div class="swatch-row">
        <button
          v-for="accent in ACCENT_PRESETS"
          :key="accent.key"
          class="accent-dot"
          :class="{ active: themeStore.accentKey === accent.key }"
          :style="{ background: accent.hex }"
          :title="t(accent.label)"
          @click="themeStore.setAccent(accent.key)"
        ></button>
      </div>
    </section>

    <!-- Цвет моих сообщений -->
    <section class="appearance-section">
      <h3 class="appearance-title">{{ t('Цвет моих сообщений') }}</h3>
      <div class="swatch-row">
        <button
          v-for="bubble in BUBBLE_STYLE_PRESETS"
          :key="bubble.key"
          class="bubble-dot"
          :class="{ active: themeStore.bubbleKey === bubble.key }"
          :style="{ background: bubble.swatch }"
          :title="t(bubble.label)"
          @click="themeStore.setBubbleStyle(bubble.key)"
        >
          <q-icon :name="icon('check')" class="bubble-check" size="18px" />
        </button>
      </div>
    </section>

    <!-- Размер текста -->
    <section class="appearance-section">
      <h3 class="appearance-title">{{ t('Размер текста') }}</h3>
      <div class="opt-row">
        <button
          v-for="opt in TEXT_SIZE_PRESETS"
          :key="opt.key"
          class="opt-pill text-size-pill"
          :class="{ active: themeStore.textSizeKey === opt.key }"
          :aria-pressed="themeStore.textSizeKey === opt.key"
          @click="themeStore.setTextSize(opt.key)"
        >
          <span class="text-size-sample" :style="{ fontSize: opt.sample }">{{ t('Аа') }}</span>
          <span>{{ t(opt.label) }}</span>
        </button>
      </div>
      <p class="hint">{{ t('Действует на текст сообщений, поле ввода и список чатов.') }}</p>
    </section>

    <!-- Обои окна сообщений -->
    <section class="appearance-section">
      <h3 class="appearance-title">{{ t('Обои окна сообщений') }}</h3>
      <div class="wallpaper-grid">
        <button
          v-for="wall in WALLPAPER_PRESETS"
          :key="wall.key"
          class="wallpaper-tile"
          :class="{ active: themeStore.wallpaperKey === wall.key }"
          :title="t(wall.label)"
          @click="themeStore.setWallpaper(wall.key)"
        >
          <span class="wallpaper-swatch" :style="{ background: wall.swatch }"></span>
          <span class="wallpaper-label">{{ t(wall.label) }}</span>
        </button>

        <button
          v-if="themeStore.wallpaperCustom"
          class="wallpaper-tile"
          :class="{ active: themeStore.wallpaperKey === 'custom' }"
          :title="t('Ваше фото')"
          @click="themeStore.setWallpaper('custom')"
        >
          <span class="wallpaper-swatch" :style="customPreviewStyle()"></span>
          <span class="wallpaper-label">{{ t('Ваше фото') }}</span>
        </button>
      </div>

      <div class="wallpaper-actions">
        <input
          ref="wallpaperInput"
          class="hidden-file"
          type="file"
          accept="image/*"
          @change="onWallpaperFile"
        />
        <button class="action-btn" @click="wallpaperInput?.click()">
          <q-icon :name="icon('image')" size="18px" /> {{ t('Загрузить фото') }}
        </button>
        <button
          v-if="themeStore.wallpaperKey === 'custom' || themeStore.wallpaperCustom"
          class="action-btn danger"
          @click="themeStore.clearCustomWallpaper()"
        >
          <q-icon :name="icon('delete')" size="18px" /> {{ t('Убрать') }}
        </button>
      </div>
      <p v-if="wallpaperError" class="wallpaper-error">{{ wallpaperError }}</p>
    </section>

    <!-- Список чатов: жесты пальцем -->
    <section class="appearance-section">
      <h3 class="appearance-title">{{ t('Список чатов') }}</h3>
      <div class="opt-row">
        <button
          v-for="opt in CHAT_SWIPE_OPTIONS"
          :key="opt.key"
          class="opt-pill"
          :class="{ active: chatSwipeAction === opt.key }"
          :aria-pressed="chatSwipeAction === opt.key"
          :title="t(opt.hint)"
          @click="writeChatSwipeAction(opt.key)"
        >
          {{ t(opt.label) }}
        </button>
      </div>
      <p class="hint">
        {{ t('Что делает свайп влево по строке чата. Свайп вправо всегда закрепляет чат.') }}
      </p>
    </section>

    <!-- Сброс -->
    <section class="appearance-section reset-row">
      <button class="action-btn reset" @click="onReset">
        <q-icon :name="icon('refresh')" size="18px" /> {{ t('Сбросить настройки') }}
      </button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, ref } from 'vue'
import SelectField from '@/components/common/SelectField.vue'
import { confirmDialog } from '@/utils/appDialogs'
import { getErrorMessage } from '@/services/errors'
import { useThemeStore, fileToCompressedDataUrl } from '@/stores/theme'
import {
  ACCENT_PRESETS,
  BUBBLE_STYLE_PRESETS,
  TEXT_SIZE_PRESETS,
  WALLPAPER_PRESETS,
  type ThemeMode
} from '@/stores/theme'
import { scheduleSummary, scheduleTimeOptions } from '@/utils/themeSchedule'
import { CHAT_SWIPE_OPTIONS, chatSwipeAction, writeChatSwipeAction } from '@/utils/chatSwipe'
import { t } from '@/i18n'

const themeStore = useThemeStore()

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: 'light', label: 'Светлая', icon: 'light_mode' },
  { mode: 'dark', label: 'Тёмная', icon: 'dark_mode' },
  { mode: 'system', label: 'Системная', icon: 'computer' },
  { mode: 'schedule', label: 'По расписанию', icon: 'schedule' }
]

/** Список времени для расписания: шаг час — точнее теме не нужно. */
const SCHEDULE_TIME_OPTIONS = scheduleTimeOptions()

/** Подпись под списками: окно и что действует сейчас. */
const scheduleHint = computed(() => scheduleSummary(themeStore.darkFrom, themeStore.darkTo))

/** Смена одной из границ: вторая остаётся как была. */
const onScheduleChange = (edge: 'from' | 'to', value: string | number | null) => {
  const minutes = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(minutes)) return
  if (edge === 'from') themeStore.setDarkWindow(minutes, themeStore.darkTo)
  else themeStore.setDarkWindow(themeStore.darkFrom, minutes)
}

const wallpaperInput = ref<HTMLInputElement | null>(null)
const wallpaperError = ref('')

const customPreviewStyle = (): Record<string, string> => ({
  background: themeStore.wallpaperCustom
    ? `url("${themeStore.wallpaperCustom}") center / cover`
    : ''
})

const onWallpaperFile = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  wallpaperError.value = ''
  try {
    const dataUrl = await fileToCompressedDataUrl(file)
    themeStore.setCustomWallpaper(dataUrl)
  } catch (error) {
    // Файл читает сам браузер (FileReader в `utils/media.ts`), поэтому ошибка
    // приходит от него — через общий разбор, а не сырым `error.message`.
    wallpaperError.value = getErrorMessage(error, t('Не удалось загрузить фото'))
  }
}

const onReset = async () => {
  const agreed = await confirmDialog({
    title: t('Сбросить все настройки оформления?'),
    message: t('Тема, обои, размер текста и акцентный цвет вернутся к значениям по умолчанию.'),
    okLabel: t('Сбросить'),
    danger: true
  })
  if (agreed) themeStore.resetAppearance()
}
</script>

<style scoped>
/* Контент растёт естественно — прокручивает общий контейнер модалки
   (.ms-modal-body), как в профиле. Внутреннего скроллбара нет, поэтому
   полоса не прижимается вплотную к опциям. */
.appearance-settings {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  min-width: 0;
}

.appearance-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.appearance-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--ms-muted, #71808d);
}

.opt-row {
  display: flex;
  flex-wrap: wrap; /* на узких экранах пилюли переносятся, а не вылезают */
  gap: 8px;
}

/* Пилюли размера текста: буква-образец показывает, насколько крупным будет текст. */
.text-size-pill {
  flex-direction: column;
  gap: 1px;
  padding: 7px 10px;
}

.text-size-sample {
  display: block;
  line-height: 1.15;
  font-weight: 700;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--ms-muted, #71808d);
}

/* Расписание тёмной темы: два списка времени и подпись под ними. */
.schedule-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 2px 2px;
}

.schedule-times {
  display: flex;
  gap: 12px;
}

.schedule-field {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.schedule-field label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ms-icon, #55636e);
}

/* Тумблер AMOLED: уточнение тёмной темы, поэтому в светлой он неактивен и
   приглушён — но остаётся на виду, иначе про настройку никто не узнает. */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.toggle-row-off {
  opacity: 0.6;
}

.toggle-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.toggle-name {
  font-size: var(--ms-fs-base, 14.5px);
  color: var(--ms-text);
}

.toggle-desc {
  font-size: var(--ms-fs-sm, 12.5px);
  color: var(--ms-muted);
}

.opt-pill {
  flex: 1 1 0%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 9px 10px;
  border-radius: var(--ms-radius-sm);
  border: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface, #fff);
  color: var(--ms-text, #1c2733);
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: 0.12s;
}

.opt-pill:hover {
  background: var(--ms-hover, #f2f4f6);
}

.opt-pill.active {
  border-color: var(--ms-accent, #2ea25e);
  background: var(--ms-accent-soft, #e3f2e5);
  color: var(--ms-accent, #2ea25e);
}

.swatch-row {
  display: flex;
  flex-wrap: wrap;
  padding-left: 5px;
  gap: 10px;
}

.accent-dot {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  transition:
    transform 0.12s,
    box-shadow 0.12s;
}

.accent-dot:hover {
  transform: scale(1.12);
}

.accent-dot.active {
  box-shadow:
    0 0 0 2px var(--ms-surface, #fff),
    0 0 0 4px var(--ms-accent, #2ea25e);
}

.bubble-dot {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 2px solid var(--ms-border, #e2e6ea);
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.12s;
}

.bubble-dot:hover {
  transform: scale(1.1);
}

.bubble-check {
  font-size: 1rem;
  color: var(--ms-bubble-text);
  opacity: 0;
}

.bubble-dot.active .bubble-check {
  opacity: 1;
}

.wallpaper-grid {
  display: grid;
  /* minmax(0, 1fr) — колонки могут сжиматься уже min-content подписи,
     иначе на узких экранах сетка вылезает за ширину диалога. */
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.wallpaper-tile {
  border: 1px solid var(--ms-border, #e2e6ea);
  border-radius: var(--ms-radius-sm);
  background: var(--ms-surface, #fff);
  padding: 5px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  min-width: 0;
  box-sizing: border-box;
}

.wallpaper-tile:hover {
  border-color: var(--ms-muted-3, #97a5b0);
}

.wallpaper-tile.active {
  border-color: var(--ms-accent, #2ea25e);
  box-shadow: 0 0 0 1px var(--ms-accent, #2ea25e) inset;
}

.wallpaper-swatch {
  width: 100%;
  height: 36px;
  border-radius: 7px;
  display: block;
  border: 1px solid var(--ms-border);
}

.wallpaper-label {
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted, #71808d);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wallpaper-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  border-radius: 9px;
  border: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface, #fff);
  color: var(--ms-text, #1c2733);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.action-btn:hover {
  background: var(--ms-hover, #f2f4f6);
}

.action-btn.danger {
  color: var(--ms-danger, #d64545);
}

.action-btn.reset {
  border-color: var(--ms-danger, #d64545);
  color: var(--ms-danger, #d64545);
}

.action-btn.reset:hover {
  background: var(--ms-danger-bg, #fdecec);
}

.hidden-file {
  display: none;
}

.wallpaper-error {
  margin: 0;
  font-size: 12.5px;
  color: var(--ms-danger, #d64545);
}

/* На узких экранах уменьшаем число колонок сетки обоев, чтобы плитки и
   подписи помещались по ширине (как профиль схлопывает свои сетки). */
@media (max-width: 420px) {
  .wallpaper-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.reset-row {
  border-top: 1px solid var(--ms-border, #e2e6ea);
  padding-top: 14px;
}
</style>
