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
  it('нигде не вызываются alert/confirm/prompt', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      if (SKIP_FILES.has(file)) continue
      for (const line of codeLines(readFileSync(file, 'utf8'))) {
        if (/\b(window\.)?(alert|confirm|prompt)\s*\(/.test(line)) {
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
