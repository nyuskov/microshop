export interface ChatUser {
  id: number
  username: string
  first_name: string | null
  last_name: string | null
  phone_number: string | null
  avatar_url: string | null
  /** Миниатюра 128px для списков и шапок (нет — показываем оригинал). */
  avatar_thumb_url?: string | null
  status?: string | null
  last_seen?: string | null
}

export interface MessageFile {
  name: string
  url: string
  mime: string | null
  size: number | null
}

/** Вкладка галереи медиа чата. */
export type ChatMediaKind = 'image' | 'video' | 'audio' | 'file'

/**
 * Вложение чата в галерее «Медиа/Файлы» (ответ `/messages/{id}/media/`).
 *
 * Лента отдаёт историю страницами, поэтому галерею строит сервер: элемент
 * ссылается на сообщение (`id`) и содержит данные вложения.
 */
export interface ChatMediaItem {
  id: number
  timestamp: string
  url: string
  name: string
  mime: string | null
  size: number | null
  kind: ChatMediaKind
}

/**
 * Конверт зашифрованного вложения (E2EE).
 *
 * Лежит ВНУТРИ зашифрованного текста сообщения, поэтому сервер его не читает:
 * видны только шифротекст файла и нейтральное имя `enc_*.bin`. `k` — ключ
 * файла, `i` — его IV, `n`/`m`/`s` — настоящее имя, MIME-тип и размер,
 * `c` — подпись к файлу (тоже зашифрована).
 */
export interface EncryptedFileMeta {
  v: 1
  t: 'file'
  n: string
  m: string
  s: number
  k: string
  i: string
  c?: string
}

export interface ReactionSummary {
  emoji: string
  count: number
  reacted_by_me: boolean
}

/** Данные плашки «Переслано от …» (снимок на момент пересылки). */
export interface ForwardedFrom {
  id: number
  sender_id: number | null
  sender_name: string
  /** Аватар автора оригинала (снимок на момент пересылки). */
  sender_avatar_url?: string | null
  chat_id: number | null
}

/** Плашка «Ответ на историю»: снимок медиа истории на момент ответа. */
export interface StoryReplyPreview {
  /** `null` — история уже удалена (снимок медиа при этом остался). */
  id: number | null
  media_url: string | null
  mime_type: string | null
}

/**
 * Карточка внешней ссылки из сообщения (превью сайта, как в Telegram).
 *
 * `image_url` — путь к НАШЕМУ файлу (`/media/...`): картинку скачал сервер,
 * поэтому её нужно прогонять через `mediaUrl()`.
 */
export interface LinkPreview {
  url: string
  /** Удалось ли собрать карточку (иначе её не показываем). */
  ok: boolean
  title?: string | null
  description?: string | null
  site_name?: string | null
  image_url?: string | null
  /** Домен для подписи (youtube.com). */
  domain?: string | null
}

/**
 * Контакт в моей «записной книжке».
 *
 * `custom_name` — как Я назвал человека. Вижу его только я (собеседник его не
 * видит и не узнаёт о нём). Пусто — показывается обычное имя из профиля.
 */
export interface Contact {
  user: ChatUser
  custom_name: string | null
  created_at: string
}

export interface Chat {
  id: number
  name: string
  users: ChatUser[]
  last_message: Message | null
  unread_count: number
  /** Замьючен ли чат для текущего пользователя (хранится на сервере). */
  muted?: boolean
  /** Тип чата: true — «зашифрованный» (E2EE), false/нет — «обычный». */
  e2ee_enabled?: boolean
  /** «Сохранённые сообщения» (личный чат с собой; удалить нельзя). */
  is_self?: boolean
  /** Групповой чат (общий для многих участников). */
  is_group?: boolean
  /** Канал: читают подписчики, публикуют владелец и админы. */
  is_channel?: boolean
  /** Публичный адрес канала (`/c/<channel_username>`); нет — приватный. */
  channel_username?: string | null
  /** Публичный канал: виден в поиске и по ссылке. */
  is_public?: boolean
  /** Аватар группы (путь /media/...). */
  avatar_url?: string | null
  /** Миниатюра аватара группы для списков (путь /media/...). */
  avatar_thumb_url?: string | null
  /** Описание группы. */
  description?: string | null
  /** Количество участников группы. */
  member_count?: number
  /** Роль текущего пользователя: creator / admin / member. */
  my_role?: 'creator' | 'admin' | 'member' | string
  /** Создатель группы. */
  creator_id?: number | null
}

/** Участник чата с ролью (для карточки группы). */
export interface ChatMember extends ChatUser {
  role: 'creator' | 'admin' | 'member' | string
}

/** Карточка канала (GET /channels/{id}/, поиск, превью по ссылке). */
export interface ChannelCard {
  id: number
  title: string
  description?: string | null
  /** Публичный адрес (`/c/<username>`); null — приватный канал. */
  username?: string | null
  is_public?: boolean
  avatar_url?: string | null
  avatar_thumb_url?: string | null
  /** Сколько подписчиков (включая владельца и админов). */
  subscribers: number
  /** Сколько постов опубликовано. */
  posts: number
  /** Моя роль: creator/admin/member или null (не подписан). */
  role?: string | null
  /** Имя владельца канала. */
  owner_name?: string | null
}

