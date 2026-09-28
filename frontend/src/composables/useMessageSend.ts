/**
 * Отправка в открытый чат: текст, стикер-эмодзи, стикер-картинка и вложения.
 *
 * Вынесено из `Messenger.vue` (второй шаг разбора G6 после `useMessageActions`):
 * это одна тема — «что происходит, когда человек нажимает отправить», включая
 * шифрование на клиенте, временный пузырь «Отправка…» с прогрессом, альбомы,
 * окно отправки с подписью и обработку офлайна (сообщение уходит в очередь).
 *
 * Зависимости отдаём ГЕТТЕРАМИ и стрелками: часть из них (`clearDraftFor`,
 * `queueOutgoingText`, `stopTyping`, `replyTarget`) объявлена в `Messenger.vue`
 * ниже вызова, а обращается к ним composable только по действию человека — иначе
 * на этапе setup была бы грабля TDZ (см. шапку файла мессенджера).
 */

import { computed, nextTick, ref, type ComputedRef, type Ref } from 'vue'
import { Notify } from 'quasar'

import { playEmojiEffectForText } from '@/composables/useEmojiEffect'
import { t } from '@/i18n'
import { sendAttachmentMessage, sendNewMessage, editMessage } from '@/services/chatService'
import { getErrorMessage, isNetworkError } from '@/services/errors'
import { encryptText } from '@/services/e2ee'
import { encryptFileForChat } from '@/services/e2eeFiles'
import { newAlbumId, planFileSend } from '@/utils/albums'
import { haptic } from '@/utils/haptics'
import { indexLocalMessages } from '@/utils/localSearchIndex'
import { optimizeImageFile, messageSnippet } from '@/utils/media'
import { activityKindOfFile, type PeerActivityKind } from '@/utils/peerActivity'
import { packStickerFileName, presetStickerFileName } from '@/utils/presetStickers'
import type { Chat, EncryptedFileMeta, Message } from '@/types'

/** Временный пузырь «Отправка…» в ленте: пока файл грузится на сервер. */
export interface PendingUpload {
  localId: number
  label: string
  previewUrl?: string | null
  /** Процент загрузки на сервер (undefined — ещё не началась). */
  progress?: number
}

export interface MessageSendDeps {
  selectedChat: () => Chat | null
  selectedChatId: () => number | null
  /** Текст поля ввода (читаем подпись, очищаем после отправки). */
  composerText: Ref<string>
  /** Погасить панель эмодзи/стикеров: сообщение уходит — она больше не нужна. */
  closeExtras: () => void
  /** Черновик этого чата больше не нужен (текст ушёл или его забрал альбом). */
  clearDraftFor: (chatId: number) => void
  /** Связь пропала: текст уходит в очередь и отправится сам. */
  queueOutgoingText: (chatId: number, text: string, replyToId: number | null) => void
  stopTyping: (chatId: number) => void
  /** Сообщение в режиме правки (null — обычная отправка). */
  editing: () => Message | null
  /** Выйти из режима правки (текст уже отправлен). */
  endEditing: () => void
  /** Заменить сообщение в ленте (после правки). */
  replaceMessage: (message: Message) => void
  /** Сообщение, на которое отвечаем (для подписи окна отправки). */
  replyTarget: () => Message | null
  /** Подпись цитаты ответа: «Вы» или имя автора. */
  replyName: () => string
  clearReply: () => void
  /** Ключ чата для шифрования (null — чат не зашифрован или ключей нет). */
  chatKeyOf: (chat: Chat | null) => Promise<CryptoKey | null>
  /** Отметить, что собеседник готов к E2EE (замок в шапке). */
  markPeerReady: (chatId: number) => void
  /** Подставить расшифрованный конверт отправленного файла (имя, тип, подпись). */
  applyLocalFileEnvelope: (message: Message, meta: EncryptedFileMeta) => void
  /** Перечитать открытую ленту (перед вставкой ответа сервера). */
  refreshThread: () => Promise<void>
  reloadPinned: (chatId: number) => Promise<void>
  reloadChats: () => Promise<void>
  /** Добавить сообщение в ленту (уже без дублей). */
  addMessage: (message: Message) => void
  /** Начать «отправляет фото/видео/файл…» у собеседника; возвращает «закончить». */
  beginActivity: (chatId: number, kind: PeerActivityKind) => () => void
  scrollToBottom: () => void
  /** Показать ошибку отправки с возможностью повтора. */
  failSend: (message: string, retry: (() => void) | null) => void
  /** Показать ошибку без повтора (итог пачки и ошибки панели стикеров). */
  setSendError: (message: string) => void
}

