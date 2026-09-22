/**
 * Слой выпадающего списка НЕ переезжает внутрь контейнера диалога Quasar.
 *
 * Живой баг 22.09.2026: открыли список (язык или страна в настройках), затем
 * закрыли настройки крестиком — приложение падало с фатальным экраном
 * («Cannot read properties of null (reading 'emitsOptions')» либо
 * «insertBefore … is not a child of this node»). Причина: слой переносился
 * ВНУТРЬ `.q-dialog` — то есть в элемент, детьми которого управляет Quasar, — и
 * порядок узлов, на который опирается Vue, ломался при следующей же перерисовке
 * (Vue ищет опорный узел, а его уже нет под ожидаемым родителем).
 *
 * Теперь слой рисуется рядом с полем — то есть внутри диалога, где focus-trap
 * `q-dialog` не забирает фокус из поля поиска. В `body` он переносится только у
 * панели звонка (`variant="call"`): её контейнер `.call-settings` сам с
 * `transform`, поэтому `position: fixed` отсчитывался бы от него, а не от окна.
 */
import { readFileSync } from 'node:fs'

import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import SelectField from '@/components/common/SelectField.vue'

let wrapper: VueWrapper | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  host?.remove()
  host = null
  document.body.innerHTML = ''
})

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Монтирует поле в свой контейнер и открывает список. */
const openList = async (variant: 'field' | 'call' = 'field'): Promise<HTMLDivElement> => {
  host = document.createElement('div')
  document.body.appendChild(host)
  wrapper = mount(SelectField, {
    attachTo: host,
    props: {
      options: [
        { value: '', label: 'Не выбрано' },
        { value: 'ru', label: 'Русский' },
        { value: 'en', label: 'English' }
      ],
      modelValue: '',
      variant
    }
  })
  await wrapper.get('.sf-trigger').trigger('click')
  await nextTick()
  return host
}

describe('слой выпадающего списка', () => {
  it('остаётся рядом с полем, а не переезжает в body', async () => {
    const container = await openList('field')
    const layer = document.querySelector('.sf-layer')
    expect(layer).not.toBeNull()
    // Перенос внутрь чужого контейнера (`.q-dialog`) и был причиной падения:
    // слой обязан жить в разметке самого поля.
    expect(container.contains(layer)).toBe(true)
  })

  it('у панели звонка переносится в body (там у контейнера transform)', async () => {
    const container = await openList('call')
    const layer = document.querySelector('.sf-layer')
    expect(layer).not.toBeNull()
    expect(container.contains(layer)).toBe(false)
    expect(document.body.contains(layer)).toBe(true)
  })

  it('в исходнике нет поиска диалога под слой', () => {
    // Страховка от возврата старого поведения: искали ближайший `.q-dialog` и
    // телепортировались прямо в него.
    const source = readFileSync('src/components/common/SelectField.vue', 'utf8')
    expect(source).toContain('<Teleport to="body" :disabled="variant !== \'call\'">')
    expect(source).not.toContain('closest')
    expect(source).not.toContain('teleportTarget')
  })
})
