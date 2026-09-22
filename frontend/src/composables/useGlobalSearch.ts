/**
 * Состояние глобального поиска по людям, сообщениям и каналам (вкладки панели
 * поиска).
 *
 * Зачем отдельный модуль: это самостоятельная единица — запрос, режим, результаты,
 * задержка и ошибка. В `ChatSidebar` остаётся только «открыт/закрыт» (панель,
 * значок в шапке, жесты), а сама логика покрывается юнит-тестом без DOM.
 *
 * Один запрос — одна вкладка: источники не опрашиваются веером, поэтому поиск
 * не расходует лимиты за то, что человек не смотрит (люди, сообщения и каналы —
 * три разных серверных лимита).
 *
 * ГРАБЛЯ-наследство: ошибку поиска пишет ещё и вкладка «Контакты» (открытие чата
 * из «найденных в мессенджере»). Показывается она в разметке вкладки «Чаты», то
 * есть человек видит её, только если вернётся туда. Поведение оставлено прежним
 * (`setError`), но теперь оно видно глазами в одном месте, а не спрятано среди
 * состояния сайдбара.
 */

import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue'
import { getErrorMessage } from '@/services/errors'
import { searchChannels } from '@/services/channelService'
import { searchMessages, searchUsers, type SearchUserResult } from '@/services/chatService'
import { searchLocalMessages, toSearchMessage } from '@/utils/localSearchIndex'
import type { ChannelCard, Message } from '@/types'
import { t } from '@/i18n'

/** Пауза перед запросом: пока человек печатает, сервер не дёргаем. */
export const SEARCH_DEBOUNCE_MS = 350

export type SearchMode = 'people' | 'messages' | 'channels'

export interface UseGlobalSearch {
  query: Ref<string>
  mode: Ref<SearchMode>
  users: Ref<SearchUserResult[]>
  messages: Ref<Message[]>
  /**
   * Совпадения из зашифрованных чатов — из индекса на ЭТОМ устройстве.
   *
   * Отдельным списком, а не в общем: сервер их текст не видит вовсе (там
   * шифротекст), поэтому в интерфейсе это отдельный блок с честной подписью
   * «на этом устройстве» (см. `utils/localSearchIndex.ts`).
   */
  localMessages: Ref<Message[]>
  /** Публичные каналы (каталог): ищем по названию и адресу. */
  channels: Ref<ChannelCard[]>
  loading: Ref<boolean>
  error: Ref<string>
  /** В запросе есть текст — поиск что-то ищет (результаты занимают место списка). */
  hasQuery: ComputedRef<boolean>
  setMode: (mode: SearchMode) => void
  setError: (text: string) => void
  /** Закрыть поиск: сбросить запрос, результаты, ожидание и ошибку. */
  reset: () => void
}

export function useGlobalSearch(): UseGlobalSearch {
  const query = ref('')
  const mode = ref<SearchMode>('people')
  const users = ref<SearchUserResult[]>([])
  const messages = ref<Message[]>([])
  const localMessages = ref<Message[]>([])
  const channels = ref<ChannelCard[]>([])
  const loading = ref(false)
  const error = ref('')
  let timer: number | null = null

  const cancel = () => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  const clearResults = () => {
    users.value = []
    messages.value = []
    localMessages.value = []
    channels.value = []
  }

  /**
   * Совпадения из зашифрованных чатов (индекс на устройстве).
   *
   * Совпадение, которое сервер тоже нашёл, показываем один раз — в общем блоке.
   */
  const fillLocalResults = async (text: string, serverFound: Message[]): Promise<void> => {
    try {
      const records = await searchLocalMessages(text)
      const seen = new Set(serverFound.map((message) => message.id))
      localMessages.value = records.filter((record) => !seen.has(record.id)).map(toSearchMessage)
    } catch {
      // Локальный индекс — добавка: его сбой не должен ломать серверный поиск.
      localMessages.value = []
    }
  }

  watch([query, mode], ([value, nextMode]) => {
    cancel()
    error.value = ''
    const text = value.trim()
    if (!text) {
      clearResults()
      loading.value = false
      return
    }
    loading.value = true
    timer = window.setTimeout(async () => {
      timer = null
      try {
        if (nextMode === 'messages') {
          messages.value = await searchMessages(text)
          await fillLocalResults(text, messages.value)
          users.value = []
          channels.value = []
        } else if (nextMode === 'channels') {
          channels.value = await searchChannels(text)
          users.value = []
          messages.value = []
          localMessages.value = []
        } else {
          users.value = await searchUsers(text)
          messages.value = []
          localMessages.value = []
          channels.value = []
        }
      } catch (err) {
        error.value = getErrorMessage(err, t('Не удалось выполнить поиск'))
      } finally {
        loading.value = false
      }
    }, SEARCH_DEBOUNCE_MS)
  })

  // Запрос в полёте после закрытия панели не должен трогать состояние.
  onScopeDispose(cancel)

  return {
    query,
    mode,
    users,
    messages,
    localMessages,
    channels,
    loading,
    error,
    hasQuery: computed(() => query.value.trim().length > 0),
    setMode: (next) => {
      mode.value = next
    },
    setError: (text) => {
      error.value = text
    },
    reset: () => {
      cancel()
      query.value = ''
      clearResults()
      loading.value = false
      error.value = ''
    }
  }
}
