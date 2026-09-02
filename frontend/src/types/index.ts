export interface Group {
  id: number
  name: string
  description?: string
  users: User[] // Связь с пользователями
}

// Определим типы для Post и Profile
export interface Post {
  id: number
  title: string
  body: string
  user_id: number // или ссылка на User
}

export interface Profile {
  id: number
  first_name: string | null
  last_name: string | null
  bio: string | null
  user_id: number // или ссылка на User
}

// Обновим интерфейс User, чтобы включить posts и profile
export interface User {
  id: number
  username: string
  email?: string
  is_active: boolean
  is_superuser: boolean
  posts: Post[] // Добавим поле posts
  profile: Profile | null // Добавим поле profile
  // Группы, к которым принадлежит пользователь, не определены здесь
  // и будут добавлены динамически в компоненте Users.vue
}
