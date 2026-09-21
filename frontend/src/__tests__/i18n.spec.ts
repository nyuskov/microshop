import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_LOCALE,
  LOCALES,
  catalogLoaded,
  dateLocale,
  locale,
  plural,
  setLocale,
  t
} from '@/i18n'

/**
 * Проверки перевода интерфейса.
 *
 * Главное, что здесь стережётся: непереведённая строка ОСТАЁТСЯ РУССКОЙ (а не
 * пустой), а список языков содержит только те, на которых интерфейс умеет
 * работать (в нём раньше были es/de/fr без перевода).
 */
describe('i18n', () => {
  beforeEach(() => {
    setLocale(null)
  })

  it('по умолчанию русский: текст отдаётся как есть', () => {
    expect(locale.value).toBe(DEFAULT_LOCALE)
    expect(t('Вход')).toBe('Вход')
  })

  it('в списке языков только переведённые (ru и en)', () => {
    expect(LOCALES.map((item) => item.code)).toEqual(['ru', 'en'])
  })

  it('неизвестный код с сервера приводится к русскому', () => {
    setLocale('de')
    expect(locale.value).toBe('ru')
  })

  it('английский включается и переводит известные строки', async () => {
    setLocale('en')
    expect(locale.value).toBe('en')
    await vi.waitFor(() => expect(catalogLoaded.value).toBe(true))
    expect(t('Вход')).toBe('Log in')
    // Строки, которой нет в каталоге, остаётся русской — интерфейс не пустеет.
    expect(t('Такой строки в каталоге нет')).toBe('Такой строки в каталоге нет')
  })

  it('подставляет значения в {места}', async () => {
    setLocale('en')
    await vi.waitFor(() => expect(catalogLoaded.value).toBe(true))
    expect(t('Код отправлен на {phone}', { phone: '+79001110001' })).toBe(
      'Code sent to +79001110001'
    )
  })

  it('в русском подстановка тоже работает (вызов один на оба языка)', () => {
    expect(t('Код отправлен на {phone}', { phone: '+7' })).toBe('Код отправлен на +7')
  })

  it('формы слова: русские три, английские две', () => {
    expect(plural(1, ['минута', 'минуты', 'минут'], ['minute', 'minutes'])).toBe('минута')
    expect(plural(3, ['минута', 'минуты', 'минут'], ['minute', 'minutes'])).toBe('минуты')
    expect(plural(5, ['минута', 'минуты', 'минут'], ['minute', 'minutes'])).toBe('минут')
    expect(plural(11, ['минута', 'минуты', 'минут'], ['minute', 'minutes'])).toBe('минут')

    setLocale('en')
    expect(plural(1, ['минута', 'минуты', 'минут'], ['minute', 'minutes'])).toBe('minute')
    expect(plural(5, ['минута', 'минуты', 'минут'], ['minute', 'minutes'])).toBe('minutes')
  })

  it('локаль дат следует за языком', () => {
    expect(dateLocale()).toBe('ru-RU')
    setLocale('en')
    expect(dateLocale()).toBe('en-US')
  })
})
