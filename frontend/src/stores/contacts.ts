/** Стор контактов: моя «записная книжка» и личные имена собеседников. */

import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { deleteContact, fetchMyContacts, saveContact } from '@/services/contacts'
import { setContactNames } from '@/utils/user'
import type { Contact, ChatUser } from '@/types'

export const useContactsStore = defineStore('contacts', () => {
  const items = ref<Contact[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  /** Мои контакты как обычные пользователи (для списков и поиска). */
  const users = computed<ChatUser[]>(() => items.value.map((item) => item.user))

  /** Раздел «мои контакты» — для быстрой проверки «уже добавлен?». */
  const ids = computed<Set<number>>(() => new Set(items.value.map((item) => item.user.id)))

  const isContact = (userId: number): boolean => ids.value.has(userId)

  /** Личное имя контакта (пусто — не назван). */
  const nameOf = (userId: number): string => {
    const found = items.value.find((item) => item.user.id === userId)
    return found?.custom_name ?? ''
  }

  const upsertLocal = (saved: Contact): void => {
    const index = items.value.findIndex((item) => item.user.id === saved.user.id)
    if (index === -1) {
      items.value = [...items.value, saved]
      return
    }
    const next = items.value.slice()
    next[index] = saved
    items.value = next
  }

  /** Загружает контакты (повторно — только по требованию). */
  const load = async (force = false): Promise<void> => {
    if (loading.value || (loaded.value && !force)) return
    loading.value = true
    try {
      items.value = await fetchMyContacts()
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  /** Добавляет в контакты / переименовывает. */
  const save = async (userId: number, customName?: string | null): Promise<Contact> => {
    const saved = await saveContact(userId, customName)
    upsertLocal(saved)
    return saved
  }

  /** Убирает из контактов (переписка остаётся). */
  const remove = async (userId: number): Promise<void> => {
    await deleteContact(userId)
    items.value = items.value.filter((item) => item.user.id !== userId)
  }

  /** Сбрасывает состояние (выход из аккаунта). */
  const reset = (): void => {
    items.value = []
    loaded.value = false
  }

  // Имена контактов держим в общем реестре: `displayName()` подставляет их во
  // всём приложении (список чатов, шапка, превью, поиск).
  watch(
    items,
    (list) => {
      const names: Record<number, string> = {}
      for (const item of list) {
        const name = item.custom_name?.trim()
        if (name) names[item.user.id] = name
      }
      setContactNames(names)
    },
    { immediate: true, deep: true }
  )

  return {
    items,
    users,
    ids,
    loading,
    loaded,
    isContact,
    nameOf,
    load,
    save,
    remove,
    reset
  }
})
