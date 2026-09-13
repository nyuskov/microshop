/**
 * Поиск в разделе «Контакты»: моя записная книжка + найденные в мессенджере.
 *
 * Это отдельная единица работы, а не часть глобального поиска: другая задержка,
 * другой минимум длины запроса (2 символа против 1) и свой результат — «кого
 * можно добавить». Раньше жила прямо в `ChatSidebar`, теперь вынесена, чтобы
 * панель контактов можно было держать отдельным компонентом, а логику —
 * проверять без DOM.
 */

import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue'
import { getErrorMessage } from '@/services/errors'
import { searchUsers, type SearchUserResult } from '@/services/chatService'
import type { ChatUser } from '@/types'

/** Пауза перед запросом к серверу, пока человек печатает. */
export const CONTACTS_SEARCH_DEBOUNCE_MS = 300

/** Минимальная длина запроса: короче — слишком много совпадений (и лишний трафик). */
export const CONTACTS_SEARCH_MIN = 2

export interface UseContactSearch {
  /** Строка поиска по логину, имени или телефону. */
  query: Ref<string>
  /** Найденные в мессенджере за вычетом тех, кого уже добавили, и себя. */
  found: ComputedRef<SearchUserResult[]>
  /** Мои контакты после фильтра по запросу. */
  filtered: ComputedRef<ChatUser[]>
  busy: Ref<boolean>
  error: Ref<string>
}

export interface UseContactSearchOptions {
  /** Мои контакты (записная книжка). */
  contacts: () => ChatUser[]
  /** Мой id — себя в «найденных» не предлагаем. */
  currentUserId: () => number | null
}

export function useContactSearch(options: UseContactSearchOptions): UseContactSearch {
  const query = ref('')
  // Результаты поиска не трогаем при добавлении: список живёт до следующего
  // запроса, а «уже добавленных» отсеиваем на отображении — человек сразу
  // пропадает из блока «Найдены в мессенджере» и появляется в контактах.
  const foundUsers = ref<SearchUserResult[]>([])
  const busy = ref(false)
  const error = ref('')
  let timer: number | null = null

  const cancel = () => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  const found = computed<SearchUserResult[]>(() => {
    const mine = new Set(options.contacts().map((contact) => contact.id))
    return foundUsers.value.filter((user) => !mine.has(user.id))
  })

  const filtered = computed<ChatUser[]>(() => {
    const text = query.value.trim().toLowerCase()
    if (!text) return options.contacts()
    return options
      .contacts()
      .filter((contact) =>
        [contact.username, contact.first_name, contact.last_name, contact.phone_number]
          .filter(Boolean)
          .some((part) => (part as string).toLowerCase().includes(text))
      )
  })

  watch(query, (value) => {
    cancel()
    error.value = ''
    const text = value.trim()
    if (text.length < CONTACTS_SEARCH_MIN) {
      foundUsers.value = []
      busy.value = false
      return
    }
    busy.value = true
    timer = window.setTimeout(async () => {
      timer = null
      try {
        const results = await searchUsers(text)
        const mine = new Set(options.contacts().map((contact) => contact.id))
        foundUsers.value = results.filter(
          (user) => !mine.has(user.id) && user.id !== options.currentUserId()
        )
      } catch (err) {
        error.value = getErrorMessage(err, 'Не удалось выполнить поиск')
      } finally {
        busy.value = false
      }
    }, CONTACTS_SEARCH_DEBOUNCE_MS)
  })

  // Запрос в полёте после ухода со вкладки не должен трогать состояние.
  onScopeDispose(cancel)

  return { query, found, filtered, busy, error }
}
