/**
 * Страховка от «забыли зарегистрировать компонент Quasar».
 *
 * Quasar подключается точечно (`src/quasar.ts`), чтобы не тащить в бандл всю
 * библиотеку. Плата за это: незарегистрированный `<q-*>` в шаблоне — не ошибка
 * сборки и не ошибка типов, а пустое место в интерфейсе, которое легко не
 * заметить (ровно та же ловушка, что у иконок в `icons.spec.ts`).
 *
 * Тест сканирует разметку всех `.vue` и проверяет, что каждый использованный
 * компонент и каждая квазаровская директива есть в списках регистрации.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { QUASAR_COMPONENTS, QUASAR_DIRECTIVES } from '@/quasar'

const SRC = path.resolve(import.meta.dirname, '..')

/** Директивы Vue, которые не нужно регистрировать через Quasar. */
const VUE_DIRECTIVES = new Set([
  'if',
  'else',
  'else-if',
  'for',
  'show',
  'model',
  'bind',
  'on',
  'text',
  'html',
  'pre',
  'cloak',
  'once',
  'memo',
  'slot'
])

/** Директивы Quasar, которые мы вообще можем встретить (для отсева чужих `v-*`). */
const QUASAR_DIRECTIVE_NAMES = [
  'close-popup',
  'ripple',
  'scroll',
  'touch',
  'intersection',
  'go-back'
]

function collectVueFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      files.push(...collectVueFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.vue')) {
      files.push(full)
    }
  }
  return files
}

/** `q-card-section` → `QCardSection` */
function tagToComponentName(tag: string): string {
  return (
    'Q' +
    tag
      .slice(2)
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('')
  )
}

const files = collectVueFiles(SRC)

describe('регистрация компонентов Quasar', () => {
  it('все использованные <q-*> зарегистрированы', () => {
    const missing = new Map<string, string[]>()

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/<(q-[a-z-]+)/g)) {
        const component = tagToComponentName(match[1])
        if (component in QUASAR_COMPONENTS) continue
        const rel = path.relative(SRC, file)
        missing.set(component, [...(missing.get(component) ?? []), rel])
      }
    }

    expect(
      [...missing.entries()].map(([component, where]) => `${component}: ${where.join(', ')}`)
    ).toEqual([])
  })

  it('все квазаровские директивы из разметки зарегистрированы', () => {
    const missing: string[] = []

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/\sv-([a-z][a-z-]*)/g)) {
        const name = match[1]
        if (VUE_DIRECTIVES.has(name)) continue
        if (!QUASAR_DIRECTIVE_NAMES.includes(name)) continue
        if (name in QUASAR_DIRECTIVES) continue
        missing.push(`${name} (${path.relative(SRC, file)})`)
      }
    }

    expect(missing).toEqual([])
  })

  it('список регистрации не содержит мусора', () => {
    for (const [name, value] of Object.entries(QUASAR_COMPONENTS)) {
      expect(name, `компонент ${name}`).toMatch(/^Q[A-Z]/)
      // Компоненты Quasar — объекты с render/setup (не функции-конструкторы),
      // поэтому проверяем «что-то регистрируемое», а не конкретный тип.
      expect(
        typeof value === 'object' || typeof value === 'function',
        `компонент ${name} должен быть объектом или функцией`
      ).toBe(true)
      expect(value, `компонент ${name} не должен быть null`).not.toBeNull()
    }
    for (const [name, value] of Object.entries(QUASAR_DIRECTIVES)) {
      expect(name, `директива ${name}`).toMatch(/^[a-z]/)
      expect(value, `директива ${name} должна иметь install/hook`).toBeTruthy()
    }
  })

  it('сканирование действительно находит файлы', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(statSync(SRC).isDirectory()).toBe(true)
  })
})
