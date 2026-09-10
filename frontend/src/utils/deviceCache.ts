/**
 * Кэш приложения на устройстве: сколько занято и как почистить.
 *
 * Service worker кэширует только оболочку приложения (сам бандл, шрифты, иконки),
 * а вложения — нет (их держит браузерный HTTP-кэш). Поэтому здесь показываем честно:
 * «кэш приложения» (его и можно очистить) и общую оценку занятого места.
 * Переписка, черновики и настройки лежат в localStorage и на очистку не влияют.
 */

/** Префикс имён кэшей приложения (см. sw.js: CACHE_PREFIX). */
const CACHE_PREFIX = 'pismo-v'

export interface DeviceCacheInfo {
  /** Сколько занято приложением и кэшем (байты), по оценке браузера. */
  usage: number
  /** Доступный лимит (байты). */
  quota: number
  /** Сколько файлов лежит в кэше приложения. */
  entries: number
  /** Поддерживает ли браузер оценку и Cache Storage. */
  supported: boolean
}

/** Собирает сведения о кэше приложения (без обращения к сети). */
export async function readDeviceCache(): Promise<DeviceCacheInfo> {
  const empty: DeviceCacheInfo = { usage: 0, quota: 0, entries: 0, supported: false }
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
      supported: true
    }
  } catch {
    // Приватный режим/старый браузер — просто нечего показать.
    return empty
  }
}

/** Удаляет кэш оболочки приложения (файлы скачаются заново при следующем входе). */
export async function clearAppCache(): Promise<number> {
  try {
    const names = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX))
    let removed = 0
    for (const name of names) {
      removed += (await (await caches.open(name)).keys()).length
      await caches.delete(name)
    }
    return removed
  } catch {
    return 0
  }
}
