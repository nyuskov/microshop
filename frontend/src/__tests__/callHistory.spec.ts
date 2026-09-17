import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  CALL_FILTERS,
  callHistoryDay,
  callHistoryIcon,
  callHistoryLabel,
  callHistoryTime,
  callPeerName,
  filterCallHistory,
  formatCallDuration,
  isMissedCall,
  matchesCallFilter,
  type CallHistoryItem
} from '@/utils/callHistory'

/**
 * Экран «Звонки» (пункт B5 плана улучшений).
 *
 * Записи о звонках уже лежали в чатах системными сообщениями, но отдельного
 * экрана не было: чтобы понять «кто звонил и не дождался», приходилось
 * открывать чаты по одному. Здесь проверяем правила показа записи — исход,
 * направление, длительность, фильтр «Пропущенные» и разделители дней.
 */
const call = (patch: Partial<CallHistoryItem> = {}): CallHistoryItem => ({
  id: 1,
  chat_id: 40,
  peer: {
    id: 7,
    username: 'peer',
    first_name: 'Вася',
    last_name: 'Петров',
    avatar_url: null
  } as CallHistoryItem['peer'],
  call_kind: 'audio',
  call_state: 'completed',
  call_duration: 125,
  timestamp: new Date(2026, 8, 17, 14, 5).toISOString(),
  outgoing: true,
  ...patch
})

describe('isMissedCall', () => {
  it('пропущенный — только входящий звонок без разговора', () => {
    expect(isMissedCall(call({ call_state: 'missed', outgoing: false }))).toBe(true)
    expect(isMissedCall(call({ call_state: 'missed', outgoing: true }))).toBe(false)
    expect(isMissedCall(call({ call_state: 'completed' }))).toBe(false)
  })

  it('«отклонённый» — не пропущенный: решение человек уже принял', () => {
    // Иначе фильтр «Пропущенные» забивался бы отказами, которые искали осознанно.
    expect(isMissedCall(call({ call_state: 'declined', outgoing: false }))).toBe(false)
  })
})

describe('иконка записи', () => {
  it('пропущенный входящий — значок пропущенного', () => {
    expect(callHistoryIcon(call({ call_state: 'missed', outgoing: false }))).toBe('call_missed')
  })

  it('состоявшийся звонок — тип связи', () => {
    expect(callHistoryIcon(call())).toBe('call')
    expect(callHistoryIcon(call({ call_kind: 'video' }))).toBe('videocam')
  })

  it('отказ — сброшенный звонок', () => {
    expect(callHistoryIcon(call({ call_state: 'declined' }))).toBe('call_end')
  })

  it('исходящий пропущенный (не ответили) — не красный значок пропущенного', () => {
    // Я звонил, а не мне: «пропущенный» здесь читалось бы наоборот.
    expect(callHistoryIcon(call({ call_state: 'missed', outgoing: true }))).toBe('call')
  })
})

describe('formatCallDuration', () => {
  it('минуты и секунды', () => {
    expect(formatCallDuration(125)).toBe('2:05')
    expect(formatCallDuration(9)).toBe('0:09')
  })

  it('час и больше — с часами', () => {
    expect(formatCallDuration(3600)).toBe('1:00:00')
    expect(formatCallDuration(3725)).toBe('1:02:05')
  })

  it('без разговора длительности нет', () => {
    expect(formatCallDuration(0)).toBe('')
    expect(formatCallDuration(-5)).toBe('')
  })
})

describe('callHistoryLabel', () => {
  it('состоявшийся: направление, тип и длительность', () => {
    expect(callHistoryLabel(call())).toBe('Исходящий · Аудио · 2:05')
    expect(callHistoryLabel(call({ outgoing: false, call_kind: 'video' }))).toBe(
      'Входящий · Видео · 2:05'
    )
  })

  it('без разговора длительность не показываем', () => {
    expect(callHistoryLabel(call({ call_duration: 0 }))).toBe('Исходящий · Аудио')
  })

  it('входящий пропущенный — просто «Пропущенный»', () => {
    expect(
      callHistoryLabel(call({ call_state: 'missed', outgoing: false, call_duration: 0 }))
    ).toBe('Пропущенный')
  })

  it('отказ читается по-разному: «отклонён» против «не ответили»', () => {
    expect(callHistoryLabel(call({ call_state: 'declined', outgoing: true }))).toBe(
      'Аудио · отклонён'
    )
    expect(callHistoryLabel(call({ call_state: 'declined', outgoing: false }))).toBe(
      'Аудио · не ответили'
    )
  })
})

