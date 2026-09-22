/**
 * Поиск в выпадающем списке стран — компонент, а не только чистые функции.
 *
 * Жалоба владельца 22.09.2026: «не кликается сам search в выборе страны». Причина
 * была в том, что клик по полю поиска сопровождается прокруткой контейнера (и, на
 * телефоне, показом клавиатуры с `resize`), а список в этот момент закрывался —
 * человек не успевал ничего набрать. Здесь это и проверяем, плюс сам поиск.
 *
 * Список рисуется рядом с полем (не переезжает в чужой контейнер — см.
 * `selectFieldLayer.spec.ts`), поэтому элементы ищем в документе, а не в обёртке.
 */
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import SelectField from '@/components/common/SelectField.vue'
import { countryOptions } from '@/utils/countries'

let wrapper: VueWrapper | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Монтирует поле и открывает список. */
const openList = async (): Promise<void> => {
  wrapper = mount(SelectField, {
    attachTo: document.body,
    props: {
      options: countryOptions('ru-RU'),
      modelValue: '',
      searchable: true,
      ariaLabel: 'Страна'
    }
  })
  await wrapper.get('.sf-trigger').trigger('click')
  await nextTick()
}

const searchInput = (): HTMLInputElement => {
  const input = document.body.querySelector<HTMLInputElement>('.sf-search')
  if (!input) throw new Error('поле поиска не найдено — список закрыт')
  return input
}

const optionLabels = (): string[] =>
  [...document.body.querySelectorAll('.sf-option-label')].map((node) => node.textContent ?? '')

/** Вводит запрос так, как это делает человек: в фокус, затем событие ввода. */
const type = async (query: string): Promise<void> => {
  const input = searchInput()
  input.focus()
  input.value = query
  input.dispatchEvent(new Event('input'))
  await nextTick()
}

describe('поле поиска в списке стран', () => {
  it('остаётся открытым, когда браузер прокручивает страницу к полю', async () => {
    await openList()
    searchInput().focus()
    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    // Не «список отклеился», а именно открыт: поле поиска на месте.
    expect(document.body.querySelector('.sf-search')).not.toBeNull()
    expect(document.body.querySelectorAll('.sf-option').length).toBeGreaterThan(200)
  })

  it('находит страну по русскому названию', async () => {
    await openList()
    await type('герман')
    expect(optionLabels()).toContain('Германия')
  })

  it('находит страну по коду', async () => {
    await openList()
    await type('kz')
    expect(optionLabels()).toContain('Казахстан')
  })

  it('находит страну по английскому названию', async () => {
    await openList()
    await type('kazakhstan')
    expect(optionLabels()).toContain('Казахстан')
  })

  it('рисует список внутри диалога Quasar, если поле лежит в диалоге', async () => {
    // Иначе фокус-трап диалога забирает фокус у поля поиска: клик по нему
    // «не работает», как будто поле только для чтения.
    const dialog = document.createElement('div')
    dialog.className = 'q-dialog'
    document.body.appendChild(dialog)

    wrapper = mount(SelectField, {
      attachTo: dialog,
      props: {
        options: countryOptions('ru-RU'),
        modelValue: '',
        searchable: true,
        ariaLabel: 'Страна'
      }
    })
    await wrapper.get('.sf-trigger').trigger('click')
    await nextTick()

    expect(dialog.querySelector('.sf-layer')).not.toBeNull()
    expect(document.body.querySelector('.sf-search')).not.toBeNull()
  })

  it('выбирает страну после поиска и закрывает список', async () => {
    await openList()
    await type('казах')

    const option = [...document.body.querySelectorAll<HTMLButtonElement>('.sf-option')].find(
      (node) => node.textContent?.includes('Казахстан')
    )
    expect(option).toBeDefined()
    option?.click()
    await nextTick()

    expect(wrapper?.emitted('update:modelValue')?.at(-1)).toEqual(['KZ'])
    expect(document.body.querySelector('.sf-layer')).toBeNull()
  })

  it('выбирает страну сразу из полного списка', async () => {
    await openList()

    const option = [...document.body.querySelectorAll<HTMLButtonElement>('.sf-option')].find(
      (node) => node.textContent?.includes('Германия')
    )
    option?.click()
    await nextTick()

    expect(wrapper?.emitted('update:modelValue')?.at(-1)).toEqual(['DE'])
  })
})
