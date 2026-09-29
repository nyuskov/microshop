import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { applyMarkup, MARKUP_MARKS } from '@/utils/markup'

/**
 * Формат текста в композере: кнопка «Aa» обрамляет выделение знаками разметки.
 *
 * Знаки разбирает рендер (`MessageText.vue` через `utils/mentions.ts`), поэтому
 * правило одно: сразу после открывающего знака и перед закрывающим не должно быть
 * пробела — значит пробелы по краям выделения остаются СНАРУЖИ обрамления.
 */
const composer = readFileSync('src/components/messenger/MessageComposer.vue', 'utf8')

describe('разметка выделенного текста', () => {
  it('оборачивает выделение знаком и оставляет его выделенным', () => {
    const edit = applyMarkup('привет мир', 0, 6, 'bold')
    expect(edit.text).toBe('*привет* мир')
    expect([edit.start, edit.end]).toEqual([1, 7])
  })

  it('пробелы по краям выделения остаются снаружи обрамления', () => {
    // `* текст *` разбор не распознаёт: жирным должен стать только `текст`.
    const edit = applyMarkup('это  текст  и всё', 4, 11, 'bold')
    expect(edit.text).toBe('это  *текст*  и всё')
    expect([edit.start, edit.end]).toEqual([6, 11])
  })

  it('повторное нажатие снимает разметку', () => {
    const wrapped = applyMarkup('привет мир', 0, 6, 'italic')
    expect(wrapped.text).toBe('_привет_ мир')

    // Выделен текст внутри готовой разметки — снимаем знаки по краям.
    expect(applyMarkup(wrapped.text, 1, 7, 'italic').text).toBe('привет мир')
    // Выделено вместе со знаками — тоже снимаем.
    expect(applyMarkup(wrapped.text, 0, 8, 'italic').text).toBe('привет мир')
  })

  it('без выделения ставит пару знаков и курсор между ними', () => {
    const edit = applyMarkup('код', 3, 3, 'code')
    expect(edit.text).toBe('код``')
    expect([edit.start, edit.end]).toEqual([4, 4])
  })

  it('многосимвольные знаки обрамляются целиком', () => {
    expect(applyMarkup('секрет', 0, 6, 'spoiler').text).toBe('||секрет||')
    expect(applyMarkup('нет', 0, 3, 'strike').text).toBe('~~нет~~')
    expect(applyMarkup('цитата', 0, 6, 'underline').text).toBe('__цитата__')
    expect(MARKUP_MARKS.code).toBe('`')
    expect(MARKUP_MARKS.underline).toBe('__')
  })

  it('повторное нажатие при пустой паре снимает её, а не ставит вторую', () => {
    // «Включил и передумал»: знаки убираются одним нажатием той же кнопки.
    const empty = applyMarkup('код', 3, 3, 'code')
    expect(empty.text).toBe('код``')

    const removed = applyMarkup(empty.text, empty.start, empty.start, 'code')
    expect(removed.text).toBe('код')
    expect([removed.start, removed.end]).toEqual([3, 3])
  })

  it('индексы вне текста (курсор уехал) не ломают правку', () => {
    expect(applyMarkup('abc', 10, 20, 'bold').text).toBe('abc**')
  })

  it('выделены одни пробелы — получается пустая пара знаков', () => {
    const edit = applyMarkup('аб вг', 2, 3, 'bold')
    expect(edit.text).toBe('аб **вг')
    expect([edit.start, edit.end]).toEqual([4, 4])
  })

  it('цитата ставит «> » в начало каждой выделенной строки', () => {
    const edit = applyMarkup('первая\nвторая\nтретья', 0, 6, 'quote')
    expect(edit.text).toBe('> первая\nвторая\nтретья')
    // Выделенной остаётся процитированная строка — ровно то, что получилось.
    expect([edit.start, edit.end]).toEqual([0, 8])
  })

  it('цитата расширяет выделение до границ строк и снимается повторно', () => {
    // Выделили середину строки — цитируется строка целиком.
    const middle = applyMarkup('текст строки', 4, 6, 'quote')
    expect(middle.text).toBe('> текст строки')
    // Повторное нажатие — «выключить», как у остальных видов.
    const off = applyMarkup(middle.text, middle.start, middle.end, 'quote')
    expect(off.text).toBe('текст строки')
    // Пустые строки знака не получают: они прерывают цитату.
    expect(applyMarkup('один\n\nдва', 0, 9, 'quote').text).toBe('> один\n\n> два')
  })
})

describe('кнопка формата в композере', () => {
  it('есть кнопка, меню из семи видов и вызов разметки', () => {
    expect(composer).toContain("t('Форматирование текста')")
    expect(composer).toContain('@click="applyFormat(item.kind)"')
    expect(composer).toContain('applyMarkup(newMessage.value, start, end, kind)')
    for (const label of [
      'Жирный',
      'Курсив',
      'Подчёркнутый',
      'Зачёркнутый',
      'Цитата',
      'Код',
      'Спойлер'
    ]) {
      expect(composer).toContain(`label: '${label}'`)
    }
  })

  it('подпись пункта нарисована тем же видом, какой получит текст', () => {
    // Классы общие для обоих меню: «Aa» в развёрнутом вводе и панель по выделению.
    expect(composer).toContain('class="attach-item markup-item"')
    expect(composer).toContain('class="selection-item markup-item"')
    expect(composer).toContain(':class="`kind-${item.kind}`"')
    for (const kind of ['bold', 'italic', 'underline', 'strike', 'quote', 'code', 'spoiler']) {
      expect(composer).toContain(`.markup-item.kind-${kind} {`)
    }
  })

  it('кнопка «Aa» — только в развёрнутом вводе', () => {
    // В обычной строке формат предлагает панель по выделению, а кнопка там только
    // сужала поле ввода (владелец просил не разъезжаться на узких экранах).
    expect(composer).toContain('<span v-if="expanded" class="format-wrap">')
  })

  it('после правки возвращаются фокус и выделение', () => {
    // Тот же приём, что у подсказки упоминаний: сначала текст, потом фокус и
    // `setSelectionRange` в `nextTick` — иначе курсор уезжает в конец поля.
    const body = composer.slice(composer.indexOf('const applyFormat'))
    expect(body).toContain('input?.setSelectionRange(next.start, next.end)')
    expect(body).toContain('autoGrow()')
  })
})
