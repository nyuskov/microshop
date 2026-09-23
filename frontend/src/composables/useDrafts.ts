/**
 * Черновики сообщений: текст, набранный в поле ввода и ещё не отправленный.
 *
 * Копии две, и обе нужны:
 * - локальная (localStorage) — мгновенная и работающая без сети; ключ
 *   `userId:chatId`, чтобы черновики не «перетекали» между аккаунтами устройства;
 * - серверная — черновик виден с другого устройства; пишем не на каждую букву, а
 *   с задержкой, а в зашифрованном чате уходит шифротекст (сервер текста не видит).
 *
 * Сервер — источник правды, но локальные черновики чатов, которых на сервере нет,
 * не трогаем: они могли не успеть уйти.
 *
 * Вынесено из `Messenger.vue`: это одна тема (что набрано и куда денется), а
 * мессенджер только связывает её с полем ввода, превью в списке диалогов и
 * жизненным циклом страницы.
 */

import { reactive, ref, watch, type Ref } from 'vue'

import { t } from '@/i18n'
import { deleteDraft, fetchDrafts, putDraft } from '@/services/drafts'
import { getErrorMessage } from '@/services/errors'
import { decryptTextWithKeys, isEncryptedPayload } from '@/services/e2ee'
import type { Chat } from '@/types'

/** Ключ хранения локальных черновиков (его же переносит `utils/storage.ts`). */
const DRAFTS_KEY = 'pismo_drafts'
/** Пауза перед отправкой черновика на сервер: API не дёргаем на каждую букву. */
const DRAFT_PUSH_DELAY_MS = 1500
/** Сколько после программной установки текста не показывать «печатает…». */
const PROGRAMMATIC_EDIT_MS = 500

export interface DraftsDeps {
  /** Текст поля ввода — его и сохраняем. */
  composerText: Ref<string>
  currentUserId: () => number | null
  /** Список чатов: по нему решаем, шифровать ли черновик перед отправкой. */
  chats: () => Chat[]
  /** Идёт правка сообщения: черновик в этот момент не трогаем. */
  isEditing: () => boolean
  /** Текст «как он уйдёт»: в зашифрованном чате — шифротекст. */
  buildWireText: (chatId: number, text: string) => Promise<{ wireText: string }>
  /** Ключи расшифровки черновика зашифрованного чата. */
  chatDecryptKeys: (chat: Chat | null) => Promise<CryptoKey[]>
}

export interface DraftsApi {
  /** Черновики текущего пользователя по id чата (превью в списке диалогов). */
  draftsByChatId: Record<number, string>
  /** Сохранить набранный текст в черновик чата (в режиме правки не трогаем). */
  saveDraftFor: (chatId: number | null) => void
  /** Черновик чата (пустая строка, если его нет). */
  loadDraftFor: (chatId: number | null) => string
  /** Удалить черновик чата (после фактической отправки). */
  clearDraftFor: (chatId: number | null) => void
  /** Отправить всё отложенное сейчас (уход со страницы, смена чата). */
  flushDraftPushes: () => void
  /** Подтянуть черновики с сервера (другое устройство — источник правды). */
  syncDraftsFromServer: () => Promise<void>
  /** Программно поставить текст поля — это не «печатает…» для собеседника. */
  setComposerText: (text: string) => void
  /** Только что текст поставили программно? Тогда «печатает…» не отправляем. */
  isProgrammaticComposerEdit: () => boolean
}

