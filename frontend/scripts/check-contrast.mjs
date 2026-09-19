#!/usr/bin/env node
/**
 * Проверка контраста токенов оформления по WCAG 2.1.
 *
 * Зачем: цвета интерфейса живут только в токенах `--ms-*`
 * (`src/assets/appearance.css`), в двух темах. Подбирать оттенки «на глаз»
 * легко промахнуться — особенно для приглушённых подписей и времени сообщений.
 * Скрипт считает реальные отношения контраста и падает, если что-то ниже нормы:
 *
 *   - обычный текст — 4.5:1  (WCAG 2.1 AA, критерий 1.4.3);
 *   - иконки/рамки — 3:1    (WCAG 2.1 AA, критерий 1.4.11).
 *
 * Запуск: node scripts/check-contrast.mjs  (из каталога frontend/)
 *
 * Значения вида `color-mix()` / `rgba()` статически посчитать нельзя — такие
 * пары помечаются SKIP и проверяются глазами в обеих темах.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const CSS_PATH = path.resolve(import.meta.dirname, '..', 'src', 'assets', 'appearance.css')

/**
 * Пары «что на чём проверяем».
 *
 * `min` — порог: 4.5 для обычного текста (WCAG AA 1.4.3), 3 для нетекстовых
 * элементов вроде иконок (WCAG AA 1.4.11). `note` объясняет, где это видно.
 *
 * Чего здесь намеренно НЕТ:
 *   - `--ms-border` на поверхности: разделители декоративны, 1.4.11 к ним не
 *     применяется (границ интерактивных полей нет — поля заданы подложкой);
 *   - `--ms-on-accent` как обычный текст: акцент выбирает пользователь, и
 *     белый текст на светлых пресетах физически даёт ~3.3:1 — проверяем по
 *     норме для элементов (3:1);
 *   - подложки из `color-mix()` (активная строка, тёмные пузыри) — статически
 *     не считаются, смотрю глазами.
 */
const CHECKS = [
  { fg: '--ms-text', bg: '--ms-surface', min: 4.5, note: 'основной текст' },
  { fg: '--ms-text', bg: '--ms-surface-2', min: 4.5, note: 'текст на вторичной подложке' },
  { fg: '--ms-text-strong', bg: '--ms-surface', min: 4.5, note: 'заголовки' },
  { fg: '--ms-muted', bg: '--ms-surface', min: 4.5, note: 'подписи, превью чатов' },
  { fg: '--ms-muted', bg: '--ms-surface-2', min: 4.5, note: 'подписи на вторичной подложке' },
  { fg: '--ms-muted-2', bg: '--ms-surface', min: 4.5, note: 'служебный текст' },
  {
    fg: '--ms-muted-2',
    bg: '--ms-surface-2',
    min: 4.5,
    note: 'служебный текст в поиске и панелях'
  },
  { fg: '--ms-muted-3', bg: '--ms-surface', min: 3, note: 'иконки-заглушки, не текст' },
  { fg: '--ms-bubble-text', bg: '--ms-bubble-out', min: 4.5, note: 'текст сообщения' },
  { fg: '--ms-bubble-time', bg: '--ms-bubble-out', min: 4.5, note: 'время в пузыре' },
  { fg: '--ms-tick', bg: '--ms-bubble-out', min: 3, note: 'галочки прочтения' },
  { fg: '--ms-on-accent', bg: '--ms-accent', min: 3, note: 'текст на кнопках и бейджах' },
  { fg: '--ms-danger', bg: '--ms-surface', min: 4.5, note: 'ошибки, «удалить»' },
  { fg: '--ms-danger', bg: '--ms-danger-bg', min: 4.5, note: 'ошибка на своей подложке' },
  { fg: '--ms-info', bg: '--ms-surface', min: 4.5, note: 'ссылки, цитаты, «печатает»' },
  { fg: '--ms-info', bg: '--ms-info-bg', min: 4.5, note: 'инфо-плашка' },
  { fg: '--ms-warn', bg: '--ms-warn-bg', min: 4.5, note: 'предупреждения, лимит места' },
  { fg: '--ms-pinned-text', bg: '--ms-pinned-bg', min: 4.5, note: 'шапка закреплённых' },
  { fg: '--ms-pinned-item', bg: '--ms-pinned-bg', min: 4.5, note: 'текст закреплённого' },
  { fg: '--ms-pinned-icon', bg: '--ms-pinned-bg', min: 3, note: 'иконка закрепления' },
  { fg: '--ms-icon', bg: '--ms-surface', min: 3, note: 'иконки' },
  { fg: '--ms-icon-2', bg: '--ms-surface', min: 3, note: 'иконки второго уровня' },
  { fg: '--ms-icon-3', bg: '--ms-surface', min: 3, note: 'иконки третьего уровня' },
  { fg: '--ms-text', bg: '--ms-danger-bg', min: 4.5, note: 'текст на подложке ошибки' },
  { fg: '--ms-text', bg: '--ms-info-bg', min: 4.5, note: 'текст на инфо-подложке' },
  { fg: '--ms-text', bg: '--ms-warn-bg', min: 4.5, note: 'текст на предупреждающей подложке' },
  {
    fg: '--ms-qr-fg',
    bg: '--ms-qr-bg',
    min: 4.5,
    note: 'модули QR-кода (сканерам нужен запас контраста)'
  }
]

