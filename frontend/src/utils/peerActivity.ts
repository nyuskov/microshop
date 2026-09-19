/**
 * Виды активности собеседника: «печатает…», «записывает голосовое…»,
 * «отправляет видео…».
 *
 * Раньше был один индикатор — набор текста. Теперь клиент сообщает ВИД занятия
 * (тем же событием `typing` с полем `kind`), поэтому собеседник видит понятную
 * подпись: в мессенджере видно, что человек не молчит, а записывает голосовое
 * или отправляет файл.
 *
 * Список видов — контракт с сервером: он проверяет `kind` по своему списку
 * (`TYPING_KINDS` в `backend/api_v1/events/views.py`), а за согласованностью
 * следит тест `__tests__/peerActivity.spec.ts` (читает файл сервера).
 */

/** Виды активности. `text` — набор текста (вид по умолчанию). */
export const PEER_ACTIVITY_KINDS = [
  'text',
  'voice',
  'video_note',
  'photo',
  'video',
  'file'
] as const

export type PeerActivityKind = (typeof PEER_ACTIVITY_KINDS)[number]

/**
 * Сколько держать подпись, если новых подтверждений не пришло.
 *
 * Клиент повторяет событие, пока занятие продолжается (как и «печатает…»), а этот
 * срок нужен на случай обрыва: подпись не должна залипнуть, если человек закрыл
 * приложение во время записи.
 */
export const PEER_ACTIVITY_TTL_MS: Record<PeerActivityKind, number> = {
  text: 4000,
  voice: 6000,
  video_note: 6000,
  photo: 6000,
  video: 6000,
  file: 6000
}

/** Вид по умолчанию: старый клиент и события без `kind`. */
export const PEER_ACTIVITY_DEFAULT: PeerActivityKind = 'text'

/** Подписи без имени: в личном чате и так ясно, кто это. */
const PHRASES: Record<PeerActivityKind, string> = {
  text: 'печатает…',
  voice: 'записывает голосовое…',
  video_note: 'записывает видеосообщение…',
  photo: 'отправляет фото…',
  video: 'отправляет видео…',
  file: 'отправляет файл…'
}

/** Похоже ли значение на известный вид (сервер присылает строку из сети). */
export const isPeerActivityKind = (value: unknown): value is PeerActivityKind =>
  typeof value === 'string' && (PEER_ACTIVITY_KINDS as readonly string[]).includes(value)

/**
 * Подпись активности.
 *
 * В группе подпись без имени бесполезна («печатает…» — кто?), поэтому туда
 * передаётся имя: «Аня печатает…». В личном чате имя лишнее.
 */
export const peerActivityLabel = (kind: PeerActivityKind, name?: string | null): string => {
  const phrase = PHRASES[kind] ?? PHRASES[PEER_ACTIVITY_DEFAULT]
  const who = (name ?? '').trim()
  return who ? `${who} ${phrase}` : phrase
}

/**
 * Вид активности по отправляемому файлу.
 *
 * Фото и видео собеседник видит подписью «отправляет фото/видео…», всё
 * остальное — «отправляет файл…». Тип берём из MIME: он есть и у файлов из
 * проводника, и у снимков с камеры.
 */
export const activityKindOfFile = (file: { type?: string }): PeerActivityKind => {
  const mime = file.type ?? ''
  if (mime.startsWith('image/')) return 'photo'
  if (mime.startsWith('video/')) return 'video'
  return 'file'
}
