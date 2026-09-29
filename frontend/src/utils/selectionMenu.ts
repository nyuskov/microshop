/**
 * Где поставить панель формата при выделении текста.
 *
 * Панель должна вставать РЯДОМ с выделением (владелец, 29.09.2026: «в веб версии
 * меню слетает куда-то в центр, а не рядом с выделением»). Центр поля для этого
 * не годится: в вебе поле во всю ширину панели, и «по центру поля» — это центр
 * мессенджера, далеко от текста, который человек выделил.
 *
 * Браузер не отдаёт координаты выделения внутри `<textarea>`, поэтому измеряем
 * «зеркалом»: тот же размер, шрифт и отступы, но обычный блок — вставляем в него
 * текст до каретки и читаем положение невидимой метки. Приём известный
 * (textarea-caret-position), но здесь он намного короче: нужна только одна точка
 * на строке выделения, а не прямоугольник.
 */

/** Точка каретки в координатах поля: отступ слева, сверху и высота строки. */
export interface CaretBox {
  left: number
  /** Уже за вычетом прокрутки поля: панель встаёт к ВИДИМОЙ строке. */
  top: number
  /** Высота строки: по ней панель встаёт под выделение, когда сверху нет места. */
  height: number
}

/** Размер самой панели: измеряется после отрисовки (зависит от длины подписей). */
export interface PanelSize {
  width: number
  height: number
}

/** Куда встала панель: точка привязки и с какой стороны от выделения. */
export interface MenuAnchor {
  /** Отступ слева (центр панели встанет на эту точку). */
  left: number
  /** Отступ сверху: верх панели (сверху) или верх полосы под выделением (снизу). */
  top: number
  above: boolean
}

/**
 * Координаты поля, от которых считается место на экране.
 *
 * `top` — отступ поля от ВЕРХА ОКНА (`getBoundingClientRect().top`), а не от верха
 * панели: панель формата сама всплывает поверх ленты, и над ней места сколько
 * угодно — важно, чтобы она не уехала за верхний или нижний край окна.
 */
export interface FieldBox {
  width: number
  top: number
}

/**
 * Что копируем в «зеркало» из самого поля.
 *
 * Переносят текст три вещи: ширина, шрифт и внутренние отступы; рамку копируем,
 * чтобы `box-sizing: border-box` сошёлся по ширине.
 */
const MIRROR_PROPS = [
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'font-variant',
  'letter-spacing',
  'line-height',
  'text-indent',
  'text-transform',
  'word-spacing',
  'tab-size'
]

/** Индекс в границах текста: выделение могло «уехать» после перерисовки. */
const clampIndex = (index: number, length: number): number =>
  Math.max(0, Math.min(Math.trunc(index), length))

/**
 * Где в поле стоит каретка (или начало выделения).
 *
 * Координаты — от левого верхнего угла поля: у поля ввода рамки нет
 * (`border: none`), поэтому они же и координаты внутри `.editor-slot`, от
 * которого позиционируется панель.
 */
export function caretBox(el: HTMLTextAreaElement, index: number): CaretBox {
  const style = getComputedStyle(el)
  const mirror = document.createElement('div')
  for (const prop of MIRROR_PROPS) {
    mirror.style.setProperty(prop, style.getPropertyValue(prop))
  }
  mirror.style.position = 'absolute'
  mirror.style.top = '0'
  mirror.style.left = '0'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  // Ширина — вся ширина поля: строки должны переноситься так же, как в нём.
  mirror.style.boxSizing = 'border-box'
  mirror.style.width = `${el.offsetWidth}px`
  mirror.style.height = 'auto'
  // Поле ввода переносит текст сам (горизонтальной прокрутки у него нет),
  // поэтому и длинные слова «зеркало» обязано ломать.
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'

  mirror.textContent = el.value.slice(0, clampIndex(index, el.value.length))
  const marker = document.createElement('span')
  // Невидимый символ, а не пустая строка: у пустого `<span>` нечего мерить.
  marker.textContent = '\u200b'
  mirror.append(marker)
  document.body.append(mirror)

  const left = marker.offsetLeft
  const top = marker.offsetTop - el.scrollTop
  const height = Number.parseFloat(style.lineHeight) || marker.offsetHeight || 0
  mirror.remove()

  return { left, top, height }
}

/**
 * Куда панель встанет: рядом с выделением и не за краем окна.
 *
 * По умолчанию — НАД выделением (владелец, 29.09.2026: «оно снизу, а надо
 * сверху»): лента сообщений выше, там панель ничего не закрывает, а снизу её
 * съедала бы клавиатура. Сверху панель встаёт и поверх ленты, и поверх поля —
 * поэтому места хватает, пока она не упрётся в верх ОКНА: только тогда она
 * опускается под строку выделения (так бывает в развёрнутом вводе, когда
 * выделили самый верхний текст).
 *
 * `left` — центр панели: её поднимают по `translate(-50%)`, поэтому в край поля
 * упирается половина ширины. Если панель шире поля (узкий телефон), она просто
 * встаёт по центру.
 */
export function menuAnchor(box: CaretBox, panel: PanelSize, field: FieldBox, gap = 8): MenuAnchor {
  const half = panel.width / 2
  const left = Math.min(Math.max(box.left, half), Math.max(half, field.width - half))
  const above = field.top + box.top - gap >= panel.height
  return { left, top: above ? box.top : box.top + box.height, above }
}
