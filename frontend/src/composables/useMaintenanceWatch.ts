/**
 * Следит за режимом технических работ: экран-заглушка и его снятие.
 *
 * Зачем опрос, если сервер и так отвечает 503: пока приложение живёт в фоне
 * (открытая вкладка, свёрнутое PWA), запросов к API может не быть минутами — а
 * режим тем временем включат или выключат. Опрос публичного статуса раз в
 * 30 секунд стоит одного маленького GET и решает обе задачи: показать экран
 * тем, у кого приложение уже открыто, и снять его, когда работы закончились.
 *
 * Дополнительно проверяем статус сразу при запуске и при возвращении человека на
 * вкладку — в этих случаях ждать полминуты неуместно.
 *
 * Ответ «сеть недоступна» НЕ считается техработами: обрыв связи не должен
 * превращаться в экран плановых работ (для «нет сети» есть своя плашка).
 */

import { onBeforeUnmount, onMounted } from 'vue'

import { fetchMaintenanceStatus } from '@/services/maintenance'
import {
  hideMaintenance,
  maintenanceActive,
  maintenanceRunning,
  showMaintenance
} from '@/utils/maintenance'

/** Как часто проверяем режим, пока приложение открыто. */
const POLL_MS = 30000

export function useMaintenanceWatch(): void {
  let timer: number | undefined

  const check = async (): Promise<void> => {
    try {
      const status = await fetchMaintenanceStatus()
      if (status.enabled) {
        showMaintenance(status.message)
        return
      }
      if (!maintenanceRunning.value) return
      // Режим выключили, а приложение это заметило: его запросы падали с 503,
      // сокеты переподключались, списки остались недогруженными. Если человек
      // стоял за заглушкой — перезагружаем (иначе он увидел бы «пустой»
      // мессенджер); если он только видел пометку на экране входа — просто
      // убираем пометку.
      const wasCovered = maintenanceActive.value
      hideMaintenance()
      if (wasCovered) window.location.reload()
    } catch {
      // Сервер не ответил — это не повод показывать техработы.
    }
  }

  const stop = (): void => {
    if (timer !== undefined) {
      window.clearInterval(timer)
      timer = undefined
    }
  }

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') void check()
  }

  onMounted(() => {
    void check()
    timer = window.setInterval(() => void check(), POLL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onVisibilityChange)
  })

  onBeforeUnmount(() => {
    stop()
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('focus', onVisibilityChange)
  })
}
