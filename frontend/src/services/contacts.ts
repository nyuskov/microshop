/** Контакты («записная книжка») — API. */

import { api } from './api'
import type { Contact } from '@/types'

/** Мои контакты (с личными именами). */
export const fetchMyContacts = async (): Promise<Contact[]> => {
  const response = await api.get<Contact[]>('/contacts/')
  return response.data
}

/**
 * Добавляет человека в контакты или меняет его имя.
 * `customName` пустой — показывается обычное имя из профиля.
 */
export const saveContact = async (userId: number, customName?: string | null): Promise<Contact> => {
  const response = await api.put<Contact>(`/contacts/${userId}/`, {
    custom_name: customName?.trim() ? customName.trim() : null
  })
  return response.data
}

/** Убирает человека из контактов (переписка при этом остаётся). */
export const deleteContact = async (userId: number): Promise<void> => {
  await api.delete(`/contacts/${userId}/`)
}
