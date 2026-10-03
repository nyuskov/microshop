/**
 * Страж «в зависимостях фронтенда появилась известная уязвимость».
 *
 * Гоняет `pnpm audit` и сравнивает находки с базовым файлом: в проекте уже есть
 * предупреждения (почти все — инструменты разработки: eslint/prettier/vitest и
 * их транзитивные зависимости), закрыть их можно только мажорными обновлениями.
 * Проверка падает только на НОВЫХ — как остальные стражи (см. docs/checks.md).
 *
 * Запуск (из каталога frontend, нужен доступ в сеть):
 *   node scripts/check-audit.mjs
 *   node scripts/check-audit.mjs --update-baseline
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BASELINE_PATH = fileURLToPath(new URL('./audit-baseline.json', import.meta.url))
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const updateBaseline = process.argv.includes('--update-baseline')

function runAudit() {
  try {
    // cwd — каталог frontend: проверку зовут и из корня репозитория (CI).
    return execFileSync('pnpm', ['audit', '--json'], { cwd: ROOT, encoding: 'utf8' })
  } catch (error) {
    // pnpm возвращает ненулевой код, когда находки есть: это не ошибка запуска.
    if (error.stdout) return error.stdout
    console.error('Не удалось запустить `pnpm audit`:', error.message)
    process.exit(2)
  }
}

const raw = runAudit()
let advisories = {}
try {
  advisories = JSON.parse(raw).advisories ?? {}
} catch {
  console.error('Не удалось разобрать вывод `pnpm audit --json`')
  process.exit(2)
}

/** Ключ «пакет|номер предупреждения» → критичность (для базы). */
const found = {}
for (const advisory of Object.values(advisories)) {
  const key = `${advisory.module_name}|${advisory.id}`
  found[key] = advisory.severity
}
const sorted = Object.fromEntries(Object.entries(found).sort(([a], [b]) => a.localeCompare(b)))

if (updateBaseline) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`)
  console.log(`База обновлена: ${BASELINE_PATH} (${Object.keys(sorted).length} находок)`)
  process.exit(0)
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
const regressions = Object.entries(sorted).filter(([key]) => !(key in baseline))

if (regressions.length === 0) {
  console.log(`Новых уязвимостей в зависимостях нет (${Object.keys(sorted).length} известных).`)
  process.exit(0)
}

console.error('В зависимостях появились известные уязвимости:')
for (const [key, severity] of regressions) {
  const [module, id] = key.split('|')
  console.error(`  ${module} — ${id} (${severity})`)
}
console.error(
  '\nОбновите пакет или зафиксируйте риск осознанно:\n' +
    '  node scripts/check-audit.mjs --update-baseline'
)
process.exit(1)
