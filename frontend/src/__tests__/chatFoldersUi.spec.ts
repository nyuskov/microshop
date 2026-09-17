import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Стражи папок чатов в интерфейсе.
 *
 * Папки живут в связке «localStorage → composable → чипы в списке → меню чата →
 * диалоги». Юнит-тестами такой путь не поймать, а сломать легко: достаточно
 * потерять подписку на событие или забыть про сохранение, и папки исчезнут без
 * ошибки. Поэтому читаем исходники и проверяем связки.
 */

const source = (path: string) => readFileSync(path, 'utf8')

const folders = source('src/utils/chatFolders.ts')
const composable = source('src/composables/useChatFolders.ts')
const list = source('src/components/messenger/ChatList.vue')
const sidebar = source('src/components/messenger/ChatSidebar.vue')
const header = source('src/components/messenger/ChatHeader.vue')
const sidebarHeader = source('src/components/messenger/SidebarHeader.vue')
const messenger = source('src/views/Messenger.vue')
const manager = source('src/components/messenger/ChatFoldersDialog.vue')
const picker = source('src/components/messenger/ChatFolderPicker.vue')

describe('хранение папок', () => {
  it('папки на устройстве и по пользователю', () => {
    expect(folders).toContain("CHAT_FOLDERS_KEY = 'pismo_chat_folders'")
    expect(composable).toContain('window.localStorage.setItem')
    expect(composable).toContain('parseChatFolders(read(), uid)')
  })

  it('правки сразу сохраняются', () => {
    for (const action of ['create', 'rename', 'remove', 'toggleChat', 'setChats', 'moveChat']) {
      expect(composable).toContain(`const ${action} = (`)
    }
    // После каждой правки — запись в localStorage (иначе папки теряются при F5).
    expect(composable.match(/persist\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(6)
  })
})

describe('чипы папок в списке чатов', () => {
  it('папки идут после базовых фильтров', () => {
    expect(sidebar).toContain('...(props.chatFolders ?? []).map((folder) => ({')
    expect(sidebar).toContain('key: folderFilter(folder.id)')
  })

  it('активная папка показывает чаты в ручном порядке', () => {
    expect(sidebar).toContain('folderChats(folder, filteredChats.value)')
  })

  it('удалённая папка не оставляет пустой список', () => {
    expect(sidebar).toContain('watch(visibleFilters')
    expect(sidebar).toContain("chatFilter.value = 'all'")
  })

  it('ряд листается мышью и пальцем, без стрелок', () => {
    // Повод: папок может быть больше, чем влезает в панель; стрелки оказались
    // лишними (пользователь: «и так понятно, что должно прокручиваться»).
    // Механизм прокрутки общий для всех лент — composables/useHScroll.ts.
    expect(list).toContain('useHScroll(() => props.filters.length)')
    expect(list).toContain('@wheel.passive="onFiltersWheel"')
    expect(list).not.toContain('chat-filters-nav')
    // Клик после протяжки не должен выбирать папку.
    expect(list).toContain('if (filtersWereDragged()) return')
    // Выбранную папку подкручиваем в видимую часть ряда.
    expect(list).toContain('revealFilter(`[data-filter="${key}"]`)')
  })

  it('долгий тап по чипу папки открывает её настройки', () => {
    expect(list).toContain("emit('manage-folder', key.slice(FOLDER_FILTER_PREFIX.length))")
    expect(list).toContain('FOLDER_HOLD_MS')
    expect(sidebar).toContain('@manage-folder="emit(\'manage-folder\', $event)"')
    expect(messenger).toContain('@manage-folder="manageFolder"')
  })

  it('кнопка «+» создаёт папку', () => {
    expect(list).toContain('aria-label="Новая папка чатов"')
    expect(list).toContain('@click="emit(\'create-folder\')"')
    expect(messenger).toContain('@create-folder="openFolderManager()"')
  })

  it('пустая папка объясняет себя, а не зовёт искать собеседника', () => {
    expect(list).toContain('В папке пока нет чатов')
  })
})

describe('диалоги папок', () => {
  it('управление: состав, порядок, переименование, удаление', () => {
    expect(manager).toContain("(e: 'create', name: string): void")
    expect(manager).toContain("(e: 'move-chat', id: string, chatId: number, delta: -1 | 1): void")
    expect(manager).toContain("emit('rename', id, name)")
    expect(manager).toContain('Удалить папку')
    // Удаление подтверждаем: папка — результат ручной работы.
    expect(manager).toContain('window.confirm(')
  })

  it('выбор папок для чата применяется сразу', () => {
    expect(picker).toContain('@change="emit(\'toggle\', folder.id, !inside(folder))"')
    expect(messenger).toContain('setFolderChatsRaw(id, ids, inside)')
    expect(messenger).toContain('createFolderRaw(name, ids[0])')
  })

  it('меню чата и панель выделения ведут в папки', () => {
    expect(header).toContain("if (action === 'folders') emit('open-chat-folders')")
    expect(header).toContain('В папку…')
    expect(sidebarHeader).toContain('@click="emit(\'bulk-folders\')"')
    expect(sidebar).toContain('@bulk-folders="emit(\'bulk-folders\', [...selectedIds])"')
    expect(messenger).toContain('@bulk-folders="openSelectedFolders"')
  })

  it('«призраков» удалённых чатов в папках не остаётся', () => {
    expect(messenger).toContain('pruneFolders(list.map((chat) => chat.id))')
  })
})
