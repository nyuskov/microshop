import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Роли: администратор (`is_admin`) и владелец (`is_superuser`).
 *
 * Зачем разделили: помощникам нужны жалобы, приглашения и обход экрана
 * техработ, но НЕ рубильник техработ — включить его значит остановить сервис
 * всем. Раньше флаг был один, и «дать админку» означало «дать всё».
 *
 * Проверяем границы ролей по исходникам: где-то фильтруются эндпоинты, где-то —
 * пункты меню, и забыть про любую из сторон легко.
 */

const source = (path: string) => readFileSync(path, 'utf8')

const auth = source('src/stores/auth.ts')
const profile = source('src/views/UserProfile.vue')
const app = source('src/App.vue')
const types = source('src/types/index.ts')
const backendUtils = source('../backend/api_v1/auth/utils.py')
const backendSystem = source('../backend/api_v1/system/views.py')
const backendModeration = source('../backend/api_v1/moderation/views.py')
const backendInvites = source('../backend/api_v1/auth/routers/invites.py')
const backendMain = source('../backend/main.py')
const model = source('../backend/core/models/user.py')
const migration = source('../backend/alembic/versions/2026_09_17_1600-e8f9a0b1c2d3_add_is_admin.py')

describe('роли в модели и в миграции', () => {
  it('есть отдельный флаг администратора', () => {
    expect(model).toContain('is_admin: Mapped[bool]')
    expect(migration).toContain('"is_admin"')
    // По умолчанию — никто не админ: новые права сами не появляются.
    expect(migration).toContain('server_default=sa.false()')
  })

  it('сервер различает роли', () => {
    expect(backendUtils).toContain('async def get_current_admin(')
    expect(backendUtils).toContain('async def get_current_superuser(')
    expect(backendUtils).toContain('user.is_admin or user.is_superuser')
  })
})

describe('что доступно администратору, а что только владельцу', () => {
  it('жалобы и приглашения — обеим ролям', () => {
    expect(backendModeration).not.toContain('get_current_superuser')
    expect(backendModeration).toContain('get_current_admin')
    expect(backendInvites).not.toContain('get_current_superuser')
    expect(backendInvites).toContain('get_current_admin')
  })

  it('рубильник техработ — только владельцу', () => {
    const toggle = backendSystem.slice(backendSystem.indexOf('async def set_maintenance'))
    expect(toggle).toContain('Depends(get_current_superuser)')
    expect(toggle).not.toContain('Depends(get_current_admin)')
  })

  it('заглушка техработ пропускает обе роли, обычных — нет', () => {
    // Проверка «запрос от администратора» живёт в общем модуле (`auth/utils.py`):
    // её используют и заглушка в `main.py`, и публичный статус техработ.
    // Роль считается по токену (`admin_viewer_of`), а заглушка пропускает только
    // `VIEWER_ADMIN`: негодный токен уходит на 401 (чтобы клиент обновил сессию),
    // всё остальное — 503.
    expect(backendUtils).toContain('user.is_admin or user.is_superuser')
    expect(backendMain).toContain('if viewer == VIEWER_ADMIN')
    expect(backendMain).toContain('if viewer == VIEWER_INVALID')
  })
})

describe('роли в интерфейсе', () => {
  it('auth-store: isAdmin для обеих ролей, isOwner — только владелец', () => {
    expect(auth).toContain('state.user?.is_admin === true || state.user?.is_superuser === true')
    expect(auth).toMatch(/isOwner: \(state\): boolean => state\.user\?\.is_superuser === true/)
    expect(auth).toContain('is_admin?: boolean')
    expect(types).toContain('is_admin?: boolean')
  })

  it('админский раздел открыт обеим ролям', () => {
    // «Шестерёнка» и раздел «Администрирование» — по общему признаку isAdmin.
    expect(app).toContain('authStore.isAdmin')
    expect(source('src/views/Messenger.vue')).toContain(':is-admin="authStore.isAdmin"')
  })

  it('пункт «Технические работы» виден только владельцу', () => {
    expect(profile).toContain('const adminRows = computed<AdminRow[]>')
    expect(profile).toContain("row.key !== 'maintenance' || authStore.isOwner")
    expect(profile).toContain('v-for="row in adminRows"')
    expect(profile).toContain("section === 'maintenance' && authStore.isOwner")
  })
})
