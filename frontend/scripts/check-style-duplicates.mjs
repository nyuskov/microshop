/**
 * Разбор дублирующего слоя `html .messenger-shell …` в `appearance.css`.
 *
 * Зачем: этот слой появился, когда scoped-стили компонентов были на хардкоде
 * светлых цветов — слой переопределял их токенами. Селекторы с префиксом
 * `html .messenger-shell` по специфичности ВЫШЕ scoped, поэтому:
 *   - если значения совпадают со стилем компонента — правило просто балласт;
 *   - если отличаются — правило МОЛЧА перебивает компонент (именно так
 *     «не работала» полупрозрачная плашка даты: слой возвращал непрозрачный фон).
 *
 * Скрипт сравнивает слой со стилями компонентов (и с обычными правилами
 * `appearance.css`) и делит правила на три группы:
 *   DUPLICATE — все свойства совпадают со значениями из компонента → можно удалять;
 *   CONFLICT  — свойство задано в двух местах по-разному → правит человек
 *               (это и есть источник тихих переопределений, база — в
 *               `scripts/style-duplicates-baseline.json`);
 *   UNIQUE    — свойство есть только в слое → удалять нельзя.
 *
 * Запуск (из каталога frontend):
 *   node scripts/check-style-duplicates.mjs            # сводка + проверка базы
 *   node scripts/check-style-duplicates.mjs --list      # списки правил целиком
 *   node scripts/check-style-duplicates.mjs --prune     # удалить DUPLICATE из appearance.css
 *   node scripts/check-style-duplicates.mjs --update-baseline
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const APPEARANCE = path.join(SRC, 'assets', 'appearance.css')
const BASELINE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'style-duplicates-baseline.json'
)
const LAYER_PREFIX = 'html .messenger-shell'

const args = new Set(process.argv.slice(2))

/** Нормализует селектор: убирает префикс слоя, scoped-атрибут и `:deep()`. */
function normalizeSelector(selector) {
  return selector
    .replace(/:deep\(|:global\(/g, '')
    .replace(/\[data-v-[a-z0-9]+\]/gi, '')
    .replace(/\)/g, '')
    .replace(/\bhtml\b/g, '')
    .replace(/\.messenger-shell\b/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~,])\s*/g, '$1')
    .trim()
}

/**
 * Варианты ключа для поиска: сам ключ и «хвосты» селектора.
 * Слой часто добавляет предка только ради специфичности
 * (`html .messenger-shell .msg .msg-bubble` против `.msg-bubble` в компоненте) —
 * такое правило перекрывает ТЕ ЖЕ элементы, что и правило компонента.
 */
function candidateKeys(key) {
  const divider = key.indexOf('||')
  const at = key.slice(0, divider + 2)
  const selector = key.slice(divider + 2)
  const parts = selector.split(' ')
  const out = [key]
  for (let i = 1; i < parts.length; i += 1) out.push(at + parts.slice(i).join(' '))
  return out
}

