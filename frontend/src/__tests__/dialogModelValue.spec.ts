import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `v-model` не должен быть привязан к readonly-`computed`.
 *
 * КАКАЯ ЭТО БЫЛА ОШИБКА (19.09.2026, «окно комментариев нельзя закрыть»):
 * диалоги открывались через `v-model="channelCommentsOpen"`, где переменная была
 * `computed(() => ...)`. Закрытие в Quasar — это запись `update:modelValue =
 * false`; readonly-computed запись отбрасывает (Vue пишет предупреждение в
 * консоль), поэтому не работали ни крестик, ни Esc, ни клик мимо — окно просто
 * висело. Сборка, типы и линт такое не ловят: связь видна только в шаблоне.
 *
 * Нужен `computed({ get, set })` или обычный `ref`. Проверка статическая (скан
 * `.vue`), потому что ошибка не воспроизводится в юнит-тесте компонента, пока не
 * смонтируешь весь родитель с диалогом.
 */

/** Все `.vue` проекта (пути — от корня фронтенда, как в остальных тестах). */
function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return vueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

/** Файлы, где пишут `v-model="имя"` и `const имя = computed(() => …)`. */
function findReadonlyModels(files: string[]): string[] {
  // `computed(` сразу за быстрым `(` (не `computed({ … })`) = только чтение.
  const readonlyComputed = new RegExp(
    'const\\s+([A-Za-z0-9_]+)\\s*=\\s*computed(?:<[^>]*>)?\\(\\s*(?!\\{)',
    'g'
  )
  const problems: string[] = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(readonlyComputed)) {
      const name = match[1]
      const usedInModel = new RegExp(`v-model(?:\\.[a-z]+)?=["']${name}["']`).test(source)
      if (usedInModel) problems.push(`${file} → v-model="${name}"`)
    }
  }
  return problems
}

describe('диалоги: v-model должен быть записываемым', () => {
  it('в компонентах нет v-model на readonly-computed', () => {
    const paths = vueFiles('src')

    expect(paths.length).toBeGreaterThan(20)
    expect(findReadonlyModels(paths)).toEqual([])
  })
})
