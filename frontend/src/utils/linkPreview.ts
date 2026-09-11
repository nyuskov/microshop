/**
 * Ссылки в тексте сообщения (для карточки-превью внешнего сайта).
 *
 * Разбор здесь намеренно осторожный: карточка нужна для обычных ссылок, но не
 * для «photo.jpg» или «спасибо.ru-подобных» слов, иначе мессенджер начал бы
 * ходить на сервер из-за каждого второго сообщения.
 *
 * Функции чистые (без обращения к window/api), поэтому на них есть тесты.
 */

/** Наши адреса: к ним превью не нужно (ссылка на профиль и так открывает чат). */
const OWN_HOSTS = new Set(['pismo.space'])

/** Домены без схемы, которые точно стоит превращать в ссылку. */
const BARE_DOMAIN_TLDS = new Set([
  'ru',
  'com',
  'net',
  'org',
  'io',
  'me',
  'tv',
  'info',
  'biz',
  'by',
  'kz',
  'ua',
  'pro',
  'app',
  'dev',
  'site',
  'online',
  'space',
  'store',
  'tech',
  'media',
  'news',
  'club',
  'xyz',
  'cloud',
  'blog',
  'live',
  'co',
  'cc',
  'edu',
  'gov'
])

/** Расширения файлов: «photo.jpg» — это файл, а не сайт. */
const FILE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'heic',
  'svg',
  'mp3',
  'mp4',
  'm4a',
  'webm',
  'ogg',
  'wav',
  'avi',
  'mov',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'txt',
  'csv',
  'json',
  'xml',
  'apk',
  'exe'
])

/** Хвостовая пунктуация обычно не часть адреса: «…смотри здесь)». */
const TRAILING_CHARS = /[.,;:!?)\]}»"'…]+$/

const WITH_SCHEME = /https?:\/\/[^\s<>"'«»]+/gi
const BARE_DOMAIN = /(?:^|[\s(«"'])((?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s<>"'«»]*)?)/g

/** Убирает хвостовую пунктуацию и лишние скобки у найденной ссылки. */
function trimLink(raw: string): string {
  let value = raw.replace(TRAILING_CHARS, '')
  // Незакрытая скобка в конце — чаще часть текста, чем адреса.
  while (
    value.endsWith(')') &&
    (value.match(/\(/g)?.length ?? 0) < (value.match(/\)/g)?.length ?? 0)
  ) {
    value = value.slice(0, -1)
  }
  return value
}

/** Адрес с явной схемой (или с «www.») — всегда ссылка. */
function ensureScheme(link: string): string {
  return /^https?:\/\//i.test(link) ? link : `https://${link}`
}

/** Домен ссылки без «www.»; пустая строка — если это не адрес. */
export function linkDomainOf(link: string): string {
  try {
    const host = new URL(ensureScheme(link)).hostname.toLowerCase()
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return ''
  }
}

/** Наша ли это ссылка (превью к своим адресам не показываем). */
export function isOwnLink(link: string): boolean {
  const domain = linkDomainOf(link)
  return !domain || OWN_HOSTS.has(domain)
}

/** Найденная в тексте ссылка. */
export interface LinkMatch {
  /** Позиция начала ссылки в тексте. */
  index: number
  /** Как ссылка выглядит в тексте (может быть без схемы). */
  value: string
  /** Адрес для перехода — всегда со схемой. */
  href: string
}

/**
 * Все ссылки в тексте по порядку — включая наши.
 *
 * Наши ссылки тоже нужны: по ним человек переходит внутри приложения
 * (например, ссылка на профиль открывает чат), поэтому их не выбрасываем.
 * Имена файлов («photo.jpg») ссылками не считаем — открывать их в браузере
 * бессмысленно.
 */
export function findLinks(text: string | null | undefined): LinkMatch[] {
  if (!text) return []
  const found: LinkMatch[] = []

  const add = (index: number, raw: string) => {
    const value = trimLink(raw)
    if (value.length < 5 || FILE_EXTENSIONS.has(extensionOf(value))) return
    // В тексте ссылка может быть без схемы; для перехода схему добавляем —
    // иначе «habr.com/x» открылся бы как относительный путь внутри приложения.
    found.push({ index, value, href: ensureScheme(value) })
  }

  for (const match of text.matchAll(WITH_SCHEME)) {
    add(match.index ?? 0, match[0])
  }
  for (const match of text.matchAll(BARE_DOMAIN)) {
    const candidate = match[1] ?? ''
    const tld = linkDomainOf(candidate).split('.').pop() ?? ''
    if (!BARE_DOMAIN_TLDS.has(tld)) continue
    // Индекс — начало самого адреса, а не пробела перед ним.
    add((match.index ?? 0) + match[0].length - candidate.length, candidate)
  }

  // Ссылка со схемой и «голый» домен внутри неё — одно и то же место в тексте.
  const unique: LinkMatch[] = []
  for (const link of found.sort((left, right) => left.index - right.index)) {
    const previous = unique[unique.length - 1]
    if (previous && link.index < previous.index + previous.value.length) continue
    unique.push(link)
  }
  return unique
}

/** Первая «пригодная для превью» ссылка в тексте или `null`. */
export function firstLinkInText(text: string | null | undefined): string | null {
  for (const link of findLinks(text)) {
    if (!isOwnLink(link.value)) return link.href
  }
  return null
}

/** Расширение из адреса ('' — если его нет): «photo.jpg» → «jpg». */
function extensionOf(link: string): string {
  const path = link.split(/[?#]/)[0] ?? ''
  const lastSegment = path.split('/').pop() ?? ''
  const dot = lastSegment.lastIndexOf('.')
  return dot === -1 ? '' : lastSegment.slice(dot + 1).toLowerCase()
}

/** Короткий адрес для подписи в карточке (без схемы, обрезанный). */
export function prettyLink(link: string, limit = 48): string {
  const value = link.replace(/^https?:\/\//i, '').replace(/\/$/, '')
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}
