/**
 * Работа с сервисом GIF (Giphy).
 *
 * Ключ API задаётся через переменную окружения VITE_GIPHY_API_KEY
 * (файл frontend/.env) — см. frontend/.env.example.
 * Без ключа панель GIF показывает подсказку и не загружает гифки.
 */

export interface GiphyGif {
  id: string
  title: string
  /** Мелкий превью (webp/gif) для сетки. */
  preview: string
  /** URL полноценного GIF-файла (отправляется на бэкенд). */
  gif: string
}

function readApiKey(): string {
  try {
    // ВАЖНО: Vite подставляет значения только в выражение `import.meta.env` целиком,
    // поэтому читать надо именно так (не через отдельную ссылку на import.meta).
    const env = import.meta.env as unknown as Record<string, unknown>
    const value = env.VITE_GIPHY_API_KEY
    return typeof value === 'string' && value.trim() ? value.trim() : ''
  } catch {
    return ''
  }
}

export const GIPHY_API_KEY = readApiKey()

export const hasGiphyKey = (): boolean => GIPHY_API_KEY.length > 0

interface GiphyImageSet {
  url?: string
  webp?: string
}

interface GiphyRaw {
  id?: string | number
  title?: string
  url?: string
  images?: {
    fixed_height_small?: GiphyImageSet
    fixed_width_small?: GiphyImageSet
    downsized_still?: GiphyImageSet
    downsized?: GiphyImageSet
    original?: GiphyImageSet
  }
}

function mapGif(raw: GiphyRaw): GiphyGif | null {
  const images = raw.images
  if (!images) return null
  const previewSet = images.fixed_height_small || images.fixed_width_small || images.downsized_still
  const sendSet = images.downsized || images.original
  if (!previewSet || (!previewSet.url && !previewSet.webp)) return null
  return {
    id: String(raw.id ?? Math.random()),
    title: raw.title ?? '',
    preview: previewSet.webp || previewSet.url || '',
    gif: sendSet?.url || raw.url || ''
  }
}

async function request(url: string): Promise<GiphyGif[]> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Сервис GIF вернул ошибку (${response.status})`)
  }
  const data = (await response.json()) as { data?: GiphyRaw[] }
  const gifs: GiphyGif[] = []
  for (const raw of data.data ?? []) {
    const mapped = mapGif(raw)
    if (mapped) gifs.push(mapped)
  }
  return gifs
}

/** Популярные GIF (случайное смещение, чтобы сетка не повторялась). */
export async function fetchTrendingGifs(): Promise<GiphyGif[]> {
  const offset = Math.floor(Math.random() * 200)
  return request(
    `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(
      GIPHY_API_KEY
    )}&limit=24&rating=g&offset=${offset}`
  )
}

/** Поиск GIF по запросу. */
export async function searchGifs(query: string): Promise<GiphyGif[]> {
  const q = query.trim()
  if (!q) return []
  return request(
    `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(
      GIPHY_API_KEY
    )}&q=${encodeURIComponent(q)}&limit=24&rating=g`
  )
}
