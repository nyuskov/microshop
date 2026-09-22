import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from 'vue'

import { pingServer } from '@/services/system'

/**
 * Статус подключения к сети.
 *
 * Нужен, чтобы показать плашку «нет интернета»: без неё пользователь не
 * понимает, почему сообщение не уходит, и думает, что сломалось приложение.
 *
 * Событий браузера (`online`/`offline`) недостаточно: они говорят только про
 * сетевой интерфейс. Wi-Fi с мёртвым провайдером, VPN и мобильная сеть дают
 * «интерфейс есть, интернета нет», а событие `online` приходит не всегда —
 * поэтому связь проверяется активным маяком: раз в 5 секунд в обычном режиме и
 * раз в 2 секунды, пока связи нет (как «Соединение…» в Telegram).
 *
 * Состояние общее для всего приложения (модуль-синглтон): от него зависят и
 * плашка, и мессенджер (догрузка пропущенного), а несколько независимых
 * таймеров пинга — лишний трафик на каждом экране.
 */
export interface OnlineStatus {
  /** Есть ли сейчас связь (по данным последней проверки). */
  online: Ref<boolean>
  /** Только что восстановилась — чтобы показать «Связь восстановлена». */
  justRestored: Ref<boolean>
  /** Идёт догрузка данных после возврата связи (плашка пишет «Соединение…»). */
  syncing: Ref<boolean>
  /**
   * Первая проверка связи ещё не дала ответа.
   *
   * Нужна шапке: пока результат неизвестен, честнее показать «Соединение…»,
   * чем молчать (состояние связи до первого ответа считается живым —
   * оптимистично, чтобы приложение не мигало «нет сети» на каждом запуске).
   */
  checking: Ref<boolean>
  /**
   * Состояние для показа в шапке (`''` — всё в порядке, показывать нечего).
   *
   * Приоритет: обрыв важнее догрузки — пока связи нет, «Соединение…» врало бы.
   * Первая проверка считается «соединением»: пока ответа нет, про связь ничего
   * не известно.
   */
  state: ComputedRef<ConnectionState>
  /** Плашка сейчас на экране (другие баннеры уступают ей место). */
  bannerVisible: ComputedRef<boolean>
  /** Проверить связь немедленно. */
  recheck: () => Promise<void>
}

/** Пока связи нет — проверяем часто, чтобы не пропустить восстановление. */
export const OFFLINE_POLL_MS = 2000
/**
 * Со связью проверяем редко: обрыв обычно замечают событие браузера или первая
 * же упавшая по сети запрос-ошибка (`services/api.ts`), а частый маяк только
 * будил бы радио на телефоне.
 */
export const ONLINE_POLL_MS = 15000
/** Сколько показываем плашку «Связь восстановлена» после возврата сети. */
export const RESTORED_VISIBLE_MS = 2500
/**
 * Страховка от «залипшего» «Соединение…»: если догрузка не отчиталась за это
 * время (например, экран с догрузкой не смонтирован), снимаем флаг сами.
 */
export const SYNCING_TIMEOUT_MS = 10000
/** Событие «связь вернулась»: подписчики добирают пропущенные данные. */
export const ONLINE_RESTORED_EVENT = 'pismo:connection-restored'

/**
 * Состояние связи в том виде, в каком его показывают шапки.
 *
 * Одно на все места сразу (пилюля в шапке списка чатов и подпись в открытом
 * чате): иначе два разных «когда что показывать» разъедутся, и в одном месте
 * будет «Нет сети», а в другом — ничего.
 */
export type ConnectionState = '' | 'offline' | 'connecting' | 'restored'

const online = ref(true)
const justRestored = ref(false)
const syncing = ref(false)
/** Ответа на первую проверку ещё не было (см. `checking` в OnlineStatus). */
const checking = ref(true)

let pollTimer: number | null = null
let restoredTimer: number | null = null
let syncingTimer: number | null = null
let probeInFlight: Promise<void> | null = null
let listenersBound = false
let watchers = 0

/** Показывает «Связь восстановлена» на короткое время. */
function startRestoredTimer(): void {
  justRestored.value = true
  if (restoredTimer !== null) window.clearTimeout(restoredTimer)
  restoredTimer = window.setTimeout(() => {
    justRestored.value = false
    restoredTimer = null
  }, RESTORED_VISIBLE_MS)
}

/** Ставит флаг «добираем данные» со страховочным таймаутом. */
function startSyncing(): void {
  syncing.value = true
  if (syncingTimer !== null) window.clearTimeout(syncingTimer)
  syncingTimer = window.setTimeout(() => {
    syncing.value = false
    syncingTimer = null
  }, SYNCING_TIMEOUT_MS)
}

/**
 * Снимает флаг догрузки.
 *
 * После догрузки продлеваем «Связь восстановлена»: обычно она занимает доли
 * секунды, и без продления человек видел бы только «Соединение…», которое
 * исчезает без ответа — непонятно, всё ли в порядке.
 */
