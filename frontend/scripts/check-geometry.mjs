#!/usr/bin/env node
/**
 * Запрет «сырой» геометрии в `<style>` блоках компонентов.
 *
 * Зачем: скругления интерфейса — это шкала из шести ступеней
 * (`--ms-radius-xs…pill`, см. `src/assets/appearance.css` и
 * `docs/design-system.md`). Когда каждый компонент пишет свой `border-radius`
 * на глаз (`5, 6, 7, 9, 11, 14, 16, 18, 22, 28px`), соседние окна и карточки
 * отличаются на 1–2 px: интерфейс перестаёт выглядеть как один набор.
 * Тень — та же история: у неё есть четыре готовых ступени
 * (`--ms-shadow-sm/md/pop/float`), и литеральная `box-shadow` почти всегда
 * означает «скопировали у соседа».
 *
 * Что считается ошибкой:
 *   - `border-radius` одним значением в `px` больше 4px (мелкие 2–4px —
 *     индикаторы, полоски — оставлены в покое);
 *   - `box-shadow` с литеральным цветом (`#…`, `rgb()`, `rgba()`).
 *
 * Что ошибкой НЕ считается (и почему):
 *   - значение с `%` (`50%` — круг), составное из нескольких частей
 *     (`16px 6px 16px 16px` — «хвост» пузыря, форма, а не ступень шкалы),
 *     `999px` (таблетка), `calc()`/`var(--ms-*)`, значения ≤ 4px;
 *   - `box-shadow: none` и тени, целиком собранные из токенов.
 *
 * Постепенная миграция: текущее число литералов зафиксировано в
 * `scripts/style-geometry-baseline.json`. Сборка падает только если число
 * выросло. Обновить базу: `node scripts/check-geometry.mjs --update-baseline`.
 *
 * Запуск: node scripts/check-geometry.mjs  (из каталога frontend/)
 * Код возврата 1, если появились новые литералы сверх базы.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'src')
const BASELINE_PATH = path.join(ROOT, 'scripts', 'style-geometry-baseline.json')

/** Скругление: `border-radius` и его угловые варианты. */
const RADIUS_PROPERTY =
  /(?:^|[\s;{])(?:border-radius|border-(?:top|bottom)-(?:left|right)-radius|border-(?:top|bottom|left|right)-radius)\s*:\s*([^;}]+)/gi

const SHADOW_PROPERTY = /(?:^|[\s;{])box-shadow\s*:\s*([^;}]+)/gi

const HEX = /#[0-9a-fA-F]{3,8}\b/
const RGB = /\brgba?\(/i

/** Комментарии не считаем: в них бывают примеры вида `border-radius: 14px`. */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ')

/** Значения, которые шкалой не описываются и потому допустимы. */
const EXEMPT = new Set(['none', 'inherit', 'initial', 'unset', 'revert', 'auto', '0'])

/**
 * `border-radius: 3px` (полоска), `50%` (круг), `999px` (таблетка),
 * `16px 6px 16px 16px` (форма пузыря), `calc(...)`, `var(--ms-radius-sm)` —
 * всё это либо не ступень шкалы, либо уже токен.
 */
function radiusIsFine(rawValue) {
  const value = rawValue.trim().toLowerCase()
  if (!value || EXEMPT.has(value)) return true
  if (value.includes('var(--ms-')) return true
  if (value.includes('%') || value.includes('calc(') || value.includes('(')) return true
  // Составное значение — форма (например, срез угла у пузыря), а не ступень.
  if (value.split(/\s+/).length > 1) return true

  const px = /^(\d+(?:\.\d+)?)px$/.exec(value)
  if (!px) return true
  const size = Number(px[1])
  // Таблетка задаётся большим числом; всё, что больше 999, тоже «таблетка».
  if (size <= 4 || size >= 999) return true
  return false
}

/** Тень: литеральный цвет — это ошибка; `none` и токены — нет. */
function shadowIsFine(rawValue) {
  const value = rawValue.trim().toLowerCase()
  if (!value || EXEMPT.has(value)) return true
  if (value.includes('var(--ms-')) return true
  return !HEX.test(value) && !RGB.test(value)
}

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
  const found = []

  blockText.split('\n').forEach((rawLine, index) => {
    const line = stripComments(rawLine)
    if (!line.includes('radius') && !line.includes('box-shadow')) return

    RADIUS_PROPERTY.lastIndex = 0
    let declaration
    while ((declaration = RADIUS_PROPERTY.exec(line)) !== null) {
      if (!radiusIsFine(declaration[1])) {
        found.push({ lineNo: startLine + index, text: rawLine.trim() })
      }
    }

    SHADOW_PROPERTY.lastIndex = 0
    while ((declaration = SHADOW_PROPERTY.exec(line)) !== null) {
      if (!shadowIsFine(declaration[1])) {
        found.push({ lineNo: startLine + index, text: rawLine.trim() })
      }
    }
  })

  return found
}

async function main() {
  const updateBaseline = process.argv.includes('--update-baseline')
  const files = (await collectVueFiles(SRC)).sort()
  const counts = new Map()
  const report = []

  for (const file of files) {
    const rel = path.relative(SRC, file).split(path.sep).join('/')
    const source = await readFile(file, 'utf8')

    const found = []
    for (const block of extractStyles(source)) {
      found.push(...inspectBlock(block.text, block.startLine))
    }

    if (found.length) {
      counts.set(rel, found.length)
      report.push({ rel, found })
    }
  }

  if (updateBaseline) {
    const baseline = Object.fromEntries(
      [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
    )
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0)
    await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8')
    console.log(
      `Базовая линия обновлена: scripts/style-geometry-baseline.json ` +
        `(${counts.size} файлов, ${total} литералов).`
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
  for (const { rel, found } of report) {
    const allowed = baseline[rel] ?? 0
    if (found.length > allowed) regressions.push({ rel, found, allowed })
    else if (found.length < allowed) improvements.push({ rel, current: found.length, allowed })
  }

  for (const { rel, found, allowed } of regressions) {
    console.log(`\n${rel} — было ${allowed}, стало ${found.length}`)
    for (const item of found) console.log(`  строка ${item.lineNo}: ${item.text}`)
  }

  if (improvements.length) {
    console.log('\nСтало чище (обновите базу: --update-baseline):')
    for (const { rel, current, allowed } of improvements) {
      console.log(`  ${rel}: ${allowed} → ${current}`)
    }
  }

  const currentTotal = [...counts.values()].reduce((sum, value) => sum + value, 0)
  const baselineTotal = Object.values(baseline).reduce((sum, value) => sum + value, 0)

  if (regressions.length) {
    const added = regressions.reduce((sum, item) => sum + (item.found.length - item.allowed), 0)
    console.error(
      `\nНовых литералов геометрии: ${added}. Возьмите ступень из шкалы ` +
        '(--ms-radius-xs/sm/md/lg/xl/pill) или тень (--ms-shadow-sm/md/pop/float) — ' +
        'см. docs/design-system.md.'
    )
    process.exitCode = 1
    return
  }

  console.log(
    `\nНовой сырой геометрии нет: ${currentTotal} литералов в ${counts.size} файлах ` +
      `(база ${baselineTotal}, проверено файлов: ${files.length}).`
  )
}

await main()
