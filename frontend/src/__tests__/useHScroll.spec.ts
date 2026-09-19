import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'

import { useHScroll } from '@/composables/useHScroll'
import { useFocusTrap } from '@/composables/useFocusTrap'
import ChannelInfoDialog from '@/components/channels/ChannelInfoDialog.vue'

/**
 * Порядок инициализации в `useHScroll`.
 *
 * Источник длины ленты — всегда геттер вида `() => TABS.value.length`, а сами
 * значения объявлены в `<script setup>` НИЖЕ вызова. `watch` вычисляет источник
 * сразу же, поэтому раньше чтение происходило до инициализации `const` и setup
 * падал с `Cannot access 'canManage' before initialization` → приложение
 * показывало фатальный экран вместо диалога (живой случай:
 * `ChannelInfoDialog.vue`). Теперь наблюдатель ставится в `onMounted`.
 */
describe('useHScroll', () => {
  it('не читает источник длины во время setup', () => {
    // `later` объявлен ПОСЛЕ вызова — если бы composable читал источник сразу,
    // здесь был бы ReferenceError (TDZ).
    const Probe = defineComponent({
      setup() {
        useHScroll(() => later.value.length)
        const later = ref([1, 2, 3])
        return () => h('div')
      }
    })

    expect(() => mount(Probe)).not.toThrow()
  })

  it('следит за длиной источника после монтирования', async () => {
    const list = ref([1, 2, 3])
    let reads = 0
    const Probe = defineComponent({
      setup() {
        useHScroll(() => {
          reads += 1
          return list.value.length
        })
        return () => h('div')
      }
    })

    mount(Probe)
    await nextTick()
    expect(reads).toBeGreaterThan(0)

    const before = reads
    list.value = [1, 2]
    await nextTick()
    expect(reads).toBeGreaterThan(before)
  })
})

/**
 * Те же грабли у `useFocusTrap`: он тоже принимает геттер (`isActive`) и следит
 * за ним через `watch`, поэтому объявленный ниже ref рвал setup оверлея.
 */
describe('useFocusTrap: порядок объявлений', () => {
  it('не читает isActive во время setup', () => {
    const Probe = defineComponent({
      setup() {
        useFocusTrap(() => layerOpen.value)
        const layerOpen = ref(false)
        return () => h('div')
      }
    })

    expect(() => mount(Probe)).not.toThrow()
  })
})

/**
 * Тот же порядок, но на реальном компоненте: именно так баг и вылез.
 *
 * `ChannelInfoDialog` передавал в `useHScroll` геттер, читающий `TABS`, а тот —
 * `canManage`, объявленный ниже. Setup падал, `main.ts` показывал фатальный
 * экран («Cannot access 'canManage' before initialization»). Тест монтирует
 * диалог у владельца канала: до правки здесь был бы ReferenceError.
 */
describe('ChannelInfoDialog: порядок объявлений', () => {
  /** Упрощённые заглушки Quasar: важен факт монтирования, а не вид. */
  const stubFor = { template: '<div><slot /></div>' }

  it('монтируется у владельца канала, не читая данные раньше объявления', () => {
    expect(() =>
      mount(ChannelInfoDialog, {
        props: { chatId: 1, open: false, role: 'creator' },
        global: {
          directives: { 'close-popup': () => undefined },
          stubs: {
            'q-card': stubFor,
            'q-card-section': stubFor,
            'q-separator': true,
            'q-space': true,
            'q-btn': stubFor,
            'q-icon': stubFor,
            'q-input': stubFor,
            'q-toggle': stubFor,
            'q-spinner': stubFor
          }
        }
      })
    ).not.toThrow()
  })
})
