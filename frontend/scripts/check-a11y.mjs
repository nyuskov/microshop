/**
 * Страж доступности: правила eslint-plugin-vuejs-accessibility на `src`.
 *
 * Плагин знает про доступность то, чего не видит ни один стилевой скрипт: связь
 * `label` с полем, клавиатурную активацию кликабельных элементов, подписи к
 * медиа. На существующем коде нарушений много, поэтому проверка сравнивает
 * результат с базовым файлом и падает только на НОВЫХ — как check-tokens.mjs и
 * соседи (см. docs/checks.md).
 *
 * Запуск (из каталога frontend):
 *   node scripts/check-a11y.mjs
 *   node scripts/check-a11y.mjs --update-baseline
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'

const PREFIX = 'vuejs-accessibility/'
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const BASELINE_PATH = fileURLToPath(new URL('./a11y-baseline.json', import.meta.url))
const updateBaseline = process.argv.includes('--update-baseline')

const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: 'eslint.a11y.config.js' })
const results = await eslint.lintFiles(['src'])

/** Разрез по файлу и правилу: номер строки не годится — он съезжает от любой правки. */
const found = {}
for (const result of results) {
  for (const message of result.messages) {
    if (!message.ruleId?.startsWith(PREFIX)) continue
    const key = `${result.filePath.replace(`${ROOT}/`, '')}|${message.ruleId}`
    found[key] = (found[key] ?? 0) + 1
  }
}
const total = Object.values(found).reduce((sum, n) => sum + n, 0)

if (updateBaseline) {
  const sorted = Object.fromEntries(Object.entries(found).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`)
  console.log(`База обновлена: ${BASELINE_PATH} (${total} нарушений, ${Object.keys(found).length} записей)`)
  process.exit(0)
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
const regressions = []
for (const [key, count] of Object.entries(found)) {
  const known = baseline[key] ?? 0
  if (count > known) regressions.push(`${key}: было ${known}, стало ${count}`)
}

if (regressions.length === 0) {
  console.log(`Новых нарушений доступности нет (всего ${total}, база ${Object.keys(baseline).length} записей).`)
  process.exit(0)
}

console.error('Новые нарушения доступности:')
for (const line of regressions) console.error(`  ${line}`)
console.error('\nПодробности: npx eslint -c eslint.a11y.config.js src')
console.error('Осознанное исключение фиксируется: node scripts/check-a11y.mjs --update-baseline')
process.exit(1)
