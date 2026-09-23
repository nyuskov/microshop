/**
 * Действия над ОДНИМ сообщением: ответ, реакции (и список поставивших),
 * закрепление, копирование, правка, удаление («у себя» / «для всех»), сохранение
 * в «Сохранённые сообщения», стикеры и наборы.
 *
 * Вынесено из `Messenger.vue`: файл перевалил за пять тысяч строк, и именно в
 * этих действиях жили самые дорогие ошибки (меню строки, «свои» посты канала,
 * правка при переключении чата). Мессенджер теперь только связывает действия с
 * лентой, композером и диалогами.
 *
 * Зависимости отдаём ГЕТТЕРАМИ и стрелками (шапка файла читается вместе с
 * «граблей TDZ» в `Messenger.vue`): часть из них объявлена в `<script setup>`
 * ниже вызова, а обращается к ним composable только по действию человека.
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'

import { t } from '@/i18n'
import { useStandardSetImport } from '@/composables/useStandardSetImport'
import {
  deleteMessage,
  forwardMessage,
  removeMessageReaction,
  setMessagePinned,
  setMessageReaction
} from '@/services/chatService'
import { getErrorMessage } from '@/services/errors'
import { stickerFromMessage } from '@/services/stickers'
import { useStickersStore } from '@/stores/stickers'
import { effectiveFile } from '@/utils/media'
import { packIdOfFileName, presetSetOfFileName } from '@/utils/presetStickers'
import { resolveStickerSet, type StickerSetRef } from '@/utils/stickerSet'
import { chatTitle } from '@/utils/user'
import type { Chat, Message } from '@/types'

/** Сообщение и эмодзи, для которых открыт список поставивших реакцию. */
export interface ReactionUsersTarget {
  message: Message
  emoji: string
  /** Чип, у которого открывается список (или null — тогда по центру). */
  anchor: HTMLElement | null
}

export interface MessageActionsDeps {
  /** Открытый чат: подписи диалога удаления и поиск «Сохранённых сообщений». */
  selectedChat: () => Chat | null
  selectedChatId: () => number | null
  currentUserId: () => number | null
  /** Список чатов: в нём ищем свой чат «Сохранённые сообщения». */
  chats: () => Chat[]
  /** Заменить сообщение в ленте (после реакции или закрепления). */
  replaceMessage: (message: Message) => void
  /** Убрать сообщение из ленты (после удаления). */
  removeMessage: (messageId: number) => void
  /** Перечитать закреплённые открытого чата. */
  reloadPinned: (chatId: number) => Promise<void>
  /** Перечитать список чатов (превью «Сохранённых» обновилось). */
  reloadChats: () => Promise<void>
  /** Показать ошибку в плашке над полем ввода. */
  setSendError: (message: string) => void
  /** Ошибка, которую можно повторить той же кнопкой. */
  failSend: (message: string, retry: (() => void) | null) => void
  /** Моё ли это сообщение (по нему решается правка и «удалить для всех»). */
  isOwnMessage: (message: Message) => boolean
  /** Личный ли это чат (подписи в диалоге удаления). */
  isPrivateChat: (chat: Chat | null) => boolean
  /** Имя автора сообщения (подпись цитаты над полем ввода). */
  nameOf: (message: Message) => string
  /** Погасить палитру реакций у строки. */
  closeEmojiPicker: () => void
  /** Погасить меню и палитру строки (перед ответом или правкой). */
  closePopups: () => void
  /** Набранный в поле ввода текст. */
  composerText: () => string
  /** Поставить текст в поле ввода (режим правки). */
  setComposerText: (text: string) => void
  /** Убрать набранный текст в черновик (перед входом в правку). */
  saveDraft: (chatId: number) => void
  /** Отменить режим пересылки: правка его не совмещает. */
  cancelForward: () => void
  /** Открыть картинку в лайтбоксе (стикер без опознанного набора). */
  openImage: (message: Message) => void
}

