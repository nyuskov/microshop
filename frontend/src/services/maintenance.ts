/**
 * Режим технических работ: статус и переключение.
 *
 * Статус — публичный (`/system/maintenance/`), он отвечает и во время самих
 * техработ: по нему приложение понимает, показывать ли экран-заглушку.
 * Переключение доступно только администратору сервиса (сервер проверяет
 * `is_superuser`), поэтому кнопка живёт в админской панели, а не в обычных
 * настройках профиля.
 */

import { api } from '@/services/api'

export interface MaintenanceStatus {
  enabled: boolean
  /** Текст, который видит пользователь на экране техработ. */
  message: string
  /** Когда режим переключили в текущее состояние (ISO-строка или null). */
  since: string | null
}

/** Текущее состояние режима технических работ. */
export async function fetchMaintenanceStatus(): Promise<MaintenanceStatus> {
  const { data } = await api.get<MaintenanceStatus>('/system/maintenance/')
  return data
}

/**
 * Включает или выключает режим технических работ.
 *
 * `message` — текст для пользователей (пусто → сервер оставит свой, по
 * умолчанию «Скоро вернёмся.»). Возвращается новое состояние: панель показывает
 * именно ответ сервера, а не то, что набрал администратор.
 */
export async function setMaintenanceMode(
  enabled: boolean,
  message?: string | null
): Promise<MaintenanceStatus> {
  const { data } = await api.put<MaintenanceStatus>('/system/maintenance/', {
    enabled,
    message: message?.trim() ? message.trim() : null
  })
  return data
}
