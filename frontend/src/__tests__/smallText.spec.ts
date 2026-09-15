import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Стражи мелкого текста и шкалы `--ms-fs-*`.
 *
 * Предыстория: служебный текст (время сообщения, плашка статуса, счётчики)
 * верстался фиксированными пикселями — до 8.5 px, причём на узких экранах
 * размеры ещё и уменьшались (`10px` → `9.5px` в медиазапросе). Из-за этого
 * такой текст не подчинялся настройке «Размер текста» из оформления: основной
 * текст масштабировался, а подписи — нет.
 *
 * Теперь служебный текст берёт размер из шкалы `--ms-fs-*`, а та умножается на
 * `--ms-text-scale`. Проверки статические (jsdom не считает шрифты), поэтому
 * сканируем исходники и следим за двумя правилами:
 *   1. никаких фиксированных `font-size` мельче 12px;
 *   2. шкала обязана быть привязана к `--ms-text-scale`.
 */

const SRC = 'src'
const FIXED_TOO_SMALL = /font-size:\s*([\d.]+)px/g

function styleFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...styleFiles(path))
    // sass-подмножество Quasar не наш код — его не проверяем
    else if (/\.(vue|css)$/.test(name)) out.push(path)
  }
  return out
}

function smallFixedSizes(source: string): number[] {
  const sizes: number[] = []
  for (const match of source.matchAll(FIXED_TOO_SMALL)) {
    const size = Number(match[1])
    if (size < 12) sizes.push(size)
  }
  return sizes
}

describe('мелкий текст', () => {
  it('в компонентах нет фиксированных размеров мельче 12px', () => {
    const offenders: string[] = []
    for (const file of styleFiles(SRC)) {
      const source = readFileSync(file, 'utf8')
      // Масштабируемые размеры (`calc(Npx * var(--ms-text-scale))`) допустимы:
      // они подчиняются настройке и проверены отдельным тестом ниже.
      const fixedSource = source.replace(/font-size:\s*calc\([^;]*--ms-text-scale[^;]*\);/g, '')
      for (const size of smallFixedSizes(fixedSource)) offenders.push(`${file}: ${size}px`)
    }
    expect(offenders).toEqual([])
  })

  it('шкала --ms-fs-* умножается на множитель настройки «Размер текста»', () => {
    const appearance = readFileSync('src/assets/appearance.css', 'utf8')
    for (const token of ['xs', 'sm', 'md', 'base', 'lg', 'xl']) {
      const declaration = new RegExp(`--ms-fs-${token}:\\s*calc\\([^;]*--ms-text-scale`)
      expect(appearance, `--ms-fs-${token} должен зависеть от --ms-text-scale`).toMatch(declaration)
    }
  })

  it('шкала используется, а не объявлена «про запас»', () => {
    const used = styleFiles(SRC).some((file) =>
      /font-size:\s*var\(--ms-fs-/.test(readFileSync(file, 'utf8'))
    )
    expect(used).toBe(true)
  })
})
