import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { readFileSync } from 'node:fs'

import MessageComposer from '@/components/messenger/MessageComposer.vue'

/**
 * Развёрнутый ввод (телефон).
 *
 * Требование владельца: «как в Телеграме» — в наборе сообщения поле ввода можно
 * развернуть на весь экран, а дополнительные пункты (форматирование «Aa»)
 * открываются ТОЛЬКО там. В обычной строке на телефоне кнопки «Aa» нет: она
 * теснила поле ввода. На компьютере строка остаётся прежней — там места хватает.
 */
const composer = readFileSync('src/components/messenger/MessageComposer.vue', 'utf8')

/** Исходник без комментариев CSS и в одну строку: prettier переносит по-разному. */
const flat = composer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')

/** Монтирует композер так же, как тесты упоминаний (Pinia нужна пакам стикеров). */
function mountComposer(text = '') {
  const wrapper = mount(MessageComposer, {
    attachTo: document.body,
    props: {
      chatId: 7,
      sending: false,
      sendError: '',
      replyTarget: null,
      replyBarName: '',
      editingMessage: null,
      extrasPanel: 'none' as const,
      voiceRecOpen: false,
      recordMode: 'audio' as const,
      micHolding: false,
      recordModeHint: '',
      mentionMembers: [],
      newMessage: text,
      'onUpdate:newMessage': (value: string) => wrapper.setProps({ newMessage: value })
    },
    global: {
      plugins: [createPinia()],
      stubs: { 'q-icon': true, VoiceRecorderBar: true, GifPicker: true }
    }
  })
  return wrapper
}

