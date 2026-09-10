import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCallStore } from '@/stores/call'

/** Предложение звонка, как оно приходит по сигнальному каналу. */
const callOffer = (callId: string, from: number) => ({
  type: 'call-offer' as const,
  from_user_id: from,
  call_id: callId,
  kind: 'audio' as const,
  sdp: 'v=0'
})

describe('повторная доставка вызова', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('во время разговора не начинает звонок заново', () => {
    const call = useCallStore()
    call.$patch({ status: 'active', callId: 'call-1', peerId: 7 })

    call._handleMessage(callOffer('call-1', 7))

    expect(call.status).toBe('active')
    // Интерфейс по этому счётчику гасит задержавшееся уведомление о звонке.
    expect(call.ignoredCallOffers).toBe(1)
  })

  it('во время входящего не сбрасывает ожидание ответа', () => {
    const call = useCallStore()
    call.$patch({ status: 'incoming', callId: 'call-2', peerId: 7 })

    call._handleMessage(callOffer('call-2', 7))

    expect(call.status).toBe('incoming')
    expect(call.ignoredCallOffers).toBe(1)
  })

  it('чужой вызов считает повтором только свой звонок', () => {
    const call = useCallStore()
    call.$patch({ status: 'active', callId: 'call-3', peerId: 7 })

    call._handleMessage(callOffer('call-4', 9))

    expect(call.status).toBe('active')
    expect(call.ignoredCallOffers).toBe(0)
  })
})

describe('service worker', () => {
  const sw = readFileSync('public/sw.js', 'utf8')

  it('при открытом приложении не показывает системный «будильник» для звонка', () => {
    // Иначе во время уже идущего разговора телефон «звонит» второй раз.
    expect(sw).toContain('async function hasVisibleClient()')
    const callBranch = sw.slice(sw.indexOf("if (data.type === 'call') {"))
    expect(callBranch).toContain('await hasVisibleClient()')
    expect(callBranch.indexOf('hasVisibleClient()')).toBeLessThan(
      callBranch.indexOf('showNotification')
    )
  })

  it('обработчик push дожидается асинхронной проверки окна', () => {
    expect(sw).toContain('event.waitUntil(handlePush(event))')
    expect(sw).toContain('async function handlePush(event)')
  })
})
