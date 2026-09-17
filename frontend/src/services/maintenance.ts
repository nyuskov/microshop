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
  /**
   * Настоящее состояние режима (только для администратора).
   *
   * Администратору сервер отдаёт `enabled = false`, чтобы приложение перед ним
   * не закрывалось: иначе та же заглушка вылезала бы и у него — в том числе в
   * старом клиенте, который о ролях ничего не знает (кэш PWA, не обновлённое
   * приложение). Панель техработ обязана показывать именно это поле.
   */
  actual_enabled?: boolean | null
}

/**
 * Настоящее состояние режима: для администратора — из `actual_enabled`.
 *
 * Обычному пользователю это поле не приходит — у него `enabled` и есть правда.
 */
export const realMaintenanceEnabled = (status: MaintenanceStatus): boolean =>
  status.actual_enabled ?? status.enabled

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
