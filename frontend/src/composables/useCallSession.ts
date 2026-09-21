import { computed, ref, watch, type ComputedRef } from 'vue'
import { t } from '@/i18n'
import { useCallStore } from '@/stores/call'
import { isCallStillPending } from '@/services/pendingCall'
import { closeCallRings, showIncomingCallRing } from '@/services/pwa'
import { displayName } from '@/utils/user'

/** Собеседник звонка, каким его видит интерфейс (имя + аватар). */
export type CallPeer = {
  username: string
  first_name?: string | null
  last_name?: string | null
  avatar_url?: string | null
  avatar_thumb_url?: string | null
}

export interface CallSessionDeps {
  /** Приложение готово: сессия восстановлена и пользователь известен. */
  ready: ComputedRef<boolean>
  /** Поиск собеседника среди чатов и контактов (для имени/аватара звонка). */
  findPeerUser: (id: number) => CallPeer | undefined
}

type CallLaunchScreen = 'none' | 'ring' | 'missed'

/**
 * Обвязка звонков: интерфейс ↔ стор.
 *
 * Здесь живёт всё, что раньше было размазано по `views/Messenger.vue`:
 * экран ожидания «Входящий звонок…» при запуске по уведомлению (пока
 * сигнальный канал не доставил припаркованный offer), системный «будильник»
 * при свёрнутом приложении и действия кнопок push («Ответить»/«Отклонить»).
 * Разметка экрана остаётся в представлении — компонуем её по этим данным.
 */
