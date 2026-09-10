import { beforeEach, describe, expect, it } from 'vitest'
import {
  addOutboxItem,
  nextOutboxLocalId,
  patchOutboxItem,
  readOutbox,
  removeOutboxItem,
  writeOutbox,
  type OutboxItem
} from '@/utils/outbox'

const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  id: 'a1',
  localId: -1,
  chatId: 5,
  text: 'привет',
  createdAt: '2026-09-10T12:00:00.000Z',
  state: 'queued',
  ...over
})

describe('очередь сообщений без сети', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('хранит очередь отдельно по пользователю', () => {
    addOutboxItem(1, item())
    addOutboxItem(2, item({ id: 'b1', text: 'другому' }))

    expect(readOutbox(1)).toHaveLength(1)
    expect(readOutbox(1)[0].text).toBe('привет')
    expect(readOutbox(2)[0].text).toBe('другому')
  })

  it('без пользователя ничего не читает и не пишет', () => {
    expect(readOutbox(null)).toEqual([])
    expect(addOutboxItem(null, item())).toEqual([])
    expect(readOutbox(null)).toEqual([])
  })

  it('переживает «перезагрузку» (данные лежат в localStorage)', () => {
    addOutboxItem(1, item())
    expect(readOutbox(1)[0].chatId).toBe(5)
    expect(JSON.parse(localStorage.getItem('pismo_outbox') ?? '{}')).toHaveProperty('1')
  })

  it('меняет состояние и текст ошибки', () => {
    addOutboxItem(1, item())
    const patched = patchOutboxItem(1, 'a1', { state: 'error', error: 'Сервер отказал' })

    expect(patched[0].state).toBe('error')
    expect(patched[0].error).toBe('Сервер отказал')
    expect(readOutbox(1)[0].state).toBe('error')
  })

  it('удаляет отправленное и чистит пустую очередь целиком', () => {
    addOutboxItem(1, item())
    expect(removeOutboxItem(1, 'a1')).toEqual([])
    // Пустой массив не остаётся в хранилище: ключ пользователя удаляем.
    expect(JSON.parse(localStorage.getItem('pismo_outbox') ?? '{}')).not.toHaveProperty('1')
  })

  it('нумерует локальные id вниз, чтобы не столкнуться с серверными', () => {
    expect(nextOutboxLocalId([])).toBe(-1)
    expect(nextOutboxLocalId([item({ localId: -1 }), item({ id: 'b', localId: -4 })])).toBe(-5)
  })

  it('после записи пустого списка очередь пользователя пуста', () => {
    addOutboxItem(1, item())
    writeOutbox(1, [])
    expect(readOutbox(1)).toEqual([])
  })

  it('переживает испорченное значение в хранилище', () => {
    localStorage.setItem('pismo_outbox', 'не json')
    expect(readOutbox(1)).toEqual([])
    expect(addOutboxItem(1, item())).toHaveLength(1)
  })
})
