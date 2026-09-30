import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Штатных окон браузера в приложении быть не должно.
 *
 * `window.confirm`/`alert`/`prompt` рисуются вне приложения: чужая типографика,
 * игнорируют тёмную тему, в PWA-режиме выглядят как системное окно поверх
 * нашего, а часть встроенных браузеров их подавляет вовсе (тогда действие
 * «молча» не выполняется). Вместо них — `utils/appDialogs.ts` (окна на Quasar).
 *
 * Тест сканирует исходники: он же поймает возврат к старой привычке в новом
 * коде. Комментарии и сам `appDialogs.ts` не считаем.
 */
const SRC = path.resolve(import.meta.dirname, '..')
const SKIP_FILES = new Set([path.join(SRC, 'utils', 'appDialogs.ts')])

function sourceFiles(dir: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      result.push(...sourceFiles(full))
      continue
    }
    if (!/\.(ts|vue)$/.test(entry)) continue
    if (full.includes('__tests__')) continue
    result.push(full)
  }
  return result
}

/** Строки кода без комментариев: ищем именно вызовы, а не упоминания в тексте. */
function codeLines(source: string): string[] {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return withoutBlockComments
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .filter((line) => line.trim().length > 0)
}

describe('штатные окна браузера', () => {
  /**
   * Штатные окна — это функции на `window`. Вызов МЕТОДА с таким именем у своего
   * объекта окном не является: у события установки приложения есть свой
   * `event.prompt()` (`services/installPrompt.ts`), и он рисует системное окно
   * установки, а не `window.prompt`. Поэтому свою форму ищем только там, где
   * перед именем нет точки, и отдельно — явные `window.alert/confirm/prompt`.
   */
  const CALL = '(alert|confirm|prompt)\\s*\\('
  const BARE_CALL = new RegExp(`(?<![.\\w$])${CALL}`)
  const WINDOW_CALL = new RegExp(`\\b(window|globalThis|self)\\s*\\.\\s*${CALL}`)

  it('нигде не вызываются alert/confirm/prompt', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      if (SKIP_FILES.has(file)) continue
      for (const line of codeLines(readFileSync(file, 'utf8'))) {
        if (BARE_CALL.test(line) || WINDOW_CALL.test(line)) {
          offenders.push(`${path.relative(SRC, file)}: ${line.trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('модальные окна живут в одном месте и умеют всё нужное', () => {
    const source = readFileSync(path.join(SRC, 'utils', 'appDialogs.ts'), 'utf8')
    expect(source).toContain('export const confirmDialog')
    expect(source).toContain('export const alertDialog')
    expect(source).toContain('export const askTextDialog')
    // Отказ от окна обязан снимать промис, иначе вызывающий код повиснет.
    expect(source).toContain('onDismiss')
  })
})
