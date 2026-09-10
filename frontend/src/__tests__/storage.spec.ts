import { beforeEach, describe, expect, it } from 'vitest'

import { migrateLegacyStorage } from '@/utils/storage'

describe('migrateLegacyStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('переносит ключи прежнего названия приложения и удаляет старые', () => {
    localStorage.setItem('microshop_drafts', '{"1:2":"привет"}')
    localStorage.setItem('microshop_pinned_chats', '{"1":[3]}')
    localStorage.setItem('microshop_call_kind', 'video')

    migrateLegacyStorage()

    expect(localStorage.getItem('pismo_drafts')).toBe('{"1:2":"привет"}')
    expect(localStorage.getItem('pismo_pinned_chats')).toBe('{"1":[3]}')
    expect(localStorage.getItem('pismo_call_kind')).toBe('video')
    expect(localStorage.getItem('microshop_drafts')).toBeNull()
    expect(localStorage.getItem('microshop_pinned_chats')).toBeNull()
    expect(localStorage.getItem('microshop_call_kind')).toBeNull()
  })

  it('переносит ключи E2EE конкретного пользователя (полный ключ, не только префикс)', () => {
    localStorage.setItem('microshop_e2ee_v1_7', '{"priv":"…"}')

    migrateLegacyStorage()

    expect(localStorage.getItem('pismo_e2ee_v1_7')).toBe('{"priv":"…"}')
    expect(localStorage.getItem('microshop_e2ee_v1_7')).toBeNull()
  })

  it('не затирает уже существующее новое значение', () => {
    localStorage.setItem('microshop_call_kind', 'video')
    localStorage.setItem('pismo_call_kind', 'audio')

    migrateLegacyStorage()

    expect(localStorage.getItem('pismo_call_kind')).toBe('audio')
    expect(localStorage.getItem('microshop_call_kind')).toBeNull()
  })

  it('не трогает чужие ключи', () => {
    localStorage.setItem('appearance', '{"mode":"dark"}')
    localStorage.setItem('app-theme', 'light')

    migrateLegacyStorage()

    expect(localStorage.getItem('appearance')).toBe('{"mode":"dark"}')
    expect(localStorage.getItem('app-theme')).toBe('light')
  })

  it('повторный вызов безопасен (идемпотентность)', () => {
    localStorage.setItem('microshop_drafts', '{}')

    migrateLegacyStorage()
    migrateLegacyStorage()

    expect(localStorage.getItem('pismo_drafts')).toBe('{}')
    expect(localStorage.length).toBe(1)
  })
})
