import axios from 'axios'
import { useAuthStore } from '../stores/auth' // Исправленный путь: services/../stores/auth -> stores/auth

const API_BASE_URL = 'https://localhost:8000/api/v1' // Изменено на https

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

// --- Функции для работы с пользователями ---
export const fetchAllUsers = async () => {
  const response = await api.get('/users/') // Предполагаемый эндпоинт для получения всех пользователей
  return response.data
}

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

// --- Новая функция для получения групп пользователя ---
export const fetchUserGroups = async (userId: number) => {
  const response = await api.get(`/users/${userId}/groups/`)
  return response.data
}
// --- Конец новой функции ---

// --- Функции для работы с группами ---
export const fetchGroups = async () => {
  const response = await api.get('/groups/')
  return response.data
}

export const fetchGroupById = async (id: number) => {
  const response = await api.get(`/groups/${id}/`)
  return response.data
}

export const createGroup = async (groupData: { name: string; description?: string }) => {
  const response = await api.post('/groups/', groupData)
  return response.data
}

export const updateGroup = async (
  id: number,
  groupData: { name: string; description?: string }
) => {
  const response = await api.put(`/groups/${id}/`, groupData)
  return response.data
}

export const partialUpdateGroup = async (
  id: number,
  groupData: Partial<{ name: string; description?: string }>
) => {
  const response = await api.patch(`/groups/${id}/`, groupData)
  return response.data
}

export const deleteGroup = async (id: number) => {
  const response = await api.delete(`/groups/${id}/`)
  return response.data
}

// --- Новые функции для работы с пользователями в группе ---
export const fetchUsersInGroup = async (groupId: number) => {
  const response = await api.get(`/groups/${groupId}/users/`)
  return response.data
}

export const updateUsersInGroup = async (groupId: number, userIds: number[]) => {
  const response = await api.put(`/groups/${groupId}/users/`, { user_ids: userIds })
  return response.data
}
// --- Конец новых функций ---

export { api }
