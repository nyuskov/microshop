import { readFileSync } from 'node:fs'

import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import MessageRow from '@/components/messenger/MessageRow.vue'
import type { Message } from '@/types'

/**
 * Свайпы по сообщению: вправо — ответ, влево — пересылка.
 *
 * Вправо свайп-ответ был и раньше (порог 56 из 84), теперь он парный: та же
 * протяжка влево пересылает сообщение — то же действие, что кнопка «Переслать»
 * в панели под сообщением. Стороны проверяем вместе, чтобы они не разъехались:
 * значок появляется ровно с той стороны, куда тянут, а порог у них общий.
 *
 * Выключено: режим выделения (там строка помечается тапом, а не жестом) и
 * одноразовые вложения — пересылку сервер запрещает, поэтому влево строка даже
 * не тянется.
 */

const message = {
  id: 1,
  chat_id: 7,
  user_id: 2,
  text: 'привет',
  timestamp: '2026-09-19T00:00:00Z',
  reply_to_id: null,
  is_read: true,
  is_pinned: false,
  edited_at: null,
  file: null,
  reactions: [],
  forwarded_from: null,
  view_once: false
} as unknown as Message

const viewOnceMessage = { ...message, view_once: true } as unknown as Message

function mountRow(overrides: Record<string, unknown> = {}) {
  return mount(MessageRow, {
    props: {
      message,
      isOwn: false,
      viewerId: 1,
      highlighted: false,
      emojiPickerOpen: false,
      quote: null,
      selectionMode: false,
      selected: false,
      selectable: true,
      ...overrides
    },
    global: { stubs: { 'q-icon': true } },
    attachTo: document.body
  })
}

/** Касание пальцем: событие мыши плюс поля указателя (в jsdom нет PointerEvent). */
function pointerEvent(type: string, x: number, y: number): Event {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  Object.defineProperty(event, 'pointerType', { value: 'touch' })
  Object.defineProperty(event, 'isPrimary', { value: true })
  return event
}

/** Итог протяжки: как поехала строка и какие подсказки показались ДО отпускания. */
interface DragResult {
  transform: string
  replyHint: boolean
  forwardHint: boolean
  replyReady: boolean
  forwardReady: boolean
}

async function drag(wrapper: ReturnType<typeof mountRow>, dx: number, dy = 0): Promise<DragResult> {
  const row = wrapper.find('.msg').element as HTMLElement
  row.dispatchEvent(pointerEvent('pointerdown', 200, 300))
  row.dispatchEvent(pointerEvent('pointermove', 200 + dx, 300 + dy))
  await nextTick()

  const reply = wrapper.find('.swipe-reply')
  const forward = wrapper.find('.swipe-forward')
  const result: DragResult = {
    transform: row.style.transform,
    replyHint: reply.exists(),
    forwardHint: forward.exists(),
    replyReady: reply.exists() && reply.classes().includes('ready'),
    forwardReady: forward.exists() && forward.classes().includes('ready')
  }

  row.dispatchEvent(pointerEvent('pointerup', 200 + dx, 300 + dy))
  await nextTick()
  return result
}

describe('свайпы по сообщению', () => {
  it('влево до порога — «Переслать»', async () => {
    const wrapper = mountRow()

    const result = await drag(wrapper, -80)

    expect(wrapper.emitted('forward')).toHaveLength(1)
    expect(wrapper.emitted('set-reply')).toBeUndefined()
    expect(result.transform).toContain('translateX(-80px)')
    wrapper.unmount()
  })

  it('вправо до порога — ответ (как было)', async () => {
    const wrapper = mountRow()

    const result = await drag(wrapper, 80)

    expect(wrapper.emitted('set-reply')).toHaveLength(1)
    expect(wrapper.emitted('forward')).toBeUndefined()
    expect(result.transform).toContain('translateX(80px)')
    wrapper.unmount()
  })

  it('значок жеста появляется с той стороны, куда тянут, и загорается на пороге', async () => {
    const wrapper = mountRow()

    const short = await drag(wrapper, -40)
    expect(short.forwardHint).toBe(true)
    expect(short.replyHint).toBe(false)
    expect(short.forwardReady).toBe(false)

    const far = await drag(wrapper, -80)
    expect(far.forwardReady).toBe(true)
    // В ответную сторону — зеркально: значок слева, справа ничего нет.
    expect(far.replyHint).toBe(false)

    const reply = await drag(wrapper, 80)
    expect(reply.replyHint).toBe(true)
    expect(reply.forwardHint).toBe(false)
    expect(reply.replyReady).toBe(true)
    wrapper.unmount()
  })

  it('недотянутая протяжка ничего не делает', async () => {
    const wrapper = mountRow()

    await drag(wrapper, -40)
    await drag(wrapper, 40)

    expect(wrapper.emitted('forward')).toBeUndefined()
    expect(wrapper.emitted('set-reply')).toBeUndefined()
    wrapper.unmount()
  })

  it('вертикальная протяжка — это прокрутка ленты, а не жест', async () => {
    const wrapper = mountRow()

    const result = await drag(wrapper, 60, -60)

    expect(result.transform).toBe('')
    expect(result.forwardHint).toBe(false)
    expect(result.replyHint).toBe(false)
    expect(wrapper.emitted('set-reply')).toBeUndefined()
    expect(wrapper.emitted('forward')).toBeUndefined()
    wrapper.unmount()
  })

  it('одноразовое вложение влево не тянется: пересылка запрещена сервером', async () => {
    const wrapper = mountRow({ message: viewOnceMessage })

    const result = await drag(wrapper, -80)

    expect(wrapper.emitted('forward')).toBeUndefined()
    expect(result.transform).toBe('')
    expect(result.forwardHint).toBe(false)
    wrapper.unmount()
  })

  it('в режиме выделения свайпы выключены', async () => {
    const wrapper = mountRow({ selectionMode: true })

    await drag(wrapper, 80)
    await drag(wrapper, -80)

    expect(wrapper.emitted('set-reply')).toBeUndefined()
    expect(wrapper.emitted('forward')).toBeUndefined()
    wrapper.unmount()
  })

  it('жест пересылки уходит тем же событием, что кнопка в панели действий', () => {
    // Строка сама ничего не открывает: `forward` поднимается до Messenger, где
    // на него подписан диалог пересылки — как у кнопки «Переслать» в панели.
    const row = readFileSync('src/components/messenger/MessageRow.vue', 'utf8')
    const thread = readFileSync('src/components/messenger/MessageThread.vue', 'utf8')

    expect(row).toContain("else if (swipeForwardReady.value) emit('forward')")
    expect(row).toContain(`@forward="emit('forward')"`)
    expect(thread).toContain(`@forward="emit('forward', item.row.message)"`)
  })
})
