/**
 * Кнопка записи аудио/видеосообщения в композере:
 * клик = начать запись выбранного режима; удержание ~0,5 c = переключить режим
 * (микрофон ⇄ видео), не начиная запись. Подсказка о новом режиме гаснет сама.
 */
import { onScopeDispose, ref } from 'vue'

export type RecordMode = 'audio' | 'video'

export interface RecordButtonOptions {
  /** Идёт ли уже запись / открыта ли модалка (нажатия игнорируются). */
  isRecording: () => boolean
  /** Начать запись выбранного режима. */
  onRecord: (mode: RecordMode) => void
}

const MIC_HOLD_MS = 500

export function useRecordButton(options: RecordButtonOptions) {
  const recordMode = ref<RecordMode>('audio')
  const micHolding = ref(false)
  const recordModeHint = ref('')
  let micPressTimer: number | null = null
  let suppressMicClick = false
  let modeHintTimer: number | null = null

  const clearMicTimer = () => {
    if (micPressTimer !== null) {
      window.clearTimeout(micPressTimer)
      micPressTimer = null
    }
  }

  const clearModeHint = () => {
    if (modeHintTimer !== null) {
      window.clearTimeout(modeHintTimer)
      modeHintTimer = null
    }
  }

  const showModeHint = () => {
    clearModeHint()
    recordModeHint.value = recordMode.value === 'video' ? 'Запись видео' : 'Запись голоса'
    modeHintTimer = window.setTimeout(() => {
      recordModeHint.value = ''
      modeHintTimer = null
    }, 1500)
  }

  const setRecordMode = (mode: RecordMode) => {
    if (recordMode.value === mode) return
    recordMode.value = mode
    showModeHint()
  }

  const resetRecordMode = () => {
    recordMode.value = 'audio'
    recordModeHint.value = ''
    clearModeHint()
  }

  const onMicDown = () => {
    if (options.isRecording()) return
    clearMicTimer()
    suppressMicClick = false
    micHolding.value = true
    micPressTimer = window.setTimeout(() => {
      micPressTimer = null
      micHolding.value = false
      // Переключаем режим, но запись не запускаем — она начнётся по клику.
      suppressMicClick = true
      setRecordMode(recordMode.value === 'video' ? 'audio' : 'video')
    }, MIC_HOLD_MS)
  }

  const onMicUp = () => {
    clearMicTimer()
    micHolding.value = false
  }

  const onMicCancel = () => {
    clearMicTimer()
    micHolding.value = false
    suppressMicClick = false
  }

  const onMicClick = () => {
    // После долгого удержания браузер всё равно пришлёт click — пропускаем его,
    // т.к. удержание уже переключило режим (иначе сразу началась бы запись).
    if (suppressMicClick) {
      suppressMicClick = false
      return
    }
    options.onRecord(recordMode.value)
  }

  // Гасим таймеры удержания/подсказки при размонтировании компонента.
  onScopeDispose(() => {
    clearMicTimer()
    clearModeHint()
  })

  return {
    recordMode,
    micHolding,
    recordModeHint,
    onMicDown,
    onMicUp,
    onMicCancel,
    onMicClick,
    resetRecordMode
  }
}