describe('развёрнутый ввод в композере', () => {
  it('значок разворота в поле: первое нажатие разворачивает', async () => {
    const wrapper = mountComposer('привет')
    const toggle = wrapper.find('.field-toggle')
    expect(toggle.exists()).toBe(true)
    expect(wrapper.find('.input-area').classes()).not.toContain('expanded')
    expect(toggle.attributes('aria-expanded')).toBe('false')

    await toggle.trigger('click')
    expect(wrapper.find('.input-area').classes()).toContain('expanded')
    expect(wrapper.find('.field-toggle').attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.field-toggle').attributes('title')).toBe('Свернуть')

    wrapper.unmount()
  })

  it('повторное нажатие сворачивает', async () => {
    const wrapper = mountComposer('привет')
    await wrapper.find('.field-toggle').trigger('click')
    await wrapper.find('.field-toggle').trigger('click')

    expect(wrapper.find('.input-area').classes()).not.toContain('expanded')
    expect(wrapper.find('.field-toggle').attributes('title')).toBe('Развернуть поле ввода')
    wrapper.unmount()
  })

  it('смена чата сворачивает развёрнутый ввод', async () => {
    const wrapper = mountComposer('привет')
    await wrapper.find('.field-toggle').trigger('click')
    await wrapper.setProps({ chatId: 8 })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.input-area').classes()).not.toContain('expanded')
    wrapper.unmount()
  })

  it('началась запись голосового — раскладка развёрнутого ввода не нужна', async () => {
    const wrapper = mountComposer('привет')
    await wrapper.find('.field-toggle').trigger('click')
    await wrapper.setProps({ voiceRecOpen: true })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.input-area').classes()).not.toContain('expanded')
    wrapper.unmount()
  })

  it('развёрнутый ввод — слой общего стека: «назад» сворачивает его', () => {
    // Иначе системное «назад» на телефоне вышло бы из приложения прямо из
    // развёрнутого набора.
    expect(composer.replace(/\s+/g, '')).toContain(
      'useMobileLayer(()=>expanded.value,()=>collapse())'
    )
  })

  it('«свернуть» — отдельной кнопкой в самом верху развёрнутой панели', async () => {
    const wrapper = mountComposer('привет')
    expect(wrapper.find('.expand-bar').exists()).toBe(false)

    await wrapper.find('.field-toggle').trigger('click')
    expect(wrapper.find('.expand-bar .collapse-btn').exists()).toBe(true)
    await wrapper.find('.collapse-btn').trigger('click')
    expect(wrapper.find('.input-area').classes()).not.toContain('expanded')
    wrapper.unmount()
  })

  it('значок разворота — телефонный и только у многострочного текста', () => {
    // Значок одного габарита с круглыми кнопками (разные размеры дают неровный
    // ряд) и живёт в поле у правого края.
    expect(flat).toContain('.field-toggle { display: none; position: absolute; right: 0;')
    expect(flat).toContain('width: 38px; height: 38px; padding: 0;')
    expect(flat).toContain('@media (max-width: 600px) { .input-row, .input-tools { gap: 2px; }')
    expect(flat).toContain('.field-toggle { right: -4px; }')
    // Показываем только с ТРЕТЬЕЙ набранной строки: на низком поле значок
    // закрывал текст, а разворачивать там было нечего.
    expect(flat).toContain('.input-area.multiline .field-toggle { display: inline-flex; }')
    // Место под значок в поле: текст под него не заезжает — и тоже только тогда.
    expect(flat).toContain('.input-area.multiline .text-input { padding-right: 40px; }')
  })

  it('«Aa» в обычной строке нет, в развёрнутом вводе — есть', () => {
    // Кнопка отрисована только в развёрнутом вводе: в строке формат предлагает
    // панель по выделению, и «Aa» там только сужала поле.
    expect(composer).toContain('<span v-if="expanded" class="format-wrap">')
    // Правил «спрятать/показать» в CSS больше нет: кнопки просто нет в разметке.
    expect(flat).not.toContain('.format-wrap { display: none; }')
    expect(flat).not.toContain('.input-area.expanded .format-wrap { display: inline-flex; }')
  })

  it('три строки — порог появления значка разворота', () => {
    expect(composer).toContain('const MULTILINE_MIN_LINES = 3')
    expect(composer).toContain('multiline.value = countLines(el) >= MULTILINE_MIN_LINES')
    expect(composer).toContain(':class="{ expanded, multiline }"')
  })

  it('панель формата появляется по выделению и встаёт у него', async () => {
    const wrapper = mountComposer('привет мир')
    const area = wrapper.find('textarea')
    expect(wrapper.find('.selection-menu').exists()).toBe(false)

    const el = area.element as HTMLTextAreaElement
    el.focus()
    el.setSelectionRange(0, 6)
    await area.trigger('select')
    await wrapper.vm.$nextTick()

    const panel = wrapper.find('.selection-menu')
    expect(panel.exists()).toBe(true)
    // Координаты считает `placeSelectionMenu` по замеру каретки: панель встаёт у
    // выделения, а не по центру поля (в вебе центр поля = центр мессенджера).
    const style = (panel.element as HTMLElement).style
    expect(style.left).toBe('0px')
    expect(style.top).toBe('0px')
    expect(composer).toContain('menuAnchor(')
    expect(composer).toContain('caretBox(el, start)')

    // Пункт меню применяет разметку к выделению: клик ловим на `mousedown`,
    // иначе поле теряет выделение до правки.
    await panel.find('.selection-item').trigger('mousedown')
    expect(wrapper.emitted('update:newMessage')?.at(-1)).toEqual(['*привет* мир'])
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.selection-menu').exists()).toBe(false)
    wrapper.unmount()
  })

  it('на телефоне у всех кнопок строки один габарит', () => {
    expect(flat).toContain('.input-row, .input-tools { gap: 2px; }')
    // Отправка — тот же круг 38 px, что у соседей (при 40 px её значок стоял
    // дальше от смайла).
    expect(flat).toContain('.send-btn { width: 38px; height: 38px; }')
  })

  it('кнопки прижаты плотнее: просветы по «чернилам», а не по боксам', () => {
    // Ширина «чернил» у кнопок разная (шеврон 10 px, смайл 19, «Aa» 14, залитая
    // отправка — весь круг), поэтому равные боксы дают разный просвет. Сдвиги
    // подобраны замером по пикселам: просветы 17–18 px во всех парах.
    expect(flat).toContain('.extras-toggle { margin-left: -5px; }')
    expect(flat).toContain('.format-wrap { margin-left: -6px; margin-right: 0; }')
    // У микрофона и у залитой отправки видимая граница разная, поэтому сдвиг
    // стоит на обёртках: иначе в одном из двух состояний просвет больше.
    expect(flat).toContain('.mic-wrap { margin-left: -8px; }')
    expect(flat).toContain('.send-wrap { margin-left: 4px; }')
    // В вебе компенсация мягче: кнопки мельче, зазор строки 8 px.
    expect(flat).toContain(
      '.format-wrap { position: relative; display: inline-flex; margin: 0 -2px; }'
    )
    expect(flat).toContain(
      '.send-wrap { position: relative; display: inline-flex; margin-left: 6px; }'
    )
    expect(flat).toContain('.mic-wrap { margin-left: -2px; }')
  })

  it('«Aa» осталась кнопкой с меню разметки', () => {
    expect(composer).toContain('class="round-btn format-btn"')
    expect(composer).toContain('<span v-if="expanded" class="format-wrap">')
    expect(composer).toContain('v-model="formatMenuOpen"')
    expect(composer).toContain('@click="applyFormat(item.kind)"')
  })

  it('кнопки собраны в одну группу, и в развёрнутом виде они внизу под полем', () => {
    // Общая обёртка: без неё кнопки не собрать в тесный ряд под полем.
    expect(composer).toContain('<span class="input-tools">')
    expect(flat).toContain('.input-tools { display: inline-flex; align-items: center; gap: 8px; }')

    // Развёрнутый ввод — сетка: поле во всю ширину сверху, кнопки в нижней строке
    // у правого края (раньше разъезжались по краям экрана).
    expect(flat).toContain(
      '.input-area.expanded .input-row { flex: 1; min-height: 0; display: grid;'
    )
    expect(flat).toContain('grid-template-columns: 1fr auto auto;')
    // По горизонтали — тот же ровный зазор, что и в обычной строке.
    expect(flat).toContain('column-gap: 2px; row-gap: 6px;')
    expect(flat).toContain(
      '.input-area.expanded .editor-slot { grid-column: 1 / -1; grid-row: 1; align-self: stretch; }'
    )
    expect(flat).toContain('.input-area.expanded .attach-wrap { grid-column: 2; grid-row: 2; }')
    expect(flat).toContain('.input-area.expanded .input-tools { grid-column: 3; grid-row: 2; }')
  })

  it('развёрнутый ввод выше ленты: её кнопка прокрутки не перекрывает отправку', () => {
    // `.jump-btn` в ленте — z-index 5; ниже него кнопка вставала ровно
    // на отправку (замер в приложении).
    expect(flat).toContain('.input-area.expanded { position: absolute; inset: 0; z-index: 6;')
  })

  it('развёрнутый значок показывает «свернуть»', () => {
    // Стрелки, а не шевроны: «поле растёт вверх» / «убирается вниз».
    expect(composer).toMatch(/icon\(expanded\s*\?\s*'arrow_downward'\s*:\s*'arrow_upward'\)/)
    // Значок в поле в развёрнутом виде скрыт (сверху есть «свернуть»), а верхняя
    // строка прижата к правому краю.
    expect(flat).toContain('.input-area.expanded .field-toggle { display: none; }')
    expect(flat).toContain('.expand-bar { display: flex; justify-content: flex-end; }')
  })
})
