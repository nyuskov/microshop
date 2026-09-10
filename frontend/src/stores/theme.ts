import { defineStore } from 'pinia'

/** Режим темы: светлая / тёмная / по системе. */
export type Theme = 'light' | 'dark'
export type ThemeMode = Theme | 'system'

export interface AccentPreset {
  key: string
  label: string
  hex: string
}

export interface BubbleStylePreset {
  key: string
  label: string
  swatch: string
}

/** Размер текста интерфейса: множитель применяется к тексту сообщений, композера и списка чатов. */
export interface TextSizePreset {
  key: string
  label: string
  scale: number
  /** Размер в пикселях для превью в настройках. */
  sample: string
}

export interface WallpaperPreset {
  key: string
  label: string
  swatch: string
  /** CSS-фон (background) для inline-стиля. Пустая строка — стиль по умолчанию из CSS. */
  background: string
}

/** Палитра акцентных цветов интерфейса. */
export const ACCENT_PRESETS: AccentPreset[] = [
  { key: 'green', label: 'Зелёный', hex: '#2ea25e' },
  { key: 'blue', label: 'Синий', hex: '#2f7fd1' },
  { key: 'cyan', label: 'Бирюзовый', hex: '#14a09c' },
  { key: 'violet', label: 'Фиолетовый', hex: '#7c5cd6' },
  { key: 'pink', label: 'Розовый', hex: '#d6579a' },
  { key: 'orange', label: 'Оранжевый', hex: '#ee7f1d' },
  { key: 'red', label: 'Красный', hex: '#e04545' },
  { key: 'indigo', label: 'Индиго', hex: '#5a6ee8' }
]

/** Цвета «моих» (исходящих) сообщений. Ключ = атрибут data-bubble в CSS. */
export const BUBBLE_STYLE_PRESETS: BubbleStylePreset[] = [
  { key: 'green', label: 'Зелёный', swatch: '#dcf8c6' },
  { key: 'blue', label: 'Голубой', swatch: '#cfe6f9' },
  { key: 'lilac', label: 'Сирень', swatch: '#e3dcf5' },
  { key: 'pink', label: 'Розовый', swatch: '#fbdce8' },
  { key: 'peach', label: 'Персик', swatch: '#fde6d0' },
  { key: 'mint', label: 'Мята', swatch: '#d3f2e4' },
  { key: 'orange', label: 'Оранжевый', swatch: '#fee3c8' }
]

/** Размер текста интерфейса (множитель к базовым размерам). */
export const TEXT_SIZE_PRESETS: TextSizePreset[] = [
  { key: 'compact', label: 'Мелкий', scale: 0.9, sample: '13px' },
  { key: 'normal', label: 'Обычный', scale: 1, sample: '15px' },
  { key: 'large', label: 'Крупный', scale: 1.15, sample: '17px' }
]

/** Обои окна сообщений (пресеты). Ключ 'custom' обрабатывается отдельно (своё фото). */
export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  {
    key: 'default',
    label: 'По умолчанию',
    swatch:
      'radial-gradient(circle at 1px 1px, rgba(120,144,156,0.25) 1px, transparent 0) 0 0/22px 22px, #eef1f4',
    background: ''
  },
  {
    key: 'sky',
    label: 'Небо',
    swatch: 'linear-gradient(160deg,#d6e6f4,#aecbe4)',
    background: 'linear-gradient(160deg,#d6e6f4,#aecbe4)'
  },
  {
    key: 'mint',
    label: 'Мята',
    swatch: 'linear-gradient(160deg,#dbf2e4,#b6e2c8)',
    background: 'linear-gradient(160deg,#dbf2e4,#b6e2c8)'
  },
  {
    key: 'peach',
    label: 'Персик',
    swatch: 'linear-gradient(160deg,#fdebd9,#f5cfae)',
    background: 'linear-gradient(160deg,#fdebd9,#f5cfae)'
  },
  {
    key: 'lilac',
    label: 'Сирень',
    swatch: 'linear-gradient(160deg,#e9e0f6,#cbbae8)',
    background: 'linear-gradient(160deg,#e9e0f6,#cbbae8)'
  },
  {
    key: 'graphite',
    label: 'Графит',
    swatch: 'linear-gradient(160deg,#3f4a55,#1f262d)',
    background: 'linear-gradient(160deg,#3f4a55,#1f262d)'
  },
  {
    key: 'ocean',
    label: 'Океан',
    swatch: 'linear-gradient(160deg,#d4e9f7,#9cc7ea)',
    background: 'linear-gradient(160deg,#d4e9f7,#9cc7ea)'
  },
  {
    key: 'sunset',
    label: 'Закат',
    swatch: 'linear-gradient(160deg,#fde6dd,#f3b9a8)',
    background: 'linear-gradient(160deg,#fde6dd,#f3b9a8)'
  }
]

