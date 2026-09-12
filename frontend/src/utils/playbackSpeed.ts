/**
 * Скорость воспроизведения голосовых и видеосообщений.
 *
 * Длинные голосовые удобно слушать быстрее (как в нативных мессенджерах).
 * Выбор общий для всех плееров в приложении: переключил один раз на 1.5× —
 * дальше так играют и остальные сообщения (иначе пришлось бы переключать каждое).
 *
 * Храним только в памяти: после перезагрузки снова обычная скорость — так
 * предсказуемее, и лишних ключей в localStorage не появляется.
 */

import { ref } from 'vue'

/** Доступные скорости по кругу. */
export const PLAYBACK_SPEEDS = [1, 1.5, 2] as const

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

/** Текущая скорость (общая для всех сообщений). */
export const playbackSpeed = ref<PlaybackSpeed>(1)

/** Следующая скорость по кругу: 1× → 1.5× → 2× → 1×. */
export const nextPlaybackSpeed = (current: number): PlaybackSpeed => {
  const index = PLAYBACK_SPEEDS.indexOf(current as PlaybackSpeed)
  return PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length]
}

/** Подпись скорости: `1×`, `1.5×`, `2×`. */
export const speedLabel = (speed: number): string => `${speed}×`

/** Переключает скорость для всех плееров и возвращает новое значение. */
export const cyclePlaybackSpeed = (): PlaybackSpeed => {
  playbackSpeed.value = nextPlaybackSpeed(playbackSpeed.value)
  return playbackSpeed.value
}
