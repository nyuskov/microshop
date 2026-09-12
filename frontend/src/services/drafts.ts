/** Черновики сообщений — API (хранение на сервере).

Черновик привязан к паре (пользователь, чат) и живёт на сервере, поэтому
переживает переустановку приложения и виден с другого устройства. Текст для
зашифрованного чата клиент присылает уже шифротекстом — сервер его не читает
(см. `buildWireText` в Messenger.vue).

Пустой текст означает «черновика нет»: сервер удаляет строку.
*/

import { api } from './api'

/** Черновик, как его отдаёт сервер. */
export interface ServerDraft {
  chat_id: number
  text: string
  updated_at: string
}

/** Все мои черновики (свежие сверху). */
export const fetchDrafts = async (): Promise<ServerDraft[]> => {
  const response = await api.get<ServerDraft[]>('/drafts/')
  return response.data
}

/** Сохранить черновик чата (пустой текст удаляет его). */
export const putDraft = async (chatId: number, text: string): Promise<void> => {
  await api.put(`/drafts/${chatId}/`, { text })
}

/** Убрать черновик чата (сообщение отправлено или текст стёрли). */
export const deleteDraft = async (chatId: number): Promise<void> => {
  await api.delete(`/drafts/${chatId}/`)
}
