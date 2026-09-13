/**
 * Поиск мёртвого CSS в компонентах: классы из `<style scoped>`, которых нет
 * больше нигде — ни в разметке, ни в скриптах.
 *
 * Зачем: стили живут в одном файле с шаблоном, поэтому «осиротевшие» правила
 * после переделки разметки никто не замечает — ни линтер, ни сборка, лишние
 * байты просто уезжают в бандл. Этим скриптом найдены и удалены, например,
 * `.otp-box` (ввод кода стал одним полем `.otp-input`), `.jump-new` (точку
 * «новые сообщения» заменил счётчик `.jump-count`) и `.search-hint` (подсказку
 * убрали — вместо неё остаётся список чатов).
 *
 * Это ИНСТРУМЕНТ, а не проверка CI: ложные срабатывания неизбежны. Класс может
 * собираться из строки — `error-screen--${tone}`, `'role-' + member.role`,
 * `s-${report.status}`, `'msg-' + severity` — такое имя в отчёте надо смотреть
 * глазами. Утилиты Quasar (`col-*`, `text-*`) и переходные классы Vue
 * (`*-enter-*`, `*-leave-*`) пропускаются: они приходят не из разметки.
 *
 * Счёт идёт по вхождениям подстроки, то есть проверка КОНСЕРВАТИВНАЯ: если имя
 * входит в состав другого класса, правило в отчёт не попадёт. Пропустить мёртвое
 * правило безопаснее, чем предложить удалить живое. Комментарии внутри `<style>`
 * игнорируются — иначе в отчёт лезут имена из текста вроде `window.innerHeight`.
 *
 * Запуск (из каталога frontend):
 *   node scripts/check-dead-css.mjs                  # кандидаты по src
 *   node scripts/check-dead-css.mjs src/views         # только по каталогу
 *   node scripts/check-dead-css.mjs src/App.vue       # или по одному файлу
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/** Где ищем классы (можно указать каталог или файл). */
const TARGET = process.argv[2] ?? 'src'
/** Где ищем использование: всегда по всему src — класс мог «переехать». */
const USAGE_ROOT = 'src'

/** Классы не из нашей разметки: утилиты Quasar, иконки, переходы Vue. */
const NOT_OURS =
  /(-enter-|-leave-|^q-|^icon-|^text-|^bg-|^col-|^row-|^items-|^justify-|^gt-|^lt-|^xs$|^sm$|^md$|^lg$|^xl$)/

/** Все исходники: по ним проверяем, встречается ли класс где-то ещё. */
const walk = (dir, filter) =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full, filter)
    return filter(entry) ? [full] : []
  })

const sources = walk(USAGE_ROOT, (name) => /\.(vue|ts|css|sass|html)$/.test(name))
const allText = sources.map((file) => readFileSync(file, 'utf8')).join('\n')

const components = statSync(TARGET).isDirectory()
  ? walk(TARGET, (name) => name.endsWith('.vue'))
  : [TARGET]
const found = []

for (const file of components) {
  const source = readFileSync(file, 'utf8')
  const styleStart = source.indexOf('<style')
  if (styleStart < 0) continue
  const style = source.slice(styleStart)
  // Имена ищем в СЕЛЕКТОРАХ (текст перед `{`), а вхождения — по сырому тексту:
  // в значениях свойств тоже бывают точки (`url(https://www.w3.org/…)`) — иначе
  // такие «классы» попадали бы в отчёт.
  const stylesheet = style.replace(/\/\*[\s\S]*?\*\//g, '')

  const names = new Set()
  for (const rule of stylesheet.matchAll(/([^{}]+)\{/g)) {
    for (const match of rule[1].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(match[1])
  }

  const dead = [...names].filter((name) => {
    if (NOT_OURS.test(name)) return false
    // Вхождения во всём репозитории минус вхождения внутри собственных стилей:
    // ноль означает, что класс нигде не применяется.
    const total = allText.split(name).length - 1
    const inStyles = style.split(name).length - 1
    return total - inStyles <= 0
  })

  if (dead.length) found.push({ file, dead })
}

if (!found.length) {
  console.log('Мёртвых классов не нашлось.')
} else {
  console.log('Кандидаты на удаление (проверить глазами — см. шапку файла):')
  for (const { file, dead } of found) {
    console.log(`  ${file}`)
    for (const name of dead) console.log(`    .${name}`)
  }
  console.log(`\nВсего: ${found.reduce((sum, item) => sum + item.dead.length, 0)}`)
}
