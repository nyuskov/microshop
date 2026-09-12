#!/usr/bin/env node
/**
 * Бюджет размера бандла (gzip).
 *
 * Зачем: остальные проверки стилей ловят регрессии внешнего вида, а вес
 * приложения не проверял никто — новый импорт «на всякий случай» тихо
 * добавляет килобайты, которые замечают только на мобильной сети. Здесь
 * зафиксированы текущие размеры чанков: сборка падает, только если чанк вырос
 * сверх допуска, а не от любого изменения.
 *
 * Как считаем: свой gzip (zlib, уровень 9) для каждого файла в `dist/assets`.
 * Уровень фиксирован, поэтому числа сравнимы между собой и с базой; nginx
 * сжимает на своём уровне (`gzip_comp_level`), поэтому абсолютные значения
 * могут отличаться — важно поведение «выросло/не выросло».
 *
 * Ключ чанка — имя без хеша (`assets/index.js` вместо `assets/index-CkR2s1b9.js`),
 * иначе база ломалась бы на каждой сборке из-за нового хеша.
 *
 * Когда падает:
 *   - известный чанк вырос больше чем на `TOLERANCE` (3%) и больше чем на
 *     `TOLERANCE_BYTES` (2 КБ) — мелкий шум от пересборки не считается;
 *   - суммарный JS или CSS вырос сверх того же допуска (это ловит и новые
 *     чанки, которых в базе ещё нет).
 *
 * Новая проверка должна пройти на текущем состоянии, поэтому базу обновляют
 * осознанно: `node scripts/check-bundle-size.mjs --update-baseline`.
 *
 * Запуск: node scripts/check-bundle-size.mjs  (из каталога frontend/)
 *         node scripts/check-bundle-size.mjs --dist /tmp/out
 * Код возврата 1, если бюджет превышен.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { gzipSync } from 'node:zlib'

const ROOT = path.resolve(import.meta.dirname, '..')
const BASELINE_PATH = path.join(ROOT, 'scripts', 'bundle-size-baseline.json')

/** Имя с хешем Vite: `index-CkR2s1b9.js` — хеш 8 символов base64url. */
const HASHED = /^(.*)-[A-Za-z0-9_-]{8}\.(js|css)$/

const TOLERANCE = 1.03
const TOLERANCE_BYTES = 2048

function parseArgs(argv) {
  const args = { dist: path.join(ROOT, 'dist'), update: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--update-baseline') args.update = true
    else if (arg === '--dist') {
      const value = argv[i + 1]
      if (!value) throw new Error('--dist требует путь к каталогу сборки')
      args.dist = path.resolve(value)
      i += 1
    }
  }
  return args
}

/** `assets/index-CkR2s1b9.js` → `assets/index.js`. */
function stableKey(name) {
  const match = HASHED.exec(name)
  return match ? `${match[1]}.${match[2]}` : name
}

function gzipSize(buffer) {
  return gzipSync(buffer, { level: 9 }).length
}

/** Все `.js`/`.css` из `dist/assets` → `{ ключ: байт gzip }`. */
async function measure(dist) {
  const assetsDir = path.join(dist, 'assets')
  let names
  try {
    names = await readdir(assetsDir)
  } catch {
    throw new Error(`не найден каталог ${assetsDir} — сначала соберите фронтенд (vite build)`)
  }
  const chunks = new Map()
  for (const name of names.sort()) {
    if (!/\.(js|css)$/.test(name)) continue
    const bytes = gzipSize(await readFile(path.join(assetsDir, name)))
    const key = `assets/${stableKey(name)}`
    // Одно и то же имя чанка может встретиться дважды (js + css) — суммируем.
    chunks.set(key, (chunks.get(key) ?? 0) + bytes)
  }
  const total = { js: 0, css: 0 }
  for (const [key, bytes] of chunks) {
    if (key.endsWith('.js')) total.js += bytes
    else total.css += bytes
  }
  return { chunks, total }
}

function formatSize(bytes) {
  return `${bytes} Б (${(bytes / 1024).toFixed(1)} КБ)`
}

function grew(before, after) {
  return after > before * TOLERANCE && after - before > TOLERANCE_BYTES
}

async function readBaseline() {
  try {
    return JSON.parse(await readFile(BASELINE_PATH, 'utf8'))
  } catch {
    return null
  }
}

const args = parseArgs(process.argv.slice(2))
const { chunks, total } = await measure(args.dist)

if (args.update) {
  const payload = {
    note: 'Размеры чанков в байтах gzip (zlib уровень 9) после vite build. Обновлять через --update-baseline.',
    generated: new Date().toISOString().slice(0, 10),
    total,
    chunks: Object.fromEntries([...chunks].sort(([a], [b]) => a.localeCompare(b)))
  }
  await writeFile(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`База обновлена: ${path.relative(ROOT, BASELINE_PATH)}`)
  for (const [key, bytes] of chunks) console.log(`  ${key.padEnd(28)} ${formatSize(bytes)}`)
  console.log(`  ${'итого JS'.padEnd(28)} ${formatSize(total.js)}`)
  console.log(`  ${'итого CSS'.padEnd(28)} ${formatSize(total.css)}`)
  process.exit(0)
}

const baseline = await readBaseline()
if (!baseline) {
  console.error(`Нет базы ${path.relative(ROOT, BASELINE_PATH)} — создайте: --update-baseline`)
  process.exit(1)
}

const errors = []
for (const [key, bytes] of [...chunks].sort(([a], [b]) => a.localeCompare(b))) {
  const before = baseline.chunks?.[key]
  if (before === undefined) {
    console.log(`новый   ${key.padEnd(28)} ${formatSize(bytes)}`)
    continue
  }
  const delta = bytes - before
  const sign = delta >= 0 ? '+' : '−'
  const line = `${key.padEnd(28)} ${formatSize(bytes)} (${sign}${Math.abs(delta)} Б)`
  if (grew(before, bytes)) {
    errors.push(line)
    console.log(`РОСТ    ${line}`)
  } else {
    console.log(`ок      ${line}`)
  }
}

for (const kind of ['js', 'css']) {
  const before = baseline.total?.[kind] ?? 0
  if (grew(before, total[kind])) {
    errors.push(`итого ${kind.toUpperCase()}: ${formatSize(before)} → ${formatSize(total[kind])}`)
  }
}

if (errors.length) {
  console.error('\nБюджет размера бандла превышен:')
  for (const line of errors) console.error(`  ${line}`)
  console.error(
    `\nДопуск: +${Math.round((TOLERANCE - 1) * 100)}% и не больше ${TOLERANCE_BYTES} Б на чанк.` +
      '\nЕсли рост осознанный (новая функциональность) — обновите базу:' +
      '\n  node scripts/check-bundle-size.mjs --update-baseline'
  )
  process.exit(1)
}

console.log('\nБюджет размера бандла в норме.')
