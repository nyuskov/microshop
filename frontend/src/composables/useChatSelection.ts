import { computed, ref, type ComputedRef, type Ref } from 'vue'

export interface ChatSelectionDeps {
  /** Id чатов в текущем списке — «выбрать все» отмечает их. */
  visibleChatIds: () => number[]
  /** Замьючен ли чат: панель показывает «включить» или «выключить» уведомления. */
  isMuted: (chatId: number) => boolean
  /** Закреплён ли чат. */
  isPinned: (chatId: number) => boolean
  /** Открыть чат (клик по строке вне режима выделения). */
  openChat: (chatId: number) => void
  /** Действия панели — списки id уводим наружу, чтобы стор и API жили в одном месте. */
  onBulkMute: (ids: number[], muted: boolean) => void
  onBulkPin: (ids: number[], pinned: boolean) => void
  onBulkDelete: (ids: number[]) => void
  /** Сколько держать строку, чтобы войти в режим выделения (мс). */
  holdMs?: number
}

export interface ChatSelection {
  /** Режим выделения чатов активен. */
  selectionMode: Ref<boolean>
  /** Отмеченные чаты. */
  selectedIds: Ref<number[]>
  isSelected: (chatId: number) => boolean
  /** Родителю: системная «назад» должна выходить из выделения. */
  isSelecting: () => boolean
  exitSelection: () => void
  toggleSelect: (chatId: number) => void
  /** Всё, что видно в списке, отмечено. */
  allVisibleSelected: ComputedRef<boolean>
  /** Все отмеченные чаты замьючены (тогда панель снимет мьют). */
  selectionAllMuted: ComputedRef<boolean>
  /** Все отмеченные чаты закреплены. */
  selectionAllPinned: ComputedRef<boolean>
  toggleSelectAll: () => void
  onBulkMute: () => void
  onBulkPin: () => void
  onBulkDelete: () => void
  /** Строка списка: удержание открывает режим выделения, клик — выбор/отметку. */
  onRowPointerDown: (chatId: number) => void
  onRowPointerUp: () => void
  onRowPointerCancel: () => void
  onRowClick: (chatId: number) => void
}

/**
 * Режим выделения чатов в списке: вход удержанием строки (~0,5 с), клик —
 * отметить/снять, сверху появляется панель действий (мьют / закрепить /
 * удалить / выбрать все).
 *
 * Логика отделена от разметки: списки id и «как открыть чат» приходят снаружи,
 * а решения (что считается отмеченным, какое действие показать) — здесь, поэтому
 * это можно проверять тестами без DOM.
 */
export function useChatSelection(deps: ChatSelectionDeps): ChatSelection {
  const holdMs = deps.holdMs ?? 480

  const selectionMode = ref(false)
  const selectedIds = ref<number[]>([])

  const isSelected = (chatId: number): boolean => selectedIds.value.includes(chatId)

  const exitSelection = () => {
    selectionMode.value = false
    selectedIds.value = []
  }

  const isSelecting = () => selectionMode.value

  const toggleSelect = (chatId: number) => {
    const next = new Set(selectedIds.value)
    if (next.has(chatId)) {
      next.delete(chatId)
    } else {
      next.add(chatId)
    }
    selectedIds.value = Array.from(next)
    if (selectedIds.value.length === 0) selectionMode.value = false
  }

  let holdTimer: number | null = null
  let suppressClick = false

  const cancelHold = () => {
    if (holdTimer !== null) {
      window.clearTimeout(holdTimer)
      holdTimer = null
    }
  }

  const onRowPointerDown = (chatId: number) => {
    if (selectionMode.value) return
    cancelHold()
    suppressClick = false
    holdTimer = window.setTimeout(() => {
      holdTimer = null
      selectionMode.value = true
      selectedIds.value = [chatId]
      suppressClick = true // клик, которым завершилось удержание, чат не открывает
    }, holdMs)
  }

  const onRowPointerUp = () => {
    cancelHold()
  }

  const onRowPointerCancel = () => {
    cancelHold()
    suppressClick = false
  }

  const onRowClick = (chatId: number) => {
    if (suppressClick) {
      suppressClick = false
      return
    }
    if (selectionMode.value) {
      toggleSelect(chatId)
      return
    }
    deps.openChat(chatId)
  }

  const allVisibleSelected = computed<boolean>(() => {
    const visible = deps.visibleChatIds()
    return visible.length > 0 && visible.every((id) => selectedIds.value.includes(id))
  })

  const selectionAllMuted = computed<boolean>(() => {
    if (selectedIds.value.length === 0) return false
    return selectedIds.value.every((id) => deps.isMuted(id))
  })

  const selectionAllPinned = computed<boolean>(() => {
    if (selectedIds.value.length === 0) return false
    return selectedIds.value.every((id) => deps.isPinned(id))
  })

  const toggleSelectAll = () => {
    if (allVisibleSelected.value) {
      exitSelection()
    } else {
      selectedIds.value = deps.visibleChatIds()
      if (selectedIds.value.length === 0) selectionMode.value = false
    }
  }

  const onBulkMute = () => {
    const ids = [...selectedIds.value]
    if (ids.length === 0) return
    const muted = !selectionAllMuted.value
    exitSelection()
    deps.onBulkMute(ids, muted)
  }

  const onBulkPin = () => {
    const ids = [...selectedIds.value]
    if (ids.length === 0) return
    const pinned = !selectionAllPinned.value
    exitSelection()
    deps.onBulkPin(ids, pinned)
  }

  const onBulkDelete = () => {
    const ids = [...selectedIds.value]
    if (ids.length === 0) return
    exitSelection()
    deps.onBulkDelete(ids)
  }

  return {
    selectionMode,
    selectedIds,
    isSelected,
    isSelecting,
    exitSelection,
    toggleSelect,
    allVisibleSelected,
    selectionAllMuted,
    selectionAllPinned,
    toggleSelectAll,
    onBulkMute,
    onBulkPin,
    onBulkDelete,
    onRowPointerDown,
    onRowPointerUp,
    onRowPointerCancel,
    onRowClick
  }
}
