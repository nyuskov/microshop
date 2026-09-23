import { defineStore } from 'pinia'
import { t } from '@/i18n'

import {
  isDarkBySchedule,
  msUntilScheduleChange,
  SCHEDULE_DEFAULT_END,
  SCHEDULE_DEFAULT_START
} from '@/utils/themeSchedule'

/** Режим темы: светлая / тёмная / по системе / по расписанию.
 *
 * `amoled` — не выбор пользователя в ряду тем, а уточнение тёмной («чёрный
 * фон»): его включает флаг `amoled`, а в `currentTheme` попадает уже готовое
 * значение для атрибута `data-theme`. */
export type Theme = 'light' | 'dark' | 'amoled'
export type ThemeMode = 'light' | 'dark' | 'system' | 'schedule'

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
  /** Чёрный фон (AMOLED) — усилие тёмной темы, а не отдельная тема. */
  amoled: boolean
  /** Границы расписания тёмной темы — минуты от полуночи (см. `utils/themeSchedule.ts`). */
  darkFrom: number
  darkTo: number
  /** Повышенная контрастность: текст и границы темнее (см. блок в appearance.css). */
  highContrast: boolean
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
  amoled: false,
  darkFrom: SCHEDULE_DEFAULT_START,
  darkTo: SCHEDULE_DEFAULT_END,
  highContrast: false,
  accentKey: 'green',
  bubbleKey: 'green',
  textSizeKey: 'normal',
  wallpaperKey: 'default',
  wallpaperCustom: null
}

/** Будильник смены темы по расписанию. Живёт вне стора: таймер не состояние UI. */
let scheduleTimer: number | null = null

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
    reader.onerror = () => reject(new Error(t('Не удалось прочитать файл')))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error(t('Файл не является изображением')))
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error(t('Canvas недоступен')))
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

/**
 * Системная настройка «повышенная контрастность».
 *
 * В Windows и Android это отдельный переключатель (не тема), поэтому у нас он
 * тоже флаг, а не четвёртая тема: пороги WCAG в этом режиме выше, а вся
 * геометрия остаётся прежней.
 */
function systemPrefersContrast(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(prefers-contrast: more)').matches
  )
}

/**
 * Есть ли смысл в плавной смене темы.
 *
 * View Transitions есть не везде (Safari и WebView постарше), а при
 * `prefers-reduced-motion` переход нужно пропустить: в a11y.css глушатся
 * обычные анимации, но псевдоэлементы `::view-transition-*` под них не попадают.
 */
