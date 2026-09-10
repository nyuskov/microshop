/**
 * Соответствие «логическое имя иконки → иконка Font Awesome Free».
 *
 * В разметке и хелперах имена остаются прежними (`close`, `reply`, `videocam`):
 * так код не зависит от конкретного набора иконок, а замена набора — это правка
 * одного этого файла. Преобразование делает `icon()` (см. ниже), а CSS и
 * урезанный шрифт собираются скриптом `frontend/scripts/build-icons-css.py`
 * (он читает именно этот файл).
 *
 * Правило: имя справа — «короткое» имя Font Awesome (класс `fa-<имя>`), набор —
 * Free Solid. Если имени нет в Font Awesome Free, скрипт сборки это подсветит.
 */
export const ICON_MAP: Record<string, string> = {
  // Управление и навигация
  add: 'plus',
  arrow_back: 'arrow-left',
  arrow_downward: 'arrow-down',
  arrow_drop_down: 'caret-down',
  arrow_drop_up: 'caret-up',
  arrow_forward: 'arrow-right',
  chevron_left: 'chevron-left',
  chevron_right: 'chevron-right',
  expand_less: 'chevron-up',
  expand_more: 'chevron-down',
  keyboard_arrow_down: 'chevron-down',
  keyboard_arrow_left: 'chevron-left',
  keyboard_arrow_right: 'chevron-right',
  keyboard_arrow_up: 'chevron-up',
  first_page: 'angles-left',
  last_page: 'angles-right',
  unfold_more: 'up-down',
  close: 'xmark',
  clear: 'xmark',
  cancel: 'circle-xmark',
  check: 'check',
  done: 'check',
  done_all: 'check-double',
  check_circle: 'circle-check',
  verified: 'certificate',
  info: 'circle-info',
  help_outline: 'circle-question',
  warning: 'triangle-exclamation',
  error: 'circle-exclamation',
  refresh: 'rotate-right',
  replay: 'rotate-left',
  undo: 'rotate-left',
  menu: 'bars',
  menu_open: 'bars',
  more_horiz: 'ellipsis',
  more_vert: 'ellipsis-vertical',
  search: 'magnifying-glass',
  block: 'ban',
  fullscreen: 'expand',
  navigation: 'location-arrow',
  schedule: 'clock',
  download: 'download',
  logout: 'arrow-right-from-bracket',
  tune: 'sliders',
  visibility: 'eye',
  visibility_off: 'eye-slash',
  lock: 'lock',
  lock_reset: 'key',
  shield: 'shield',
  privacy_tip: 'user-shield',
  gavel: 'gavel',
  flag: 'flag',
  star: 'star',
  bookmark: 'bookmark',
  push_pin: 'thumbtack',
  edit: 'pen',
  content_copy: 'copy',
  delete: 'trash',
  delete_outline: 'trash-can',
  delete_forever: 'trash-can',
  radio_button_checked: 'circle-dot',
  radio_button_unchecked: 'circle',
  fiber_manual_record: 'circle',

  // Сообщения и чаты
  send: 'paper-plane',
  attach_file: 'paperclip',
  sentiment_satisfied_alt: 'face-smile',
  add_reaction: 'face-smile-wink',
  reply: 'reply',
  forward: 'share',
  forward_to_inbox: 'share',
  chat_bubble: 'comment',
  sms: 'comment-sms',
  forum: 'comments',
  mark_chat_unread: 'envelope',
  mail: 'envelope',
  image: 'image',
  photo_camera: 'camera',
  description: 'file-lines',
  insert_drive_file: 'file',
  picture_as_pdf: 'file-pdf',
  play_arrow: 'play',
  pause: 'pause',
  stop: 'stop',
  skip_next: 'forward-step',
  skip_previous: 'backward-step',

  // Люди и группы
  person: 'user',
  person_add: 'user-plus',
  person_remove: 'user-minus',
  group: 'users',
  group_add: 'user-plus',
  contacts: 'address-book',
  verified_user: 'shield',

  // Звонки и медиа
  call: 'phone',
  call_end: 'phone-flip',
  call_missed: 'phone-slash',
  videocam: 'video',
  mic: 'microphone',
  mic_off: 'microphone-slash',
  volume_up: 'volume-high',
  volume_down: 'volume-low',
  volume_off: 'volume-xmark',
  screen_share: 'display',
  stop_screen_share: 'display',
  devices: 'laptop',
  computer: 'desktop',
  phone_android: 'mobile',
  phonelink_erase: 'mobile-button',
  phonelink_lock: 'mobile-screen',

  // Прочее
  auto_stories: 'book-open',
  palette: 'palette',
  dark_mode: 'moon',
  light_mode: 'sun',
  wifi: 'wifi',
  wifi_off: 'link-slash',
  notifications: 'bell',
  notifications_off: 'bell-slash',
  cloud: 'cloud',
  cloud_upload: 'cloud-arrow-up',
  date_range: 'calendar-days'
}

/** Иконка по умолчанию: если имени нет в мэппинге. */
const FALLBACK_ICON = 'circle-question'

/**
 * Превращает логическое имя в классы иконки Font Awesome (`fa-solid fa-user`).
 *
 * Важно: имя ОБЯЗАНО начинаться с `fa-` — Quasar по этому префиксу понимает,
 * что получил не имя лигатуры, а список классов. Всё остальное он рисует как
 * текст внутри `<i class="material-icons">`.
 *
 * Если строка уже содержит пробел (готовые классы) — возвращаем как есть.
 * Неизвестное имя возвращаем без изменений: его отрисует прежний шрифт Material
 * (Quasar подключён), то есть ошибка будет видна, а не превратится в пустоту.
 */
export function icon(name?: string | null): string | undefined {
  if (!name) return undefined
  if (name.includes(' ')) return name
  const fa = ICON_MAP[name]
  if (!fa) return name
  return `fa-solid fa-${fa}`
}

/** Имя Font Awesome для логического имени (для сборки CSS и проверок). */
export function faNameOf(name: string): string {
  return ICON_MAP[name] ?? FALLBACK_ICON
}
