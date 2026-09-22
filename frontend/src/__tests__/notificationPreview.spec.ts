import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Скрытие текста сообщения в уведомлениях.
 *
 * Push показывает текст прямо на экране блокировки — это видят все, кто взял
 * телефон, и текст оседает в галерее уведомлений. Настройка выключает превью:
 * остаётся имя отправителя, по которому понятно, открывать ли чат.
 *
 * Решает сервер (push рисует система, а не наша страница), поэтому проверяем и
 * его правило, и то, что интерфейс отправляет настройку.
 */
const ROOT = path.resolve(import.meta.dirname, '../../..')
const front = (relative: string): string =>
  readFileSync(path.join(ROOT, 'frontend/src', relative), 'utf8')
const back = (relative: string): string =>
  readFileSync(path.join(ROOT, 'backend', relative), 'utf8')

describe('настройка в профиле', () => {
  const profile = front('views/UserProfile.vue')

  it('тумблер есть в разделе «Уведомления» и меняет профиль сразу', () => {
    expect(profile).toContain('Показывать текст сообщения')
    expect(profile).toContain('Если выключить — в уведомлении будет только имя отправителя')
    expect(profile).toContain('v-model="profileForm.notification_preview"')
    expect(profile).toContain('@update:model-value="onPreviewToggle"')
  })

  it('значение уходит на сервер вместе с профилем', () => {
    expect(profile).toContain('notification_preview: profileForm.notification_preview')
  })

  it('тумблер приглушён, когда уведомления выключены целиком', () => {
    expect(profile).toMatch(
      /v-model="profileForm\.notification_preview"[\s\S]{0,120}:disable="!profileForm\.notifications_enabled"/
    )
  })
})

describe('правило на сервере', () => {
  const task = back('tasks/notifications.py')

  it('тело уведомления зависит от настройки получателя', () => {
    expect(task).toContain('def _body_for_user(')
    expect(task).toContain('PUSH_HIDDEN_BODY')
    expect(task).toContain('if profile is not None and not profile.notification_preview:')
  })

  it('группировка push учитывает и заголовок, и тело', () => {
    // Иначе одному и тому же уведомлению с текстом ушли бы и те, кто превью
    // выключил: настройка бы не работала.
    expect(task).toContain('def _group_by_push(')
    // Запасной текст берётся переведённым: язык получателя знает сервер.
    expect(task).toContain('push_bodies.get(sub.user_id, t("Новое сообщение"))')
    expect(task).not.toContain('_group_by_title')
  })

  it('E2EE-текст в уведомление не попадает и раньше', () => {
    expect(task).toContain('🔒 Сообщение защищено сквозным шифрованием')
  })
})
