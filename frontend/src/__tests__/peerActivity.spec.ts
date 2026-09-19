import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { effectScope } from 'vue'

import { usePeerActivity } from '@/composables/usePeerActivity'
import { chatActivityKind } from '@/utils/chatPreview'
import {
  PEER_ACTIVITY_KINDS,
  PEER_ACTIVITY_TTL_MS,
  activityKindOfFile,
  isPeerActivityKind,
  peerActivityLabel
} from '@/utils/peerActivity'
import type { Chat, ChatUser } from '@/types'

/**
 * Виды активности собеседника.
 *
 * Раньше был один индикатор — «печатает…». Теперь клиент сообщает, ЧЕМ занят
 * человек: записывает голосовое, отправляет фото или файл. Здесь проверяем
 * словарь видов, подписи, время жизни подписи и согласованность списка видов с
 * сервером: он отбрасывает незнакомые значения, и если списки разойдутся, подпись
 * молча пропадёт (ни ошибки, ни пустой строки — просто «ничего»).
 */

const user = (id: number): ChatUser =>
  ({ id, username: `u${id}`, first_name: `Имя${id}`, last_name: '' }) as unknown as ChatUser

const chat = (patch: Partial<Chat> = {}): Chat =>
  ({
    id: 7,
    name: 'Чат',
    is_group: false,
    is_self: false,
    is_channel: false,
    unread_count: 0,
    users: [user(1), user(2)],
    ...patch
  }) as unknown as Chat

afterEach(() => {
  vi.useRealTimers()
})

describe('подписи видов активности', () => {
  it('без имени — просто действие, с именем — кто именно', () => {
    expect(peerActivityLabel('text')).toBe('печатает…')
    expect(peerActivityLabel('text', 'Аня')).toBe('Аня печатает…')
    expect(peerActivityLabel('voice', '  Аня  ')).toBe('Аня записывает голосовое…')
  })

  it('у каждого вида есть своя подпись: виды не должны выглядеть одинаково', () => {
    const labels = PEER_ACTIVITY_KINDS.map((kind) => peerActivityLabel(kind))

    expect(new Set(labels).size).toBe(PEER_ACTIVITY_KINDS.length)
    for (const label of labels) expect(label).not.toBe('')
  })

  it('незнакомое значение не считается видом (сервер присылает строку из сети)', () => {
    expect(isPeerActivityKind('voice')).toBe(true)
    expect(isPeerActivityKind('голос')).toBe(false)
    expect(isPeerActivityKind(undefined)).toBe(false)
  })

  it('вид по файлу: фото, видео и всё остальное', () => {
    expect(activityKindOfFile({ type: 'image/jpeg' })).toBe('photo')
    expect(activityKindOfFile({ type: 'video/mp4' })).toBe('video')
    expect(activityKindOfFile({ type: 'application/pdf' })).toBe('file')
    expect(activityKindOfFile({})).toBe('file')
  })
})

describe('список видов согласован с сервером', () => {
  it('те же виды, что проверяет сервер', () => {
    // Сервер отбрасывает незнакомый вид и подставляет набор текста — то есть
    // новый вид, добавленный только на клиенте, просто не покажется.
    const server = readFileSync(
      path.resolve(import.meta.dirname, '../../../backend/api_v1/events/views.py'),
      'utf8'
    )
    const match = /TYPING_KINDS = frozenset\(\{([^}]*)\}\)/.exec(server)

    expect(match).not.toBeNull()
    const serverKinds = [...(match?.[1] ?? '').matchAll(/"([a-z_]+)"/g)].map((item) => item[1])
    expect([...PEER_ACTIVITY_KINDS].sort()).toEqual(serverKinds.sort())
  })
})

describe('состояние активности на клиенте', () => {
  const make = () => {
    const scope = effectScope()
    const activity = scope.run(() => usePeerActivity({ isMe: (id) => id === 1 }))!
    return { scope, activity }
  }

  it('запоминает вид и сбрасывается по «закончил»', () => {
    const { scope, activity } = make()
    activity.markPeerActivity(7, 2, 'voice')

    expect(activity.peerActivityOf(7)).toEqual({ userId: 2, kind: 'voice' })
    expect(activity.isPeerTyping(7)).toBe(false)

    activity.clearPeerActivity(7)
    expect(activity.peerActivityOf(7)).toBeNull()
    scope.stop()
  })

  it('неизвестный вид приводится к набору текста, а не пропадает', () => {
    const { scope, activity } = make()
    activity.markPeerActivity(7, 2, 'что-то своё')

    expect(activity.peerActivityOf(7)?.kind).toBe('text')
    scope.stop()
  })

  it('своя же активность не показывается (иначе вижу «печатает…» у себя)', () => {
    const { scope, activity } = make()
    activity.markPeerActivity(7, 1, 'photo')

    expect(activity.peerActivityOf(7)).toBeNull()
    scope.stop()
  })

  it('подпись гаснет сама: человек исчез посреди записи — подпись не залипает', () => {
    vi.useFakeTimers()
    const { scope, activity } = make()
    activity.markPeerActivity(7, 2, 'voice')

    vi.advanceTimersByTime(PEER_ACTIVITY_TTL_MS.voice - 100)
    expect(activity.peerActivityOf(7)?.kind).toBe('voice')

    vi.advanceTimersByTime(500)
    expect(activity.peerActivityOf(7)).toBeNull()
    scope.stop()
  })

  it('новая активность продлевает подпись (запись длиннее одного события)', () => {
    vi.useFakeTimers()
    const { scope, activity } = make()
    activity.markPeerActivity(7, 2, 'voice')
    vi.advanceTimersByTime(PEER_ACTIVITY_TTL_MS.voice - 500)
    // Клиент повторяет событие, пока человек записывает.
    activity.markPeerActivity(7, 2, 'voice')
    vi.advanceTimersByTime(PEER_ACTIVITY_TTL_MS.voice - 500)

    expect(activity.peerActivityOf(7)?.kind).toBe('voice')
    scope.stop()
  })
})

describe('строка списка чатов', () => {
  it('вид показываем только в личном чате: в группе подпись без имени бесполезна', () => {
    expect(chatActivityKind(chat({ id: 5 }), { 5: 'photo' })).toBe('photo')
    expect(chatActivityKind(chat({ id: 5 }), { 6: 'photo' })).toBeNull()
    expect(
      chatActivityKind(chat({ id: 5, is_group: true, users: [user(1), user(2), user(3)] }), {
        5: 'photo'
      })
    ).toBeNull()
  })
})
