/**
 * Занятое место в хранилище медиа (профиль → «Хранилище»).
 *
 * Квота на сервере считается по файлам, которые пользователь загрузил сам:
 * пересланные сообщения переиспользуют тот же файл и второй раз не считаются.
 * Нужен этот вызов, чтобы показать заполненность ДО того, как загрузка начнёт
 * падать с 413 «хранилище заполнено».
 */
import { api } from './api'
import { t } from '@/i18n'

export interface StorageInfo {
  used_bytes: number
  quota_bytes: number
  files: number
  percent: number
}

export async function fetchStorageInfo(): Promise<StorageInfo> {
  const response = await api.get<StorageInfo>('/users/me/storage/')
  return {
    used_bytes: response.data?.used_bytes ?? 0,
    quota_bytes: response.data?.quota_bytes ?? 0,
    files: response.data?.files ?? 0,
    percent: response.data?.percent ?? 0
  }
}

/** Человекочитаемый размер: 1536 → «1.5 МБ» (совпадает с сервером). */
export function formatBytes(numBytes: number): string {
  // Единицы переводим на месте: язык переключается на лету.
  const units = [t('Б'), t('КБ'), t('МБ'), t('ГБ')]
  let value = Math.max(0, numBytes)
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  if (index === 0) return `${Math.round(value)} ${units[0]}`
  return `${value.toFixed(1)} ${units[index]}`
}
