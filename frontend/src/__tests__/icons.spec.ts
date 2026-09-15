import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DRAWN_GLYPHS, ICON_MAP, icon } from '@/utils/icons'

/** Исходники проекта (.vue и .ts), которые могут содержать имена иконок. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      // Тесты и сам мэппинг не считаем: там имена иконок — это как раз данные.
      return entry === '__tests__' ? [] : sourceFiles(path)
    }
    if (path.endsWith('.ts') && path.endsWith('utils/icons.ts')) return []
    return path.endsWith('.vue') || path.endsWith('.ts') ? [path] : []
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

describe('иконки видео', () => {
  it('видеосообщение и видеозвонок — разные глифы', () => {
    // Одно изображение на «записать кружок» и «позвонить с видео» читалось
    // неоднозначно, поэтому у видеосообщения свой глиф: «кружок внутри квадрата
    // со скруглёнными углами» — как в Telegram. В Lucide такого нет, глиф
    // нарисован вручную (см. icons-drawn.css).
    expect(ICON_MAP.videocam).toBe('video')
    expect(ICON_MAP.video_message).toBe('round-video')
    expect(ICON_MAP.video_message).not.toBe(ICON_MAP.videocam)
    // Класс-база другая: рисованный глиф рисует маска, а не шрифт.
    expect(icon('video_message')).toBe('icon-drawn icon-round-video')
  })

  it('рисованный глиф описан в icons-drawn.css', () => {
    // Иначе кнопка записи видео останется пустым местом: имени `round-video`
    // нет ни в шрифте, ни в сгенерированном icons.css.
    const css = readFileSync('src/assets/icons-drawn.css', 'utf8')
    const glyph = css.match(/\.icon-round-video\s*\{[^}]*--icon-glyph:\s*url\("([^"]+)"\)/)
    expect(glyph).not.toBeNull()

    // Форма из маски: квадрат со скруглением и кружок внутри.
    const svg = decodeURIComponent(glyph![1])
    expect(svg).toContain('<rect')
    expect(svg).toContain("rx='6'")
    expect(svg).toContain('<circle')
    // Штрих 2 из поля 24 — как у иконок Lucide, иначе глиф выбивается по весу.
    expect(svg).toContain("stroke-width='2'")
  })
})

/**
 * Убирает из выражения сравнения — там строки не имена иконок, а значения
 * (`icon(callKind === 'video' ? 'videocam' : 'call')`).
 */
function stripComparisons(expr: string): string {
  return expr.replace(/[!=]==?\s*'[a-z0-9_]+'/g, '')
}

/**
 * Имена иконок, которые реально встречаются в коде.
 *
 * Важно: иконка передаётся не только литералом в шаблоне. Часто имя лежит в
 * объекте и выбирается тернарником (`icon: isAdmin ? 'shield_person' :
 * 'admin_panel_settings'`, см. GroupChatInfo.vue) — такой случай тоже надо
 * ловить: имени нет в ICON_MAP → `icon()` вернёт его как есть, и Quasar
 * нарисует значение ТЕКСТОМ. vue-tsc и eslint об этом молчат.
 */
function usedIconNames(text: string): string[] {
  const names: string[] = []
  // icon('name') / iconNameOf('name')
  for (const m of text.matchAll(/\b(?:icon|iconNameOf)\(\s*'([a-z0-9_]+)'/g)) {
    names.push(m[1])
  }
  // :name="icon(...)" — включая тернарники внутри вызова.
  for (const m of text.matchAll(/:name="([^"]*)"/g)) {
    if (!m[1].includes('icon(')) continue
    for (const n of stripComparisons(m[1]).matchAll(/'([a-z0-9_]+)'/g)) names.push(n[1])
  }
  // Свойство объекта: icon: 'name' | icon: cond ? 'a' : 'b',
  for (const m of text.matchAll(/\bicon\s*:\s*([^\n,}]+)/g)) {
    for (const n of stripComparisons(m[1]).matchAll(/'([a-z0-9_]+)'/g)) names.push(n[1])
  }
  // icon = 'name'
  for (const m of text.matchAll(/\bicon\s*=\s*'([a-z0-9_]+)'/g)) names.push(m[1])
  // icon="name" на наших компонентах (EmptyState, ChatPlaceholder): имя уходит
  // в `icon()` внутри компонента, поэтому проверять надо так же строго.
  for (const m of text.matchAll(/<(?:EmptyState|ChatPlaceholder)\b[^>]*?\sicon="([a-z0-9_]+)"/gs)) {
    names.push(m[1])
  }
  return names
}

describe('мэппинг иконок', () => {
  it('все имена из кода есть в ICON_MAP', () => {
    const used = new Set<string>()
    for (const file of sourceFiles('src')) {
      for (const name of usedIconNames(readFileSync(file, 'utf8'))) used.add(name)
    }
    // Хотя бы что-то нашли — иначе проверка бессмысленна.
    expect(used.size).toBeGreaterThan(50)
    const unknown = [...used].filter((name) => !(name in ICON_MAP)).sort()
    expect(unknown).toEqual([])
  })

  it('у каждой иконки есть правило: шрифтовой — в icons.css, рисованной — в icons-drawn.css', () => {
    // Иначе иконка отрендерится пустотой: имени не будет в CSS.
    const font = readFileSync('src/assets/icons.css', 'utf8')
    const drawn = readFileSync('src/assets/icons-drawn.css', 'utf8')
    const missing = [...new Set(Object.values(ICON_MAP))].filter((name) =>
      DRAWN_GLYPHS.has(name)
        ? !drawn.includes(`.icon-${name} {`)
        : !font.includes(`.icon-${name}::before`)
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
