/**
 * Соответствие «логическое имя иконки → иконка Lucide».
 *
 * В разметке и хелперах имена остаются прежними (`close`, `reply`, `videocam`):
 * так код не зависит от конкретного набора иконок, а замена набора — это правка
 * одного этого файла. Преобразование делает `icon()` (см. ниже), а CSS и
 * урезанный шрифт собираются скриптом `frontend/scripts/build-icons-css.py`
 * (он читает именно этот файл).
 *
 * Правило: имя справа — имя иконки Lucide (класс `icon-<имя>`). Если имени нет
 * в наборе, скрипт сборки это подсветит (см. scripts/build-icons-css.py).
 */
export const ICON_MAP: Record<string, string> = {
  // Управление и навигация
  add: 'plus',
  arrow_back: 'arrow-left',
  arrow_downward: 'arrow-down',
  arrow_drop_down: 'chevron-down',
  arrow_drop_up: 'chevron-up',
  arrow_forward: 'arrow-right',
  chevron_left: 'chevron-left',
  chevron_right: 'chevron-right',
  expand_less: 'chevron-up',
  expand_more: 'chevron-down',
  keyboard_arrow_down: 'chevron-down',
  keyboard_arrow_left: 'chevron-left',
  keyboard_arrow_right: 'chevron-right',
  keyboard_arrow_up: 'chevron-up',
  first_page: 'chevrons-left',
  last_page: 'chevrons-right',
  unfold_more: 'chevrons-up-down',
  close: 'x',
  clear: 'x',
  cancel: 'circle-x',
  check: 'check',
  done: 'check',
  done_all: 'check-check',
  check_circle: 'circle-check',
  verified: 'badge-check',
  info: 'info',
  help_outline: 'circle-help',
  warning: 'triangle-alert',
  error: 'circle-alert',
  refresh: 'refresh-cw',
  replay: 'rotate-ccw',
  undo: 'undo-2',
  menu: 'menu',
  menu_open: 'menu',
  more_horiz: 'ellipsis',
  more_vert: 'ellipsis-vertical',
  search: 'search',
  share: 'share',
  picture_in_picture: 'picture-in-picture-2',
  block: 'ban',
  fullscreen: 'maximize',
  navigation: 'navigation',
  schedule: 'clock',
  download: 'download',
  logout: 'log-out',
  tune: 'sliders-horizontal',
  visibility: 'eye',
  visibility_off: 'eye-off',
  lock: 'lock',
  lock_reset: 'key',
  shield: 'shield',
  privacy_tip: 'shield-check',
  gavel: 'gavel',
  flag: 'flag',
  star: 'star',
  bookmark: 'bookmark',
  push_pin: 'pin',
  edit: 'pencil',
  content_copy: 'copy',
  delete: 'trash-2',
  delete_outline: 'trash',
  delete_forever: 'trash-2',
  radio_button_checked: 'circle-dot',
  radio_button_unchecked: 'circle',
  fiber_manual_record: 'circle',

  // Сообщения и чаты
  send: 'send',
  attach_file: 'paperclip',
  sentiment_satisfied_alt: 'smile',
  add_reaction: 'smile-plus',
  reply: 'reply',
  forward: 'forward',
  forward_to_inbox: 'forward',
  chat_bubble: 'message-circle',
  sms: 'message-square-text',
  forum: 'messages-square',
  mark_chat_unread: 'mail-open',
  mail: 'mail',
  image: 'image',
  photo_camera: 'camera',
  description: 'file-text',
  insert_drive_file: 'file',
  picture_as_pdf: 'file-text',
  play_arrow: 'play',
  pause: 'pause',
  stop: 'square',
  skip_next: 'skip-forward',
  skip_previous: 'skip-back',

  // Люди и группы
  person: 'user',
  person_add: 'user-plus',
  person_remove: 'user-minus',
  group: 'users',
  group_add: 'user-plus',
  contacts: 'book-user',
  verified_user: 'shield',
  // Роли участника группы: выдать / снять админку (см. GroupChatInfo.vue).
  admin_panel_settings: 'shield-user',
  shield_person: 'shield-minus',

  // Звонки и медиа
  call: 'phone',
  call_end: 'phone-off',
  call_missed: 'phone-missed',
  videocam: 'video',
  mic: 'mic',
  mic_off: 'mic-off',
  volume_up: 'volume-2',
  volume_down: 'volume-1',
  volume_off: 'volume-x',
  screen_share: 'screen-share',
  stop_screen_share: 'screen-share',
  devices: 'laptop',
  computer: 'monitor',
  phone_android: 'smartphone',
  phonelink_erase: 'eraser',
  phonelink_lock: 'smartphone',

  // Прочее
  auto_stories: 'book-open',
  palette: 'palette',
  dark_mode: 'moon',
  light_mode: 'sun',
  wifi: 'wifi',
  wifi_off: 'wifi-off',
  notifications: 'bell',
  notifications_off: 'bell-off',
  cloud: 'cloud',
  cloud_upload: 'cloud-upload',
  date_range: 'calendar-days'
}

/** Иконка по умолчанию: если имени нет в мэппинге. */
const FALLBACK_ICON = 'circle-help'

/**
 * Превращает логическое имя в классы иконки (`icon-lucide icon-user`).
 *
 * Важно: имя ОБЯЗАНО начинаться с распознанного Quasar префикса (`icon-`) — по
 * нему он понимает, что получил не имя лигатуры, а список классов. Всё
 * остальное он рисует как текст внутри `<i class="material-icons">`.
 *
 * Если строка уже содержит пробел (готовые классы) — возвращаем как есть.
 * Неизвестное имя возвращаем без изменений: его отрисует прежний шрифт Material
 * (Quasar подключён), то есть ошибка будет видна, а не превратится в пустоту.
 */
export function icon(name?: string | null): string | undefined {
  if (!name) return undefined
  if (name.includes(' ')) return name
  const lucide = ICON_MAP[name]
  if (!lucide) return name
  return `icon-lucide icon-${lucide}`
}

/** Имя Lucide для логического имени (для сборки CSS и проверок). */
export function iconNameOf(name: string): string {
  return ICON_MAP[name] ?? FALLBACK_ICON
}
