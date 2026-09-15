import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatSelection, type ChatSelectionDeps } from '@/composables/useChatSelection'

/**
 * Режим выделения чатов: удержание строки, отметки и действия панели.
 * Логика больше не живёт в разметке сайдбара, поэтому проверяется без DOM.
 */
const makeSelection = (overrides: Partial<ChatSelectionDeps> = {}) => {
  const muted = new Set<number>([2])
  const pinned = new Set<number>([3])
  const archived = new Set<number>([4])
  const opened: number[] = []
  const bulk: { kind: string; ids: number[]; value?: boolean }[] = []
  const selection = useChatSelection({
    visibleChatIds: () => [1, 2, 3],
    isMuted: (id) => muted.has(id),
    isPinned: (id) => pinned.has(id),
    isArchived: (id) => archived.has(id),
    openChat: (id) => opened.push(id),
    onBulkMute: (ids, value) => bulk.push({ kind: 'mute', ids, value }),
    onBulkPin: (ids, value) => bulk.push({ kind: 'pin', ids, value }),
    onBulkArchive: (ids, value) => bulk.push({ kind: 'archive', ids, value }),
    onBulkDelete: (ids) => bulk.push({ kind: 'delete', ids }),
    ...overrides
  })
  // 4 — чат из архива, его не видно в списке, но он нужен для проверки панели.
  return { selection, opened, bulk, archived }
}

beforeEach(() => {
  vi.useFakeTimers()
})

/**
 * Войти в режим выделения так, как это делает человек: удержать строку и отпустить
 * её — клик, которым завершается удержание, поглощается (чат не переключается и не
 * снимает отметку).
 */
const hold = (selection: ReturnType<typeof makeSelection>['selection'], chatId: number) => {
  selection.onRowPointerDown(chatId)
  vi.advanceTimersByTime(480)
  selection.onRowPointerUp()
  selection.onRowClick(chatId)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('вход в режим выделения', () => {
  it('удержание строки включает режим и отмечает этот чат', () => {
    const { selection } = makeSelection()

    selection.onRowPointerDown(1)
    expect(selection.selectionMode.value).toBe(false)

    vi.advanceTimersByTime(480)
    expect(selection.selectionMode.value).toBe(true)
    expect(selection.selectedIds.value).toEqual([1])
  })

  it('короткое касание режим не включает', () => {
    const { selection } = makeSelection()

    selection.onRowPointerDown(1)
    vi.advanceTimersByTime(200)
    selection.onRowPointerUp()
    vi.advanceTimersByTime(1000)

    expect(selection.selectionMode.value).toBe(false)
    expect(selection.selectedIds.value).toEqual([])
  })

  it('клик, которым завершилось удержание, чат не открывает', () => {
    const { selection, opened } = makeSelection()

    selection.onRowPointerDown(2)
    vi.advanceTimersByTime(480)
    selection.onRowClick(2)

    expect(opened).toEqual([])
    expect(selection.selectedIds.value).toEqual([2])
  })

  it('в режиме выделения клик отмечает и снимает чат', () => {
    const { selection } = makeSelection()

    hold(selection, 1)
    selection.onRowClick(3)
    expect(selection.selectedIds.value).toEqual([1, 3])

    selection.onRowClick(3)
    expect(selection.selectedIds.value).toEqual([1])
  })

  it('снятие последней отметки выходит из режима', () => {
    const { selection } = makeSelection()

    hold(selection, 1)
    selection.onRowClick(1)

    expect(selection.selectedIds.value).toEqual([])
    expect(selection.selectionMode.value).toBe(false)
  })

  it('вне режима клик открывает чат', () => {
    const { selection, opened } = makeSelection()

    selection.onRowClick(2)

    expect(opened).toEqual([2])
  })
})

describe('панель действий', () => {
  it('«выбрать все» отмечает видимые чаты, повторный вызов снимает всё', () => {
    const { selection } = makeSelection()

    selection.onRowPointerDown(1)
    vi.advanceTimersByTime(480)
    selection.toggleSelectAll()

    expect(selection.allVisibleSelected.value).toBe(true)
    expect(selection.selectedIds.value).toEqual([1, 2, 3])

    selection.toggleSelectAll()
    expect(selection.selectionMode.value).toBe(false)
  })

  it('пустой список ничего не выбирает и не роняет режим', () => {
    const { selection } = makeSelection({ visibleChatIds: () => [] })

    selection.onRowPointerDown(1)
    vi.advanceTimersByTime(480)
    selection.toggleSelectAll()

    expect(selection.selectedIds.value).toEqual([])
    expect(selection.selectionMode.value).toBe(false)
  })

  it('мьют: включает уведомления, если замьючены не все выбранные', () => {
    const { selection, bulk } = makeSelection()

    selection.onRowPointerDown(1)
    vi.advanceTimersByTime(480)
    selection.onBulkMute()

    expect(bulk).toEqual([{ kind: 'mute', ids: [1], value: true }])
    expect(selection.selectionMode.value).toBe(false)
  })

  it('мьют: выключает уведомления, если замьючены все выбранные', () => {
    const { selection, bulk } = makeSelection()

    selection.onRowPointerDown(2)
    vi.advanceTimersByTime(480)
    expect(selection.selectionAllMuted.value).toBe(true)
    selection.onBulkMute()

    expect(bulk).toEqual([{ kind: 'mute', ids: [2], value: false }])
  })

  it('закрепление отдаёт обратное текущему состоянию значение', () => {
    const { selection, bulk } = makeSelection()

    selection.onRowPointerDown(3)
    vi.advanceTimersByTime(480)
    expect(selection.selectionAllPinned.value).toBe(true)
    selection.onBulkPin()

    expect(bulk).toEqual([{ kind: 'pin', ids: [3], value: false }])
  })

  it('архив: чат ещё в списке — архивируем', () => {
    const { selection, bulk } = makeSelection()

    hold(selection, 1)
    expect(selection.selectionAllArchived.value).toBe(false)
    selection.onBulkArchive()

    expect(bulk).toEqual([{ kind: 'archive', ids: [1], value: true }])
    expect(selection.selectionMode.value).toBe(false)
  })

  it('архив: всё выбранное уже в архиве — вынимаем', () => {
    const { selection, bulk } = makeSelection({ visibleChatIds: () => [1, 2, 4] })

    selection.onRowPointerDown(4)
    vi.advanceTimersByTime(480)
    expect(selection.selectionAllArchived.value).toBe(true)
    selection.onBulkArchive()

    expect(bulk).toEqual([{ kind: 'archive', ids: [4], value: false }])
  })

  it('удаление отдаёт отмеченные чаты и выходит из режима', () => {
    const { selection, bulk } = makeSelection()

    hold(selection, 1)
    selection.onRowClick(2)
    selection.onBulkDelete()

    expect(bulk).toEqual([{ kind: 'delete', ids: [1, 2] }])
    expect(selection.selectedIds.value).toEqual([])
    expect(selection.selectionMode.value).toBe(false)
  })

  it('без отметок действия ничего не делают', () => {
    const { selection, bulk } = makeSelection()

    selection.onBulkMute()
    selection.onBulkPin()
    selection.onBulkArchive()
    selection.onBulkDelete()

    expect(bulk).toEqual([])
  })
})
