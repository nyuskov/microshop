/**
 * Своя кнопка «Установить приложение».
 *
 * Chrome на Android предлагает установку только пунктом меню «⋮» → «Установить
 * приложение», и находит его не каждый (владелец: «на устройстве Redmi A3 не
 * появляется как приложение установить»). Браузер сам сообщает о готовности
 * событием `beforeinstallprompt` — перехватываем его и показываем кнопку прямо в
 * приложении, в разделе «Устройство».
 *
 * ПОЧЕМУ слушателя вешаем в `main.ts`, а не рядом с кнопкой: событие приходит один
 * раз и только если условия установки выполнены. Раздел «Устройство» ленивый
 * (`defineAsyncComponent` в профиле), к моменту его загрузки событие уже прошло бы —
 * и кнопки не было бы никогда.
 *
 * ПОЧЕМУ `preventDefault()`: без него Chrome показывает свою мини-подсказку и
 * забирает событие себе. Перехватив, мы обязаны предложить установку сами — иначе
 * её не увидит никто; кнопка и есть это предложение.
 */

import { computed, shallowRef, type ComputedRef } from 'vue'

/**
 * Событие установки: в стандартной библиотеке его нет, поэтому описываем сами.
 * Есть только в Chromium-браузерах — в Safari установка живёт в «Поделиться».
 */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Чем кончилась попытка установки. `unavailable` — браузер её не предлагает. */
export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable'

const deferred = shallowRef<InstallPromptEvent | null>(null)

/** Установили прямо сейчас, в этой сессии (событие `appinstalled`). */
export const installedNow = shallowRef(false)

/** Браузер готов поставить приложение — значит кнопку показывать есть смысл. */
export const canInstall: ComputedRef<boolean> = computed(
  () => deferred.value !== null && !installedNow.value
)

/** Подписывается на события браузера. Зовётся один раз при старте приложения. */
export function watchInstallPrompt(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred.value = event as InstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    deferred.value = null
    installedNow.value = true
  })
}

/**
 * Показывает системное окно установки и возвращает, чем кончилось.
 *
 * Событие одноразовое: после показа оно «сгорает», поэтому очищаем его в любом
 * случае — кнопка исчезает, а не жмётся впустую (дважды окно не показать; когда
 * браузер снова будет готов, он сообщит об этом сам).
 */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferred.value
  if (!event) return 'unavailable'
  deferred.value = null
  await event.prompt()
  const choice = await event.userChoice
  if (choice.outcome === 'accepted') installedNow.value = true
  return choice.outcome
}

/** Сбрасывает состояние. Нужен тестам: модуль держит состояние между файлами. */
export function resetInstallPrompt(): void {
  deferred.value = null
  installedNow.value = false
}