const THEMES = [
  { name: 'светлая', selector: ':root' },
  { name: 'тёмная', selector: "html[data-theme='dark']" },
  {
    // AMOLED переопределяет только поверхности, остальное берёт у тёмной темы —
    // поэтому в `base` указано, откуда добирать токены.
    name: 'AMOLED',
    selector: "html[data-theme='amoled']",
    base: "html[data-theme='dark']"
  }
]

/** Варианты цвета исходящих сообщений из настроек оформления. */
const BUBBLE_VARIANTS = ['blue', 'lilac', 'pink', 'peach', 'mint', 'orange']

/**
 * Вырезает содержимое блока правил по селектору.
 *
 * Ищем сам селектор, а не `селектор {`: блоки тем могут стоять в списке
 * (`html[data-theme='dark'], html[data-theme='amoled'] {`), и при поиске с
 * пробелом и скобкой такой блок просто не нашёлся бы. Берём первый `{` после
 * селектора — в файле это всегда начало блока токенов.
 */
function extractBlockOrNull(css, selector) {
  const start = css.indexOf(selector)
  if (start === -1) return null
  const from = css.indexOf('{', start) + 1
  const end = css.indexOf('\n}', from)
  if (end === -1) throw new Error(`Не найден конец блока «${selector}»`)
  return css.slice(from, end)
}

function extractBlock(css, selector) {
  const block = extractBlockOrNull(css, selector)
  if (block === null) throw new Error(`В appearance.css не найден блок «${selector}»`)
  return block
}

/** `--ms-text: #1c2733;` → Map('--ms-text' → '#1c2733') */
function parseTokens(block) {
  const tokens = new Map()
  for (const match of block.matchAll(/--ms-([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    tokens.set(`--ms-${match[1].toLowerCase()}`, match[2].trim())
  }
  return tokens
}

/**
 * Разбор `#rgb` / `#rrggbb` / `rgb()` / `rgba()` в { rgb, alpha }.
 * Возвращает null для формул (color-mix и пр.).
 */
function parseColor(value) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const digits = hex[1]
    const full =
      digits.length === 3
        ? digits
            .split('')
            .map((c) => c + c)
            .join('')
        : digits
    return {
      rgb: [
        Number.parseInt(full.slice(0, 2), 16),
        Number.parseInt(full.slice(2, 4), 16),
        Number.parseInt(full.slice(4, 6), 16)
      ],
      alpha: 1
    }
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?/i.exec(value)
  if (rgb) {
    return {
      rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])],
      alpha: rgb[4] === undefined ? 1 : Number(rgb[4])
    }
  }
  return null
}

