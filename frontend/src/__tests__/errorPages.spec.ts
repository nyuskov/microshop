/**
 * Статические экраны ошибок (404/500).
 *
 * Их отдаёт nginx (см. `nginx-prod/default.conf`), а не приложение: страница
 * должна открываться даже когда фронтенд или бэкенд недоступны. Поэтому
 * проверяем, что файлы на месте, самодостаточны (без внешних ресурсов и без
 * сервис-воркера, который мог бы закэшировать поломку) и уводят в приложение.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

// Корень проекта: в vitest `import.meta.url` виртуальный, поэтому идём от cwd.
const read = (name: string): string => readFileSync(resolve(process.cwd(), 'public', name), 'utf8')

const PAGES: Array<[string, string]> = [
  ['404.html', 'Страница не найдена'],
  ['500.html', 'Что-то пошло не так']
]

describe.each(PAGES)('статическая страница %s', (file, title) => {
  const html = read(file)

  it('содержит заголовок и кнопку возврата в приложение', () => {
    expect(html).toContain(title)
    expect(html).toContain('href="/"')
  })

  it('не тянет внешние ресурсы и не регистрирует service worker', () => {
    expect(html).not.toMatch(/<script[^>]+src=/i)
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/i)
    expect(html).not.toContain('serviceWorker')
  })

  it('оформлена в палитре приложения и не индексируется', () => {
    expect(html).toContain('--brand')
    expect(html).toContain('prefers-color-scheme')
    expect(html).toContain('noindex')
  })
})