/** Комментарий под постом канала. */
export interface ChannelComment {
  id: number
  message_id: number
  user_id: number
  name: string
  username: string
  avatar_url?: string | null
  text: string
  created_at: string
  /** Можно ли удалить (свой или я владелец/админ канала). */
  can_delete?: boolean
}

/** Счётчики поста: просмотры и комментарии. */
export interface ChannelPostMeta {
  message_id: number
  views: number
  comments: number
}

/** Пост, предложенный подписчиком (ждёт решения владельца/админа). */
export interface ChannelSuggestion {
  id: number
  chat_id: number
  author_id: number
  author_name: string
  text: string
  status: 'pending' | 'approved' | 'rejected' | string
  message_id?: number | null
  created_at: string
}

/** Карточка чата вместе с участниками и их ролями (GET /chats/{id}/). */
export interface ChatDetail extends Chat {
  members: ChatMember[]
}

export interface CreateGroupRequest {
  name: string
  user_ids: number[]
  description?: string | null
}

export interface GroupInfoUpdate {
  name?: string
  description?: string | null
}

export interface Message {
  id: number
  chat_id: number
  user_id: number
  text: string
  timestamp: string
  reply_to_id: number | null
  is_read: boolean
  is_pinned: boolean
  encrypted?: boolean
  /**
   * Конверт зашифрованного вложения. Заполняется клиентом после расшифровки
   * текста сообщения (в API его нет); пока пусто — показываем «🔒 Вложение».
   */
  e2ee_file?: EncryptedFileMeta | null
  /** kind: 'text' — обычное; 'call' — системная отметка о звонке; 'sticker' — картинка-стикер. */
  kind?: 'text' | 'call' | 'sticker'
  call_kind?: 'audio' | 'video'
  call_state?: 'completed' | 'missed' | 'declined'
  call_duration?: number
  call_caller_id?: number
  edited_at: string | null
  file: MessageFile | null
  reactions: ReactionSummary[]
  forwarded_from: ForwardedFrom | null
  /**
   * Пометка «ответ на историю»: снимок медиа истории на момент ответа. Медиа
   * хранится в самом сообщении, поэтому плашка живёт и после удаления истории
   * (тогда `id` — `null`).
   */
  reply_to_story?: StoryReplyPreview | null
  /**
   * Скрыто модерацией до разбора (авто после 3 жалоб или решением модератора).
   * Такое сообщение видит только автор — с пометкой «скрыто до проверки»;
   * остальным оно не приходит вовсе (см. api_v1/moderation/service.py).
   */
  hidden?: boolean
  hidden_reason?: string | null
}

export interface CreateMessageRequest {
  text: string
  chat_id: number
  reply_to_id?: number | null
  /** Ответ на историю: автору в личный чат, с плашкой и превью медиа. */
  reply_to_story_id?: number | null
  encrypted?: boolean
}

export interface OpenPrivateChatRequest {
  user_id: number
}

export interface Profile {
  bio: string | null
  birth_date: string | null
  language: string | null
  country: string | null
  notifications_enabled: boolean
  privacy_mode: boolean
}

export interface User {
  id: number
  username: string
  phone_number?: string | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  is_superuser?: boolean
  /** Администратор: модерация и приглашения, без рубильника техработ. */
  is_admin?: boolean
  avatar_url?: string | null
  /** Миниатюра аватара 128px: списки и шапки берут её вместо оригинала. */
  avatar_thumb_url?: string | null
  status?: string | null
  profile?: Profile | null
  chats?: Chat[]
  posts?: unknown[]
}

export interface Group {
  id: number
  name: string
  description?: string
  users?: User[]
}

/** Ссылка-приглашение в группу (создаёт создатель или админ). */
export interface GroupInvite {
  id: number
  token: string
  /** Путь ссылки (`/j/<токен>`); полный адрес собирает клиент (свой origin). */
  path: string
  created_at: string
  expires_at: string | null
  max_uses: number | null
  uses: number
  revoked: boolean
  /** Ссылка ещё работает: не отозвана, не истекла, лимит входов не исчерпан. */
  active: boolean
}

/** Карточка группы по ссылке — что видит приглашённый до вступления. */
export interface GroupInvitePreview {
  chat_id: number
  name: string
  description: string | null
  avatar_url: string | null
  avatar_thumb_url: string | null
  member_count: number
  /** Он уже в группе — вступать не нужно, просто открываем чат. */
  is_member: boolean
  /** Ссылка уже не работает (отозвана/истекла/исчерпана). */
  expired: boolean
}

/** Результат входа по ссылке. */
export interface GroupJoinResult {
  chat_id: number
  name: string
}
