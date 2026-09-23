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

/**
 * Литералы, которые обязаны остаться русскими: это ДАННЫЕ, а не подписи.
 *
 * Без исключений счёт «осталось перевести» не дойдёт до нуля никогда, а
 * переводить эти строки нельзя — смысл потеряется:
 *   - `passwordPolicy.ts` — словарь слабых паролей: переводить его нельзя,
 *     иначе проверка перестанет ловить «пароль» (английский `password` там уже
 *     есть отдельной строкой);
 *   - `errors.ts` — русский текст 404-ответа сервера, по которому узнаём, что чат
 *     удалён: признак сверяется дословно;
 *   - названия языков (`Русский`, `Українська`, `Қазақша`) показываются СВОИМ
 *     именем — так и должно быть в выборе языка, а не «Russian»;
 *   - `countries.ts` — русские названия стран: английские берёт
 *     `countryName(code, 'en')`, то есть перевод есть, но он не в каталоге.
 */
const KEEP_RUSSIAN = new Map([
  ['services/errors.ts', ['чат не найден']],
  ['utils/passwordPolicy.ts', ['йцукен', 'пароль', 'привет', 'любовь', 'россия', 'москва']],
  ['utils/countries.ts', ['США', 'Южная Корея']],
  ['utils/translation.ts', ['Русский', 'Українська']],
  ['utils/voiceRecognition.ts', ['Русский', 'Українська', 'Қазақша']],
  // Название чата «Сохранённые сообщения» приходит с сервера по-русски: с ним
  // сравниваемся, чтобы показать перевод (`savedMessagesTitle`).
  ['utils/user.ts', ['Сохранённые сообщения']]
])

/**
 * Файлы, где русские литералы — это словари КЛЮЧЕЙ, а переводятся они вызовом
 * (`t(STATUS_MESSAGES[status])`, `t(elsewhere[reason])`) или при показе списка.
 *
 * Исключение файла целиком — осознанно: перечислять здесь полтора десятка
 * кодов ответов и статусов жалоб значило бы дублировать сам словарь, а он
 * меняется. Условие «есть в каталоге» (см. `isDataKey`) для этих файлов
 * обязательно, иначе правило спрятало бы и сырые подписи.
 */
const DATA_ONLY_FILES = new Map([
  ['services/errors.ts', 'таблица текстов по коду ответа: переводится вызовом'],
  ['services/moderation.ts', 'статусы и причины жалоб: ключи, переводятся при показе'],
  ['stores/call.ts', 'причины завершения на другом устройстве: переводит вызов']
])

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

/** Заменяет текст пробелами, оставляя переводы строк (нумерация не едет). */
function blank(text) {
  return text.replace(/[^\n]/g, ' ')
}

/**
 * Границы строкового литерала начиная с кавычки на позиции `start`.
 * Возвращает индекс ЗА закрывающей кавычкой (или конец текста, если её нет).
 */
function literalEnd(source, start) {
  const quote = source[start]
  let i = start + 1
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2
      continue
    }
    if (source[i] === quote) return i + 1
    i += 1
  }
  return i
}

/**
 * Границы вызова начиная с его имени: ищет закрывающую скобку с учётом строк.
 */
function callEnd(source, openIndex) {
  let depth = 0
  let i = openIndex
  while (i < source.length) {
    const char = source[i]
    if (char === "'" || char === '"' || char === '`') {
      i = literalEnd(source, i)
      continue
    }
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return i + 1
    }
    i += 1
  }
  return i
}

/**
 * Участки текста, которые УЖЕ переведены: аргументы `t('…')` и формы `plural(…)`.
 *
 * Зачем именно участки, а не поиск `t(` в строке: prettier разбивает длинный
 * вызов на несколько строк (`t(\n  'Очень длинный текст'\n)`), и построчный счёт
 * считал такие подписи непереведёнными. Так делался весь раздел «Настройки
 * устройства» и почти все окна с пояснениями.
 */
