import { describe, expect, it } from 'vitest'
import { fileCaption, parseFileMeta } from '@/services/e2eeFiles'
import { effectiveFile, isLockedFile, lockedFileLabel, messageSnippet } from '@/utils/media'
import type { EncryptedFileMeta, Message } from '@/types'

/**
 * Конверт зашифрованного вложения: файл шифруется отдельным ключом, а его
 * настоящее имя/тип/размер/ключ/подпись лежат внутри зашифрованного текста
 * сообщения. Сервер видит только шифротекст и нейтральное `enc_*.bin`.
 */
const ENVELOPE: EncryptedFileMeta = {
  v: 1,
  t: 'file',
  n: 'photo.png',
  m: 'image/png',
  s: 1234,
  k: 'FILE_KEY_B64',
  i: 'IV_B64',
  c: 'подпись'
}

/** Сообщение с вложением-шифротекстом (как его отдаёт сервер). */
const encryptedMessage = (patch: Partial<Message> = {}): Message =>
  ({
    id: 1,
    chat_id: 1,
    user_id: 2,
    text: 'e2ee1:aaaa:bbbb',
    encrypted: true,
    timestamp: '2026-09-11T10:00:00',
    reply_to_id: null,
    is_read: false,
    is_pinned: false,
    edited_at: null,
    kind: 'text',
    file: {
      name: 'enc_0f1e2d.bin',
      url: '/media/enc_0f1e2d.bin',
      mime: 'application/octet-stream',
      size: 4200
    },
    reactions: [],
    forwarded_from: null,
    ...patch
  }) as Message

describe('parseFileMeta: конверт зашифрованного вложения', () => {
  it('разбирает конверт вместе с подписью', () => {
    expect(parseFileMeta(JSON.stringify(ENVELOPE))).toEqual(ENVELOPE)
  })

  it('конверт без подписи тоже валиден', () => {
    const { c: _caption, ...withoutCaption } = ENVELOPE
    const parsed = parseFileMeta(JSON.stringify(withoutCaption))
    expect(parsed?.n).toBe('photo.png')
    expect(parsed?.c).toBeUndefined()
  })

  it('обычный текст и повреждённый JSON отдают null, а не падают', () => {
    expect(parseFileMeta('обычное сообщение')).toBeNull()
    expect(parseFileMeta('{"t":"file"')).toBeNull()
    // Есть тип, но нет ключа/IV/имени — расшифровать файл нечем.
    expect(parseFileMeta('{"t":"file","n":"a.png"}')).toBeNull()
  })

  it('подпись достаётся только из конверта', () => {
    expect(fileCaption(parseFileMeta(JSON.stringify(ENVELOPE)))).toBe('подпись')
    expect(fileCaption(null)).toBe('')
  })
})

describe('зашифрованное вложение в интерфейсе', () => {
  it('до расшифровки показывает «замок», а не шифротекст', () => {
    const message = encryptedMessage()
    expect(isLockedFile(message)).toBe(true)
    expect(lockedFileLabel(message)).toBe('🔒 Вложение')
    // В превью списка чатов тоже не должно быть ни текста, ни имени файла.
    expect(messageSnippet(message)).toBe('🔒 Вложение')
    // Настоящего имени/типа в конверте ещё нет — показываем нейтральные.
    expect(effectiveFile(message)?.name).toBe('enc_0f1e2d.bin')
  })

  it('после расшифровки подставляет настоящее имя, тип и размер', () => {
    const message = encryptedMessage({
      text: 'подпись',
      encrypted: false,
      e2ee_file: ENVELOPE
    })
    expect(isLockedFile(message)).toBe(false)
    expect(effectiveFile(message)).toMatchObject({
      name: 'photo.png',
      mime: 'image/png',
      size: 1234
    })
    expect(messageSnippet(message)).toBe('🔒 📷 Изображение')
  })

  it('тип вложения берётся из конверта, а не с сервера', () => {
    // Сервер прислал application/octet-stream — картинку узнаём по конверту.
    const message = encryptedMessage({ e2ee_file: ENVELOPE })
    expect(lockedFileLabel(message)).toBe('🔒 Вложение')
    expect(effectiveFile(message)?.mime).toBe('image/png')
  })
})
