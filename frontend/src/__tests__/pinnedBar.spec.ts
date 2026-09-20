import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Шторка «Закреплённые сообщения»: одна строка шапки, всё по вертикальному центру.
 *
 * Повод (жалоба 17.09.2026): текст «Закреплённые сообщения» стоял не по центру —
 * иконка, счётчик и кнопка выравнивались по верху (`align-items: flex-start`),
 * поэтому при одной строке текста заголовок «плавал», а стрелка и крестик
 * смотрелись ниже него. Теперь шапка — отдельная строка фиксированной высоты, где
 * иконка, заголовок, счётчик и кнопки центрированы по вертикали.
 */
const source = (path: string) => readFileSync(path, 'utf8')
const bar = source('src/components/messenger/PinnedBar.vue')
const messenger = source('src/views/Messenger.vue')
const header = source('src/components/messenger/ChatHeader.vue')
/** Исходник без комментариев: в пояснениях слова «flex-start» есть намеренно. */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')

const barCss = stripComments(bar)

/** Тело правила CSS по селектору (без вложенных медиа-запросов). */
function ruleBody(css: string, selector: string): string {
  const index = css.indexOf(`${selector} {`)
  expect(index, `правило ${selector} должно быть в стилях`).toBeGreaterThan(-1)
  const from = css.indexOf('{', index) + 1
  // Правила в файле плоские, поэтому до первой закрывающей скобки.
  return css.slice(from, css.indexOf('}', from))
}

describe('шапка шторки закреплённых', () => {
  it('вся строка выровнена по центру по вертикали', () => {
    const row = ruleBody(barCss, '.pinned-head-row')
    expect(row).toContain('align-items: center')
    // Высота строки — как у кнопки, иначе заголовок снова «плавал» бы.
    expect(row).toContain('min-height')
  })

  it('иконка, заголовок и стрелка центрируются, а не выравниваются по верху', () => {
    expect(barCss).not.toContain('align-items: flex-start')
    expect(ruleBody(barCss, '.pinned-icon')).toContain('align-items: center')
    expect(ruleBody(barCss, '.pinned-toggle')).toContain('align-items: center')
    expect(ruleBody(barCss, '.pinned-chevron')).toContain('flex: none')
  })

  it('счётчик — круглая плашка с цифрой по центру в обе стороны', () => {
    const count = ruleBody(barCss, '.pinned-count')
    expect(count).toContain('align-items: center')
    expect(count).toContain('justify-content: center')
    expect(count).toContain('border-radius')
    expect(count).toContain('line-height: 1')
  })

  it('список идёт под шапкой с отступом по иконке', () => {
    const list = ruleBody(barCss, '.pinned-list')
    expect(list).toContain('flex-direction: column')
    expect(list).toContain('padding')
  })

  it('поворот стрелки гасится при reduced-motion', () => {
    expect(bar).toContain('prefers-reduced-motion')
  })
})

