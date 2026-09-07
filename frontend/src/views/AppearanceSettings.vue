<template>
  <div class="appearance-settings">
    <!-- Тема -->
    <section class="appearance-section">
      <h3 class="appearance-title">Тема оформления</h3>
      <div class="opt-row">
        <button
          v-for="opt in THEME_OPTIONS"
          :key="opt.mode"
          class="opt-pill"
          :class="{ active: themeStore.mode === opt.mode }"
          @click="themeStore.setThemeMode(opt.mode)"
        >
          <q-icon :name="opt.icon" size="17px" />
          <span>{{ opt.label }}</span>
        </button>
      </div>
    </section>

    <!-- Акцентный цвет -->
    <section class="appearance-section">
      <h3 class="appearance-title">Акцентный цвет</h3>
      <div class="swatch-row">
        <button
          v-for="accent in ACCENT_PRESETS"
          :key="accent.key"
          class="accent-dot"
          :class="{ active: themeStore.accentKey === accent.key }"
          :style="{ background: accent.hex }"
          :title="accent.label"
          @click="themeStore.setAccent(accent.key)"
        ></button>
      </div>
    </section>

    <!-- Цвет моих сообщений -->
    <section class="appearance-section">
      <h3 class="appearance-title">Цвет моих сообщений</h3>
      <div class="swatch-row">
        <button
          v-for="bubble in BUBBLE_STYLE_PRESETS"
          :key="bubble.key"
          class="bubble-dot"
          :class="{ active: themeStore.bubbleKey === bubble.key }"
          :style="{ background: bubble.swatch }"
          :title="bubble.label"
          @click="themeStore.setBubbleStyle(bubble.key)"
        >
          <q-icon name="check" class="bubble-check" size="16px" />
        </button>
      </div>
    </section>

    <!-- Обои окна сообщений -->
    <section class="appearance-section">
      <h3 class="appearance-title">Обои окна сообщений</h3>
      <div class="wallpaper-grid">
        <button
          v-for="wall in WALLPAPER_PRESETS"
          :key="wall.key"
          class="wallpaper-tile"
          :class="{ active: themeStore.wallpaperKey === wall.key }"
          :title="wall.label"
          @click="themeStore.setWallpaper(wall.key)"
        >
          <span class="wallpaper-swatch" :style="{ background: wall.swatch }"></span>
          <span class="wallpaper-label">{{ wall.label }}</span>
        </button>

        <button
          v-if="themeStore.wallpaperCustom"
          class="wallpaper-tile"
          :class="{ active: themeStore.wallpaperKey === 'custom' }"
          title="Ваше фото"
          @click="themeStore.setWallpaper('custom')"
        >
          <span class="wallpaper-swatch" :style="customPreviewStyle()"></span>
          <span class="wallpaper-label">Ваше фото</span>
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
          <q-icon name="image" size="17px" /> Загрузить фото
        </button>
        <button
          v-if="themeStore.wallpaperKey === 'custom' || themeStore.wallpaperCustom"
          class="action-btn danger"
          @click="themeStore.clearCustomWallpaper()"
        >
          <q-icon name="delete" size="17px" /> Убрать
        </button>
      </div>
      <p v-if="wallpaperError" class="wallpaper-error">{{ wallpaperError }}</p>
    </section>

    <!-- Сброс -->
    <section class="appearance-section reset-row">
      <button class="action-btn reset" @click="onReset">
        <q-icon name="refresh" size="17px" /> Сбросить настройки
      </button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useThemeStore, fileToCompressedDataUrl } from '@/stores/theme'
import {
  ACCENT_PRESETS,
  BUBBLE_STYLE_PRESETS,
  WALLPAPER_PRESETS,
  type ThemeMode
} from '@/stores/theme'

const themeStore = useThemeStore()

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: 'light', label: 'Светлая', icon: 'light_mode' },
  { mode: 'dark', label: 'Тёмная', icon: 'dark_mode' },
  { mode: 'system', label: 'Системная', icon: 'computer' }
]

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
    wallpaperError.value = error instanceof Error ? error.message : 'Не удалось загрузить фото'
  }
}

const onReset = () => {
  if (window.confirm('Сбросить все настройки оформления?')) {
    themeStore.resetAppearance()
  }
}
</script>

<style scoped>
.appearance-settings {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-height: 70vh;
  overflow-y: auto;
  padding-right: 4px;
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
  gap: 8px;
}

.opt-pill {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface, #fff);
  color: var(--ms-text, #1c2733);
  font-size: 13.5px;
  font-weight: 600;
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
  color: #111;
  opacity: 0;
}

.bubble-dot.active .bubble-check {
  opacity: 1;
}

.wallpaper-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.wallpaper-tile {
  border: 1px solid var(--ms-border, #e2e6ea);
  border-radius: 10px;
  background: var(--ms-surface, #fff);
  padding: 5px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
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
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.wallpaper-label {
  font-size: 10.5px;
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

.reset-row {
  border-top: 1px solid var(--ms-border, #e2e6ea);
  padding-top: 14px;
}
</style>
