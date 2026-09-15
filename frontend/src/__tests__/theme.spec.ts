import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'

import { useThemeStore } from '@/stores/theme'
import { migrateLegacyStorage } from '@/utils/storage'

/** Очищает окружение перед каждым тестом: localStorage + атрибуты документа. */
function resetDom() {
  localStorage.clear()
  const el = document.documentElement
  el.removeAttribute('data-theme')
  el.removeAttribute('data-bubble')
  el.style.removeProperty('--ms-accent')
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', '')
}

function themeAttr(): string | null {
  return document.documentElement.getAttribute('data-theme')
}

function accentVar(): string {
  return document.documentElement.style.getPropertyValue('--ms-accent')
}

function storedAppearance(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem('appearance') ?? '{}')
}

describe('theme store: defaults', () => {
  beforeEach(() => {
    resetDom()
    setActivePinia(createPinia())
  })

  it('начинает с тёмной темы и зелёного акцента', () => {
    const store = useThemeStore()
    expect(store.mode).toBe('dark')
    expect(store.currentTheme).toBe('dark')
    expect(store.accentKey).toBe('green')
    expect(store.bubbleKey).toBe('green')
    expect(store.wallpaperKey).toBe('default')
  })

  it('applyAppearance вешает атрибуты на <html> и сохраняет настройки', () => {
    const store = useThemeStore()
    store.applyAppearance()
    expect(themeAttr()).toBe('dark')
    expect(document.documentElement.getAttribute('data-bubble')).toBe('green')
    expect(accentVar()).toBe('#2ea25e')
    expect(storedAppearance().mode).toBe('dark')
    expect(localStorage.getItem('app-theme')).toBe('dark')
  })
})

describe('theme store: переключение', () => {
  beforeEach(() => {
    resetDom()
    setActivePinia(createPinia())
  })

  it('setTheme("light") меняет тему и документ', () => {
    const store = useThemeStore()
    store.setTheme('light')
    expect(store.mode).toBe('light')
    expect(store.currentTheme).toBe('light')
    expect(themeAttr()).toBe('light')
    expect(localStorage.getItem('app-theme')).toBe('light')
  })

  it('toggleTheme переключает светлая ↔ тёмная', () => {
    const store = useThemeStore()
    expect(store.currentTheme).toBe('dark')
    store.toggleTheme()
    expect(store.currentTheme).toBe('light')
    store.toggleTheme()
    expect(store.currentTheme).toBe('dark')
  })

  it('setThemeMode("system") резолвится в тему документа', () => {
    // jsdom не реализует matchMedia — «тёмная по системе» = false → light.
    const store = useThemeStore()
    store.setThemeMode('system')
    expect(store.mode).toBe('system')
    expect(store.currentTheme).toBe('light')
    expect(themeAttr()).toBe('light')
  })
})

describe('theme store: акцент и оформление', () => {
  beforeEach(() => {
    resetDom()
    setActivePinia(createPinia())
  })

  it('setAccent применяет hex пресета в --ms-accent и в localStorage', () => {
    const store = useThemeStore()
    store.setAccent('violet')
    expect(store.accentKey).toBe('violet')
    expect(accentVar()).toBe('#7c5cd6')
    expect(storedAppearance().accentKey).toBe('violet')
  })

  it('wallpaperCss отдаёт пустую строку для default и градиент для пресета', () => {
    const store = useThemeStore()
    expect(store.wallpaperCss).toBe('')
    store.setWallpaper('sky')
    expect(store.wallpaperCss).toContain('linear-gradient')
    expect(storedAppearance().wallpaperKey).toBe('sky')
  })

  it('своё фото обоев: установка и очистка', () => {
    const store = useThemeStore()
    store.setCustomWallpaper('data:image/jpeg;base64,abc')
    expect(store.wallpaperKey).toBe('custom')
    expect(store.wallpaperCss).toContain('url("data:image/jpeg;base64,abc")')

    store.clearCustomWallpaper()
    expect(store.wallpaperKey).toBe('default')
    expect(store.wallpaperCustom).toBeNull()
    expect(store.wallpaperCss).toBe('')
  })
})

