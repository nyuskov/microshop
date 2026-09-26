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
    expect(MARKUP_MARKS.code).toBe('`')
  })

  it('индексы вне текста (курсор уехал) не ломают правку', () => {
    expect(applyMarkup('abc', 10, 20, 'bold').text).toBe('abc**')
  })

  it('выделены одни пробелы — получается пустая пара знаков', () => {
    const edit = applyMarkup('аб вг', 2, 3, 'bold')
    expect(edit.text).toBe('аб **вг')
    expect([edit.start, edit.end]).toEqual([4, 4])
  })
})

describe('кнопка формата в композере', () => {
  it('есть кнопка, меню из пяти видов и вызов разметки', () => {
    expect(composer).toContain("t('Форматирование текста')")
    expect(composer).toContain('@click="applyFormat(item.kind)"')
    expect(composer).toContain('applyMarkup(newMessage.value, start, end, kind)')
    for (const label of ['Жирный', 'Курсив', 'Зачёркнутый', 'Код', 'Спойлер']) {
      expect(composer).toContain(`label: '${label}'`)
    }
  })

  it('кнопка появляется только при набранном тексте', () => {
    // Пока текста нет, в строке стоит микрофон: лишняя кнопка сузила бы поле
    // ввода на телефоне (владелец просил не разъезжаться на узких экранах).
    expect(composer).toContain('<span v-if="hasText" class="format-wrap">')
  })

  it('после правки возвращаются фокус и выделение', () => {
    // Тот же приём, что у подсказки упоминаний: сначала текст, потом фокус и
    // `setSelectionRange` в `nextTick` — иначе курсор уезжает в конец поля.
    const body = composer.slice(composer.indexOf('const applyFormat'))
    expect(body).toContain('input?.setSelectionRange(next.start, next.end)')
    expect(body).toContain('autoGrow()')
  })
})
