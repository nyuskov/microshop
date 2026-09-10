import { describe, expect, it } from 'vitest'

/**
 * Страж на «компонент есть в шаблоне, но не подключён».
 *
 * Vue в рантайме пишет только console.warn «Failed to resolve component» и
 * рендерит пустоту — ни vue-tsc, ни eslint такое не ловят, поэтому экран
 * молча остаётся пустым (именно так «не открывался» просмотрщик историй).
 * Здесь проверяем, что каждый PascalCase-тег из шаблона объявлен в скрипте.
 */
const FILES = import.meta.glob('/src/**/*.vue', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/** Теги Quasar регистрируются глобально в main.ts, их объявлять не нужно. */
const isGlobal = (tag: string): boolean => /^Q[A-Z]/.test(tag)

/** Встроенные компоненты Vue: доступны без импорта. */
const BUILTIN = new Set([
  'Teleport',
  'Suspense',
  'KeepAlive',
  'Transition',
  'TransitionGroup',
  'Component',
  'Fragment'
])

/** Имена слотов/событий и прочие служебные записи сюда не попадут: нужен `<Тег`. */
const TAG_RE = /<([A-Z][A-Za-z0-9]*)[\s/>]/g

/** Убираем шаблон, чтобы искать только объявления в скрипте. */
const scriptOnly = (source: string): string => {
  const start = source.indexOf('<template>')
  const end = source.lastIndexOf('</template>')
  if (start === -1 || end === -1) return source
  return source.slice(0, start) + source.slice(end + '</template>'.length)
}

const declaredIn = (script: string, tag: string): boolean =>
  new RegExp(`(^|[^\\w.$])${tag}([^\\w$]|$)`).test(script)

describe('компоненты в шаблонах', () => {
  const cases = Object.keys(FILES).map((path) => [path, FILES[path]] as const)

  it('найдены файлы для проверки', () => {
    expect(cases.length).toBeGreaterThan(20)
  })

  it.each(cases)('%s: все компоненты объявлены', (path, source) => {
    const templateStart = source.indexOf('<template>')
    if (templateStart === -1) return
    const template = source.slice(templateStart)
    const script = scriptOnly(source)

    const missing = new Set<string>()
    for (const match of template.matchAll(TAG_RE)) {
      const tag = match[1]
      if (isGlobal(tag) || BUILTIN.has(tag)) continue
      if (!declaredIn(script, tag)) missing.add(tag)
    }

    expect([...missing], `в ${path} не подключены компоненты`).toEqual([])
  })
})
