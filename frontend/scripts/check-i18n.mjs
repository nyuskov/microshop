#!/usr/bin/env node
/**
 * Проверка переводов: ключи, которые использует код, должны быть в каталоге.
 *
 * Зачем: ключ перевода — сам русский текст (`t('Войти')`), а переводы лежат в
 * `src/i18n/en.ts`. Забыть строку в каталоге очень легко (компонент правится в
 * одном файле, каталог — в другом), и тогда в английском интерфейсе молча
 * остаётся русская фраза. Это единственная ошибка перевода, которую видно
 * только глазами, поэтому её ловит скрипт.
 *
 * Что проверяется:
 *   - ERROR: `t('...')` из кода есть в `en.ts` (иначе английский покажет русский);
 *   - WARN:  ключи `en.ts`, которых нет ни в одном вызове (мёртвый перевод —
 *     строка переписана в компоненте, а ключ остался);
 *   - INFO:  сколько русских текстов ещё НЕ обёрнуто в `t()` (по файлам). Это
 *     оценка прогресса миграции, а не ошибка: перевод делается по частям.
 *
 * Запуск: node scripts/check-i18n.mjs  (из каталога frontend/)
 * Код возврата 1 — если есть ключи без перевода.
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'src')
const CATALOG = path.join(SRC, 'i18n', 'en.ts')

/** Каталог и тесты не участвуют: в них русский текст — это данные и ожидания. */
const SKIP_DIRS = new Set(['__tests__', 'i18n'])

const CODE_EXTENSIONS = new Set(['.ts', '.vue', '.js', '.mjs'])

/** Вызовы `t('...')` / `t("...")`, в том числе на нескольких строках. */
const CALL_RE = /\bt\(\s*(['"])([\s\S]*?)\1/g

/** Строки каталога: `'Ключ': 'Значение',` — ключ бывает и без кавычек (TS это позволяет). */
const ENTRY_RE = /^\s*(?:'((?:\\.|[^'])*)'|"((?:\\.|[^"])*)"|([^\s:'"]+))\s*:/gm

/** Любые строковые литералы кода (`'…'`, `"…"`, `` `…` ``) — живые тексты. */
const LITERAL_RE = /'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      files.push(...(await collectFiles(path.join(dir, entry.name))))
      continue
    }
    if (CODE_EXTENSIONS.has(path.extname(entry.name))) files.push(path.join(dir, entry.name))
  }
  return files
}

/** Убирает из `t()` переводы строк и лишние пробелы: они не часть ключа. */
function normalizeKey(raw) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
}

const catalogSource = await readFile(CATALOG, 'utf8')
const known = new Set()
/** Повторённые ключи: TS падает на них («multiple properties with the same name»). */
const duplicates = []
for (const match of catalogSource.matchAll(ENTRY_RE)) {
  const key = match[1] ?? match[2] ?? match[3]
  if (!key) continue
  const normalized = normalizeKey(key)
  if (known.has(normalized)) duplicates.push(normalized)
  known.add(normalized)
}

const files = await collectFiles(SRC)
const used = new Map()
/** Все строковые литералы кода: по ним видно живые ключи (см. ниже). */
const literals = new Set()
/** Файлы, где ещё есть русский текст вне `t()` — очередь перевода. */
const pending = []

for (const file of files) {
  const source = await readFile(file, 'utf8')
  const relative = path.relative(SRC, file)

  for (const match of source.matchAll(CALL_RE)) {
    const key = normalizeKey(match[2])
    if (!key) continue
    if (!used.has(key)) used.set(key, relative)
    else if (used.get(key) === relative) continue
  }

  // Тексты, которые в `t()` приходят ПЕРЕМЕННОЙ (`t(filter.title)`), вызовом не
  // видны — считаем их «живыми» по самому литералу в коде.
  for (const match of source.matchAll(LITERAL_RE)) {
    literals.add(normalizeKey(match[1] ?? match[2] ?? match[3] ?? ''))
  }

  // Оценка прогресса: строки с кириллицей, которые не являются вызовом `t(` и
  // не комментарием (ни `//`, ни шаблонным `<!-- -->`). Точность не нужна —
  // важен порядок величины и то, чтобы счёт не раздували комментарии.
  const withoutTemplateComments = source.replace(/<!--[\s\S]*?-->/g, (block) =>
    block.replace(/[^\n]/g, ' ')
  )
  const lines = withoutTemplateComments.split('\n')
  let untranslated = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (!/[А-Яа-яЁё]/.test(line)) continue
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    if (trimmed.includes('t(')) continue
    untranslated += 1
  }
  if (untranslated > 0) pending.push({ relative, untranslated })
}

const missing = [...used.entries()].filter(([key]) => !known.has(key))
const unused = [...known].filter((key) => !used.has(key) && !literals.has(key))

console.log(`Проверка переводов: в коде ${used.size} ключей, в каталоге ${known.size}.`)

if (unused.length > 0) {
  console.log(`\nВнимание: ${unused.length} перевод(ов) не используются (ключ переписан в коде?):`)
  for (const key of unused.slice(0, 20)) console.log(`  ${key}`)
  if (unused.length > 20) console.log(`  …и ещё ${unused.length - 20}`)
}

pending.sort((a, b) => b.untranslated - a.untranslated)
const totalPending = pending.reduce((sum, item) => sum + item.untranslated, 0)
console.log(
  `\nОсталось перевести (оценка по строкам с русским текстом вне t()): ${totalPending} в ${pending.length} файлах.`
)
for (const item of pending.slice(0, 15)) {
  console.log(`  ${item.untranslated}\t${item.relative}`)
}

if (duplicates.length > 0) {
  console.error(`\nОшибка: в каталоге ${duplicates.length} повторённых ключей:`)
  for (const key of duplicates) console.error(`  ${key}`)
  process.exit(1)
}

if (missing.length > 0) {
  console.error(`\nОшибка: ${missing.length} ключей без английского перевода:`)
  for (const [key, file] of missing) console.error(`  ${key}  (${file})`)
  process.exit(1)
}

console.log('\nВсе ключи, которые использует код, переведены.')
