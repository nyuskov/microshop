#!/usr/bin/env node
/**
 * Запрет «сырых» цветов в `<style>` блоках компонентов.
 *
 * Зачем: цвета интерфейса обязаны идти через токены `--ms-*`
 * (`src/assets/appearance.css`). Если компонент хардкодит `#ffffff`, в тёмной
 * теме появляется светлое пятно, и лечится это вторым слоем оверрайдов в
 * `appearance.css` — то есть двумя источниками правды вместо одного.
 *
 * Что считается ошибкой:
 *   - литеральный цвет (`#fff`, `rgb()`) в цветовом свойстве внутри `<style>`
 *     компонента (кроме `var(--ms-x, #fallback)` — фолбэк допустим);
 *   - `var(--ms-что-то)`, которого нет в `appearance.css`: опечатка в имени
 *     токена молча уводит элемент на фолбэк (или на прозрачный цвет), поэтому
 *     это самая незаметная из подобных ошибок — ловим явно.
 *
 * Что считается предупреждением (не ломает сборку):
 *   - литеральный цвет внутри `color-mix()`/градиента — считается глазами.
 *
 * Исключения — файлы, которые по смыслу рисуются поверх фото/видео (там белый
 * текст не зависит от темы). Список ниже, у каждого — причина.
 *
 * Постепенная миграция: в `scripts/style-tokens-baseline.json` зафиксировано
 * текущее число литеральных цветов по файлам. Сборка падает только если число
 * выросло — новое светлое пятно не проскочит, а старое можно чинить по одному.
 * Обновление базы: `node scripts/check-tokens.mjs --update-baseline`.
 *
 * Запуск: node scripts/check-tokens.mjs  (из каталога frontend/)
 * Код возврата 1, если появились новые ошибки сверх базы.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'src')
const BASELINE_PATH = path.join(ROOT, 'scripts', 'style-tokens-baseline.json')
const TOKENS_PATH = path.join(SRC, 'assets', 'appearance.css')

/**
 * Токены, которых в `appearance.css` нет и не должно быть: их выставляет JS в
 * рантайме (`useVisualViewport` пишет высоту/смещение visualViewport,
 * `MessageComposer` — высоту открытой панели эмодзи/стикеров, чтобы лента
 * резервировала под неё место, `ChatSidebar` — смещение панели при протяжке вниз
 * и прогресс до следующего шага).
 */
const RUNTIME_TOKENS = new Set([
  '--ms-vv-h',
  '--ms-vv-top',
  '--ms-extras-h',
  '--ms-pull-y',
  '--ms-pull-progress'
])

/** Пути относительно src/. Литеральные цвета здесь оправданы. */
const ALLOWED = new Map([
  ['components/calls/CallOverlay.vue', 'белый текст и управление поверх видео'],
  ['components/media/ImageLightbox.vue', 'лайтбокс: белое управление поверх фото'],
  ['components/media/RoundVideoMessage.vue', 'кружок-видео: белое управление поверх кадра'],
  ['components/media/VideoRecorderModal.vue', 'запись видео: белое управление поверх кадра'],
  ['components/stories/StoryViewer.vue', 'просмотр истории: белое поверх кадра'],
  ['components/common/ErrorScreen.vue', 'иллюстрация ошибки (SVG fill)'],
  ['components/common/OfflineBanner.vue', 'белый текст на цветной плашке статуса']
])

const COLOR_PROPERTY =
  /(?:^|[\s;{])(?:color|background|background-color|border|border-color|border-(?:top|bottom|left|right)(?:-color)?|box-shadow|outline|outline-color|fill|stroke|caret-color|accent-color)\s*:\s*([^;}]+)/gi

const HEX = /#[0-9a-fA-F]{3,8}\b/
const RGB = /\brgba?\(/i

/** Убирает комментарии, чтобы `/* #fff *​/` не считался цветом. */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ')

/**
 * `var(--ms-accent, rgba(46, 162, 94, 0.35))` → `var(--token)`: фолбэк токена —
 * не хардкод. Скобки в фолбэке вложенные, поэтому обычный `[^()]*` не подходит.
 */
const stripVarFallbacks = (text) =>
  text.replace(/var\(\s*--[a-z0-9-]+\s*,[^()]*(?:\([^()]*\)[^()]*)*\)/gi, 'var(--token)')

/** Формулы вида color-mix(...) и linear-gradient(...) проверяются глазами. */
const stripFormulas = (text) =>
  text.replace(
    /(?:color-mix|linear-gradient|radial-gradient|conic-gradient)\([^()]*(?:\([^()]*\)[^()]*)*\)/gi,
    'FORMULA'
  )

async function collectVueFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      files.push(...(await collectVueFiles(full)))
    } else if (entry.name.endsWith('.vue')) {
      files.push(full)
    }
  }
  return files
}

/** Достаёт содержимое <style> блоков вместе с номером первой строки. */
function extractStyles(source) {
  const blocks = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi
  let match
  while ((match = re.exec(source)) !== null) {
    const linesBefore = source.slice(0, match.index).split('\n').length
    const offset = match[0].indexOf('>') + 1
    blocks.push({
      text: match[1],
      startLine: linesBefore + match[0].slice(0, offset).split('\n').length - 1
    })
  }
  return blocks
}