function canCrossfadeTheme(): boolean {
  if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function') {
    return false
  }
  return !(
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Меняет тему документа, по возможности — кроссфейдом.
 *
 * Смена темы = подмена значений токенов, анимацией её не описать (переменные
 * не интерполируются). Снимок прежнего кадра делает сам браузер, нам остаётся
 * только попросить об этом. Без API — мгновенная смена, как раньше.
 */
function applyThemeAttribute(next: Theme) {
  const root = document.documentElement
  // Атрибут уже такой (в том числе после theme-boot.js в index.html) или
  // перехода нет — обычная смена без снимка.
  if (root.getAttribute('data-theme') === next || !canCrossfadeTheme()) {
    root.setAttribute('data-theme', next)
    return
  }
  try {
    const transition = document.startViewTransition(() => root.setAttribute('data-theme', next))
    // Переход могут отменить (вкладка ушла в фон) — это не ошибка приложения.
    void transition.finished.catch(() => undefined)
  } catch {
    root.setAttribute('data-theme', next)
  }
}

export const useThemeStore = defineStore('theme', {
  state: (): AppearanceState => {
    const stored = loadAppearance()
    return {
      ...DEFAULT_STATE,
      ...stored,
      // Системную настройку берём только при первом запуске: дальше решает
      // тумблер, иначе явно выключенный режим включался бы на каждом старте.
      highContrast: stored.highContrast ?? systemPrefersContrast(),
      isSidebarCollapsed: false
    }
  },

  getters: {
    /** Действует ли сейчас тёмная схема (в неё входит и AMOLED).
     *
     * Нужен настройкам внешнего вида: чёрный фон имеет смысл только на тёмной
     * теме, поэтому тумблер AMOLED гасится в светлой. */
    darkActive: (state): boolean => state.currentTheme !== 'light',

    /** Тема выбирается расписанием (тёмная вечером, светлая днём). */
    scheduleActive: (state): boolean => state.mode === 'schedule',

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
      const bySchedule = isDarkBySchedule(new Date(), this.darkFrom, this.darkTo)
      const base: Theme =
        this.mode === 'system'
          ? prefersDark
            ? 'dark'
            : 'light'
          : this.mode === 'schedule'
            ? bySchedule
              ? 'dark'
              : 'light'
            : this.mode
      // Чёрный фон — только для тёмной схемы: в светлой флаг не должен менять
      // атрибут `data-theme`, иначе получится чёрное окно со светлыми токенами.
      const resolved: Theme = base === 'dark' && this.amoled ? 'amoled' : base
      this.currentTheme = resolved
      applyThemeAttribute(resolved)
      try {
        localStorage.setItem(LEGACY_THEME_KEY, resolved)
      } catch {
        /* localStorage недоступен */
      }

      const accent = ACCENT_PRESETS.find((item) => item.key === this.accentKey)
      const accentHex = accent?.hex ?? ACCENT_PRESETS[0].hex
      document.documentElement.style.setProperty('--ms-accent', accentHex)
      document.documentElement.setAttribute('data-bubble', this.bubbleKey)
      document.documentElement.setAttribute('data-contrast', this.highContrast ? 'high' : 'normal')

      // Размер текста: множитель читают CSS-правила текста сообщений, композера и списка чатов.
      const textSize =
        TEXT_SIZE_PRESETS.find((item) => item.key === this.textSizeKey) ?? TEXT_SIZE_PRESETS[1]
      document.documentElement.style.setProperty('--ms-text-scale', String(textSize.scale))

      // Цвет панели браузера: светлая тема — акцент, тёмная — цвет фона приложения.
      const themeColor = document.querySelector('meta[name="theme-color"]')
      if (themeColor) {
        const hex = resolved === 'amoled' ? '#000000' : resolved === 'dark' ? '#10151c' : accentHex
        themeColor.setAttribute('content', hex)
      }
      this.saveAppearance()
      this.planScheduleCheck()
    },

    saveAppearance() {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            mode: this.mode,
            amoled: this.amoled,
            darkFrom: this.darkFrom,
            darkTo: this.darkTo,
            highContrast: this.highContrast,
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

    /**
     * Границы расписания тёмной темы (минуты от полуночи).
     *
     * Применяем сразу: пользователь выбрал время и хочет видеть результат, а не
     * гадать, почему тема не сменилась (например, выставил окно 22:00–07:00
     * вечером — она станет тёмной тут же).
     */
    setDarkWindow(from: number, to: number) {
      this.darkFrom = from
      this.darkTo = to
      this.applyAppearance()
    },

    /** Чёрный фон (AMOLED). Действует, только пока активна тёмная схема. */
    setAmoled(on: boolean) {
      this.amoled = on
      this.applyAppearance()
    },

    /** Повышенная контрастность: текст и границы темнее (лучше видно на солнце). */
    setHighContrast(on: boolean) {
      this.highContrast = on
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
      this.amoled = DEFAULT_STATE.amoled
      this.darkFrom = DEFAULT_STATE.darkFrom
      this.darkTo = DEFAULT_STATE.darkTo
      this.highContrast = DEFAULT_STATE.highContrast
      this.accentKey = DEFAULT_STATE.accentKey
      this.bubbleKey = DEFAULT_STATE.bubbleKey
      this.textSizeKey = DEFAULT_STATE.textSizeKey
      this.wallpaperKey = DEFAULT_STATE.wallpaperKey
      this.wallpaperCustom = DEFAULT_STATE.wallpaperCustom
      this.applyAppearance()
    },

    /**
     * Будильник на границу окна расписания: ровно в 22:00 или 07:00 тема
     * перерисовывается. Опрашивать время каждую минуту не нужно — это лишняя
     * работа в фоне, особенно на телефоне.
     */
    planScheduleCheck() {
      if (typeof window === 'undefined') return
      if (scheduleTimer !== null) {
        window.clearTimeout(scheduleTimer)
        scheduleTimer = null
      }
      if (this.mode !== 'schedule') return
      const wait = msUntilScheduleChange(new Date(), this.darkFrom, this.darkTo)
      if (!wait) return
      scheduleTimer = window.setTimeout(() => {
        scheduleTimer = null
        this.applyAppearance()
      }, wait)
    },

    /**
     * Пересчёт темы при возврате к приложению.
     *
     * Телефон в фоне замораживает таймеры, поэтому после долгой блокировки экрана
     * будильник мог не сработать — при возврате считаем заново, не дожидаясь
     * следующей границы.
     */
    watchSchedule() {
      if (typeof document === 'undefined' || !document.addEventListener) return
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.applyAppearance()
      })
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
      this.watchSchedule()
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