function translatedRanges(source) {
  const ranges = []
  for (const match of source.matchAll(/\bt\(/g)) {
    const open = match.index + match[0].length - 1
    ranges.push([open, callEnd(source, open)])
  }
  for (const match of source.matchAll(/\bplural\(/g)) {
    const open = match.index + match[0].length - 1
    ranges.push([open, callEnd(source, open)])
  }
  return ranges
}

/** Строковые литералы с позициями: по ним и считаем очередь перевода. */
function literalsWithPositions(source) {
  const out = []
  for (const match of source.matchAll(LITERAL_RE)) {
    const value = match[1] ?? match[2] ?? match[3] ?? ''
    const start = match.index
    out.push({ value: normalizeKey(value), start, end: start + match[0].length })
  }
  return out
}

/**
 * Литерал — метка-ДАННЫЕ, а не подпись: значение `label:`/`title:` в пресетах.
 *
 * Так устроены списки оформления (акценты, обои, размер текста), категории
 * эмодзи, статусы жалоб: русский текст там — КЛЮЧ, а переводятся они в месте
 * показа (`t(preset.label)`), потому что список строится один раз при импорте и
 * перевод в нём застыл бы на языке, который был в тот момент.
 *
 * Условие «есть в каталоге» обязательно: иначе под эту же маску попадёт
 * случайная сырая подпись с тем же текстом.
 */
function isDataKey(source, literal) {
  if (!known.has(literal.value)) return false
  const lineStart = source.lastIndexOf('\n', literal.start - 1) + 1
  return /(?:label|title|text|hint|subtitle|note|desc)\s*:\s*$/.test(
    source.slice(lineStart, literal.start)
  )
}

/**
 * Текст файла без комментариев и без блока `<style>`.
 *
 * Нужен и для поиска вызовов `t()`, и для ОЦЕНКИ прогресса: русский текст в
 * комментариях — не интерфейс (в `StoriesStrip.vue` его было 72 «строки» при
 * трёх реальных подписях), а правила CSS подписей не содержат вовсе.
 *
 * Комментарии убираем ПО СТРОКАМ (начало строки — `//`, `/*` или `*`):
 * посимвольный разбор приходилось бы учить отличать комментарий от регулярки
 * (`/[А-Яа-я]/`), и ошибка в этом месте «съедала» код вместе с вызовами `t()`.
 * Русский текст в конце строки после кода — редкий случай, и кавычек он обычно
 * не содержит, а считаем мы именно строковые литералы.
 */
function withoutCommentsAndStyles(source) {
  const cleaned = source
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<style[\s\S]*?<\/style>/g, blank)
  return cleaned
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        return ''
      }
      return line
    })
    .join('\n')
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
  // Комментарии и стили — не интерфейс: и для поиска ключей, и для оценки.
  const ui = withoutCommentsAndStyles(source)

  for (const match of ui.matchAll(CALL_RE)) {
    const key = normalizeKey(match[2])
    if (!key) continue
    if (!used.has(key)) used.set(key, relative)
    else if (used.get(key) === relative) continue
  }

  // Тексты, которые в `t()` приходят ПЕРЕМЕННОЙ (`t(filter.title)`), вызовом не
  // видны — считаем их «живыми» по самому литералу в коде.
  for (const match of ui.matchAll(LITERAL_RE)) {
    literals.add(normalizeKey(match[1] ?? match[2] ?? match[3] ?? ''))
  }

  // Оценка прогресса: русские литералы, которые НЕ являются аргументом `t()`
  // или формой `plural()`. Разбор по литералам, а не по строкам: многострочный
  // вызов prettier'а — это одна переведённая подпись, а не три непереведённых.
  const translated = translatedRanges(ui)
  const keepRussian = new Set(KEEP_RUSSIAN.get(relative) ?? [])
  const pendingLines = []
  for (const literal of literalsWithPositions(ui)) {
    if (!/[А-Яа-яЁё]/.test(literal.value)) continue
    if (keepRussian.has(literal.value)) continue
    // Файлы-словари: литерал — ключ, который переводится в месте показа.
    if (DATA_ONLY_FILES.has(relative) && known.has(literal.value)) continue
    if (isDataKey(ui, literal)) continue
    // Пересечение, а не «целиком внутри»: в разметке атрибут — это тоже строка
    // (`:title="t('Открыть')"`), и она «съедает» вложенный вызов вместе с его
    // кавычками. Такой литерал переведён — его и пропускаем.
    if (translated.some(([from, to]) => literal.start < to && literal.end > from)) continue
    const line = ui.slice(0, literal.start).split('\n').length
    pendingLines.push(`${line}: ${literal.value.slice(0, 80)}`)
  }
  if (pendingLines.length > 0) {
    pending.push({ relative, untranslated: pendingLines.length, lines: pendingLines })
  }
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
  `\nОсталось перевести (строковые литералы с русским текстом вне t()): ${totalPending} в ${pending.length} файлах.`
)
for (const item of pending.slice(0, 15)) {
  console.log(`  ${item.untranslated}\t${item.relative}`)
  for (const line of item.lines.slice(0, 3)) console.log(`      ${line}`)
}
if (process.argv.includes('--list')) {
  for (const item of pending) {
    console.log(`\n=== ${item.relative} (${item.untranslated}) ===`)
    for (const line of item.lines) console.log(`  ${line}`)
  }
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