describe('закреплённые: выделение тоном, без рамок', () => {
  const thread = stripComments(source('src/components/messenger/MessageThread.vue'))

  it('шторка закреплённых отбивается фоном, а не линией', () => {
    const barRule = ruleBody(barCss, '.pinned-bar')
    expect(barRule).toContain('background: var(--ms-pinned-bg)')
    expect(barRule).not.toContain('border')
  })

  it('переход к закреплённому — полоса во всю ширину чата, под сообщениями', () => {
    const band = ruleBody(thread, '.highlight-band')
    expect(band).toContain('left: 0')
    expect(band).toContain('right: 0')
    // Ровный полупрозрачный тон, а не градиент: полоса не зависит от стороны
    // сообщения и не «плывёт» по яркости.
    expect(band).toContain('color-mix(')
    expect(band).toContain('transparent')
    expect(band).not.toContain('gradient')
    // Строка уже пузыря, поэтому полоса живёт в обёртке ленты и тянется на всю
    // её ширину, а высоту берёт у строки.
    expect(thread).toContain('class="highlight-band"')
    expect(thread).toContain('getBoundingClientRect')
    expect(thread).toContain('data-message-id')
    // Сообщения — выше полос: фон пузыря не подсвечиваем.
    expect(ruleBody(thread, '.messages-scroll')).toContain('z-index: 1')
    // Рамкой больше не подсвечиваем.
    expect(thread).not.toContain('box-shadow: 0 0 0 3px')
  })

  it('полоса выделения не обрезается плашкой даты', () => {
    // Раньше полоса обрезалась по нижней границе плашки: при висящей дате
    // верхняя часть строки оставалась без подсветки, и полоса выглядела
    // «перекрытой» (жалоба владельца). Теперь она идёт ровно по строке, а плашка
    // даты плотнее и просто накрывает её.
    const measure = thread.slice(thread.indexOf('const measureBands'))
    const body = measure.slice(0, measure.indexOf('const flash'))

    expect(body).not.toContain('day-divider')
    expect(body).toContain('height: box.height')
  })

  it('выделенные сообщения светятся той же полосой, но держатся', () => {
    const selected = ruleBody(thread, '.highlight-band.selected')
    expect(selected).toContain('animation: none')
    expect(selected).toContain('opacity: 1')
    // Тон тот же, что у вспышки перехода: своего фона (тем более градиента)
    // для выделения не заводим.
    expect(selected).not.toContain('background')
    // Полосы собираются по выбору и по вспышке перехода.
    expect(thread).toContain('props.selectedMessageIds')
    expect(thread).toContain('flashMessageId')
    // Рамка выбранного сообщения убрана из строки.
    const row = stripComments(source('src/components/messenger/MessageRow.vue'))
    expect(row).not.toContain('.msg.selected .msg-bubble')
  })

  it('без анимаций полоса остаётся видимой', () => {
    const reduce = thread.slice(thread.indexOf('prefers-reduced-motion'))
    expect(reduce).toContain('.highlight-band')
    expect(reduce).toContain('opacity: 1')
  })
})

describe('поведение шторки', () => {
  it('заголовок раскрывает и сворачивает список, стрелка поворачивается', () => {
    expect(bar).toContain('open = !open')
    expect(bar).toMatch(/:class="\{ rotated: open \}"/)
  })

  it('крестик скрывает шторку в этом чате', () => {
    expect(bar).toContain("emit('close')")
    expect(bar).toContain('aria-label="Скрыть закреплённые сообщения"')
    expect(messenger).toContain('pinnedHidden')
    expect(messenger).toContain('@close="pinnedHidden = true"')
    expect(messenger).toContain('v-if="pinnedRows.length && !pinnedHidden"')
  })

  it('при открытии другого чата шторка снова видна', () => {
    // Иначе скрытая в одном чате шторка пропала бы и во всех остальных.
    expect(messenger).toMatch(/pinnedHidden\.value = false/)
  })
})

describe('скрытую шторку можно вернуть', () => {
  it('в шапке нет отдельной кнопки — действие живёт в меню, без дублей', () => {
    // Отдельная булавка рядом с звонком и «⋯» только засоряла бы шапку.
    expect(header).not.toContain('pinned-restore')
    expect(header).not.toContain("emit('show-pinned')")
    expect(messenger).not.toContain('@show-pinned')
  })

  it('в меню «⋯» есть переключатель видимости шторки', () => {
    expect(header).toContain("runChatAction('pinned')")
    expect(header).toContain("if (action === 'pinned') emit('toggle-pinned')")
    // Пункт показываем только когда есть что показывать.
    expect(header).toMatch(/v-if="hasPinned"[\s\S]{0,220}runChatAction\('pinned'\)/)
    expect(header).toContain('Показать закреплённые')
    expect(header).toContain('Скрыть закреплённые')
  })

  it('переключатель помнит состояние и раскрывает список при показе', () => {
    expect(messenger).toContain('@toggle-pinned="togglePinnedBar"')
    expect(messenger).toMatch(
      /const togglePinnedBar = \(\) => \{[\s\S]{0,320}pinnedOpen\.value = true/
    )
    expect(messenger).toContain(':has-pinned="pinnedRows.length > 0"')
    expect(messenger).toContain(':pinned-hidden="pinnedHidden"')
  })
})
