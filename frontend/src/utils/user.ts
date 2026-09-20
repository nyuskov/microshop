/** Утилиты отображения имени пользователя и аватара (градиент). */

import { ref } from 'vue'

import { mediaUrl } from '@/config'
import type { Chat, ChatUser } from '@/types'

/**
 * Личные имена контактов («записная книжка»).
 *
 * Живут в модуле, а не в конкретном компоненте: имя контакта должно
 * подставляться ВЕЗДЕ — в списке чатов, шапке, превью, поиске, уведомлениях,
 * без правок каждого места. Реестр обновляет стор контактов
 * (`setContactNames`), поэтому `displayName()` всегда видит свежие имена.
 *
 * ПОЧЕМУ `ref`, а не обычный объект (грабля 2026-09-20): имя считается внутри
 * вычисляемых свойств и кэшируется. Пока реестр был обычной переменной, Vue не
 * знал о его изменении — и имена «сбивались»: чаты грузятся ОДНОВРЕМЕННО с
 * контактами, поэтому первые вычисления успевали закэшировать логин, а сами
 * имена появлялись только после того, как человек откроет чат или обновит
 * список (любое другое изменение пересчитывало вычисляемое).
 */
const contactNames = ref<Record<number, string>>({})

/** Обновляет реестр имён контактов (вызывает стор контактов). */
export const setContactNames = (names: Record<number, string>): void => {
  contactNames.value = names
}

/** Имя, которым пользователь назвал контакт (если назвал). */
export const contactNameOf = (userId: number | null | undefined): string | undefined =>
  userId === null || userId === undefined ? undefined : contactNames.value[userId]

export const fullName = (
  first: string | null | undefined,
  last: string | null | undefined,
  username: string
): string => {
  if (first && last) return `${first} ${last}`
  if (first) return first
  if (last) return last
  return username
}

/**
 * Отображаемое имя пользователя.
 * Приоритет: личное имя контакта → имя и фамилия из профиля → логин.
 */
export const displayName = (user: {
  id?: number
  first_name?: string | null
  last_name?: string | null
  username: string
}): string => contactNameOf(user.id) ?? fullName(user.first_name, user.last_name, user.username)

export const initials = (value: string): string => {
  const clean = value.trim()
  if (!clean) return '?'
  const parts = clean.split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase()
  }
  return clean.slice(0, 2).toUpperCase()
}

const AVATAR_COLORS = [
  'linear-gradient(135deg,#5b9bd5,#2e75b6)',
  'linear-gradient(135deg,#69b578,#2f8f5b)',
  'linear-gradient(135deg,#e58e7a,#c25e4a)',
  'linear-gradient(135deg,#b28ce0,#7c53b8)',
  'linear-gradient(135deg,#f0a35e,#d97b2b)',
  'linear-gradient(135deg,#6fc3c9,#2f9aa3)'
]

export const avatarStyle = (name: string): Record<string, string> => {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return { background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }
}

/**
 * Абсолютный URL аватара для кружка 40–56px (списки, шапки, участники).
 *
 * Сервер рядом с оригиналом хранит миниатюру 128px: оригинал с телефона может
 * весить мегабайты, а на экране разница не видна. Миниатюры нет — показываем
 * оригинал (аватары, загруженные до её появления).
 */
export const avatarUrlOf = (
  user: { avatar_url?: string | null; avatar_thumb_url?: string | null } | null | undefined
): string | undefined => {
  const path = user?.avatar_thumb_url || user?.avatar_url
  return path ? mediaUrl(path) : undefined
}

/** Оригинал аватара — для экранов, где фото показывается крупно. */
export const avatarFullUrlOf = (
  user: { avatar_url?: string | null } | null | undefined
): string | undefined => (user?.avatar_url ? mediaUrl(user.avatar_url) : undefined)

/** Второй участник личного чата (не текущий пользователь). */
export const chatPeer = (chat: Chat, currentUserId: number | null): ChatUser | undefined => {
  if (currentUserId !== null) {
    const found = chat.users.find((user) => user.id !== currentUserId)
    if (found) return found
  }
  return chat.users[0]
}

/** Отображаемое название чата (для личных чатов — имя собеседника). */
export const chatPeerTitle = (chat: Chat, currentUserId: number | null): string => {
  // «Сохранённые сообщения» — это чат с собой, показываем его название.
  if (chat.is_self) return chat.name || 'Сохранённые сообщения'
  const peer = chatPeer(chat, currentUserId)
  return peer ? displayName(peer) : chat.name
}

/** Личный чат ровно с двумя участниками. */
export const isPrivateChat = (chat: Chat): boolean =>
  !chat.is_group && !chat.is_self && chat.users.length === 2

/** Групповой чат (общий для нескольких участников). */
export const isGroupChat = (chat: Chat): boolean =>
  chat.is_group === true || (!chat.is_self && chat.users.length > 2)

/**
 * Аватар группы или канала — скруглённый квадрат, у личного чата — круг.
 *
 * Форма различает тип чата до чтения подписи: рупор канала виден, а группа от
 * личного чата отличается только названием и числом участников. Логика в одном
 * месте, потому что аватар чата рисуется и в списке, и в шапке переписки, и в
 * результатах поиска — им всем нужен один ответ (класс `.rounded`).
 */
export const chatAvatarRounded = (chat: Chat): boolean =>
  Boolean(chat.is_channel) || isGroupChat(chat)

/**
 * Отображаемое название чата.
 * Группа — собственное название; личный чат — имя собеседника;
 * «Сохранённые сообщения» — как в chatPeerTitle.
 */
export const chatTitle = (chat: Chat, currentUserId: number | null): string => {
  if (isGroupChat(chat)) return chat.name || 'Группа'
  return chatPeerTitle(chat, currentUserId)
}

/** Аватар группы (None — группы нет/нет фото; нужен initials-фолбэк). */
export const groupAvatarUrl = (chat: Chat): string | undefined => {
  if (!isGroupChat(chat)) return undefined
  const path = chat.avatar_thumb_url || chat.avatar_url
  return path ? mediaUrl(path) : undefined
}

/** Находит участника группы по id (для имён авторов в ленте). */
export const chatMemberOf = (chat: Chat | undefined, userId: number): ChatUser | undefined =>
  chat?.users.find((user) => user.id === userId)