/** Похоже ли значение на цвет (значит, в шорткате это `*-color`). */
const looksLikeColor = (value) =>
  /^(#|var\(|rgb|hsl|color-mix|transparent\b|currentcolor\b|white\b|black\b)/.test(value)

/**
 * Разворачивает шорткаты в длинные свойства, чтобы сравнение не зависело от
 * формы записи: `border-bottom: 1px solid var(--ms-border)` в компоненте и
 * `border-bottom-color: var(--ms-border)` в слое — одно и то же.
 */
function expandDeclarations(decls) {
  const out = new Map()
  for (const [prop, value] of decls) {
    const border = /^border(-(top|right|bottom|left))?$/.exec(prop)
    if (border !== null) {
      const part = border[2] === undefined ? '' : `-${border[2]}`
      const bits = value.split(/\s+/)
      const color = bits.find(looksLikeColor)
      const style = bits.find((b) =>
        ['none', 'solid', 'dashed', 'dotted', 'double', 'hidden', 'initial', 'inherit'].includes(b)
      )
      const width = bits.find((b) => /^[\d.]+[a-z%]*$/.test(b))
      if (width !== undefined) out.set(`border${part}-width`, width)
      if (style !== undefined) out.set(`border${part}-style`, style)
      if (color !== undefined) out.set(`border${part}-color`, color)
      continue
    }
    if (prop === 'background') {
      // Одно значение: либо цвет, либо градиент.
      if (value.includes('gradient')) out.set('background-image', value)
      else if (looksLikeColor(value)) out.set('background-color', value)
      continue
    }
    out.set(prop, value)
  }
  return out
}

/** Разбор CSS на правила построчно: форматирование в проекте однородное. */
function parseRules(text, file, { layer = false } = {}) {
  const rules = []
  const lines = text.split('\n')
  let context = []
  let current = null
  let inComment = false

  const push = () => {
    if (current === null) return
    const selector = current.selector.replace(/\s+/g, ' ').trim()
    const isKeyframeStop = /^(from|to|[\d.]+%)$/.test(selector)
    if (!isKeyframeStop && current.decls.size > 0) {
      const at = context.join(' and ')
      rules.push({
        file,
        selector,
        key: `${at}||${normalizeSelector(selector)}`,
        at,
        decls: current.decls,
        start: current.start,
        end: current.end,
        layer
      })
    }
    current = null
  }

  lines.forEach((raw, index) => {
    const lineNo = index + 1
    const line = raw.trim()
    if (inComment) {
      if (line.includes('*/')) inComment = false
      return
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inComment = true
      return
    }
    if (line === '') return

    if (line.endsWith('{')) {
      const head = line.slice(0, -1).trim()
      if (head.startsWith('@')) {
        // @media/@supports — контекст; @keyframes/@font-face — пропускаем тело.
        context.push(head)
        return
      }
      if (context.some((c) => c.startsWith('@keyframes') || c.startsWith('@font-face'))) return
      current = { selector: head, decls: new Map(), start: lineNo, end: lineNo }
      return
    }

    if (line === '}') {
      if (current !== null) {
        current.end = lineNo
        push()
      } else if (context.length > 0) {
        context.pop()
      }
      return
    }

    if (current !== null) {
      const colon = line.indexOf(':')
      if (colon === -1) return
      const prop = line.slice(0, colon).trim().toLowerCase()
      const value = line
        .slice(colon + 1)
        .replace(/;?\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (prop !== '' && value !== '') current.decls.set(prop, value)
      return
    }
  })
  if (current !== null) push()

  return rules
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

/** Все правила проекта: слой, остальной appearance.css и `<style>` компонентов. */
async function collectAllRules() {
  const appearanceText = await readFile(APPEARANCE, 'utf8')
  const appearanceRules = parseRules(appearanceText, 'src/assets/appearance.css').map((rule) => ({
    ...rule,
    layer: rule.selector.includes(LAYER_PREFIX)
  }))

  const componentRules = []
  for (const file of await collectVueFiles(SRC)) {
    const source = await readFile(file, 'utf8')
    const rel = path.relative(path.dirname(SRC), file)
    for (const match of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
      const startLine = source.slice(0, match.index ?? 0).split('\n').length
      for (const rule of parseRules(match[1], rel)) {
        componentRules.push({ ...rule, start: rule.start + startLine, end: rule.end + startLine })
      }
    }
  }
  return { appearanceRules, componentRules, appearanceText }
}

function analyze() {
  return collectAllRules().then(({ appearanceRules, componentRules, appearanceText }) => {
    const layerRules = appearanceRules.filter((rule) => rule.layer)
    const others = [...appearanceRules.filter((rule) => !rule.layer), ...componentRules]

    // всё, что задано вне слоя: ключ → свойство → множество значений (с источником)
    const outside = new Map()
    for (const rule of others) {
      const byProp = outside.get(rule.key) ?? new Map()
      for (const [prop, value] of expandDeclarations(rule.decls)) {
        const values = byProp.get(prop) ?? new Map()
        if (!values.has(value)) values.set(value, `${rule.file}:${rule.start}`)
        byProp.set(prop, values)
      }
      outside.set(rule.key, byProp)
    }

    const duplicate = []
    const conflict = []
    const unique = []

    for (const rule of layerRules) {
      const byProp = new Map()
      for (const key of candidateKeys(rule.key)) {
        for (const [prop, values] of outside.get(key) ?? []) {
          const merged = byProp.get(prop) ?? new Map()
          for (const [value, where] of values) if (!merged.has(value)) merged.set(value, where)
          byProp.set(prop, merged)
        }
      }
      const conflicts = []
      const missing = []
      for (const [prop, value] of expandDeclarations(rule.decls)) {
        const values = byProp?.get(prop)
        if (values === undefined) {
          missing.push(prop)
          continue
        }
        if (!values.has(value)) {
          const [other, where] = [...values.entries()][0]
          conflicts.push({ prop, layerValue: value, otherValue: other, where })
        }
      }
      if (conflicts.length > 0) conflict.push({ rule, conflicts })
      else if (missing.length === 0) duplicate.push(rule)
      else unique.push({ rule, missing })
    }

    return { layerRules, duplicate, conflict, unique, appearanceText }
  })
}

function conflictKeys(conflict) {
  return conflict
    .map(({ rule, conflicts }) =>
      conflicts.map((c) => `${rule.selector}|${c.prop}|${c.layerValue}|${c.otherValue}`)
    )
    .flat()
    .sort()
}

const { layerRules, duplicate, conflict, unique, appearanceText } = await analyze()

console.log(`Правил в слое "${LAYER_PREFIX}": ${layerRules.length}`)
console.log(`  DUPLICATE (совпадает с компонентом, можно удалять): ${duplicate.length}`)
console.log(`  CONFLICT  (разные значения — молча перебивает компонент): ${conflict.length}`)
console.log(`  UNIQUE    (свойств больше нигде нет): ${unique.length}`)

if (args.has('--list')) {
  if (duplicate.length > 0) {
    console.log('\n--- DUPLICATE ---')
    for (const rule of duplicate) console.log(`  ${rule.file}:${rule.start}  ${rule.selector}`)
  }
  if (conflict.length > 0) {
    console.log('\n--- CONFLICT ---')
    for (const { rule, conflicts } of conflict) {
      console.log(`  ${rule.file}:${rule.start}  ${rule.selector}`)
      for (const c of conflicts) {
        console.log(`      ${c.prop}: слой=${c.layerValue}  ${c.where}=${c.otherValue}`)
      }
    }
  }
  if (unique.length > 0) {
    console.log('\n--- UNIQUE ---')
    for (const { rule, missing } of unique) {
      console.log(
        `  ${rule.file}:${rule.start}  ${rule.selector}  (только тут: ${missing.join(', ')})`
      )
    }
  }
}

// --- удаление правил-дублей -------------------------------------------------
if (args.has('--prune')) {
  const lines = appearanceText.split('\n')
  const drop = new Set()
  for (const rule of duplicate) {
    // правило + пустая строка перед ним/после него
    for (let n = rule.start; n <= rule.end; n += 1) drop.add(n)
    if (lines[rule.end]?.trim() === '') drop.add(rule.end + 1)
  }
  const kept = lines.filter((_, index) => !drop.has(index + 1))
  await writeFile(APPEARANCE, kept.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf8')
  console.log(`\nУдалено строк: ${drop.size} (правил: ${duplicate.length})`)
}

// --- база конфликтов: новые не должны появляться ----------------------------
const current = conflictKeys(conflict)
if (args.has('--update-baseline')) {
  await writeFile(BASELINE, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
  console.log(`\nБаза обновлена: ${BASELINE} (${current.length})`)
} else if (existsSync(BASELINE)) {
  const baseline = new Set(JSON.parse(readFileSync(BASELINE, 'utf8')))
  const added = current.filter((key) => !baseline.has(key))
  if (added.length > 0) {
    console.error('\nНовые конфликты слоя со стилями компонентов:')
    for (const key of added) console.error(`  ${key}`)
    console.error(
      '\nОдин и тот же селектор задаёт одно свойство по-разному в слое и в компоненте —\n' +
        'слой победит (специфичность выше). Уберите правило из слоя или синхронизируйте\n' +
        'значение. Если так и задумано: node scripts/check-style-duplicates.mjs --update-baseline'
    )
    process.exit(1)
  }
  console.log(`\nНовых конфликтов нет (база: ${baseline.size}).`)
} else {
  console.log(`\nБаза конфликтов ещё не создана: --update-baseline (текущих: ${current.length}).`)
}