/**
 * Раскрывает `var(--ms-x)` и отдаёт { rgb, alpha }.
 * Полупрозрачные подложки (в тёмной теме это rgba-подсветки) накладываются на
 * непрозрачную поверхность: иначе `rgba(255,138,128,0.12)` читался бы как
 * сплошной красный и давал ложное «1:1».
 */
function resolveColor(value, tokens, backdrop, depth = 0) {
  if (depth > 5) return null
  const ref = /^var\(\s*(--ms-[a-z0-9-]+)\s*\)$/i.exec(value)
  if (ref) {
    const next = tokens.get(ref[1].toLowerCase())
    return next === undefined ? null : resolveColor(next, tokens, backdrop, depth + 1)
  }
  const parsed = parseColor(value)
  if (!parsed) return null
  if (parsed.alpha >= 1 || !backdrop) return parsed
  return {
    rgb: parsed.rgb.map((channel, index) =>
      Math.round(channel * parsed.alpha + backdrop[index] * (1 - parsed.alpha))
    ),
    alpha: 1
  }
}

function channelToLinear(channel) {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance([r, g, b]) {
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b)
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [light, dark] = la > lb ? [la, lb] : [lb, la]
  return (light + 0.05) / (dark + 0.05)
}

/** Проверяет набор пар на одном наборе токенов. Возвращает число провалов. */
function runChecks(tokens, label) {
  const surface = resolveColor(tokens.get('--ms-surface') ?? '', tokens, null)
  let failures = 0

  console.log(`\n=== ${label} ===`)
  for (const { fg, bg, min, note } of CHECKS) {
    const fgColor = resolveColor(tokens.get(fg) ?? '', tokens, surface?.rgb)
    const bgColor = resolveColor(tokens.get(bg) ?? '', tokens, surface?.rgb)

    if (!fgColor || !bgColor) {
      console.log(`SKIP  ${fg} на ${bg} — цвет задан формулой (color-mix), смотрю глазами`)
      continue
    }

    const ratio = contrastRatio(fgColor.rgb, bgColor.rgb)
    const ok = ratio >= min
    if (!ok) failures += 1
    console.log(
      `${ok ? 'OK  ' : 'ФЕЙЛ'}  ${fg} на ${bg} — ${ratio.toFixed(2)}:1 (норма ${min}:1, ${note})`
    )
  }

  return failures
}

async function main() {
  const css = await readFile(CSS_PATH, 'utf8')
  let failures = 0

  // `:root` — база: тёмные темы переопределяют только часть токенов,
  // остальные наследуются, поэтому собираем итоговый набор как объединение.
  const rootTokens = parseTokens(extractBlock(css, ':root'))

  for (const theme of THEMES) {
    const parent = theme.base
      ? new Map([...rootTokens, ...parseTokens(extractBlock(css, theme.base))])
      : rootTokens
    const baseTokens =
      theme.selector === ':root'
        ? rootTokens
        : new Map([...parent, ...parseTokens(extractBlock(css, theme.selector))])
    failures += runChecks(baseTokens, `${theme.name} тема (${theme.selector})`)

    // Цвет исходящих сообщений выбирается в настройках — проверяем каждый вариант.
    for (const variant of BUBBLE_VARIANTS) {
      const selector =
        theme.selector === ':root'
          ? `html[data-bubble='${variant}']`
          : `${theme.selector}[data-bubble='${variant}']`
      const variantBlock = extractBlockOrNull(css, selector)
      if (!variantBlock) continue
      const tokens = new Map([...baseTokens, ...parseTokens(variantBlock)])
      failures += runChecks(tokens, `${theme.name} тема, пузыри «${variant}»`)
    }
  }

  if (failures > 0) {
    console.error(
      `\nПровалено проверок: ${failures}. Поправьте токены в src/assets/appearance.css.`
    )
    process.exitCode = 1
    return
  }
  console.log('\nВсе проверки контраста пройдены.')
}

await main()
