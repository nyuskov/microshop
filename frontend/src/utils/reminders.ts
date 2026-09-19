/**
 * Напоминание о сообщении («напомнить мне»): варианты времени и подписи.
 *
 * Отличие от отложенной отправки (`utils/scheduledSend.ts`): там выбирают, КОГДА
 * отправить новое сообщение, здесь — когда вернуть человека к уже отправленному.
 * Поэтому набор пресетов другой: час-два вперёд бесполезны (человек ещё помнит
 * сам), а «вечером» и «завтра» — самые нужные.
 *
 * Пресеты считаются от текущего момента и только в будущее: время, которое уже
 * прошло (например «сегодня в 20:00» в 21:00), сервер отклонит — такой пункт не
 * показываем, а не показываем недостижимое.
 */

/** Готовый вариант «напомнить»: подпись в списке и момент напоминания. */
export interface ReminderPreset {
  label: string
  at: Date
}

/** Час вечернего напоминания и час утреннего («завтра в 9:00»). */
const EVENING_HOUR = 20
const MORNING_HOUR = 9

const atTime = (day: Date, hour: number, minute = 0): Date => {
  const moment = new Date(day)
  moment.setHours(hour, minute, 0, 0)
  return moment
}

const timeLabel = (date: Date): string =>
  date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

/**
 * Варианты «напомнить» для меню сообщения.
 *
 * Порядок — от ближайшего к дальнему: «через 20 минут» (вернуться к тому же
 * делу) нужен чаще всего.
 */
export const reminderPresets = (now: Date = new Date()): ReminderPreset[] => {
  const presets: ReminderPreset[] = [
    { label: 'Через 20 минут', at: new Date(now.getTime() + 20 * 60 * 1000) },
    { label: 'Через час', at: new Date(now.getTime() + 60 * 60 * 1000) }
  ]

  const todayEvening = atTime(now, EVENING_HOUR)
  if (todayEvening.getTime() > now.getTime()) {
    presets.push({ label: `Сегодня в ${timeLabel(todayEvening)}`, at: todayEvening })
  }

  const tomorrowMorning = atTime(new Date(now.getTime() + 24 * 60 * 60 * 1000), MORNING_HOUR)
  presets.push({ label: `Завтра в ${timeLabel(tomorrowMorning)}`, at: tomorrowMorning })

  const week = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  presets.push({ label: `Через неделю в ${timeLabel(week)}`, at: week })

  return presets
}

/** Момент напоминания в том виде, в каком его ждёт сервер (UTC, ISO). */
export const reminderSendAt = (at: Date): string => at.toISOString()