function stopSyncing(): void {
  const wasSyncing = syncing.value
  syncing.value = false
  if (syncingTimer !== null) {
    window.clearTimeout(syncingTimer)
    syncingTimer = null
  }
  if (wasSyncing && online.value) startRestoredTimer()
}

/** Связь есть; возвращает `true`, если она только что восстановилась. */
function markOnline(): boolean {
  if (online.value) return false
  online.value = true
  startRestoredTimer()
  startSyncing()
  window.dispatchEvent(new Event(ONLINE_RESTORED_EVENT))
  return true
}

/** Связи нет: плашка «нет подключения» и учащённые проверки. */
function markOffline(): void {
  if (restoredTimer !== null) {
    window.clearTimeout(restoredTimer)
    restoredTimer = null
  }
  justRestored.value = false
  // Сначала «нет связи», потом снятие флага: иначе stopSyncing решит, что
  // догрузка закончилась успешно, и покажет «Связь восстановлена» при офлайне.
  online.value = false
  stopSyncing()
}

/** Пересобирает таймер под текущее состояние (без связи опрашиваем чаще). */
function scheduleProbeTimer(): void {
  if (pollTimer !== null) window.clearInterval(pollTimer)
  pollTimer =
    watchers === 0
      ? null
      : window.setInterval(
          () => void probeConnection(),
          online.value ? ONLINE_POLL_MS : OFFLINE_POLL_MS
        )
}

/** Проверяет связь сейчас (параллельные вызовы ждут одну и ту же проверку). */
export function probeConnection(): Promise<void> {
  if (probeInFlight) return probeInFlight
  probeInFlight = pingServer()
    .then((alive) => {
      if (alive) {
        if (markOnline()) scheduleProbeTimer()
        return
      }
      // Связь пропала: пересобираем таймер — без связи спрашиваем чаще.
      if (online.value) {
        markOffline()
        scheduleProbeTimer()
      }
    })
    .finally(() => {
      probeInFlight = null
      // Результат первой проверки получен — «Соединение…» в шапке больше не врёт.
      checking.value = false
    })
  return probeInFlight
}

const onBrowserOnline = (): void => {
  // Событие — только повод проверить: интерфейс поднялся ≠ есть интернет.
  void probeConnection()
}

const onBrowserOffline = (): void => {
  markOffline()
  scheduleProbeTimer()
}

const onVisible = (): void => {
  if (document.visibilityState === 'visible') void probeConnection()
}

function bindListeners(): void {
  if (listenersBound) return
  listenersBound = true
  window.addEventListener('online', onBrowserOnline)
  window.addEventListener('offline', onBrowserOffline)
  document.addEventListener('visibilitychange', onVisible)
}

function unbindListeners(): void {
  if (!listenersBound) return
  listenersBound = false
  window.removeEventListener('online', onBrowserOnline)
  window.removeEventListener('offline', onBrowserOffline)
  document.removeEventListener('visibilitychange', onVisible)
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
  if (restoredTimer !== null) {
    window.clearTimeout(restoredTimer)
    restoredTimer = null
  }
  if (syncingTimer !== null) {
    window.clearTimeout(syncingTimer)
    syncingTimer = null
  }
}

/** Запрос к API дошёл: связь точно есть (быстрее, чем ждать маяка). */
export function reportConnectionAlive(): void {
  if (online.value) return
  if (markOnline()) scheduleProbeTimer()
}

/** Запрос к API не дошёл по сети: показываем «нет интернета» сразу. */
export function reportConnectionLost(): void {
  if (!online.value) return
  markOffline()
  scheduleProbeTimer()
}

/** Отмечает, что идёт догрузка данных после возврата связи. */
export function setConnectionSyncing(value: boolean): void {
  if (value && online.value) {
    startSyncing()
    return
  }
  stopSyncing()
}

const bannerVisible = computed(() => !online.value || justRestored.value || syncing.value)

const state = computed<ConnectionState>(() => {
  if (!online.value) return 'offline'
  if (checking.value || syncing.value) return 'connecting'
  if (justRestored.value) return 'restored'
  return ''
})

export function useOnlineStatus(): OnlineStatus {
  onMounted(() => {
    watchers += 1
    if (watchers === 1) {
      bindListeners()
      scheduleProbeTimer()
      void probeConnection()
    }
  })
  onBeforeUnmount(() => {
    watchers = Math.max(0, watchers - 1)
    if (watchers === 0) unbindListeners()
  })
  return { online, justRestored, syncing, checking, state, bannerVisible, recheck: probeConnection }
}

/** Сбрасывает состояние и снимает подписки — только для тестов. */
export function resetOnlineStatus(): void {
  watchers = 0
  unbindListeners()
  online.value = true
  justRestored.value = false
  checking.value = true
  stopSyncing()
}