export interface MessageActionsApi {
  /** Сообщение, на которое отвечаем (цитата над полем ввода). */
  replyTarget: Ref<Message | null>
  /** Подпись цитаты: «Вы» или имя автора. */
  replyBarName: ComputedRef<string>
  /** Ответить на сообщение. */
  setReply: (message: Message) => void
  /** Убрать цитату ответа. */
  clearReply: () => void
  /** Сообщение в режиме правки. */
  editingMessage: Ref<Message | null>
  /** Войти в правку своего сообщения (набранный текст уходит в черновик). */
  startEditMessage: (message: Message) => void
  /** Выйти из правки (текст в поле ввода очищается). */
  cancelEditing: () => void
  /** Поставить или снять свою реакцию. */
  toggleReaction: (message: Message, emoji: string) => Promise<void>
  /** Открыт список поставивших реакцию (удержание чипа). */
  reactionUsersFor: Ref<ReactionUsersTarget | null>
  /** Открыть список поставивших реакцию. */
  openReactionUsers: (message: Message, emoji: string, anchor: HTMLElement | null) => void
  /** Закрепить или открепить сообщение. */
  togglePinMessage: (message: Message) => Promise<void>
  /** Скопировать текст сообщения в буфер обмена. */
  copyMessage: (message: Message) => Promise<void>
  /** Сохранить сообщение в «Сохранённые» (пересылка в свой self-чат). */
  saveMessageToSelf: (message: Message) => Promise<void>
  /** «В стикеры»: сервер копирует картинку сообщения в пак по умолчанию. */
  makeStickerFromMessage: (message: Message) => Promise<void>
  /** «Добавить набор» встроенных стикеров по метке в имени файла. */
  addStickerSet: (message: Message) => void
  /** Открытый набор стикера (окно): null — окно закрыто. */
  stickerSet: Ref<StickerSetRef | null>
  /** Тап по стикеру в ленте: показать его набор (или открыть картинку). */
  openStickerSetOf: (message: Message) => Promise<void>
  /** Идёт вопрос «удалить у себя или для всех» (диалог открыт). */
  showDeleteMessageDialog: Ref<boolean>
  /** Сколько сообщений удаляем (у одного — 1). */
  deleteMessageCount: Ref<number>
  /** Можно ли удалять «для всех» (своё сообщение, не «Сохранённые»). */
  deleteMessageCanForAll: Ref<boolean>
  /** Подпись галки «Удалить для …». */
  deleteForAllLabel: ComputedRef<string>
  /** Пояснение под галкой: что именно исчезнет. */
  deleteForAllHint: ComputedRef<string>
  /**
   * Спросить область удаления: `me` — только у себя, `all` — у всех,
   * `null` — отмена или закрытие окна.
   */
  askDeleteScope: (payload: { count: number; canForAll: boolean }) => Promise<'me' | 'all' | null>
  /** Ответ диалога удаления (в том числе `null` — отмена). */
  finishDeleteScope: (scope: 'me' | 'all' | null) => void
  /** Удалить одно сообщение (область спрашиваем диалогом). */
  deleteMessageOf: (message: Message) => Promise<void>
}

