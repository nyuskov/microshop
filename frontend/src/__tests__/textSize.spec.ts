import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { TEXT_SIZE_PRESETS, useThemeStore } from '@/stores/theme'

/** Множитель размера текста, который читают CSS-правила. */
function scaleVar(): string {
  return document.documentElement.style.getPropertyValue('--ms-text-scale')
}

function storedAppearance(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem('appearance') ?? '{}')
}

describe('theme store: размер текста', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.style.removeProperty('--ms-text-scale')
    setActivePinia(createPinia())
  })

  it('по умолчанию — обычный размер (множитель 1)', () => {
    const store = useThemeStore()
    expect(store.textSizeKey).toBe('normal')
    store.applyAppearance()
    expect(scaleVar()).toBe('1')
  })

  it('крупный размер выставляет множитель больше единицы', () => {
    const store = useThemeStore()
    store.setTextSize('large')
    expect(Number(scaleVar())).toBeGreaterThan(1)
  })

  it('мелкий размер выставляет множитель меньше единицы', () => {
    const store = useThemeStore()
    store.setTextSize('compact')
    expect(Number(scaleVar())).toBeLessThan(1)
  })

  it('неизвестный ключ откатывается к обычному размеру', () => {
    const store = useThemeStore()
    store.textSizeKey = 'нет-такого'
    store.applyAppearance()
    expect(scaleVar()).toBe('1')
  })

  it('выбор сохраняется в localStorage', () => {
    const store = useThemeStore()
    store.setTextSize('large')
    expect(storedAppearance().textSizeKey).toBe('large')
  })

  it('размер восстанавливается из localStorage', () => {
    localStorage.setItem('appearance', JSON.stringify({ textSizeKey: 'compact' }))
    setActivePinia(createPinia())
    const store = useThemeStore()
    expect(store.textSizeKey).toBe('compact')
  })

  it('сброс настроек возвращает обычный размер', () => {
    const store = useThemeStore()
    store.setTextSize('large')
    store.resetAppearance()
    expect(store.textSizeKey).toBe('normal')
    expect(scaleVar()).toBe('1')
  })

  it('во всех пресетах есть подпись и положительный множитель', () => {
    for (const preset of TEXT_SIZE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0)
      expect(preset.scale).toBeGreaterThan(0)
    }
  })
})
