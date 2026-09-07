/**
 * Кнопка звонка в шапке чата:
 * короткий клик — начать звонок выбранного типа,
 * удержание ~0,5 c — переключить тип (аудио ⇄ видео), не звоня.
 */
import { onScopeDispose, ref } from 'vue'

export interface CallButtonOptions {
  /** Вызывается по короткому клику (без удержания). */
  onTap: () => void
}

export type CallKind = 'audio' | 'video'

const CALL_OPTIONS: ReadonlyArray<{ kind: CallKind; label: string }> = [
  { kind: 'audio', label: 'Голосовой звонок' },
  { kind: 'video', label: 'Видеозвонок' }
]

// Текущий выбранный тип звонка запоминается между сессиями.
const CALL_KIND_KEY = 'microshop_call_kind'
const CALL_HOLD_MS = 500

export function useCallButton(options: CallButtonOptions) {
  const callKind = ref<CallKind>(
    (() => {
      try {
        return localStorage.getItem(CALL_KIND_KEY) === 'video' ? 'video' : 'audio'
      } catch {
        return 'audio'
      }
    })()
  )
  const callHolding = ref(false)
  let callPressTimer: number | null = null
  let suppressCallClick = false

  const callLabel = (kind: CallKind): string => {
    const option = CALL_OPTIONS.find((item) => item.kind === kind)
    return option ? option.label : ''
  }

  const clearCallTimer = () => {
    if (callPressTimer !== null) {
      window.clearTimeout(callPressTimer)
      callPressTimer = null
    }
  }

  const toggleCallKind = () => {
    callKind.value = callKind.value === 'video' ? 'audio' : 'video'
    try {
      localStorage.setItem(CALL_KIND_KEY, callKind.value)
    } catch {
      /* ignore */
    }
  }

  const onCallDown = () => {
    clearCallTimer()
    suppressCallClick = false
    callHolding.value = true
    callPressTimer = window.setTimeout(() => {
      callPressTimer = null
      callHolding.value = false
      // Удержание — только переключаем тип, звонок не делаем.
      suppressCallClick = true
      toggleCallKind()
    }, CALL_HOLD_MS)
  }

  const onCallUp = () => {
    clearCallTimer()
    callHolding.value = false
  }

  const onCallCancel = () => {
    clearCallTimer()
    callHolding.value = false
    suppressCallClick = false
  }

  const onCallClick = () => {
    // После долгого удержания браузер всё равно пришлёт click — пропускаем его.
    if (suppressCallClick) {
      suppressCallClick = false
      return
    }
    options.onTap()
  }

  // Чистим таймер удержания при размонтировании компонента.
  onScopeDispose(clearCallTimer)

  return { callKind, callHolding, callLabel, onCallDown, onCallUp, onCallCancel, onCallClick }
}
