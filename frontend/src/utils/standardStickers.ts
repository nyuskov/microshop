/**
 * Стандартные стикеры приложения (файл сгенерирован `scripts/build-standard-stickers.py`).
 *
 * Это наши собственные картинки, а не чужой набор: они лежат в `public/` и
 * раздаются как статика, поэтому у сервера нет ни строк в БД, ни файлов в
 * `media/`. Отправка ничем не отличается от своих стикеров: клиент скачивает
 * байты и уходит сообщением с `sticker=true`.
 *
 * Удалить их нельзя (это часть приложения, а не библиотека человека), поэтому
 * в окне «Мои стикеры» их не видно — они всегда первые в панели.
 */

export interface StandardSticker {
  name: string
  /** Путь к файлу в `public/` (готовый URL, без префикса API). */
  url: string
  /** Подпись для скринридера и подсказки. */
  label: string
}

export interface StandardStickerPack {
  key: string
  title: string
  stickers: StandardSticker[]
}

export const STANDARD_STICKER_PACKS: StandardStickerPack[] = [
  {
    key: 'reactions',
    title: 'Реакции',
    stickers: [
      {
        name: 'ok',
        url: '/stickers/reactions/ok.png',
        label: 'Ок'
      },
      {
        name: 'yes',
        url: '/stickers/reactions/yes.png',
        label: 'Да'
      },
      {
        name: 'no',
        url: '/stickers/reactions/no.png',
        label: 'Нет'
      },
      {
        name: 'thanks',
        url: '/stickers/reactions/thanks.png',
        label: 'Спасибо'
      },
      {
        name: 'please',
        url: '/stickers/reactions/please.png',
        label: 'Пожалуйста'
      },
      {
        name: 'hello',
        url: '/stickers/reactions/hello.png',
        label: 'Привет'
      },
      {
        name: 'bye',
        url: '/stickers/reactions/bye.png',
        label: 'Пока'
      },
      {
        name: 'agree',
        url: '/stickers/reactions/agree.png',
        label: 'Согласен'
      },
      {
        name: 'funny',
        url: '/stickers/reactions/funny.png',
        label: 'Смешно'
      },
      {
        name: 'love',
        url: '/stickers/reactions/love.png',
        label: 'Люблю'
      },
      {
        name: 'sorry',
        url: '/stickers/reactions/sorry.png',
        label: 'Извини'
      },
      {
        name: 'wait',
        url: '/stickers/reactions/wait.png',
        label: 'Минуту'
      },
      {
        name: 'great',
        url: '/stickers/reactions/great.png',
        label: 'Отлично'
      },
      {
        name: 'doubt',
        url: '/stickers/reactions/doubt.png',
        label: 'Сомневаюсь'
      },
      {
        name: 'hug',
        url: '/stickers/reactions/hug.png',
        label: 'Обнимаю'
      },
      {
        name: 'congrats',
        url: '/stickers/reactions/congrats.png',
        label: 'Поздравляю'
      }
    ]
  },
  {
    key: 'work',
    title: 'Работа',
    stickers: [
      {
        name: 'done',
        url: '/stickers/work/done.png',
        label: 'Готово'
      },
      {
        name: 'in_progress',
        url: '/stickers/work/in_progress.png',
        label: 'В работе'
      },
      {
        name: 'call_me',
        url: '/stickers/work/call_me.png',
        label: 'Созвон'
      },
      {
        name: 'meeting',
        url: '/stickers/work/meeting.png',
        label: 'Встреча'
      },
      {
        name: 'deadline',
        url: '/stickers/work/deadline.png',
        label: 'Дедлайн'
      },
      {
        name: 'report',
        url: '/stickers/work/report.png',
        label: 'Отчёт'
      },
      {
        name: 'vacation',
        url: '/stickers/work/vacation.png',
        label: 'В отпуске'
      },
      {
        name: 'question',
        url: '/stickers/work/question.png',
        label: 'Вопрос'
      }
    ]
  },
  {
    key: 'food',
    title: 'Еда',
    stickers: [
      {
        name: 'coffee',
        url: '/stickers/food/coffee.png',
        label: 'Кофе'
      },
      {
        name: 'lunch',
        url: '/stickers/food/lunch.png',
        label: 'Обед'
      },
      {
        name: 'tea',
        url: '/stickers/food/tea.png',
        label: 'Чай'
      },
      {
        name: 'hungry',
        url: '/stickers/food/hungry.png',
        label: 'Голоден'
      },
      {
        name: 'tasty',
        url: '/stickers/food/tasty.png',
        label: 'Вкусно'
      },
      {
        name: 'pizza',
        url: '/stickers/food/pizza.png',
        label: 'Пицца'
      },
      {
        name: 'cake',
        url: '/stickers/food/cake.png',
        label: 'Торт'
      },
      {
        name: 'bill',
        url: '/stickers/food/bill.png',
        label: 'Счёт'
      }
    ]
  },
  {
    key: 'holidays',
    title: 'Праздники',
    stickers: [
      {
        name: 'happy_new_year',
        url: '/stickers/holidays/happy_new_year.png',
        label: 'С Новым годом'
      },
      {
        name: 'happy_birthday',
        url: '/stickers/holidays/happy_birthday.png',
        label: 'С днём рождения'
      },
      {
        name: 'merry_christmas',
        url: '/stickers/holidays/merry_christmas.png',
        label: 'С Рождеством'
      },
      {
        name: 'congratulations',
        url: '/stickers/holidays/congratulations.png',
        label: 'Поздравляю'
      },
      {
        name: 'hooray',
        url: '/stickers/holidays/hooray.png',
        label: 'Ура'
      },
      {
        name: 'gift',
        url: '/stickers/holidays/gift.png',
        label: 'Подарок'
      },
      {
        name: 'party',
        url: '/stickers/holidays/party.png',
        label: 'Праздник'
      },
      {
        name: 'thanks_again',
        url: '/stickers/holidays/thanks_again.png',
        label: 'Спасибо!'
      }
    ]
  }
]