export function useMessageActions(deps: MessageActionsDeps): MessageActionsApi {
  const stickerStore = useStickersStore()

  // ---------- Ответ (reply) ----------
  const replyTarget = ref<Message | null>(null)

  const setReply = (message: Message): void => {
    replyTarget.value = message
    deps.closeEmojiPicker()
  }

  const clearReply = (): void => {
    replyTarget.value = null
  }

  /** Подпись цитаты: как в ленте — «Вы» для своих, иначе имя автора. */
  const replyBarName = computed<string>(() => {
    const target = replyTarget.value
    if (!target) return ''
    return deps.isOwnMessage(target) ? t('Вы') : deps.nameOf(target)
  })

  // ---------- Правка ----------
  const editingMessage = ref<Message | null>(null)

  const startEditMessage = (message: Message): void => {
    if (!deps.isOwnMessage(message)) return
    clearReply()
    deps.cancelForward()
    // Набранный текст не теряем: перед входом в режим правки убираем его в черновик.
    const chatId = deps.selectedChatId()
    if (chatId !== null && deps.composerText().trim()) deps.saveDraft(chatId)
    editingMessage.value = message
    deps.setComposerText(message.text || '')
  }

  const cancelEditing = (): void => {
    editingMessage.value = null
    deps.setComposerText('')
  }

  // ---------- Реакции ----------
  /** Есть ли среди реакций моя — по ней тап снимает реакцию, а не ставит. */
  const hasMyReaction = (message: Message, emoji: string): boolean =>
    message.reactions.some((reaction) => reaction.reacted_by_me && reaction.emoji === emoji)

  const toggleReaction = async (message: Message, emoji: string): Promise<void> => {
    const mine = hasMyReaction(message, emoji)
    try {
      const updated = mine
        ? await removeMessageReaction(message.id)
        : await setMessageReaction(message.id, emoji)
      deps.closeEmojiPicker()
      deps.replaceMessage(updated)
    } catch (error) {
      console.error(t('Не удалось изменить реакцию:'), getErrorMessage(error))
    }
  }

  /**
   * Кто поставил реакцию: открывается удержанием чипа (или правым кликом).
   *
   * Тап по реакции ставит/снимает СВОЮ — это привычное действие, поэтому список
   * живёт на отдельном жесте.
   */
  const reactionUsersFor = ref<ReactionUsersTarget | null>(null)

  const openReactionUsers = (message: Message, emoji: string, anchor: HTMLElement | null): void => {
    reactionUsersFor.value = { message, emoji, anchor }
  }

  // ---------- Закрепление, копирование ----------
  const togglePinMessage = async (message: Message): Promise<void> => {
    try {
      const updated = await setMessagePinned(message.id, !message.is_pinned)
      deps.replaceMessage(updated)
      const chatId = deps.selectedChatId()
      if (chatId !== null) {
        await deps.reloadPinned(chatId)
      }
    } catch (error) {
      console.error(t('Не удалось изменить закрепление:'), getErrorMessage(error))
    }
  }

  const copyMessage = async (message: Message): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message.text || '')
    } catch (error) {
      console.error(t('Не удалось скопировать:'), getErrorMessage(error))
    }
  }

  /** «Сохранить в Сохранённые сообщения» — пересылка сообщения в self-чат. */
  const saveMessageToSelf = async (message: Message): Promise<void> => {
    const selfChat = deps.chats().find((chat) => chat.is_self)
    const current = deps.selectedChat()
    // В самом «Сохранённых» или для служебных сообщений (звонки) не дублируем.
    if (!selfChat || message.kind === 'call' || (current !== null && current.is_self)) return
    try {
      await forwardMessage(message.id, selfChat.id)
    } catch (error) {
      console.error(t('Не удалось сохранить сообщение:'), getErrorMessage(error))
    }
  }

  // ---------- Стикеры ----------
  /**
   * «В стикеры» из сообщения: сервер копирует картинку в пак по умолчанию.
   *
   * Пункт показывается только там, где сервер может прочитать файл (обычный чат),
   * поэтому расшифровывать на клиенте нечего: см. `canBecomeSticker`.
   */
  const makeStickerFromMessage = async (message: Message): Promise<void> => {
    deps.setSendError('')
    try {
      await stickerFromMessage(message.id)
      // Библиотека изменилась — панель стикеров должна увидеть новый стикер сразу.
      await stickerStore.load(true)
    } catch (error) {
      deps.failSend(
        getErrorMessage(error, t('Не удалось добавить стикер')),
        () => void makeStickerFromMessage(message)
      )
    }
  }

  /**
   * «Добавить набор» из меню стикера — как «Добавить стикеры» в Телеграме.
   *
   * Так работают только ВСТРОЕННЫЕ наборы: метка `st-…` в имени файла говорит,
   * какой это набор (`utils/presetStickers.ts`). Стикеры из серверных наборов
   * (своих и публичных) добавляются из окна набора — тап по стикеру в ленте.
   */
  const { run: runStandardSetImport } = useStandardSetImport()

  const addStickerSet = (message: Message): void => {
    // Имя берём из эффективного вложения: в E2EE в `message.file.name` лежит
    // нейтральное `enc_*.bin`, а метка набора — в расшифрованном конверте.
    const set = presetSetOfFileName(effectiveFile(message)?.name ?? null)
    if (!set) return
    void runStandardSetImport(set).then((problem) => {
      if (problem) deps.setSendError(problem)
    })
  }

  /** Открытый набор стикера (окно): null — окно закрыто. */
  const stickerSet = ref<StickerSetRef | null>(null)

  /**
   * Тап по стикеру в ленте: показываем его набор — как в Телеграме.
   *
   * Набор узнаём по метке в имени файла (`utils/presetStickers.ts`): `st-…` —
   * встроенный, `sp-<id>` — свой или публичный с сервера. Метки нет (старый
   * стикер, чужой личный набор, обычная картинка) — ведём себя как раньше и
   * открываем просмотр картинки: обещать нечего.
   */
  const openStickerSetOf = async (message: Message): Promise<void> => {
    // Имя — из эффективного вложения: у E2EE-стикера настоящее имя (с меткой
    // набора) лежит в расшифрованном конверте, а `message.file.name` — `enc_*.bin`.
    // Без этого тап по стикеру в зашифрованном чате открывал просмотр картинки.
    const fileName = effectiveFile(message)?.name ?? null
    const packId = packIdOfFileName(fileName)
    let set = resolveStickerSet(fileName, stickerStore.packs, stickerStore.presets)
    if (!set && packId !== null) {
      // Списки могли быть ещё не загружены (панель стикеров не открывали) —
      // подтягиваем и пробуем снова: без них серверный набор не опознать.
      await Promise.all([stickerStore.load(), stickerStore.loadPresets()])
      set = resolveStickerSet(fileName, stickerStore.packs, stickerStore.presets)
    }
    if (set) stickerSet.value = set
    else deps.openImage(message)
  }

  // ---------- Удаление сообщений: «только у меня» или «для всех» ----------
  //
  // Область выбирает человек в диалоге (`DeleteMessageDialog`), и диалог один на
  // два входа — удаление одного сообщения и удаление выделенных: вариантов два, а
  // «для всех» необратимо у собеседника, поэтому молча его выбирать нельзя.
  const deleteMessageCount = ref(0)
  const deleteMessageCanForAll = ref(false)
  const showDeleteMessageDialog = ref(false)
  /** Ожидающий ответа диалог: промис разрешается выбором человека. */
  let deleteScopeResolve: ((scope: 'me' | 'all' | null) => void) | null = null

  const askDeleteScope = (payload: {
    count: number
    canForAll: boolean
  }): Promise<'me' | 'all' | null> => {
    deleteMessageCount.value = payload.count
    deleteMessageCanForAll.value = payload.canForAll
    showDeleteMessageDialog.value = true
    return new Promise((resolve) => {
      deleteScopeResolve = resolve
    })
  }

  /**
   * Подпись галки: в личном чате — имя собеседника (как в подписи чата), в
   * группе — «Удалить для всех». Пустая строка — галки нет: в «Сохранённых
   * сообщениях» удалять «для кого-то» нечего, там сообщение и так только моё.
   */
  const deleteForAllLabel = computed<string>(() => {
    const chat = deps.selectedChat()
    if (!chat || chat.is_self) return ''
    return deps.isPrivateChat(chat)
      ? t('Удалить для {name}', { name: chatTitle(chat, deps.currentUserId()) })
      : t('Удалить для всех')
  })

  /** Пояснение под отмеченной галкой: без него «вернуть нельзя» остаётся догадкой. */
  const deleteForAllHint = computed<string>(() => {
    const chat = deps.selectedChat()
    if (!chat || chat.is_self) return ''
    const many = deleteMessageCount.value > 1
    const what = many ? t('Исчезнут') : t('Исчезнет')
    if (deps.isPrivateChat(chat)) {
      const name = chatTitle(chat, deps.currentUserId())
      return t('{what} и у {name} — вернуть нельзя.', { what, name })
    }
    return t('{what} у всех участников — вернуть нельзя.', { what })
  })

  /** Ответ диалога: `null` — отмена или закрытие окна. */
  const finishDeleteScope = (scope: 'me' | 'all' | null): void => {
    showDeleteMessageDialog.value = false
    const resolve = deleteScopeResolve
    deleteScopeResolve = null
    resolve?.(scope)
  }

  const deleteMessageOf = async (message: Message): Promise<void> => {
    const scope = await askDeleteScope({
      count: 1,
      canForAll: message.user_id === deps.currentUserId()
    })
    if (scope === null) return
    try {
      await deleteMessage(message.id, scope === 'all')
      deps.removeMessage(message.id)
      const chatId = deps.selectedChatId()
      if (chatId !== null) {
        await Promise.all([deps.reloadPinned(chatId), deps.reloadChats()])
      }
    } catch (error) {
      console.error(t('Не удалось удалить сообщение:'), getErrorMessage(error))
    }
  }

  return {
    replyTarget,
    replyBarName,
    setReply,
    clearReply,
    editingMessage,
    startEditMessage,
    cancelEditing,
    toggleReaction,
    reactionUsersFor,
    openReactionUsers,
    togglePinMessage,
    copyMessage,
    saveMessageToSelf,
    makeStickerFromMessage,
    addStickerSet,
    stickerSet,
    openStickerSetOf,
    showDeleteMessageDialog,
    deleteMessageCount,
    deleteMessageCanForAll,
    deleteForAllLabel,
    deleteForAllHint,
    askDeleteScope,
    finishDeleteScope,
    deleteMessageOf
  }
}