const STORAGE_KEY = 'appearance'
const LEGACY_THEME_KEY = 'app-theme'
// Древний ключ обоев чата из старой версии (тогда приложение звалось microshop,
// ключ переносится в pismo_chat_bg миграцией в utils/storage.ts).
const LEGACY_BG_KEY = 'pismo_chat_bg'
const DEFAULT_MODE: ThemeMode = 'dark'

interface AppearanceState {
  currentTheme: Theme
  mode: ThemeMode
  accentKey: string
  bubbleKey: string
  textSizeKey: string
  wallpaperKey: string
  wallpaperCustom: string | null
  isSidebarCollapsed: boolean
}

const DEFAULT_STATE: Omit<AppearanceState, 'isSidebarCollapsed'> = {
  currentTheme: 'dark',
  mode: DEFAULT_MODE,
  accentKey: 'green',
  bubbleKey: 'green',
  textSizeKey: 'normal',
  wallpaperKey: 'default',
  wallpaperCustom: null
}

function loadAppearance(): Partial<AppearanceState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Partial<AppearanceState>
  } catch {
    /* повреждённые данные — игнорируем */
  }
  return {}
}

/** Читает файл изображения и уменьшает его для хранения в localStorage. */
export function fileToCompressedDataUrl(file: File, maxSize = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Файл не является изображением'))
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas недоступен'))
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

export const useThemeStore = defineStore('theme', {
  state: (): AppearanceState => {
    const stored = loadAppearance()
    return {
      ...DEFAULT_STATE,
      ...stored,
      isSidebarCollapsed: false
    }
  },

  getters: {
    /** CSS-фон окна сообщений с учётом пресета или загруженного фото. */
    wallpaperCss: (state): string => {
      if (state.wallpaperKey === 'custom' && state.wallpaperCustom) {
        return `url("${state.wallpaperCustom}") center / cover no-repeat`
      }
      const preset = WALLPAPER_PRESETS.find((item) => item.key === state.wallpaperKey)
      return preset?.background ?? ''
    }
  },

  actions: {
    /** Применяет текущие настройки оформления к документу. */
    applyAppearance() {
      const prefersDark = systemPrefersDark()
      const resolved: Theme = this.mode === 'system' ? (prefersDark ? 'dark' : 'light') : this.mode
      this.currentTheme = resolved
      document.documentElement.setAttribute('data-theme', resolved)
      try {
        localStorage.setItem(LEGACY_THEME_KEY, resolved)
      } catch {
        /* localStorage недоступен */
      }

      const accent = ACCENT_PRESETS.find((item) => item.key === this.accentKey)
      const accentHex = accent?.hex ?? ACCENT_PRESETS[0].hex
      document.documentElement.style.setProperty('--ms-accent', accentHex)
      document.documentElement.setAttribute('data-bubble', this.bubbleKey)

      // Размер текста: множитель читают CSS-правила текста сообщений, композера и списка чатов.
      const textSize =
        TEXT_SIZE_PRESETS.find((item) => item.key === this.textSizeKey) ?? TEXT_SIZE_PRESETS[1]
      document.documentElement.style.setProperty('--ms-text-scale', String(textSize.scale))

      // Цвет панели браузера: светлая тема — акцент, тёмная — цвет фона приложения.
      const themeColor = document.querySelector('meta[name="theme-color"]')
      if (themeColor) {
        themeColor.setAttribute('content', resolved === 'dark' ? '#10151c' : accentHex)
      }
      this.saveAppearance()
    },

    saveAppearance() {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            mode: this.mode,
            accentKey: this.accentKey,
            bubbleKey: this.bubbleKey,
            textSizeKey: this.textSizeKey,
            wallpaperKey: this.wallpaperKey,
            wallpaperCustom: this.wallpaperCustom
          })
        )
      } catch {
        /* localStorage недоступен — не сохраняем */
      }
    },

    /** Старый API: явная светлая/тёмная тема. */
    setTheme(theme: string) {
      if (theme === 'light' || theme === 'dark') {
        this.mode = theme
        this.applyAppearance()
      }
    },

    setThemeMode(mode: ThemeMode) {
      this.mode = mode
      this.applyAppearance()
    },

    toggleTheme() {
      const next: Theme = this.currentTheme === 'light' ? 'dark' : 'light'
      this.setTheme(next)
    },

    setAccent(key: string) {
      this.accentKey = key
      this.applyAppearance()
    },

    setBubbleStyle(key: string) {
      this.bubbleKey = key
      this.applyAppearance()
    },

    setTextSize(key: string) {
      this.textSizeKey = key
      this.applyAppearance()
    },

    setWallpaper(key: string) {
      this.wallpaperKey = key
      if (key !== 'custom') this.wallpaperCustom = null
      this.saveAppearance()
    },

    /** Устанавливает собственное фото в качестве обоев чата. */
    setCustomWallpaper(dataUrl: string) {
      this.wallpaperCustom = dataUrl
      this.wallpaperKey = 'custom'
      this.saveAppearance()
    },

    clearCustomWallpaper() {
      if (this.wallpaperKey === 'custom') {
        this.wallpaperKey = 'default'
      }
      this.wallpaperCustom = null
      this.saveAppearance()
    },

    resetAppearance() {
      this.mode = DEFAULT_MODE
      this.accentKey = DEFAULT_STATE.accentKey
      this.bubbleKey = DEFAULT_STATE.bubbleKey
      this.textSizeKey = DEFAULT_STATE.textSizeKey
      this.wallpaperKey = DEFAULT_STATE.wallpaperKey
      this.wallpaperCustom = DEFAULT_STATE.wallpaperCustom
      this.applyAppearance()
    },

    initializeTheme() {
      // Переносимость: если раньше пользователь выбирал тему через app-theme.
      const legacy = localStorage.getItem(LEGACY_THEME_KEY)
      const saved = loadAppearance()
      if (!saved.mode && (legacy === 'light' || legacy === 'dark')) {
        this.mode = legacy
      }
      // Старое поле выбора обоев чата (было в Messenger.vue).
      if (!saved.wallpaperKey) {
        const legacyBg = localStorage.getItem(LEGACY_BG_KEY)
        if (legacyBg && WALLPAPER_PRESETS.some((item) => item.key === legacyBg)) {
          this.wallpaperKey = legacyBg
        }
      }
      this.applyAppearance()
      this._watchSystemTheme()
    },

    _watchSystemTheme() {
      if (typeof window === 'undefined' || !window.matchMedia) return
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      const onChange = () => {
        if (this.mode === 'system') this.applyAppearance()
      }
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', onChange)
      } else {
        // Safari < 14
        media.addListener(onChange)
      }
    },

    toggleSidebarCollapse() {
      this.isSidebarCollapsed = !this.isSidebarCollapsed
      localStorage.setItem('sidebar-collapsed', this.isSidebarCollapsed.toString())
    },

    initializeSidebarState() {
      const savedState = localStorage.getItem('sidebar-collapsed')
      if (savedState !== null) {
        this.isSidebarCollapsed = savedState === 'true'
      }
    }
  }
})
