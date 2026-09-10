/**
 * Очередь сообщений, которые не ушли из-за сети.
 *
 * Зачем: на телефоне связь пропадает регулярно (метро, лифт, переход Wi-Fi↔LTE).
 * Раньше при обрыве отправка просто падала с ошибкой, и набранный текст терялся —
 * пользователь видел «Не удалось отправить сообщение» и должен был помнить, что он
 * писал. Теперь текст остаётся в очереди и отправляется сам, как только связь
 * вернётся.
 *
 * Хранится в localStorage по пользователю (как черновики и пины): очередь не
 * «перетекает» между аккаунтами на одном устройстве и переживает перезагрузку.
 */

/** Сообщение в очереди. */
export interface OutboxItem {
  /** Локальный ключ (строка — попадает в data-атрибуты и в UI). */
  id: string
  /** Числовой локальный id для UI (отрицательный, чтобы не путать с серверными). */
  localId: number
  chatId: number
  /** Открытый текст: шифруем (E2EE) уже в момент отправки. */
  text: string
  replyToId?: number | null
  /** Время постановки в очередь (ISO). */
  createdAt: string
  /** `queued` — ждём сеть; `error` — сервер отказал, нужен ручной повтор. */
  state: 'queued' | 'error'
  /** Текст ошибки для состояния `error`. */
  error?: string
}

const KEY = 'pismo_outbox'

type OutboxMap = Record<string, OutboxItem[]>

/** Читает всю карту очередей (по всем пользователям устройства). */
function readMap(): OutboxMap {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as OutboxMap
  } catch {
    // Приватный режим или повреждённое значение — очередь просто пустая.
    return {}
  }
}

function writeMap(map: OutboxMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* записать некуда — очередь будет жить только в памяти вкладки */
  }
}

/** Очередь конкретного пользователя (самые старые — первыми). */
export function readOutbox(userId: number | null): OutboxItem[] {
  if (userId === null) return []
  const items = readMap()[String(userId)]
  return Array.isArray(items) ? items : []
}

/** Заменяет очередь пользователя целиком. */
export function writeOutbox(userId: number | null, items: OutboxItem[]): void {
  if (userId === null) return
  const map = readMap()
  if (items.length === 0) delete map[String(userId)]
  else map[String(userId)] = items
  writeMap(map)
}

/** Добавляет сообщение в очередь и возвращает обновлённый список. */
export function addOutboxItem(userId: number | null, item: OutboxItem): OutboxItem[] {
  // Без пользователя очередь сохранить некуда — не делаем вид, что сохранили.
  if (userId === null) return []
  const items = [...readOutbox(userId), item]
  writeOutbox(userId, items)
  return items
}

/** Меняет поля сообщения в очереди (состояние, текст ошибки). */
export function patchOutboxItem(
  userId: number | null,
  id: string,
  patch: Partial<OutboxItem>
): OutboxItem[] {
  const items = readOutbox(userId).map((item) => (item.id === id ? { ...item, ...patch } : item))
  writeOutbox(userId, items)
  return items
}

/** Убирает сообщение из очереди (ушло или удалено пользователем). */
export function removeOutboxItem(userId: number | null, id: string): OutboxItem[] {
  const items = readOutbox(userId).filter((item) => item.id !== id)
  writeOutbox(userId, items)
  return items
}

/** Следующий свободный локальный id (отрицательный — чтобы не совпасть с серверным). */
export function nextOutboxLocalId(existing: OutboxItem[]): number {
  const minId = existing.reduce((min, item) => Math.min(min, item.localId), 0)
  return minId - 1
}