export interface MessageSendApi {
  /** Идёт отправка текста/стикера: блокирует повторное нажатие. */
  sending: Ref<boolean>
  /** Идёт отправка вложения (для индикаторов вне композера). */
  sendingFile: Ref<boolean>
  /** Временные пузыри «Отправка…» (лента рисует их вместе с очередью). */
  pendingUploads: Ref<PendingUpload[]>
  /** Отправить текст из поля ввода (или сохранить правку). */
  sendText: () => Promise<void>
  /** Отправить стикер-эмодзи отдельным сообщением. */
  sendSticker: (sticker: string) => Promise<void>
  /** Отправить стикер-картинку (скачать по ссылке и послать вложением). */
  sendStickerImage: (image: {
    url: string
    mime: string
    preset?: { setKey: string; name: string }
    pack?: { packId: number; position: number }
  }) => Promise<void>
  /** Файлы выбраны: открыть окно отправки (там же пишется подпись). */
  onFilesSelected: (files: File[], viewOnce?: boolean) => void
  /** Файлы брошены в окно: тот же окно отправки (нужен открытый чат). */
  handleDroppedFiles: (files: File[]) => void
  /** Отправлять есть куда: чат открыт (подсказка перетаскивания). */
  canDropFiles: ComputedRef<boolean>
  /** Выбранные файлы, ждущие подписи в окне отправки. */
  pendingSend: Ref<{ files: File[]; viewOnce: boolean } | null>
  /** Цитата для окна отправки. */
  pendingSendReply: ComputedRef<{ name: string; text: string } | null>
  /** «Отправить» в окне: подпись готова — отправляем пачку. */
  confirmSend: (caption: string) => void
  /** Закрыть окно без отправки. */
  cancelSend: () => void
  /** Создать временный пузырь (нужен и записи голосовых/видео). */
  addPendingUpload: (label: string, previewUrl?: string | null) => number
  removePendingUpload: (localId: number) => void
  /** Есть ли ещё актуальный временный пузырь (запись голосовых/видео). */
  hasPendingUpload: (localId: number) => boolean
  setPendingProgress: (localId: number, percent: number) => void
  /** Убрать все временные пузыри (смена чата) — с освобождением превью. */
  clearPendingUploads: () => void
  /** Ошибка панели стикеров (из `StickerPanel`) — в плашку над полем ввода. */
  onStickerError: (message: string) => void
}

