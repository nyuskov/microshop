/**
 * Стек «слоёв» поверх основного экрана: модалки и полноэкранные окна.
 *
 * Зачем отдельный реестр, а не список флагов в `useChatNavigation`: слоёв много
 * (информация о чате, стикеры, папки, пересылка, одноразовое медиа, жалоба …), и
 * «назад» ломается ровно на том слое, который забыли перечислить. Симптом
 * одинаковый во всех случаях: человек открыл модалку, нажал «назад», а приложение
 * либо вышло (модалка вообще не участвовала в истории), либо закрыло чат вместо
 * модалки (шаг ушёл не тому слою).
 *
 * Здесь слой сам о себе сообщает: пока модалка открыта, она в стеке. Отсюда это
 * берут двое — `utils/mobileNav.ts` («назад» закрывает верхний слой) и
 * `composables/useChatNavigation.ts` (на каждый слой — свой шаг в истории
 * браузера, чтобы «назад» шло по слоям по одному, как страницы в браузере).
 *
 * Правило для новой модалки: одна строка рядом с её состоянием —
 * `useMobileLayer(() => myDialogOpen.value, closeMyDialog)`.
 */

import { onScopeDispose, shallowRef, watch, type Ref } from 'vue'

/** Источник состояния: ref-флаг или геттер (`() => flag.value !== null`). */
type OpenSource = Ref<boolean> | (() => boolean)

/** Открытый слой: умеет только закрыть себя. */
interface MobileLayer {
  close: () => void
}

/**
 * Слои в порядке открытия (последний — верхний).
 *
 * Состояние общее для всего приложения: открывают модалки разные компоненты
 * (`Messenger.vue`, оверлеи каналов, профиль, карточка чата), а «назад»
 * обрабатывается в одном месте.
 *
 * `shallowRef`, а не `ref`: массив всегда заменяется целиком, а глубокий proxy
 * подменял бы объекты слоёв при чтении — снятие слоя ищет его по ссылке
 * (`layer !== mine`) и не находило бы ничего.
 */
const layers = shallowRef<MobileLayer[]>([])

/** Сколько слоёв сейчас открыто (нужно `decideBackStep`). */
export function mobileLayerDepth(): number {
  return layers.value.length
}

/** Закрыть верхний слой. `false` — слоёв не было. */
export function closeTopMobileLayer(): boolean {
  const top = layers.value[layers.value.length - 1]
  if (!top) return false
  top.close()
  return true
}

/**
 * Объявить модалку слоем: пока `open` истинно, она в стеке.
 *
 * Слой снимается и при закрытии (`open` стал false), и при исчезновении
 * компонента (например, модалку снесло вместе с закрытым профилем) — иначе
 * «назад» пыталось бы закрыть то, чего на экране нет.
 */
export function useMobileLayer(open: OpenSource, close: () => void): void {
  const read = typeof open === 'function' ? open : () => open.value
  let entry: MobileLayer | null = null

  const sync = (isOpen: boolean): void => {
    if (isOpen && !entry) {
      const mine: MobileLayer = { close }
      entry = mine
      layers.value = [...layers.value, mine]
      return
    }
    if (!isOpen && entry) {
      const mine = entry
      entry = null
      layers.value = layers.value.filter((layer) => layer !== mine)
    }
  }

  // `flush: 'sync'` — чтобы порядок «закрыл модалку → погасил её шаг в истории»
  // сработал внутри того же обработчика, что и смена флага.
  watch(read, sync, { flush: 'sync' })
  sync(read())

  onScopeDispose(() => {
    if (!entry) return
    const mine = entry
    entry = null
    layers.value = layers.value.filter((layer) => layer !== mine)
  })
}
