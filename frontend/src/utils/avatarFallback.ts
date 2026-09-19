/**
 * Запасной адрес аватара, если миниатюра не загрузилась.
 *
 * Рядом с оригиналом аватара сервер хранит миниатюру 128px
 * (`user_5_ab12cd_t128.jpg`), и клиент предпочитает её: оригинал с телефона
 * бывает в мегабайты, а показывается он кружком 40–56px. Но файла миниатюры
 * может не оказаться — так было на проде, когда ночная очистка media удалила
 * миниатюры, а ссылки в БД остались. Тогда `<img>` рисует битую картинку, и
 * аватар просто «пропадает».
 *
 * Имя миниатюры выводится из имени оригинала (`thumb_stored_name` на сервере),
 * поэтому запасной адрес можно собрать на клиенте: отрезаем суффикс `_t128` и
 * перебираем расширения, которые бывают у аватаров. Расширение оригинала в
 * ссылке на миниатюру не сохраняется, поэтому перебор — единственный способ.
 *
 * Адрес читаем из атрибута `src` (`.getAttribute`), а не из свойства: свойство
 * браузер делает абсолютным (`http://host/media/...`), и подменённая ссылка
 * уезжала бы с чужого хоста, если приложение открыто не там, где медиа.
 *
 * Слушатель один на всё приложение (`installAvatarFallback`): аватары рисуются в
 * двух десятках компонентов, и правка каждого `<img>` рано или поздно разошлась
 * бы — ровно так, как разошлись списки «сирот» на сервере.
 */

/** Суффикс миниатюры в имени файла: `_t128`, `_t192` и т.п. */
const THUMB_SUFFIX = /_t\d+\.(?:jpe?g|png|webp)$/i

/** Расширения, с которыми аватары лежат в media (в порядке вероятности). */
const AVATAR_EXTENSIONS = ['jpg', 'png', 'webp'] as const

/** Признак «сколько попыток ещё осталось» на элементе (в dataset). */
const ATTEMPTS_KEY = 'avatarLeft'

/**
 * Запасные адреса для ссылки на миниатюру (пусто — ссылка не на миниатюру).
 *
 * На вход — ссылка на миниатюру (`/media/avatars/user_5_ab_t128.jpg`), на
 * выходе — возможные ссылки на оригинал: `/media/avatars/user_5_ab.jpg`,
 * `…_ab.png`, `…_ab.webp`. Оригинала может и не быть ни в одном из расширений —
 * тогда список просто будет перебран до конца, а картинка останется пустой.
 */
export const avatarFallbackCandidates = (src: string): string[] => {
  const match = THUMB_SUFFIX.exec(src)
  if (match === null) return []
  const stem = src.slice(0, match.index)
  return AVATAR_EXTENSIONS.map((extension) => `${stem}.${extension}`)
}

const remainingCandidates = (img: HTMLImageElement): string[] => {
  const stored = img.dataset[ATTEMPTS_KEY]
  if (stored !== undefined) {
    try {
      const parsed: unknown = JSON.parse(stored)
      return Array.isArray(parsed) ? (parsed as string[]) : []
    } catch {
      return []
    }
  }
  return avatarFallbackCandidates(img.getAttribute('src') ?? '')
}

/**
 * Обработчик ошибки загрузки картинки: подставляет следующего кандидата.
 *
 * Когда кандидаты кончились, `src` убираем совсем: пустое место (там, где
 * разметка предусматривает инициалы) выглядит лучше «битой» иконки браузера.
 */
export const handleAvatarError = (event: Event): void => {
  const img = event.target
  if (!(img instanceof HTMLImageElement)) return
  const candidates = remainingCandidates(img)
  const next = candidates.shift()
  if (next === undefined) {
    img.removeAttribute('src')
    return
  }
  img.dataset[ATTEMPTS_KEY] = JSON.stringify(candidates)
  img.src = next
}

/**
 * Слушает ошибки загрузки картинок на фазе перехвата.
 *
 * `error` у элементов не всплывает, поэтому нужен именно `capture: true` —
 * иначе событие до `window` не дойдёт и подмена не сработает.
 */
export const installAvatarFallback = (): void => {
  window.addEventListener('error', handleAvatarError, true)
}
