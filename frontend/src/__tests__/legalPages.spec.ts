/**
 * Юридические страницы: русский оригинал и английский перевод.
 *
 * Документы лежат статикой (`public/*.html`), их отдаёт nginx, а приложение
 * только ссылается на нужную версию (см. `utils/legalDocs.ts`). Проверяем, что
 * обе версии на месте, что английская помечена как перевод (при расхождении
 * действует русская редакция) и что ссылки выбираются по языку интерфейса.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { setLocale } from '@/i18n'
import { legalUrl } from '@/utils/legalDocs'

const read = (name: string): string => readFileSync(resolve(process.cwd(), 'public', name), 'utf8')

const DOCS: Array<[string, string, string]> = [
  // [файл, часть заголовка на русском, часть заголовка на английском]
  ['terms', 'Пользовательское соглашение Pismo', 'Pismo Terms of Service'],
  ['privacy', 'Политика конфиденциальности Pismo', 'Pismo Privacy Policy'],
  ['community', 'Правила сообщества Pismo', 'Pismo Community Rules']
]

afterEach(() => setLocale('ru'))

describe.each(DOCS)('документ %s', (name, titleRu, titleEn) => {
  it('есть русская и английская версии', () => {
    expect(existsSync(resolve(process.cwd(), 'public', `${name}.html`))).toBe(true)
    expect(existsSync(resolve(process.cwd(), 'public', `${name}-en.html`))).toBe(true)
    expect(read(`${name}.html`)).toContain(titleRu)
    expect(read(`${name}-en.html`)).toContain(titleEn)
  })

  it('английская версия помечена как перевод и не содержит русского текста', () => {
    const html = read(`${name}-en.html`)
    expect(html).toContain('lang="en"')
    // При расхождении действует русская редакция — это написано в самой странице.
    expect(html).toContain('the Russian version prevails')
    expect(html).not.toContain(titleRu)
  })

  it('внутренние ссылки ведут на английские версии документов', () => {
    // Исключение — сама пометка о переводе: в ней ссылка на русскую редакцию
    // обязана вести на русский документ.
    const html = read(`${name}-en.html`)
      .split('\n')
      .filter((line) => !line.includes('prevails'))
      .join('\n')
    for (const match of html.matchAll(/href="\/([a-z-]+)\.html"/g)) {
      expect(match[1].endsWith('-en')).toBe(true)
    }
  })
})

describe('ссылка на документ зависит от языка интерфейса', () => {
  it('русский — оригинал, английский — перевод', () => {
    setLocale('ru')
    expect(legalUrl('terms')).toBe('/terms.html')
    expect(legalUrl('privacy')).toBe('/privacy.html')
    expect(legalUrl('community')).toBe('/community.html')

    setLocale('en')
    expect(legalUrl('terms')).toBe('/terms-en.html')
    expect(legalUrl('privacy')).toBe('/privacy-en.html')
    expect(legalUrl('community')).toBe('/community-en.html')
  })
})
