import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Вес шрифта, которого нет в шрифтовых файлах, браузер «подделывает»:
 * утолщает 700 синтетически, и текст выглядит размазанным. В приложении
 * объявлены Roboto 300/400/500/600/700, поэтому другие веса в стилях —
 * ошибка: либо опечатка, либо забытая гарнитура.
 *
 * Исключения: диапазон вариативного диапазона (`font-weight: 100 700`) и
 * иконочные шрифты, где вес задаётся диапазоном.
 */
const DECLARED_WEIGHTS = new Set([300, 400, 500, 600, 700])

const SRC = resolve(__dirname, '..')

function collectFiles(dir: string, extensions: string[]): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full, extensions))
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

/** Все веса из `font-weight: <значение>` в файлах стилей и компонентов. */
function usedWeights(): { file: string; value: string }[] {
  const files = collectFiles(SRC, ['.vue', '.scss', '.css'])
  const found: { file: string; value: string }[] = []
  for (const file of files) {
    // fonts.css — это и есть объявление шрифтов: его не проверяем.
    if (file.endsWith('fonts.css') || file.endsWith('icons.css')) continue
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/font-weight:\s*([^;{}]+)/g)) {
      found.push({ file: file.slice(SRC.length + 1), value: match[1].trim() })
    }
  }
  return found
}

describe('веса шрифта', () => {
  it('в стилях используются только объявленные веса (иначе браузер подделывает жирность)', () => {
    const bad = usedWeights().filter(
      ({ value }) =>
        !value.includes(' ') && // 100 700 — диапазон вариативного шрифта
        !value.startsWith('var(') &&
        !/^(normal|bold|bolder|lighter|inherit|initial|unset)$/.test(value) &&
        !DECLARED_WEIGHTS.has(Number(value))
    )
    expect(bad).toEqual([])
  })

  it('в проекте действительно встречаются веса (проверка не «пустая»)', () => {
    expect(usedWeights().length).toBeGreaterThan(50)
  })
})
