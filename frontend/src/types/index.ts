// src/types/index.ts

export interface User {
  id: number;
  email: string;
  username: string;
  is_active: boolean;
  is_superuser: boolean;
  is_verified: boolean;
  first_name?: string;
  last_name?: string;
  bio?: string;
  avatar?: string;
}

export interface Post {
  id: number;
  title: string;
  body: string;
  views: number;
  created_at: string; // ISO date string
  updated_at: string; // ISO date string
  user_id: number;
}

// Интерфейс для новой сущности Group
export interface Group {
  id: number;
  name: string;
  description?: string;
}