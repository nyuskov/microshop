/**
 * Прогресс загрузки файла на сервер.
 *
 * Браузер отдаёт в событии прогресса, сколько байт уже ушло и сколько всего;
 * нам нужен процент для индикатора. Округление вниз до целого: «99%» на глаз
 * честнее, чем «100%», пока сервер ещё не ответил.
 */
export const uploadPercent = (loaded: number, total: number): number | null => {
  if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0) return null
  const percent = Math.floor((loaded / total) * 100)
  if (percent <= 0) return 0
  return percent > 100 ? 100 : percent
}

/**
 * Текст статуса под вложением: без прогресса — просто «Отправка…», с ним —
 * «Отправка… 42%», чтобы на медленной сети было видно, что процесс живой.
 */
export const uploadStatusText = (percent: number | null | undefined): string =>
  typeof percent === 'number' ? `Отправка… ${percent}%` : 'Отправка…'
