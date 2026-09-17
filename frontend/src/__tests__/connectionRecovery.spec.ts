import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Стражи «связь вернулась — данные догрузились».
 *
 * Связь проверяется маяком (см. `useOnlineStatus`), но сама догрузка живёт в
 * связке: событие восстановления → обработчик мессенджера → обновление списков.
 * Юнит-тестом этот путь не поймать (сценарий «был офлайн, потом онлайн» в
 * приложении один), а сломать легко: достаточно забыть про подписку — и данные
 * останутся старыми, хотя плашка уже погасла.
 */

const source = (path: string) => readFileSync(path, 'utf8')

const online = source('src/composables/useOnlineStatus.ts')
const messenger = source('src/views/Messenger.vue')
const api = source('src/services/api.ts')
const system = source('src/services/system.ts')
const banner = source('src/components/common/OfflineBanner.vue')

describe('проверка связи', () => {
  it('спрашивает сервер, а не браузер', () => {
    expect(online).toContain('pingServer()')
    expect(system).toContain('fetch(`${API_BASE_URL}/system/ping/')
    // Маяк не должен зависеть от общих интерцепторов и кэша.
    expect(system).toContain("cache: 'no-store'")
    expect(system).toContain('controller.abort()')
  })

  it('без связи опрашивает чаще, чем со связью', () => {
    expect(online).toContain('online.value ? ONLINE_POLL_MS : OFFLINE_POLL_MS')
    expect(online).toMatch(/OFFLINE_POLL_MS = 2000/)
    expect(online).toMatch(/ONLINE_POLL_MS = \d+/)
    // Таймер пересобирается при смене состояния — иначе после обрыва остался
    // бы редкий опрос в 5 секунд и плашка висела бы дольше нужного.
    expect(online).toContain('markOffline()\n        scheduleProbeTimer()')
  })

  it('плашка сверху объясняет три состояния', () => {
    expect(banner).toContain('Нет подключения к интернету')
    expect(banner).toContain('Соединение…')
    expect(banner).toContain('Связь восстановлена')
    expect(banner).toContain('top: 0')
  })
})

describe('догрузка после возврата связи', () => {
  it('мессенджер подписан на событие восстановления и отписывается', () => {
    expect(messenger).toContain(
      'window.addEventListener(ONLINE_RESTORED_EVENT, onConnectionRestored)'
    )
    expect(messenger).toContain(
      'window.removeEventListener(ONLINE_RESTORED_EVENT, onConnectionRestored)'
    )
  })

  it('догрузка обновляет чаты, открытую переписку и истории', () => {
    const handler = messenger.slice(messenger.indexOf('const onConnectionRestored'))
    expect(handler).toContain('setConnectionSyncing(true)')
    expect(handler).toContain('flushOutbox()')
    expect(handler).toContain('refreshChatsQuiet()')
    expect(handler).toContain('refreshOpenThreadQuiet()')
    expect(handler).toContain('storiesStore.load()')
    expect(handler).toContain('setConnectionSyncing(false)')
  })

  it('очередь «Ждёт сети» опирается на проверенную связь', () => {
    // `navigator.onLine` врёт: интерфейс есть — интернета нет.
    expect(messenger).not.toContain('navigator.onLine')
    expect(messenger).toContain('if (!onlyId && !online.value) return')
  })

  it('запросы к API сами сообщают о потере и восстановлении связи', () => {
    expect(api).toContain('reportConnectionAlive()')
    expect(api).toContain('reportConnectionLost()')
    // Отменённый запрос (навигация) — не признак обрыва.
    expect(api).toContain("error.code !== 'ERR_CANCELED'")
  })
})