function inspectBlock(blockText, startLine) {
  const errors = []
  const warnings = []

  blockText.split('\n').forEach((rawLine, index) => {
    const lineNo = startLine + index
    const line = stripComments(rawLine)
    if (!line.includes('#') && !RGB.test(line)) return
    const withFormulasHidden = stripFormulas(line)
    let found = false

    COLOR_PROPERTY.lastIndex = 0
    let declaration
    while ((declaration = COLOR_PROPERTY.exec(withFormulasHidden)) !== null) {
      const value = stripVarFallbacks(declaration[1])
      if (HEX.test(value) || RGB.test(value)) {
        errors.push({ lineNo, text: rawLine.trim() })
        found = true
      }
    }

    if (found) return
    const leftover = stripVarFallbacks(withFormulasHidden).replace(/var\(--token\)/g, '')
    if (HEX.test(leftover) || RGB.test(leftover)) {
      warnings.push({ lineNo, text: rawLine.trim() })
    }
  })

  return { errors, warnings }
}

/** Имена токенов, определённых в `appearance.css`. */
function definedTokens(css) {
  const names = new Set()
  for (const match of css.matchAll(/(--ms-[a-z0-9-]+)\s*:/gi)) names.add(match[1].toLowerCase())
  return names
}

/** `var(--ms-x)` в файле, которых нет среди определённых токенов. */
function unknownTokens(source, startLine, defined) {
  const found = []
  const re = /var\(\s*(--ms-[a-z0-9-]+)/gi
  for (const block of extractStyles(source)) {
    for (const match of block.text.matchAll(re)) {
      const name = match[1].toLowerCase()
      if (defined.has(name) || RUNTIME_TOKENS.has(name)) continue
      const offset = block.text.slice(0, match.index).split('\n').length - 1
      // startLine — первая строка содержимого блока, поэтому +offset, без +1.
      found.push({ name, lineNo: block.startLine + offset })
    }
  }
  void startLine
  return found
}

async function main() {
  const updateBaseline = process.argv.includes('--update-baseline')
  const files = (await collectVueFiles(SRC)).sort()
  const counts = new Map()
  const report = []
  const undefinedUsages = []
  const defined = definedTokens(await readFile(TOKENS_PATH, 'utf8'))
  let warningCount = 0

  for (const file of files) {
    const rel = path.relative(SRC, file).split(path.sep).join('/')
    const source = await readFile(file, 'utf8')

    // Опечатку в имени токена проверяем и в файлах-исключениях: исключение
    // разрешает литеральные цвета поверх медиа, но не несуществующий токен.
    const unknown = unknownTokens(source, 0, defined)
    if (unknown.length) undefinedUsages.push({ rel, unknown })

    if (ALLOWED.has(rel)) continue

    const errors = []
    const warnings = []
    for (const block of extractStyles(source)) {
      const result = inspectBlock(block.text, block.startLine)
      errors.push(...result.errors)
      warnings.push(...result.warnings)
    }

    if (errors.length) counts.set(rel, errors.length)
    if (errors.length || warnings.length) {
      report.push({ rel, errors, warnings })
      warningCount += warnings.length
    }
  }

  if (updateBaseline) {
    const baseline = Object.fromEntries(
      [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
    )
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0)
    await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8')
    console.log(
      `Базовая линия обновлена: scripts/style-tokens-baseline.json ` +
        `(${counts.size} файлов, ${total} цветов).`
    )
    return
  }

  let baseline = {}
  try {
    baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8'))
  } catch {
    console.log('Базовая линия не найдена — создайте её: --update-baseline')
  }

  const regressions = []
  const improvements = []
  for (const { rel, errors } of report) {
    const allowed = baseline[rel] ?? 0
    if (errors.length > allowed) regressions.push({ rel, errors, allowed })
    else if (errors.length < allowed) improvements.push({ rel, current: errors.length, allowed })
  }

  for (const { rel, errors, allowed } of regressions) {
    console.log(`\n${rel} — было ${allowed}, стало ${errors.length}`)
    for (const item of errors) console.log(`  строка ${item.lineNo}: ${item.text}`)
  }

  if (warningCount > 0) {
    console.log('\nПредупреждения (литеральный цвет внутри формулы, не ломает проверку):')
    for (const { rel, warnings } of report) {
      for (const item of warnings) console.log(`  ${rel}:${item.lineNo} — ${item.text}`)
    }
  }

  if (improvements.length) {
    console.log('\nСтало чище (обновите базу: --update-baseline):')
    for (const { rel, current, allowed } of improvements) {
      console.log(`  ${rel}: ${allowed} → ${current}`)
    }
  }

  const currentTotal = [...counts.values()].reduce((sum, value) => sum + value, 0)
  const baselineTotal = Object.values(baseline).reduce((sum, value) => sum + value, 0)

  if (undefinedUsages.length) {
    console.error('\nНеизвестные токены (--ms-*, которых нет в appearance.css):')
    for (const { rel, unknown } of undefinedUsages) {
      for (const item of unknown) console.error(`  ${rel}:${item.lineNo} — ${item.name}`)
    }
    console.error('Проверьте имя токена — иначе всегда работает фолбэк.')
    process.exitCode = 1
    return
  }

  if (regressions.length) {
    const added = regressions.reduce((sum, item) => sum + (item.errors.length - item.allowed), 0)
    console.error(
      `\nНовых литеральных цветов: ${added}. Используйте токены (--ms-*); ` +
        'если цвет оправдан — добавьте файл в ALLOWED с пояснением.'
    )
    process.exitCode = 1
    return
  }

  console.log(
    `\nНового хардкода нет: ${currentTotal} цветов в ${counts.size} файлах ` +
      `(база ${baselineTotal}, проверено файлов: ${files.length}).`
  )
}

await main()