const readDrafts = (): Record<string, string> => {
  try {
    const raw = window.localStorage.getItem(DRAFTS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

const writeDrafts = (drafts: Record<string, string>): void => {
  try {
    window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
  } catch {
    // Приватный режим/переполнение — черновик просто не сохранится.
  }
}

export function useDrafts(deps: DraftsDeps): DraftsApi {
  const draftsByChatId = reactive<Record<number, string>>({})
  /** Момент последней программной установки текста поля (гасит «печатает…»). */
  const lastProgrammaticEdit = ref(0)
  /** Отложенные отправки черновиков: id чата → таймер. */
  const draftPushTimers = new Map<number, number>()

  /** Загружает черновики пользователя из localStorage в реактивную карту. */
  const syncDraftsFromStorage = (uid: number | null): void => {
    for (const key of Object.keys(draftsByChatId)) {
      delete draftsByChatId[Number(key)]
    }
    if (uid === null) return
    const all = readDrafts()
    const prefix = `${uid}:`
    for (const [key, text] of Object.entries(all)) {
      if (key.startsWith(prefix) && text.trim()) {
        const chatId = Number(key.slice(prefix.length))
        if (Number.isFinite(chatId)) draftsByChatId[chatId] = text
      }
    }
  }

  watch(
    () => deps.currentUserId(),
    (uid) => syncDraftsFromStorage(uid),
    { immediate: true }
  )

  const draftStorageKey = (chatId: number | null): string | null => {
    const uid = deps.currentUserId()
    if (uid === null || chatId === null) return null
    return `${uid}:${chatId}`
  }

  /** Что уходит на сервер: в зашифрованном чате — шифротекст (сервер его не читает). */
  const pushDraftToServer = async (chatId: number, text: string): Promise<void> => {
    try {
      if (!text.trim()) {
        await deleteDraft(chatId)
        return
      }
      const chat = deps.chats().find((item) => item.id === chatId) ?? null
      const wire = chat?.e2ee_enabled ? await deps.buildWireText(chatId, text) : null
      await putDraft(chatId, wire ? wire.wireText : text)
    } catch (error) {
      // Сеть пропала — черновик остался в localStorage и уйдёт при следующем наборе.
      console.error(t('Не удалось сохранить черновик:'), getErrorMessage(error))
    }
  }

  /** Отложить отправку черновика чата (повторный вызов сдвигает таймер). */
  const scheduleDraftPush = (chatId: number | null, text: string): void => {
    if (chatId === null || deps.currentUserId() === null) return
    const existing = draftPushTimers.get(chatId)
    if (existing !== undefined) window.clearTimeout(existing)
    draftPushTimers.set(
      chatId,
      window.setTimeout(() => {
        draftPushTimers.delete(chatId)
        void pushDraftToServer(chatId, text)
      }, DRAFT_PUSH_DELAY_MS)
    )
  }

  const saveDraftFor = (chatId: number | null): void => {
    const key = draftStorageKey(chatId)
    if (key === null || deps.isEditing()) return
    const text = deps.composerText.value
    const drafts = readDrafts()
    if (text.trim()) {
      drafts[key] = text
      if (chatId !== null) draftsByChatId[chatId] = text
    } else {
      delete drafts[key]
      if (chatId !== null) delete draftsByChatId[chatId]
    }
    writeDrafts(drafts)
    scheduleDraftPush(chatId, text)
  }

  const loadDraftFor = (chatId: number | null): string => {
    const key = draftStorageKey(chatId)
    if (key === null) return ''
    return readDrafts()[key] ?? ''
  }

  const clearDraftFor = (chatId: number | null): void => {
    const key = draftStorageKey(chatId)
    if (key === null) return
    const drafts = readDrafts()
    if (key in drafts) {
      delete drafts[key]
      writeDrafts(drafts)
    }
    if (chatId !== null) delete draftsByChatId[chatId]
    scheduleDraftPush(chatId, '')
  }

  const flushDraftPushes = (): void => {
    for (const [chatId, timer] of draftPushTimers) {
      window.clearTimeout(timer)
      const text = draftsByChatId[chatId] ?? ''
      void pushDraftToServer(chatId, text)
    }
    draftPushTimers.clear()
  }

  /**
   * Подтянуть черновики с сервера.
   *
   * Черновик зашифрованного чата без ключа просто пропускаем: расшифровать его
   * нечем, а «пустой» черновик затёр бы локальный.
   */
  const syncDraftsFromServer = async (): Promise<void> => {
    const uid = deps.currentUserId()
    if (uid === null) return
    try {
      const list = await fetchDrafts()
      const local = readDrafts()
      for (const item of list) {
        let text = item.text
        if (isEncryptedPayload(text)) {
          const chat = deps.chats().find((entry) => entry.id === item.chat_id) ?? null
          const plain = await decryptTextWithKeys(await deps.chatDecryptKeys(chat), text)
          if (plain === null) continue
          text = plain
        }
        draftsByChatId[item.chat_id] = text
        local[`${uid}:${item.chat_id}`] = text
      }
      writeDrafts(local)
    } catch (error) {
      console.error(t('Не удалось загрузить черновики:'), getErrorMessage(error))
    }
  }

  const setComposerText = (text: string): void => {
    lastProgrammaticEdit.value = Date.now()
    deps.composerText.value = text
  }

  const isProgrammaticComposerEdit = (): boolean =>
    Date.now() - lastProgrammaticEdit.value < PROGRAMMATIC_EDIT_MS

  return {
    draftsByChatId,
    saveDraftFor,
    loadDraftFor,
    clearDraftFor,
    flushDraftPushes,
    syncDraftsFromServer,
    setComposerText,
    isProgrammaticComposerEdit
  }
}