describe('theme store: миграция legacy-настроек', () => {
  beforeEach(resetDom)

  it('переносит старую app-theme=light и обои из microshop_chat_bg=sky', () => {
    localStorage.setItem('app-theme', 'light')
    localStorage.setItem('microshop_chat_bg', 'sky')
    // Так же, как при старте приложения (main.ts): сначала переносим ключи.
    migrateLegacyStorage()
    setActivePinia(createPinia())

    const store = useThemeStore()
    store.initializeTheme()
    expect(store.mode).toBe('light')
    expect(store.wallpaperKey).toBe('sky')
    expect(themeAttr()).toBe('light')
  })

  it('новые сохранённые настройки имеют приоритет над legacy', () => {
    localStorage.setItem('appearance', JSON.stringify({ mode: 'dark', wallpaperKey: 'ocean' }))
    localStorage.setItem('app-theme', 'light') // legacy, должен игнорироваться
    setActivePinia(createPinia())

    const store = useThemeStore()
    store.initializeTheme()
    expect(store.mode).toBe('dark')
    expect(store.wallpaperKey).toBe('ocean')
    expect(themeAttr()).toBe('dark')
  })
})

describe('theme store: чёрный фон (AMOLED)', () => {
  beforeEach(() => {
    resetDom()
    setActivePinia(createPinia())
  })

  it('в тёмной теме подменяет data-theme и сохраняется', () => {
    const store = useThemeStore()
    store.setAmoled(true)
    expect(store.amoled).toBe(true)
    expect(store.currentTheme).toBe('amoled')
    expect(themeAttr()).toBe('amoled')
    expect(storedAppearance().amoled).toBe(true)
  })

  it('в светлой теме флаг ничего не меняет, но остаётся включённым', () => {
    // Чёрный фон — уточнение тёмной схемы: если бы флаг переключал тему и в
    // светлой, получилось бы чёрное окно со светлыми токенами.
    const store = useThemeStore()
    store.setTheme('light')
    store.setAmoled(true)
    expect(store.currentTheme).toBe('light')
    expect(themeAttr()).toBe('light')
    // Возврат в тёмную — фон снова чёрный, выбор не потерялся.
    store.setTheme('dark')
    expect(themeAttr()).toBe('amoled')
  })

  it('darkActive показывает, действует ли тёмная схема', () => {
    const store = useThemeStore()
    expect(store.darkActive).toBe(true) // по умолчанию тёмная
    store.setTheme('light')
    expect(store.darkActive).toBe(false)
    store.setAmoled(true)
    store.setTheme('dark')
    expect(store.darkActive).toBe(true)
  })

  it('панель браузера в AMOLED — чистый чёрный', () => {
    // В jsdom нет index.html, поэтому тег создаём сами: в реальной странице он
    // есть (иначе панель браузера осталась бы тёмно-серой от тёмной темы).
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)

    const store = useThemeStore()
    store.setAmoled(true)
    expect(meta.getAttribute('content')).toBe('#000000')
    meta.remove()
  })

  it('сброс настроек возвращает тёмную тему без чёрного фона', () => {
    const store = useThemeStore()
    store.setAmoled(true)
    store.resetAppearance()
    expect(store.amoled).toBe(false)
    expect(store.currentTheme).toBe('dark')
    expect(themeAttr()).toBe('dark')
  })
})

/**
 * Стражи по исходникам: AMOLED — это набор селекторов в CSS, и забыть в нём
 * строку ничего не стоит (сборка пройдёт, тема будет выглядеть «почти
 * правильно»). Забытый пузырь вернулся бы к светлому значению из базового
 * блока — светлый пузырь в чёрной теме.
 */
describe('AMOLED: селекторы в CSS', () => {
  const appearance = readFileSync('src/assets/appearance.css', 'utf8')
  const quasar = readFileSync('src/assets/quasar.css', 'utf8')

  it('блок токенов задаёт тёмные контролы и чёрный фон чата', () => {
    const block = appearance.slice(appearance.indexOf("html[data-theme='amoled'] {"))
    expect(block).toContain('color-scheme: dark;')
    expect(block).toContain('--ms-chat-bg: #000000;')
  })

  it('тёмные оттенки пузырей объявлены и для AMOLED', () => {
    for (const variant of ['blue', 'lilac', 'pink', 'peach', 'mint', 'orange']) {
      expect(appearance).toContain(`html[data-theme='amoled'][data-bubble='${variant}']`)
    }
  })

  it('бэкдроп диалога затемняется и в AMOLED', () => {
    expect(quasar).toContain("html[data-theme='amoled'] .q-dialog__backdrop")
  })
})
