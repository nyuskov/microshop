/**
 * Состояние глобального поиска по людям и сообщениям (вкладки «Чаты»/«Контакты»).
 *
 * Зачем отдельный модуль: это самостоятельная единица — запрос, режим, результаты,
 * задержка и ошибка. В `ChatSidebar` остаётся только «открыт/закрыт» (панель,
 * значок в шапке, жесты), а сама логика покрывается юнит-тестом без DOM.
 *
 * ГРАБЛЯ-наследство: ошибку поиска пишет ещё и вкладка «Контакты» (открытие чата
 * из «найденных в мессенджере»). Показывается она в разметке вкладки «Чаты», то
 * есть человек видит её, только если вернётся туда. Поведение оставлено прежним
 * (`setError`), но теперь оно видно глазами в одном месте, а не спрятано среди
 * состояния сайдбара.
 */

import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue'
import { getErrorMessage } from '@/services/errors'
import { searchMessages, searchUsers, type SearchUserResult } from '@/services/chatService'
import type { Message } from '@/types'

/** Пауза перед запросом: пока человек печатает, сервер не дёргаем. */
export const SEARCH_DEBOUNCE_MS = 350

export type SearchMode = 'people' | 'messages'

export interface UseGlobalSearch {
  query: Ref<string>
  mode: Ref<SearchMode>
  users: Ref<SearchUserResult[]>
  messages: Ref<Message[]>
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
  const loading = ref(false)
  const error = ref('')
  let timer: number | null = null

  const cancel = () => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  watch([query, mode], ([value, nextMode]) => {
    cancel()
    error.value = ''
    const text = value.trim()
    if (!text) {
      users.value = []
      messages.value = []
      loading.value = false
      return
    }
    loading.value = true
    timer = window.setTimeout(async () => {
      timer = null
      try {
        if (nextMode === 'messages') {
          messages.value = await searchMessages(text)
          users.value = []
        } else {
          users.value = await searchUsers(text)
          messages.value = []
        }
      } catch (err) {
        error.value = getErrorMessage(err, 'Не удалось выполнить поиск')
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
      users.value = []
      messages.value = []
      loading.value = false
      error.value = ''
    }
  }
}
