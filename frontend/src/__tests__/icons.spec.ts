import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ICON_MAP, icon } from '@/utils/icons'

/** Все .vue файлы проекта (рекурсивно). */
function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return vueFiles(path)
    return path.endsWith('.vue') ? [path] : []
  })
}

describe('icon(): логическое имя → классы иконки', () => {
  it('превращает имя в классы, которые понимает Quasar', () => {
    // Префикс `icon-` обязателен: по нему Quasar понимает, что получил список
    // классов, а не имя лигатуры (иначе нарисует значение ТЕКСТОМ).
    expect(icon('close')).toBe('icon-lucide icon-x')
    expect(icon('reply')).toBe('icon-lucide icon-reply')
    expect(icon('user')).toBe('user')
  })

  it('пустое значение и готовые классы пропускает как есть', () => {
    expect(icon(undefined)).toBeUndefined()
    expect(icon('')).toBeUndefined()
    expect(icon('icon-lucide icon-user')).toBe('icon-lucide icon-user')
  })
})

describe('мэппинг иконок', () => {
  it('все имена из шаблонов есть в ICON_MAP', () => {
    const used = new Set<string>()
    for (const file of vueFiles('src')) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/:name="\s*icon\(\s*'([a-z0-9_]+)'/g)) {
        used.add(match[1])
      }
    }
    // Хотя бы что-то нашли — иначе проверка бессмысленна.
    expect(used.size).toBeGreaterThan(50)
    const unknown = [...used].filter((name) => !(name in ICON_MAP))
    expect(unknown).toEqual([])
  })

  it('для каждой иконки есть правило в сгенерированном icons.css', () => {
    // Иначе иконка отрендерится пустотой: имени не будет в CSS.
    const css = readFileSync('src/assets/icons.css', 'utf8')
    const missing = [...new Set(Object.values(ICON_MAP))].filter(
      (name) => !css.includes(`.icon-${name}::before`)
    )
    expect(missing).toEqual([])
  })

  it('в CSS подключены оба шрифта: свой (Lucide) и резервный (Material)', () => {
    const css = readFileSync('src/assets/icons.css', 'utf8')
    expect(css).toContain("font-family: 'Pismo Icons'")
    expect(css).toContain("font-family: 'Material Symbols Rounded'")
    // База рисует иконки своим шрифтом, а не лигатурами Material.
    expect(css).toContain('.icon-lucide {')
  })
})