export function useCallSession({ ready, findPeerUser }: CallSessionDeps) {
  const callStore = useCallStore()

  // ---------- Запуск из уведомления о звонке ----------
  // Приложение открыли тапом по push «Вам звонят…» (?call=<id>&peer=<uid>).
  // Пока сигнальный WS не доставит припаркованный offer, показываем
  // полноэкранный «Входящий звонок…», чтобы не «моргал» список чатов.
  // Если offer так и не пришёл (вызов сброшен/истёк) — «Вызов завершён».
  const callLaunch = ref<{ callId: string; peerId: number; action?: string } | null>(null)
  const callLaunchScreen = ref<CallLaunchScreen>('none')
  /** Нажали «Ответить» на экране ожидания — offer ещё не пришёл, ждём его. */
  const callLaunchAnswering = ref(false)
  let callLaunchTimer: ReturnType<typeof setTimeout> | undefined
  let callLaunchVerifyTimer: ReturnType<typeof setTimeout> | undefined
  // Ждём припаркованный offer: собеседник мог открыть приложение из push,
  // для этого нужно время на загрузку и подключение WebSocket.
  const CALL_LAUNCH_WAIT_MS = 25_000
  // Через сколько проверить у сервера, ждёт ли вызов ещё (см. verifyPendingCall).
  // Даём сигнальному каналу время подключиться и забрать offer из парковки.
  const CALL_LAUNCH_VERIFY_MS = 3000
  // Действие из push-уведомления, ожидающее доставки offer (см. watcher'ы ниже).
  let autoAnswerPending = false
  let autoDeclinePending = false

  /** Идентификатор вызова, для которого открыт экран ожидания (пусто — экрана нет). */
  const launchCallId = computed<string>(() => callLaunch.value?.callId ?? '')

  /** Имя собеседника для экрана «Входящий звонок…». */
  const callLaunchPeerName = computed<string>(() => {
    const peerId = callLaunch.value?.peerId
    if (peerId === undefined) return ''
    const peer = findPeerUser(peerId)
    return peer ? displayName(peer) : ''
  })

  const stopCallLaunchScreen = () => {
    callStore.stopRinging()
    callLaunchScreen.value = 'none'
    callLaunchAnswering.value = false
    if (callLaunchTimer !== undefined) {
      window.clearTimeout(callLaunchTimer)
      callLaunchTimer = undefined
    }
    if (callLaunchVerifyTimer !== undefined) {
      window.clearTimeout(callLaunchVerifyTimer)
      callLaunchVerifyTimer = undefined
    }
  }

  /**
   * Проверяет, ждёт ли этот звонок ещё ответа.
   *
   * Экран «Входящий звонок…» открывается по уведомлению, пока вызов лежит в
   * парковке на сервере. Уведомление может быть устаревшим: звонок давно
   * отклонили, ответили на другом устройстве или зовущий его отменил. Тогда
   * парковки уже нет — закрываем экран сразу, а не через 25 секунд ожидания.
   */
  const verifyPendingCall = async (callId: string) => {
    const pending = await isCallStillPending(callId)
    // null — не знаем (нет сети): не мешаем человеку, работает обычное ожидание.
    if (pending !== false) return
    // Пока спрашивали, вызов мог дойти своим ходом — тогда экран уже не наш.
    if (callStore.status !== 'idle') return
    if (callLaunch.value?.callId !== callId) return
    callLaunch.value = null
    stopCallLaunchScreen()
    callStore.notice = t('Звонок завершён')
  }

  const showCallLaunchRing = () => {
    if (!callLaunch.value) return
    const launch = callLaunch.value
    callLaunchScreen.value = 'ring'
    // Звук с самого открытия, пока WS не доставит offer (дальше стор сам звонит).
    callStore.ringIncoming()
    if (callLaunchVerifyTimer !== undefined) window.clearTimeout(callLaunchVerifyTimer)
    callLaunchVerifyTimer = window.setTimeout(() => {
      callLaunchVerifyTimer = undefined
      void verifyPendingCall(launch.callId)
    }, CALL_LAUNCH_VERIFY_MS)
    if (callLaunchTimer !== undefined) window.clearTimeout(callLaunchTimer)
    callLaunchTimer = window.setTimeout(() => {
      if (callLaunchScreen.value !== 'ring') return
      callLaunchScreen.value = 'missed'
      callStore.stopRinging()
      autoAnswerPending = false
      autoDeclinePending = false
      callLaunchAnswering.value = false
      callLaunchTimer = window.setTimeout(() => {
        callLaunchScreen.value = 'none'
        callLaunch.value = null
        callLaunchTimer = undefined
      }, 3500)
    }, CALL_LAUNCH_WAIT_MS)
  }

  /** Пользователь сам закрыл экран «Входящий звонок…» (до доставки offer). */
  const dismissCallLaunch = () => {
    const launch = callLaunch.value
    if (launch) callStore.declineCallTo(launch.peerId, launch.callId)
    autoAnswerPending = false
    autoDeclinePending = false
    callLaunchAnswering.value = false
    callLaunch.value = null
    stopCallLaunchScreen()
  }

  /**
   * Нажали «Ответить» на экране ожидания (offer ещё в пути).
   *
   * Отвечать пока нечем — SDP собеседника придёт с припаркованным offer'ом. Но
   * желание человека уже известно: как только offer доставят, `acceptCall()`
   * выполнится сам (см. watcher статуса). Иначе зовущий ждал бы таймаут, хотя
   * «Ответить» уже нажали — и это выглядело бы как отказ.
   */
  const answerCallLaunch = () => {
    if (callLaunchAnswering.value) return
    callLaunchAnswering.value = true
    autoAnswerPending = true
    autoDeclinePending = false
  }

  /**
   * Применяет «запуск из уведомления о звонке»: экран ожидания offer и действие
   * из push («Ответить»/«Отклонить»).
   *
   * Нужна отдельно от watcher'а готовности, потому что готовность и запуск
   * приходят в разном порядке: при холодном старте сессия восстанавливается из
   * localStorage сразу, поэтому `ready` уже true к моменту разбора адреса
   * — раньше действие «Ответить» из уведомления в таком случае терялось, и
   * звонок приходилось принимать вручную (зовущий всё это время слышал гудки).
   */
  const applyCallLaunch = () => {
    const launch = callLaunch.value
    if (!launch || !ready.value) return
    const wanted =
      launch.action === 'answer' || launch.action === 'decline' ? launch.action : 'focus'
    // Offer мог прийти раньше, чем мы обработали запуск: тогда watcher статуса
    // уже не сработает, поэтому действие выполняем сразу.
    if (callStore.status === 'incoming') {
      callLaunch.value = null
      callLaunchScreen.value = 'none'
      if (callLaunchTimer !== undefined) {
        window.clearTimeout(callLaunchTimer)
        callLaunchTimer = undefined
      }
      if (wanted === 'answer') void callStore.acceptCall()
      else if (wanted === 'decline') callStore.declineCall()
      return
    }
    if (callStore.status !== 'idle') return
    if (wanted === 'decline') {
      // «Отклонить» — без экрана: ждём доставки offer и отклоняем (см. watcher).
      autoDeclinePending = true
      // Через окно ожидания флаг снимаем: иначе он выстрелил бы на следующем
      // звонке (offer по отклонённому вызову уже не придёт).
      if (callLaunchTimer !== undefined) window.clearTimeout(callLaunchTimer)
      callLaunchTimer = window.setTimeout(() => {
        callLaunchTimer = undefined
        autoDeclinePending = false
        callLaunch.value = null
      }, CALL_LAUNCH_WAIT_MS)
      return
    }
    autoAnswerPending = wanted === 'answer'
    showCallLaunchRing()
  }

  /**
   * Запускает экран входящего звонка по данным уведомления (адрес `?call=…`,
   * нативная оболочка Android, push). Приложение может быть полностью закрыто:
   * сам вызов уже ждёт в парковке на сервере (см. `calls.park_offer`).
   */
  const beginCallLaunch = (
    callId: string,
    peerId: number,
    action: 'answer' | 'decline' | 'focus' = 'focus'
  ) => {
    if (!callId || !peerId) return
    // Звонок уже идёт/звонит — экран ожидания только мешал бы, но действие из
    // уведомления терять нельзя: иначе «Ответить» из push просто ничего не делал
    // бы (звонок у зовущего дотелефонит до таймаута и запишется пропущенным).
    if (callStore.status !== 'idle') {
      if (action === 'answer' && callStore.status === 'incoming') {
        void callStore.acceptCall()
      } else if (action === 'decline' && callStore.status === 'incoming') {
        callStore.declineCall()
      }
      return
    }
    callLaunch.value = { callId, peerId, action }
    applyCallLaunch()
  }

  // ---------- Входящий звонок при свёрнутом приложении (системное уведомление) ----------
  // Если звонок пришёл, а приложение свёрнуто/в фоне — показываем системный
  // «будильник» с кнопкой «Ответить» ОДИН раз на звонок.
  //
  // Раньше уведомление пере-показывалось каждые 3,5 секунды (ради звука/вибрации,
  // «как рингтон»). На Android это выглядело как бесконечный поток уведомлений:
  // нажал «Ответить» — оно тут же возвращается; а если звонок к тому моменту уже
  // завершился, возвращалось вечно. Уведомление и так держится на экране
  // (`requireInteraction`), а когда звонок закончится, его закроет service worker.
  const buildCallRing = () => {
    const peerName =
      callStore.peerName && !callStore.peerName.startsWith('@') ? callStore.peerName : ''
    return {
      title: peerName || t('Входящий звонок'),
      body: callStore.kind === 'video' ? t('Видеозвонок') : t('Аудиозвонок'),
      callId: callStore.callId ?? '',
      peerId: callStore.peerId ?? 0
    }
  }

  const ringIncomingCallWhenHidden = () => {
    if (!document.hidden) return
    if (callStore.status !== 'incoming' || callStore.peerId === null || !callStore.callId) return
    void showIncomingCallRing(buildCallRing())
  }

  /**
   * Единственный источник правды о том, что «звонит»: если звонок уже не входящий
   * (принят, идёт разговор, завершён) — ни рингтона, ни системного уведомления быть
   * не должно, где бы оно ни появилось: после ответа, повторного push или возврата
   * в приложение. Иначе получается «ещё один звонок» во время разговора.
   */
  const syncCallRings = () => {
    if (callStore.status === 'incoming') return
    void closeCallRings()
  }

  /** Приложение свернули во время входящего звонка — будим и «звоним». */
  const handleCallVisibility = () => {
    if (document.hidden) {
      ringIncomingCallWhenHidden()
      return
    }
    // В фоне таймеры душатся: звонок, о завершении которого нам не сообщили,
    // дожидается возврата на экран — иначе окно вызова со звуком висит вечно.
    callStore.dropStaleRinging()
    syncCallRings()
  }

  /**
   * Звонок завершился там, где мы его не видели (приняли на другом устройстве,
   * отклонили, зовущий снял вызов) — гасим экран ожидания, если это наш вызов.
   * Идущий разговор не трогаем (см. `finishIfRinging`).
   */
  const onCallCancelled = (callId: string) => {
    if (callLaunch.value?.callId && callLaunch.value.callId === callId) {
      callLaunch.value = null
      stopCallLaunchScreen()
    }
    callStore.finishIfRinging(callId)
  }

  // Звонок ушёл из состояния «входящий» (принят/отменён/завершён) — убираем уведомление.
  watch(() => callStore.status, syncCallRings)

  // Сервер повторил предложение уже идущего вызова (или пришёл повторный push) —
  // звонок заново не начинаем и висящее уведомление убираем.
  watch(() => callStore.ignoredCallOffers, syncCallRings)

  // Запуск из уведомления о звонке: offer доставлен (появился реальный звонок) —
  // убираем промежуточный экран. Рингтон уже продолжает стор (здесь не глушим).
  watch(
    () => callStore.status,
    (status) => {
      if (status !== 'idle' && callLaunchScreen.value !== 'none') {
        callLaunchScreen.value = 'none'
        if (callLaunchTimer !== undefined) {
          window.clearTimeout(callLaunchTimer)
          callLaunchTimer = undefined
        }
        callLaunch.value = null
      }
    }
  )

  // Кнопки push-уведомления о звонке: когда offer доставлен (звонок «входящий»),
  // выполняем действие — «Ответить» принимает, «Отклонить» отклоняет.
  watch(
    () => callStore.status,
    (status) => {
      if (status !== 'incoming') return
      if (autoDeclinePending) {
        autoDeclinePending = false
        callStore.declineCall()
      } else if (autoAnswerPending) {
        autoAnswerPending = false
        void callStore.acceptCall()
      }
    }
  )

  // Обогащаем карточку собеседника (имя/аватар) при звонке из списка чатов/контактов.
  watch(
    [() => callStore.status, () => callStore.peerId],
    ([status, peerId]) => {
      if (status === 'idle' || peerId === null) return
      const peer = findPeerUser(peerId)
      if (peer) {
        callStore.setPeerInfo({
          name: displayName(peer),
          avatarUrl: peer.avatar_thumb_url ?? peer.avatar_url ?? null
        })
      }
      // Если приложение свёрнуто — показываем системное уведомление о звонке.
      ringIncomingCallWhenHidden()
    },
    { immediate: true }
  )

  return {
    /** Экран ожидания: 'none' | 'ring' | 'missed'. */
    callLaunchScreen,
    /** Нажали «Ответить», offer ещё в пути. */
    callLaunchAnswering,
    /** Имя собеседника для экрана ожидания. */
    callLaunchPeerName,
    /** Вызов, для которого открыт экран ожидания (пусто — экрана нет). */
    launchCallId,
    beginCallLaunch,
    applyCallLaunch,
    answerCallLaunch,
    dismissCallLaunch,
    stopCallLaunchScreen,
    onCallCancelled,
    syncCallRings,
    handleCallVisibility
  }
}
