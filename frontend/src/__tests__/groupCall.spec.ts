import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Групповой звонок «mesh» (пункт B2 плана).
 *
 * Схема полносвязная: каждый участник держит своё соединение с каждым, медиа
 * идёт напрямую (поэтому сквозное шифрование сохраняется — SFU не нужен). Здесь
 * проверяем правила, которые легко сломать незаметно: лимит из четырёх человек,
 * «младший инициирует соединение» (иначе обе стороны начнут одновременно — glare),
 * признак `group` в исходящих сообщениях и состав участников в интерфейсе.
 */
vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return {
    ...actual,
    api: {
      get: vi.fn(async () => ({ data: { ice_servers: [] } })),
      put: vi.fn(async () => ({ data: { ok: true } })),
      post: vi.fn(async () => ({ data: {} }))
    }
  }
})

const source = (path: string): string => readFileSync(path, 'utf8')
const store = source('src/stores/call.ts')
const constants = source('src/stores/call/constants.ts')
const grid = source('src/components/calls/CallGrid.vue')
const overlay = source('src/components/calls/CallOverlay.vue')
const messenger = source('src/views/Messenger.vue')
const backendViews = source('../backend/api_v1/calls/views.py')

describe('лимит участников', () => {
  it('на клиенте и на сервере одинаковый — четыре человека', () => {
    expect(constants).toMatch(/export const MAX_GROUP_PARTICIPANTS = 4/)
    expect(backendViews).toMatch(/MAX_GROUP_CALL_PARTICIPANTS = 4/)
  })

  it('инициатор звонит не больше чем трём собеседникам', () => {
    // Место в звонке занимает он сам — иначе пятый получил бы отказ сервера уже
    // после того, как ему показали окно звонка.
    expect(store).toMatch(/members\.slice\(0, MAX_GROUP_PARTICIPANTS - 1\)/)
  })
})

describe('правила «mesh»', () => {
  it('соединение инициирует младший по id — без одновременных offer', () => {
    expect(store).toMatch(/if \(myId < id\) void this\._offerToPeer\(id\)/)
  })

  it('состав приходит от сервера отдельным сообщением', () => {
    expect(store).toContain("case 'call-peers'")
    expect(backendViews).toContain('_broadcast_group_peers')
    expect(backendViews).toContain('"type": "call-peers"')
  })

  it('входящий offer внутри идущего звонка принимается без окна «звонит»', () => {
    expect(store).toMatch(/_acceptPeerOffer\(from, message\.sdp\)/)
  })

  it('ушедший участник убирается вместе со своим соединением', () => {
    expect(store).toMatch(
      /this\._dropLink\(item\.id\)[\s\S]{0,120}filter\(\(row\) => row\.id !== item\.id\)/
    )
  })

  it('исходящие сообщения помечены как групповые', () => {
    // Без признака `group` сервер не проверит чат и не разошлёт состав.
    expect(store).toMatch(/group: true, chat_id: this\.groupChatId/)
  })
})

describe('интерфейс сетки', () => {
  it('оверлей показывает сетку только в групповом звонке', () => {
    expect(overlay).toContain('<CallGrid v-if="callStore.isGroup" />')
    expect(overlay).toMatch(/!callStore\.isGroup && callStore\.kind === 'video'/)
  })

  it('плитка участника берёт его собственный поток', () => {
    // Раньше в интерфейсе был ровно один удалённый поток — на всех.
    expect(grid).toContain('callStore.remoteStreamOf(participant.id)')
    expect(grid).toContain('grid-mic')
  })

  it('кнопка звонка есть и в группе (но не в канале)', () => {
    expect(messenger).toContain('isGroupCallChat(selectedChat)')
    expect(messenger).toMatch(/is_group[\s\S]{0,80}!chat\.is_channel[\s\S]{0,40}!chat\.is_self/)
  })
})

describe('состав участников в интерфейсе', () => {
  it('новые участники добавляются к списку плиток', () => {
    expect(store).toMatch(
      /const fresh = peers\.filter\(\(id\) => id !== myId && !known\.has\(id\)\)/
    )
    expect(store).toMatch(/this\.participants\.push\(\{/)
  })

  it('ушедшие убираются вместе с соединением', () => {
    expect(store).toMatch(/if \(peers\.includes\(item\.id\)\) continue/)
  })

  it('пока звонок не принят, соединения не поднимаются', () => {
    // Иначе собеседники решили бы, что мы уже в разговоре, хотя микрофон ещё
    // не разрешён (человек не нажал «Ответить»).
    expect(store).toMatch(/if \(this\.status !== 'active' && this\.status !== 'outgoing'\) return/)
  })
})
describe('разговор не рвётся из-за неподключившихся', () => {
  it('отказ одного участника не завершает групповой звонок', () => {
    // Раньше `call-decline` вызывал общий `_cleanup()`: звонок обрывался у всех,
    // как только кто-то один не взял трубку.
    const decline = store.slice(
      store.indexOf("case 'call-decline'"),
      store.indexOf("case 'call-end'")
    )
    expect(decline).toMatch(/this\.isGroup && this\.status === 'active'/)
    expect(decline).toMatch(/this\._dropParticipant\(from\)/)
  })

  it('выход одного участника убирает только его плитку', () => {
    const end = store.slice(
      store.indexOf("case 'call-end'"),
      store.indexOf("case 'call-ended-elsewhere'")
    )
    expect(end).toMatch(/this\._dropParticipant\(from\)/)
    // Звонок завершается только когда в нём никого не осталось.
    expect(end).toMatch(/participants\.length === 0/)
  })

  it('ушедший убирается вместе со своей связью', () => {
    expect(store).toMatch(/this\._dropLink\(peerId\)[\s\S]{0,120}filter/)
  })

  it('Lимит попыток ICE считается на связь, а не на весь звонок', () => {
    // Один собеседник мог так и не подключиться: его неудачи не должны
    // израсходовать лимит у остальных (иначе «связь потеряна» для всех).
    expect(store).toMatch(/link\.iceRestartAttempts >= ICE_RESTART_MAX_ATTEMPTS/)
    expect(store).toMatch(/if \(!this\._hasLiveLink\(\)\)/)
  })

  it('наблюдатель медиа в группе довольствуется живой связью', () => {
    expect(store).toMatch(/results\.some\(Boolean\)/)
  })

  it('если никто не ответил — так и говорим', () => {
    expect(store).toMatch(/this\.notice = this\.isGroup \? 'Никто не ответил'/)
  })
})
