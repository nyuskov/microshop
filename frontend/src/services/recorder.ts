import { t } from '@/i18n'
/** Утилиты для записи и воспроизведения аудио/видеосообщений. */

export type MediaRecordKind = 'audio' | 'video'

export interface RecordedMedia {
  blob: Blob
  mime: string
  durationMs: number
}

/** Возвращает поддерживаемый браузером MIME-тип записи (audio/video). */
export function pickMimeType(kind: MediaRecordKind): string {
  const candidates =
    kind === 'audio'
      ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
      : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
  if (typeof MediaRecorder === 'undefined') {
    return kind === 'audio' ? 'audio/webm' : 'video/webm'
  }
  const supported = candidates.find((mime) => {
    try {
      return MediaRecorder.isTypeSupported(mime)
    } catch {
      return false
    }
  })
  return supported ?? (kind === 'audio' ? 'audio/webm' : 'video/webm')
}

/** Расширение файла по MIME-типу. */
export function extensionFromMime(mime: string): string {
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

/** Имя файла для отправки медиасообщения. */
export function mediaFileName(
  prefix: 'voice' | 'video' | 'audio' | 'media',
  mime: string,
  stamp = Date.now()
): string {
  return `${prefix}_${stamp}.${extensionFromMime(mime)}`
}

/** Останавливает все дорожки потока (микрофон/камера). */
export function stopMediaStream(stream: MediaStream | null): void {
  if (!stream) return
  stream.getTracks().forEach((track) => track.stop())
}

/** Понятное описание ошибки доступа к микрофону/камере. */
export function describeMediaError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
      return t(
        'Нет доступа к микрофону/камере. Разрешите доступ: откройте сайт в Chrome, нажмите значок 🔒 рядом с адресом и включите «Микрофон» и «Камера», затем повторите. В установленном приложении доступ настраивается там же.'
      )
    case 'NotFoundError':
      return t('Не найдено устройство записи (микрофон/камера).')
    case 'NotReadableError':
      return t('Микрофон/камера заняты другим приложением. Закройте его и повторите.')
    case 'SecurityError':
    case 'InsecureContextError':
      return t('Запись доступна только по HTTPS.')
    default:
      return t('Не удалось получить доступ к микрофону/камере.')
  }
}

/** Форматирует секунды как m:ss. */
export function formatClock(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