describe('фильтр и группировка', () => {
  const items = [
    call({ id: 1, call_state: 'missed', outgoing: false }),
    call({ id: 2, call_state: 'completed' }),
    call({ id: 3, call_state: 'declined', outgoing: true })
  ]

  it('«Все» показывает всё, «Пропущенные» — только входящие без ответа', () => {
    expect(filterCallHistory(items, 'all')).toHaveLength(3)
    expect(filterCallHistory(items, 'missed').map((item) => item.id)).toEqual([1])
  })

  it('фильтры списка перечислены в порядке «Все → Пропущенные»', () => {
    expect(CALL_FILTERS.map((filter) => filter.key)).toEqual(['all', 'missed'])
    expect(matchesCallFilter(items[1], 'all')).toBe(true)
    expect(matchesCallFilter(items[1], 'missed')).toBe(false)
  })

  it('разделитель дня берётся из локального времени', () => {
    const today = new Date()
    const label = callHistoryDay(call({ timestamp: today.toISOString() }))
    expect(label).toBe('Сегодня')
  })

  it('время сегодня — «ЧЧ:ММ», раньше — датой', () => {
    // Дату берём от «сегодня»: с жёстким 17.09.2026 тест протухал на следующий день.
    const today = new Date()
    today.setHours(14, 5, 0, 0)
    expect(callHistoryTime(call({ timestamp: today.toISOString() }))).toBe('14:05')
    // Для прошлых дней в строке чата времени нет (как в списке чатов) — «10 сент.».
    const earlier = new Date(2026, 8, 10, 9, 30)
    expect(callHistoryTime(call({ timestamp: earlier.toISOString() }))).toBe('10 сент.')
  })
})

describe('callPeerName', () => {
  it('имя и фамилия собеседника', () => {
    expect(callPeerName(call())).toBe('Вася Петров')
  })

  it('только логин, если имя не заполнено', () => {
    expect(
      callPeerName(
        call({
          peer: { id: 7, username: 'vasya', first_name: null, last_name: null } as never
        })
      )
    ).toBe('vasya')
  })

  it('удалённый аккаунт — заглушка, а не пустая строка', () => {
    expect(callPeerName(call({ peer: null }))).toBe('Удалённый аккаунт')
  })
})

/**
 * Связка с сервером и интерфейсом: экран бесполезен, если его неоткуда открыть
 * или если сервер не отдаёт записи. Проверяем по исходникам — это дешевле и
 * надёжнее, чем монтировать Messenger целиком.
 */
describe('связка с API и меню', () => {
  const source = (path: string) => readFileSync(path, 'utf8')

  it('сервис запрашивает историю звонков с пагинацией', () => {
    const service = source('src/services/callHistory.ts')
    expect(service).toContain("'/calls/history/'")
    expect(service).toContain('limit')
    expect(service).toContain('offset')
  })

  it('в меню «⋯» списка чатов есть пункт «Звонки»', () => {
    const header = source('src/components/messenger/SidebarHeader.vue')
    expect(header).toContain("key: 'calls'")
    expect(header).toContain("emit('open-calls')")
  })

  it('Messenger открывает экран и умеет перезвонить и открыть чат', () => {
    const messenger = source('src/views/Messenger.vue')
    expect(messenger).toContain('CallHistoryDialog')
    expect(messenger).toContain('callBackFromHistory')
    expect(messenger).toContain('openChatFromCalls')
    // «Перезвонить» сохраняет тип звонка: видео — видео, аудио — аудио.
    expect(messenger).toContain("item.call_kind === 'video' ? 'video' : 'audio'")
  })

  it('экран подключается лениво — чанк не тянется при входе в приложение', () => {
    const messenger = source('src/views/Messenger.vue')
    expect(messenger).toMatch(/CallHistoryDialog = defineAsyncComponent/)
  })
})
