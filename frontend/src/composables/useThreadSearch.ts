/**
 * Поиск по сообщениям открытого чата: шторка над лентой и переходы по совпадениям.
 *
 * Вынесено из `Messenger.vue` (часть разбора G6). Поиск СЕРВЕРНЫЙ
 * (`searchMessages`), поэтому совпадение может лежать в ещё не загруженной части
 * истории: перед переходом страница догружается (`ensureMessageLoaded` —
 * `useMessageReveal`), чтобы лента не «прыгала» и не оставалась без ответа.
 *
 * Запрос отправляется с задержкой 350 мс: человек набирает слово целиком, и
 * каждый символ не должен превращаться в запрос к серверу.
 */

import { onScopeDispose, ref, watch, type Ref } from 'vue'

import { t } from '@/i18n'
import { searchMessages } from '@/services/chatService'
import { getErrorMessage } from '@/services/errors'
import type { Message } from '@/types'

/** Пауза после последнего нажатия, прежде чем спросить сервер. */
const SEARCH_DEBOUNCE_MS = 350

export interface ThreadSearchDeps {
  selectedChatId: () => number | null
  /** Догрузить страницу, в которую попадает сообщение (см. useMessageReveal). */
  ensureMessageLoaded: (messageId: number) => Promise<Message | undefined>
  /** Показать сообщение в ленте с подсветкой. */
  revealMessageInThread: (messageId: number) => Promise<void>
}

export interface ThreadSearchApi {
  /** Шторка поиска открыта. */
  searchOpen: Ref<boolean>
  /** Текст запроса (v-model:query у шторки). */
  query: Ref<string>
  /** Открыть/закрыть шторку (закрытие очищает запрос). */
  toggleSearch: () => void
  /** Сколько совпадений нашёл сервер. */
  matchCount: Ref<number>
  /** Номер показанного совпадения (0-based). */
  matchIndex: Ref<number>
  /** Переход по кругу: `delta` — «следующее» (+1) или «предыдущее» (−1). */
  goToMatch: (delta: number) => Promise<void>
}

export function useThreadSearch(deps: ThreadSearchDeps): ThreadSearchApi {
  const searchOpen = ref(false)
  const query = ref('')
  const matchCount = ref(0)
  /** Найденные совпадения (по возрастанию) и номер того, что показано сейчас. */
  const matches = ref<{ id: number }[]>([])
  const matchIndex = ref(0)
  let timer: number | null = null

  const toggleSearch = (): void => {
    searchOpen.value = !searchOpen.value
    if (!searchOpen.value) query.value = ''
  }

  /** Серверный поиск по всей истории + догрузка старых до найденного. */
  const runServerSearch = async (): Promise<void> => {
    const chatId = deps.selectedChatId()
    const text = query.value.trim()
    if (!text || chatId === null) {
      matchCount.value = 0
      matches.value = []
      matchIndex.value = 0
      return
    }
    const results = await searchMessages(text, chatId)
    matchCount.value = results.length
    matches.value = results.map((message) => ({ id: message.id }))
    if (results.length === 0) {
      matchIndex.value = 0
      return
    }

    // Показываем САМОЕ СВЕЖЕЕ совпадение: с него начинают смотреть, а дальше по
    // стрелкам уходим вглубь истории (счётчик при этом показывает «N из M»).
    matchIndex.value = results.length - 1
    const newest = results[results.length - 1] as Message
    const loaded = await deps.ensureMessageLoaded(newest.id)
    if (loaded) await deps.revealMessageInThread(newest.id)
  }

  /**
   * Переход к совпадению по кругу: после последнего снова первое.
   *
   * Поиск серверный, поэтому совпадение может лежать в ещё не загруженной части
   * истории — `ensureMessageLoaded` догружает нужную страницу и не даёт ленте
   * «прыгнуть».
   */
  const goToMatch = async (delta: number): Promise<void> => {
    const total = matches.value.length
    if (total === 0) return
    matchIndex.value = (matchIndex.value + delta + total) % total
    const match = matches.value[matchIndex.value]
    if (!match) return
    const loaded = await deps.ensureMessageLoaded(match.id)
    if (loaded) await deps.revealMessageInThread(match.id)
  }

  watch(query, (value) => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
    if (!value.trim() || deps.selectedChatId() === null) {
      matchCount.value = 0
      matches.value = []
      matchIndex.value = 0
      return
    }
    timer = window.setTimeout(() => {
      timer = null
      void runServerSearch().catch((error) => {
        console.error(t('Не удалось выполнить поиск по сообщениям:'), getErrorMessage(error))
      })
    }, SEARCH_DEBOUNCE_MS)
  })

  onScopeDispose(() => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  })

  return { searchOpen, query, toggleSearch, matchCount, matchIndex, goToMatch }
}