export function useMessageSend(deps: MessageSendDeps): MessageSendApi {
  const sending = ref(false)
  const sendingFile = ref(false)

  // ---------- Временные пузыри «Отправка…» ----------
  const pendingUploads = ref<PendingUpload[]>([])
  let pendingSeq = 0

  /**
   * Отметить прогресс загрузки вложения. Массив пересобираем: строка в ленте
   * должна обновиться, а лишние перерисовки гасим сравнением процента.
   */
  const setPendingProgress = (localId: number, percent: number): void => {
    if (!pendingUploads.value.some((p) => p.localId === localId && p.progress !== percent)) return
    pendingUploads.value = pendingUploads.value.map((p) =>
      p.localId === localId ? { ...p, progress: percent } : p
    )
  }

  /** Создать временный пузырь «Отправка…» и вернуть его localId. */
  const addPendingUpload = (label: string, previewUrl: string | null = null): number => {
    const localId = --pendingSeq
    pendingUploads.value = [...pendingUploads.value, { localId, label, previewUrl }]
    return localId
  }

  /** Убрать временный пузырь (успех, ошибка или смена чата). */
  const removePendingUpload = (localId: number): void => {
    pendingUploads.value = pendingUploads.value.filter((p) => p.localId !== localId)
  }

  const hasPendingUpload = (localId: number): boolean =>
    pendingUploads.value.some((p) => p.localId === localId)

  const clearPendingUploads = (): void => {
    for (const p of pendingUploads.value) {
      if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
    }
    pendingUploads.value = []
  }

  // ---------- Текст ----------
  /**
   * Доставка текста: E2EE, отправка, показ в ленте.
   *
   * Общая для обычного сообщения и для стикера (стикер — это тоже текст из
   * эмодзи): различается только то, что делает вызывающий до и после.
   */
  const deliverText = async (chatId: number, text: string, replyTo: number | null) => {
    // E2EE шифрует, только если чат «зашифрованный» (e2ee_enabled) и обе стороны
    // опубликовали ключи. Обычные чаты идут открытым текстом (текст виден в
    // превью списка и в push-уведомлениях — как в обычных чатах Telegram).
    let wireText = text
    let wireEncrypted = false
    const aes = await deps.chatKeyOf(deps.selectedChat())
    if (aes) {
      wireText = await encryptText(aes, text)
      wireEncrypted = true
      deps.markPeerReady(chatId)
    }
    const message = await sendNewMessage(chatId, wireText, replyTo, wireEncrypted)
    if (wireEncrypted) {
      // Локально в ленте показываем открытый текст; шифротекст живёт на сервере.
      message.text = text
      message.encrypted = false
      // И сразу запоминаем его для локального поиска: сервер этот текст не видит
      // (см. utils/localSearchIndex.ts).
      void indexLocalMessages([message])
    }
    await deps.refreshThread()
    deps.addMessage(message)
    await deps.reloadPinned(chatId)
    // Короткий отклик при отправке: понятно, что сообщение ушло, не сверяясь
    // с галочками (на телефоне ощущается как «нажалось»).
    haptic()
    deps.scrollToBottom()
  }

  const sendText = async (): Promise<void> => {
    const chatId = deps.selectedChatId()
    const text = deps.composerText.value.trim()
    if (chatId === null || !text || sending.value) return

    sending.value = true
    deps.setSendError('')
    // Сообщение уходит — панель смайлов/стикеров больше не нужна (как в Телеграме).
    deps.closeExtras()
    try {
      const editing = deps.editing()
      if (editing) {
        const updated = await editMessage(editing.id, text)
        deps.composerText.value = ''
        deps.clearDraftFor(chatId)
        deps.endEditing()
        deps.replaceMessage(updated)
        deps.stopTyping(chatId)
        await deps.reloadPinned(chatId)
        deps.scrollToBottom()
        return
      }

      await deliverText(chatId, text, deps.replyTarget()?.id ?? null)
      // Одиночный эмодзи рассыпается частицами по экрану (как в Telegram).
      // Только для НОВОГО сообщения: правка уже отправленного эффекта не даёт.
      playEmojiEffectForText(text)
      deps.composerText.value = ''
      deps.clearDraftFor(chatId)
      deps.stopTyping(chatId)
      deps.clearReply()
    } catch (error) {
      // Связь пропала — не теряем набранное: ставим в очередь и отправим сами,
      // как только сеть вернётся (сообщение видно в ленте как «Ждёт сети»).
      if (isNetworkError(error)) {
        deps.queueOutgoingText(chatId, text, deps.replyTarget()?.id ?? null)
        deps.composerText.value = ''
        deps.clearDraftFor(chatId)
        deps.clearReply()
        void nextTick(deps.scrollToBottom)
      } else {
        deps.failSend(
          getErrorMessage(error, t('Не удалось отправить сообщение')),
          () => void sendText()
        )
      }
    } finally {
      sending.value = false
    }
  }

  /**
   * Отправляет стикер (эмодзи) отдельным сообщением — тап в панели «Стикеры».
   *
   * Черновик в поле ввода НЕ трогаем: человек мог параллельно набирать текст, а
   * стикер — отдельное сообщение. В ленте оно рисуется крупно и без пузыря
   * (`MessageRow.vue`, `emojiLayout`).
   */
  const sendSticker = async (sticker: string): Promise<void> => {
    const chatId = deps.selectedChatId()
    if (chatId === null || !sticker || sending.value) return
    sending.value = true
    deps.setSendError('')
    // Стикер уходит сразу — панель закрываем, как в Телеграме: лента остаётся видна.
    deps.closeExtras()
    try {
      await deliverText(chatId, sticker, deps.replyTarget()?.id ?? null)
      deps.clearReply()
    } catch (error) {
      if (isNetworkError(error)) {
        deps.queueOutgoingText(chatId, sticker, deps.replyTarget()?.id ?? null)
        deps.clearReply()
        void nextTick(deps.scrollToBottom)
      } else {
        deps.failSend(
          getErrorMessage(error, t('Не удалось отправить стикер')),
          () => void sendSticker(sticker)
        )
      }
    } finally {
      sending.value = false
    }
  }

  /** Ошибка добавления стикера (из панели стикеров): показываем в строке ошибок. */
  const onStickerError = (message: string): void => {
    deps.setSendError(message)
  }

  /**
   * Отправляет стикер-картинку сообщением (тап в панели «Стикеры»).
   *
   * Стикер скачиваем по ссылке и отправляем теми же байтами, что обычное
   * вложение, только с ``sticker=true``: сообщение получает ``kind='sticker'`` и
   * рисуется без пузыря. Ссылка приходит готовая — свои стикеры лежат на сервере
   * (`media/`), стандартные — ассеты приложения (`public/stickers/`).
   * В E2EE-чате байты сначала шифруются — как и любое другое вложение.
   */
  const sendStickerImage = async (image: {
    url: string
    mime: string
    /** Встроенный набор приложения: метка `st-<набор>-<имя>.png`. */
    preset?: { setKey: string; name: string }
    /** Набор с сервера: метка `sp-<id>-<имя>.png` (свой или публичный). */
    pack?: { packId: number; position: number }
  }): Promise<void> => {
    const chatId = deps.selectedChatId()
    if (chatId === null || sending.value) return
    sending.value = true
    deps.setSendError('')
    // Картинка-стикер уходит сразу: панель закрываем — как при отправке стикера-эмодзи.
    deps.closeExtras()
    try {
      const response = await fetch(image.url)
      if (!response.ok) throw new Error(t('Не удалось прочитать стикер'))
      const blob = await response.blob()
      // Имя файла несёт метку набора: по ней получатель поймёт, из какого набора
      // стикер, и сможет открыть его целиком — см. utils/presetStickers.ts.
      const fileName = image.preset
        ? presetStickerFileName(image.preset.setKey, image.preset.name)
        : image.pack
          ? packStickerFileName(image.pack.packId, String(image.pack.position))
          : 'sticker.webp'
      const file = new File([blob], fileName, {
        type: image.mime || blob.type || 'image/webp'
      })
      const aes = await deps.chatKeyOf(deps.selectedChat())
      const payload = aes ? await encryptFileForChat(aes, file, '') : null
      const message = await sendAttachmentMessage(
        chatId,
        payload ? payload.blob : file,
        payload ? payload.text : '',
        deps.replyTarget()?.id ?? null,
        undefined,
        !!payload,
        true
      )
      if (payload) deps.applyLocalFileEnvelope(message, payload.meta)
      deps.clearReply()
      deps.stopTyping(chatId)
      deps.addMessage(message)
      deps.scrollToBottom()
    } catch (error) {
      deps.failSend(
        getErrorMessage(error, t('Не удалось отправить стикер')),
        () => void sendStickerImage(image)
      )
    } finally {
      sending.value = false
    }
  }

  // ---------- Окно отправки вложения (превью + подпись) ----------
  /**
   * Файлы, выбранные для отправки, но ещё не отправленные.
   *
   * Пока они здесь, человек видит превью, может написать подпись (и поправить
   * её) и только потом нажать «Отправить». Без этого окна подпись получалась
   * лишь у того файла, который шёл первым, и только если текст был набран ДО
   * выбора файла.
   */
  const pendingSend = ref<{ files: File[]; viewOnce: boolean } | null>(null)

  /** Цитата для окна отправки: к какому сообщению уйдёт вложение. */
  const pendingSendReply = computed<{ name: string; text: string } | null>(() => {
    const target = deps.replyTarget()
    if (!target) return null
    return { name: deps.replyName(), text: messageSnippet(target) }
  })

  /** Файлы выбраны: показать окно отправки (подпись пишется здесь же). */
  const openSendDialog = (files: File[], viewOnce = false): void => {
    if (files.length === 0) return
    deps.setSendError('')
    pendingSend.value = { files, viewOnce }
  }

  /** «Отправить» в окне: подпись уже написана — отправляем пачку. */
  const confirmSend = (caption: string): void => {
    const pending = pendingSend.value
    pendingSend.value = null
    if (!pending) return
    void sendFiles(pending.files, pending.viewOnce, caption)
  }

  /** Закрыть окно без отправки: файлы не уходят, текст в поле ввода остаётся. */
  const cancelSend = (): void => {
    pendingSend.value = null
  }

  /**
   * Отправка одного файла: временный пузырь с прогрессом → сжатие фото → E2EE →
   * загрузка. На ошибке бросает исключение (почистив за собой временный пузырь) —
   * что показать пользователю, решает вызывающий: отправка одного файла или пачки.
   *
   * `options.albumId` — файл входит в альбом (см. utils/albums.ts).
   * `options.caption === null` — подписи этому файлу не даём: она уже уехала с
   * первым вложением пачки (и поле ввода чистить второй раз нельзя).
   * `options.refresh === false` — не перечитывать список чатов и закреплённые:
   * пачка из десяти фото не должна дёргать их десять раз.
   */
  const sendFileMessage = async (
    file: File,
    viewOnce = false,
    options: { albumId?: string; caption?: string | null; refresh?: boolean } = {}
  ) => {
    const chatId = deps.selectedChatId()
    if (chatId === null) return

    // Сразу показываем временный пузырь (для фото — с превью), чтобы было видно,
    // что отправка идёт; затем заменяем его настоящим сообщением.
    const isImage = file.type.startsWith('image/')
    const previewUrl = isImage ? URL.createObjectURL(file) : null
    const localId = addPendingUpload(file.name || t('Вложение'), previewUrl)
    void nextTick(deps.scrollToBottom)

    sendingFile.value = true
    // Что именно отправляем — видно по типу файла: фото, видео или документ.
    const finishActivity = deps.beginActivity(chatId, activityKindOfFile(file))
    try {
      // Фото с камеры/галереи сжимаем на клиенте — грузится быстрее.
      const optimized = isImage ? await optimizeImageFile(file) : file
      // Подпись: своя (у альбома её несёт первое вложение), из поля ввода — или
      // никакая (продолжение альбома приходит с `caption: null`).
      const ownCaption = options.caption !== null
      const caption = ownCaption ? (options.caption ?? deps.composerText.value.trim()) : ''
      // «Зашифрованный» чат: и содержимое, и настоящее имя файла уезжают
      // только в шифрованном виде (на сервере остаётся блоб enc_*.bin).
      const aes = await deps.chatKeyOf(deps.selectedChat())
      const payload = aes ? await encryptFileForChat(aes, optimized, caption) : null
      const message = await sendAttachmentMessage(
        chatId,
        payload ? payload.blob : optimized,
        payload ? payload.text : caption,
        deps.replyTarget()?.id,
        (percent) => {
          // Сжатие могло занять время — прогресс показываем только актуального пузыря.
          if (hasPendingUpload(localId)) setPendingProgress(localId, percent)
        },
        !!payload,
        // Стикером это не отправляем, а «посмотреть один раз» — флаг сообщения.
        false,
        viewOnce,
        options.albumId ?? null
      )
      if (payload) deps.applyLocalFileEnvelope(message, payload.meta)
      removePendingUpload(localId)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      // Поле ввода и «ответ» относятся ко всей отправке, а не к каждому файлу:
      // у альбома их забирает первое вложение.
      if (ownCaption) {
        deps.composerText.value = ''
        deps.clearDraftFor(chatId)
        deps.clearReply()
      }
      deps.addMessage(message)
      if (options.refresh !== false) {
        await Promise.all([deps.reloadPinned(chatId), deps.reloadChats()])
      }
      deps.scrollToBottom()
    } catch (error) {
      removePendingUpload(localId)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      throw error
    } finally {
      finishActivity()
      sendingFile.value = false
    }
  }

  /**
   * Отправка файлов: кнопка «Прикрепить», вставка из буфера и перетаскивание в
   * окно. Подряд идущие картинки уходят одним АЛЬБОМОМ — в ленте они рисуются
   * сеткой (см. utils/albums.ts), остальные файлы — отдельными сообщениями.
   * Подпись из поля ввода достаётся первому отправленному файлу: после него поле
   * очищается — ровно как при отправке одного файла.
   */
  const sendFiles = async (files: File[], viewOnce = false, caption?: string) => {
    const chatId = deps.selectedChatId()
    if (chatId === null || files.length === 0) return
    deps.setSendError('')
    const failures: string[] = []
    // Подпись из окна отправки достаётся ПЕРВОМУ ушедшему файлу (у альбома —
    // первой картинке пачки), остальным — ничего: так же ведёт себя Телеграм.
    let captionLeft: string | null | undefined = caption

    for (const item of planFileSend(files, !viewOnce)) {
      if (item.kind === 'album') {
        // Одна метка на всю пачку: по ней лента собирает сетку и понимает, что
        // push на эту отправку нужен один, а не на каждый файл.
        const albumId = newAlbumId()
        for (let index = 0; index < item.files.length; index += 1) {
          const file = item.files[index] as File
          const partCaption = index === 0 ? captionLeft : null
          try {
            await sendFileMessage(file, false, {
              albumId,
              caption: partCaption,
              refresh: false
            })
          } catch (error) {
            // Один неудачный файл не отменяет остальные: копим причины и показываем
            // итог после всей пачки.
            failures.push(
              getErrorMessage(error, t('Не удалось отправить «{name}»', { name: file.name }))
            )
          }
        }
        captionLeft = null
        continue
      }
      try {
        await sendFileMessage(item.file, viewOnce, { caption: captionLeft })
      } catch (error) {
        failures.push(
          getErrorMessage(error, t('Не удалось отправить «{name}»', { name: item.file.name }))
        )
      }
      captionLeft = null
    }

    // Список чатов и закреплённые перечитываем один раз на всю пачку — и только
    // если человек всё ещё в том же чате.
    if (deps.selectedChatId() === chatId) {
      await Promise.all([deps.reloadPinned(chatId), deps.reloadChats()])
      deps.scrollToBottom()
    }

    if (failures.length === 1) deps.setSendError(failures[0] as string)
    else if (failures.length > 1) {
      deps.setSendError(
        t('Не удалось отправить {failed} из {total} файлов', {
          failed: failures.length,
          total: files.length
        })
      )
    }
  }

  /**
   * Файлы выбраны (кнопка «Прикрепить», вставка из буфера, перетаскивание):
   * открываем ОКНО ОТПРАВКИ, а не шлём сразу.
   *
   * Раньше подпись уходила в файл только если текст был набран ДО выбора файла —
   * то есть обычный порядок «прикрепил, потом написал комментарий» не работал
   * (владелец: «отсылать фото с комментарием, как в Телеграме»).
   */
  const onFilesSelected = (files: File[], viewOnce = false): void => {
    openSendDialog(files, viewOnce)
  }

  /**
   * Файлы, брошенные в окно. Нужен именно открытый (загруженный) чат: пока чат
   * восстанавливается из адреса, ключа E2EE ещё нет — файл уехал бы на сервер
   * открытым. О том же говорит и подсказка (FileDropOverlay, `canDropFiles`).
   */
  const handleDroppedFiles = (files: File[]): void => {
    if (deps.selectedChat() === null) {
      Notify.create({ message: t('Откройте чат, чтобы отправить файл'), timeout: 3000 })
      return
    }
    openSendDialog(files)
  }

  /** Отправлять есть куда: чат открыт (пока он грузится, подсказка нейтральная). */
  const canDropFiles = computed(() => deps.selectedChat() !== null)

  return {
    sending,
    sendingFile,
    pendingUploads,
    sendText,
    sendSticker,
    sendStickerImage,
    onFilesSelected,
    handleDroppedFiles,
    canDropFiles,
    pendingSend,
    pendingSendReply,
    confirmSend,
    cancelSend,
    addPendingUpload,
    removePendingUpload,
    hasPendingUpload,
    setPendingProgress,
    clearPendingUploads,
    onStickerError
  }
}
