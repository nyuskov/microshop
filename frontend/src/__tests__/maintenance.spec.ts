/**
 * Режим технических работ в приложении.
 *
 * Смысл проверки — чтобы «заглушка» не разъехалась с сервером и не пропала из
 * интерфейса: экран показывается поверх всего приложения, включая вход; о режиме
 * узнаём из ответа 503 с кодом `maintenance` и из публичного статуса; рубильник
 * живёт в админской панели и только там.
 *
 * jsdom не считает ни раскладку, ни видимость, поэтому читаем исходники — тем же
 * приёмом, что `errorPages.spec.ts` и `adminPanel.spec.ts`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')

const screen = source('src/components/common/MaintenanceScreen.vue')
const app = source('src/App.vue')
const utils = source('src/utils/maintenance.ts')
const api = source('src/services/api.ts')
const service = source('src/services/maintenance.ts')
const watch = source('src/composables/useMaintenanceWatch.ts')
const settings = source('src/components/messenger/MaintenanceSettings.vue')
const profile = source('src/views/UserProfile.vue')

// Договор с бэкендом: путь статуса, код ошибки и обход заглушки для самого
// рубильника. Разъедется — экран молча перестанет показываться.
const backendViews = readFileSync(
  resolve(process.cwd(), '../backend/api_v1/system/views.py'),
  'utf8'
)
const backendMain = readFileSync(resolve(process.cwd(), '../backend/main.py'), 'utf8')
const backendCore = readFileSync(resolve(process.cwd(), '../backend/core/maintenance.py'), 'utf8')

describe('экран технических работ', () => {
  it('это полноэкранная заглушка поверх приложения в стиле остальных ошибок', () => {
    expect(screen).toContain("import ErrorScreen from '@/components/common/ErrorScreen.vue'")
    expect(screen).toMatch(/<ErrorScreen[\s\S]*?overlay/)
    expect(screen).toMatch(/code="503"/)
    expect(screen).toContain('Идут технические работы')
  })

  it('показывается только когда режим включён', () => {
    // Без этого условия заглушка (она всегда смонтирована в App.vue) закрыла бы
    // приложение навсегда.
    expect(screen).toMatch(/v-if="maintenanceActive"/)
    expect(screen).toContain('maintenanceActive')
  })

  it('даёт человеку кнопку проверки и обещает автообновление', () => {
    expect(screen).toContain('Проверить снова')
    expect(screen).toMatch(/fetchMaintenanceStatus/)
    expect(screen).toContain('hideMaintenance')
  })

  it('подключён в App.vue вместе с наблюдением за режимом', () => {
    expect(app).toContain(
      "import MaintenanceScreen from '@/components/common/MaintenanceScreen.vue'"
    )
    expect(app).toMatch(/<MaintenanceScreen \/>/)
    expect(app).toContain('useMaintenanceWatch()')
  })

  it('администратору и владельцу экран не показывается — иначе не выключить', () => {
    // Сервер пускает обе роли (см. main.py), значит и приложение не должно
    // закрываться перед ними: панель нужно уметь открыть.
    expect(utils).toMatch(/if \(viewerIsAdmin\) return/)
    expect(utils).toMatch(/export function setMaintenanceExempt/)
    expect(app).toContain('setMaintenanceExempt')
    expect(app).toMatch(/watch\(\(\) => authStore\.isAdmin, setMaintenanceExempt/)
    expect(backendMain).toMatch(/user\.is_admin or user\.is_superuser/)
  })
})

describe('как приложение узнаёт о режиме', () => {
  it('по ответу 503 с кодом maintenance — без гадания на другие ошибки', () => {
    expect(utils).toContain("export const MAINTENANCE_CODE = 'maintenance'")
    expect(utils).toMatch(/response\.status !== 503/)
    expect(utils).toMatch(/\.code !== MAINTENANCE_CODE/)
    expect(api).toContain('maintenanceMessageOf')
    expect(api).toContain('showMaintenance')
  })

  it('и по публичному статусу, который опрашивается, пока приложение открыто', () => {
    expect(service).toMatch(/api\.get<MaintenanceStatus>\('\/system\/maintenance\/'\)/)
    expect(service).toMatch(/api\.put<MaintenanceStatus>\('\/system\/maintenance\/'/)
    expect(watch).toMatch(/setInterval/)
    expect(watch).toContain("document.addEventListener('visibilitychange'")
    // Обрыв связи — не техработы: иначе экран вылезал бы при любом «нет сети».
    expect(watch).toMatch(/catch \{[\s\S]{0,200}?\}/)
    expect(watch).toContain('Сервер не ответил — это не повод показывать техработы')
  })

  it('пути и код совпадают с бэкендом', () => {
    expect(backendViews).toMatch(/APIRouter\(prefix="\/system"/)
    expect(backendViews).toMatch(/"\/maintenance\/"/)
    expect(backendCore).toContain('MAINTENANCE_CODE = "maintenance"')
    // Сам рубильник обязан работать во время техработ, иначе режим не выключить.
    expect(backendMain).toMatch(/MAINTENANCE_EXEMPT_PREFIXES/)
    expect(backendMain).toMatch(/system\/maintenance/)
  })
})

describe('рубильник в админской панели', () => {
  it('раздел есть в админском списке и открывает компонент', () => {
    const adminRows = profile.split('const ADMIN_ROWS')[1].split('const section =')[0]
    expect(adminRows).toContain("key: 'maintenance'")
    // Показываем рубильник только владельцу (is_superuser): включить техработы
    // значит остановить сервис всем, администратору это право не дают.
    expect(profile).toMatch(
      /v-if="section === 'maintenance' && authStore\.isOwner"[\s\S]{0,120}<MaintenanceSettings \/>/
    )
    // Рубильник не должен оказаться в обычных настройках: он служебный.
    const userRows = profile.split('const SETTINGS_ROWS')[1].split('const ADMIN_ROWS')[0]
    expect(userRows).not.toContain("'maintenance'")
  })

  it('«назад» из раздела возвращает к админскому списку, а не в профиль', () => {
    expect(profile).toMatch(
      /const ADMIN_SECTIONS: SettingsSection\[\] = \['invites', 'maintenance'\]/
    )
    expect(profile).toMatch(/ADMIN_SECTIONS\.includes\(section\.value\) \? 'admin' : 'root'/)
  })

  it('переключатель шлёт состояние на сервер и показывает его ответ', () => {
    expect(settings).toContain('setMaintenanceMode')
    expect(settings).toContain('fetchMaintenanceStatus')
    expect(settings).toMatch(/<q-toggle/)
    expect(settings).toContain('Режим технических работ')
    // Текст на экране задаётся администратором, предел совпадает с серверным.
    expect(settings).toMatch(/MESSAGE_MAX_LENGTH = 300/)
    expect(backendViews).toMatch(/MESSAGE_MAX_LENGTH = 300/)
  })
})
