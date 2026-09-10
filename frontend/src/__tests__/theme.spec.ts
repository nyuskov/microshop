import { beforeEach, describe, expect, it } from 'vitest'
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
