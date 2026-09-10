import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * Статус подключения к сети.
 *
 * Нужен, чтобы показать баннер «нет интернета»: без него пользователь не
 * понимает, почему сообщение не уходит, и думает, что сломалось приложение.
 * Кроме `online`/`offline` дополнительно проверяем, что вернулась связь с
 * сервером (события браузера срабатывают, даже когда провайдер «есть», а
 * интернета нет).
 */
export interface OnlineStatus {
  /** Есть ли сейчас связь (по данным браузера). */
  online: Ref<boolean>
  /** Только что восстановилась — чтобы показать «Связь восстановлена». */
  justRestored: Ref<boolean>
}

/** Сколько показываем плашку «Связь восстановлена» после возврата сети. */
export const RESTORED_VISIBLE_MS = 2500

export function useOnlineStatus(): OnlineStatus {
  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
  const justRestored = ref(false)
  let restoredTimer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = () => {
    if (restoredTimer !== null) {
      clearTimeout(restoredTimer)
      restoredTimer = null
    }
  }

  const goOffline = () => {
    clearTimer()
    justRestored.value = false
    online.value = false
  }

  const goOnline = () => {
    online.value = true
    justRestored.value = true
    clearTimer()
    restoredTimer = setTimeout(() => {
      justRestored.value = false
      restoredTimer = null
    }, RESTORED_VISIBLE_MS)
  }

  onMounted(() => {
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('offline', goOffline)
    window.removeEventListener('online', goOnline)
    clearTimer()
  })

  return { online, justRestored }
}
