import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Служебные разделы (приглашения, техработы, жалобы) — внутри настроек профиля.
 *
 * Раньше вход был плавающей «шестерёнкой» внизу списка чатов, а раздел «Жалобы»
 * открывался отдельным окном: на телефоне это мешало («значок мешает», «из жалоб
 * назад дороги нет»). Теперь вход — пункт «Администрирование» в списке настроек
 * (виден только администратору), а «Жалобы» — такой же раздел, как «Технические
 * работы»: со своей шапкой и кнопкой «назад».
 *
 * jsdom не считает ни раскладку, ни видимость, поэтому читаем исходники.
 */
const sidebar = readFileSync('src/components/messenger/ChatSidebar.vue', 'utf8')
const rows = readFileSync('src/assets/rows.css', 'utf8')
const header = readFileSync('src/components/messenger/SidebarHeader.vue', 'utf8')
const profile = readFileSync('src/views/UserProfile.vue', 'utf8')
const messenger = readFileSync('src/views/Messenger.vue', 'utf8')
const overlays = readFileSync('src/views/MessengerModerationOverlays.vue', 'utf8')
const reportsSection = readFileSync('src/components/messenger/ModerationReportsSection.vue', 'utf8')

describe('вход в служебные разделы — пункт настроек', () => {
  it('шестерёнки в панели чатов больше нет', () => {
    // Ни кнопки, ни её стилей, ни запаса снизу под неё, ни обработчиков в
    // родителе: возвращать плавающий значок не нужно (просьба владельца).
    expect(sidebar).not.toContain('admin-gear')
    expect(sidebar).not.toContain("emit('open-admin')")
    expect(rows).not.toContain('has-admin-gear')
    expect(messenger).not.toContain('goToAdmin')
    expect(messenger).not.toContain('profileStartSection')
    expect(messenger).not.toContain("'open-admin'")
  })

  it('пункт «Администрирование» добавляется только администратору', () => {
    expect(profile).toMatch(
      /const settingsEntries = computed<SettingsEntry\[\]>\(\(\) =>\s*\(authStore\.isAdmin \? \[\.\.\.SETTINGS_ROWS, ADMIN_ENTRY\] : SETTINGS_ROWS\)\.map\(/
    )
    expect(profile).toMatch(/key: 'admin',/)
    // Пункт идёт последним и попадает в поиск по настройкам (единый список).
    expect(profile).toMatch(/v-for="row in visibleSettingsEntries"/)
    expect(profile).toMatch(/:class="\{ 'settings-link--admin': row\.key === 'admin' \}"/)
  })

  it('пункт — обычная строка, а отделяет его полоса, как перед «Выйти из аккаунта»', () => {
    // Владелец: «не бордер, а как здесь просто полоса сверху». Полоса — отдельный
    // элемент, а не рамка кнопки: рамка читалась частью пункта.
    const separator = profile.slice(profile.indexOf('.settings-separator {'))
    const separatorBlock = separator.slice(separator.indexOf('{'), separator.indexOf('}'))

    expect(separatorBlock).toContain('border-top: 1px dashed var(--ms-border)')
    expect(separatorBlock).toContain('margin: var(--ms-space-3) 0')
    // Та же полоса, что у блока выхода/удаления аккаунта.
    expect(profile).toMatch(
      /\.delete-account-row \{[\s\S]*?border-top: 1px dashed var\(--ms-border\);/
    )
    expect(profile).toMatch(
      /<div v-if="row\.key === 'admin'" class="settings-separator" aria-hidden="true"><\/div>/
    )
    // Своей геометрии у служебного пункта нет — только цвет иконки.
    expect(profile).toMatch(/\.settings-link--admin \.settings-link-icon \{/)
    expect(profile).not.toContain('.settings-link--admin {')
  })
})

describe('служебные разделы отделены от обычных настроек', () => {
  it('в списке обычных разделов нет приглашений и жалоб', () => {
    const userRows = profile.split('const SETTINGS_ROWS')[1].split('const ADMIN_ROWS')[0]
    const adminRows = profile.split('const ADMIN_ROWS')[1].split('const ADMIN_ENTRY')[0]

    expect(userRows).not.toContain("key: 'invites'")
    expect(userRows).not.toContain("key: 'reports'")
    expect(userRows).not.toContain("key: 'maintenance'")
    expect(adminRows).toContain("key: 'invites'")
    expect(adminRows).toContain("key: 'maintenance'")
    expect(adminRows).toContain("key: 'reports'")
  })

  it('служебный список рисуется по section === "admin"', () => {
    expect(profile).toMatch(/v-if="section === 'admin'"/)
    expect(profile).toMatch(/:aria-label="t\('Разделы администрирования'\)"/)
  })

  it('«назад» из служебного раздела возвращает к служебному списку', () => {
    expect(profile).toMatch(
      /const ADMIN_SECTIONS: SettingsSection\[\] = \['invites', 'maintenance', 'reports'\]/
    )
    expect(profile).toMatch(/ADMIN_SECTIONS\.includes\(section\.value\) \? 'admin' : 'root'/)
  })

  it('шапка раздела есть у служебного экрана и стоит СВЕРХУ содержимого', () => {
    // Раньше у админского экрана шапки не было (заголовок давало окно), и
    // заголовок служебного списка стоял ниже его пунктов — читалось как подпись
    // к списку (владелец: «заголовок не сверху»).
    expect(profile).toMatch(/v-if="section !== 'root'" class="settings-head"/)
    expect(profile).toMatch(/class="settings-head-title"/)
    // Стрелка «к разделам» есть у каждого служебного раздела.
    expect(profile).toMatch(/class="settings-back"/)

    const headIndex = profile.indexOf('class="settings-head"')
    const adminListIndex = profile.indexOf(':aria-label="t(\'Разделы администрирования\')"')
    const settingsListIndex = profile.indexOf(':aria-label="t(\'Разделы настроек\')"')

    expect(headIndex).toBeLessThan(adminListIndex)
    expect(headIndex).toBeLessThan(settingsListIndex)
  })

  it('системный «назад» с экрана настроек идёт по разделам, а не закрывает окно', () => {
    expect(profile).toMatch(/const isInSection = \(\) => section\.value !== 'root'/)
    expect(profile).toMatch(/useMobileLayer\(isInSection, backToSections\)/)
  })

  it('окно настроек называется «Настройки»: заголовок раздела даёт сам раздел', () => {
    expect(messenger).toMatch(/const profileTitle = computed<string>\(\(\) => t\('Настройки'\)\)/)
    expect(messenger).toMatch(/\{\{ profileTitle \}\}/)
    expect(profile).toContain("if (section.value === 'admin') return t('Администрирование')")
  })

  it('«Жалобы» больше не живут ни в меню «⋯», ни отдельным окном', () => {
    expect(header).not.toContain('reports')
    expect(header).not.toContain('isAdmin')
    expect(overlays).not.toContain('openReports')
    expect(overlays).not.toContain('ModerationReportsDialog')
    expect(existsSync('src/components/messenger/ModerationReportsDialog.vue')).toBe(false)
  })
})

describe('раздел «Жалобы»', () => {
  it('это раздел настроек со своим содержимым, а не диалог', () => {
    expect(profile).toMatch(
      /v-if="section === 'reports'"[\s\S]{0,120}<ModerationReportsSection \/>/
    )
    expect(profile).toMatch(/const ModerationReportsSection = defineAsyncComponent/)
    // Открывается из служебного списка как обычная строка настроек.
    expect(profile).toMatch(
      /const openAdminRow = \(key: AdminRow\['key'\]\) => \{\s*section\.value = key/
    )
    expect(profile).not.toContain("emit('open-moderation')")
  })

  it('внутри — очередь разбора, журнал и обновление', () => {
    expect(reportsSection).toContain('fetchReports')
    expect(reportsSection).toContain('updateReportStatus')
    expect(reportsSection).toContain('fetchJournal')
    expect(reportsSection).toContain('unhideUserMessages')
    expect(reportsSection).toContain('Журнал')
    expect(reportsSection).toContain(':aria-label="t(\'Обновить\')"')
    // Заголовок и крестик закрытия больше не нужны: их даёт окно настроек.
    expect(reportsSection).not.toContain('q-dialog')
    expect(reportsSection).not.toContain('aria-label="Закрыть"')
  })
})
