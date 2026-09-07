import axios from 'axios'

import { useAuthStore } from '../stores/auth'
import { API_BASE_URL } from '@/config'

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true // Важно для передачи cookies с токеном
})

// --- Глобальный interceptor для добавления Authorization header ---
api.interceptors.request.use(
  (config) => {
    // Получаем store и токен
    // ВНИМАНИЕ: Это работает, только если store инициализирован до первого вызова API
    const authStore = useAuthStore()
    const token = authStore.accessToken // Получаем токен из store
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)
// --- Конец interceptor ---

// --- Функции для аватара текущего пользователя ---
export const uploadAvatar = async (file: File): Promise<string | null> => {
  const extMatch = file.name.split('.').pop()
  const ext = (extMatch || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const response = await api.put('/users/me/avatar/', file, {
    params: { ext },
    headers: { 'Content-Type': file.type || 'application/octet-stream' }
  })
  return response.data?.avatar_url ?? null
}

export const removeAvatar = async (): Promise<void> => {
  await api.delete('/users/me/avatar/')
}
// --- Конец функций для аватара ---

export { api }
