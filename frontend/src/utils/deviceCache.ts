/**
 * Кэш приложения на устройстве: сколько занято и как почистить.
 *
 * Service worker кэширует только оболочку приложения (сам бандл, шрифты, иконки),
 * а вложения — нет (их держит браузерный HTTP-кэш). Сюда же попадает кэш
 * сохранённых страниц переписки для чтения без сети (`utils/threadCache.ts`).
 * Поэтому здесь показываем честно: «кэш приложения» (его и можно очистить) и
 * общую оценку занятого места. Черновики и настройки лежат в localStorage и на
 * очистку не влияют, а переписка на сервере — тем более.
 */

import { clearThreadCache, threadCacheMessages } from '@/utils/threadCache'

/** Префикс имён кэшей приложения (см. sw.js: CACHE_PREFIX). */
const CACHE_PREFIX = 'pismo-v'

export interface DeviceCacheInfo {
  /** Сколько занято приложением и кэшем (байты), по оценке браузера. */
  usage: number
  /** Доступный лимит (байты). */
  quota: number
  /** Сколько файлов лежит в кэше приложения. */
  entries: number
  /** Сколько сохранённых сообщений лежит в кэше переписки (чтение без сети). */
  threadMessages: number
  /** Поддерживает ли браузер оценку и Cache Storage. */
  supported: boolean
}

/** Собирает сведения о кэше приложения (без обращения к сети). */
export async function readDeviceCache(): Promise<DeviceCacheInfo> {
  const empty: DeviceCacheInfo = {
    usage: 0,
    quota: 0,
    entries: 0,
    threadMessages: 0,
    supported: false
  }
  try {
    const estimate = await navigator.storage?.estimate?.()
    const names = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX))
    let entries = 0
    for (const name of names) {
      entries += (await (await caches.open(name)).keys()).length
    }
    return {
      usage: estimate?.usage ?? 0,
      quota: estimate?.quota ?? 0,
      entries,
      threadMessages: await threadCacheMessages(),
      supported: true
    }
  } catch {
    // Приватный режим/старый браузер — просто нечего показать.
    return empty
  }
}

/** Что убрала очистка кэша (для честной подписи в профиле). */
export interface AppCacheCleared {
  /** Удалено файлов оболочки. */
  files: number
  /** Удалено сохранённых сообщений (страницы для чтения без сети). */
  messages: number
}

/**
 * Удаляет кэш оболочки и сохранённые страницы переписки.
 *
 * Страницы убираем вместе с файлами: человек жмёт «Очистить кэш», чтобы
 * освободить место и убрать следы переписки с устройства («кэш приложения» из
 * подписи) — поэтому возвращаем и то, и другое число.
 */
export async function clearAppCache(): Promise<AppCacheCleared> {
  const cleared: AppCacheCleared = { files: 0, messages: 0 }
  try {
    cleared.messages = await threadCacheMessages()
    await clearThreadCache()
  } catch {
    /* кэш страниц — не критичная часть очистки */
  }
  try {
    const names = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX))
    for (const name of names) {
      cleared.files += (await (await caches.open(name)).keys()).length
      await caches.delete(name)
    }
  } catch {
    /* нет Cache Storage — считаем, что чистить нечего */
  }
  return cleared
}
