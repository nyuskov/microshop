/**
 * Стек модалок: кто в нём и в каком порядке закрывается.
 *
 * Тест стережёт ровно то, на чём ломалось «назад» на телефоне: модалка должна
 * попадать в стек (иначе «назад» её не видит и закрывает то, что под ней, или
 * выходит из приложения), сниматься при закрытии любым способом (иначе в
 * истории остаётся пустой шаг) и закрываться сверху вниз — по одной за раз.
 */

import { describe, expect, it } from 'vitest'
import { effectScope, ref } from 'vue'

import {
  closeTopMobileLayer,
  mobileLayerDepth,
  useMobileLayer
} from '@/composables/useMobileOverlay'

/** Модалка: флаг «открыто» и счётчик закрытий. */
const modal = (open = false) => {
  const isOpen = ref(open)
  const closed: string[] = []
  return { isOpen, closed, close: () => closed.push('closed') }
}

describe('useMobileLayer', () => {
  it('регистрирует открытую модалку и снимает её при закрытии', () => {
    const scope = effectScope()
    const one = modal(true)
    scope.run(() => useMobileLayer(() => one.isOpen.value, one.close))

    expect(mobileLayerDepth()).toBe(1)

    one.isOpen.value = false
    expect(mobileLayerDepth()).toBe(0)

    scope.stop()
  })

  it('поддерживает и ref-флаг, и геттер по объекту', () => {
    const scope = effectScope()
    const flag = ref(false)
    const target = ref<{ id: number } | null>({ id: 1 })
    scope.run(() => useMobileLayer(flag, () => {}))
    scope.run(() =>
      useMobileLayer(
        () => target.value !== null,
        () => {}
      )
    )

    expect(mobileLayerDepth()).toBe(1)

    flag.value = true
    expect(mobileLayerDepth()).toBe(2)

    target.value = null
    expect(mobileLayerDepth()).toBe(1)

    scope.stop()
  })

  it('закрывает верхний слой первым (по одной за раз)', () => {
    const scope = effectScope()
    const first = modal(true)
    const second = modal(true)
    scope.run(() =>
      useMobileLayer(
        () => first.isOpen.value,
        () => {
          first.isOpen.value = false
        }
      )
    )
    scope.run(() =>
      useMobileLayer(
        () => second.isOpen.value,
        () => {
          second.isOpen.value = false
        }
      )
    )

    expect(mobileLayerDepth()).toBe(2)

    expect(closeTopMobileLayer()).toBe(true)
    expect(second.isOpen.value).toBe(false)
    expect(first.isOpen.value).toBe(true)
    expect(mobileLayerDepth()).toBe(1)

    expect(closeTopMobileLayer()).toBe(true)
    expect(mobileLayerDepth()).toBe(0)
    expect(closeTopMobileLayer()).toBe(false)

    scope.stop()
  })

  it('снимает слой, когда модалка исчезла вместе с компонентом', () => {
    const scope = effectScope()
    const panel = modal(true)
    scope.run(() => useMobileLayer(() => panel.isOpen.value, panel.close))

    expect(mobileLayerDepth()).toBe(1)

    // Модалку снесло вместе с родителем (например, закрыли профиль): слоя быть
    // не должно, иначе «назад» попытается закрыть то, чего на экране нет.
    scope.stop()
    expect(mobileLayerDepth()).toBe(0)
  })

  it('двойная регистрация одного состояния не дублирует слой', () => {
    const scope = effectScope()
    const dialog = modal(false)
    scope.run(() => useMobileLayer(() => dialog.isOpen.value, dialog.close))

    dialog.isOpen.value = true
    dialog.isOpen.value = true
    expect(mobileLayerDepth()).toBe(1)

    scope.stop()
    expect(mobileLayerDepth()).toBe(0)
  })
})
