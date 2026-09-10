/**
 * Выбор устройств для звонка (камера/микрофон/динамик).
 *
 * Выбор хранится в localStorage per-device (как черновики/пины), а не на сервере:
 * устройства — свойство конкретного браузера и телефона, синхронизировать их
 * между устройствами бессмысленно.
 */

export interface CallDeviceChoice {
  camera?: string
  mic?: string
  speaker?: string
}

export const CALL_DEVICES_STORAGE_KEY = 'pismo_call_devices'

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Читает сохранённый выбор устройств (пустой объект, если ничего нет/битые данные). */
export function readCallDevices(): CallDeviceChoice {
  const store = storage()
  if (!store) return {}
  try {
    const raw = store.getItem(CALL_DEVICES_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const value = parsed as Record<string, unknown>
    const pick = (key: string): string | undefined =>
      typeof value[key] === 'string' && value[key] ? (value[key] as string) : undefined
    return { camera: pick('camera'), mic: pick('mic'), speaker: pick('speaker') }
  } catch {
    return {}
  }
}

/** Сохраняет выбор устройств, не затирая уже сохранённые поля. */
export function writeCallDevices(choice: CallDeviceChoice): void {
  const store = storage()
  if (!store) return
  try {
    const next: CallDeviceChoice = { ...readCallDevices(), ...choice }
    store.setItem(CALL_DEVICES_STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* localStorage недоступен — выбор просто не переживёт перезагрузку */
  }
}

/**
 * Какое устройство выбрать по умолчанию.
 *
 * Сохранённый id используется только если устройство всё ещё в списке — иначе
 * берём первое (браузер отдаёт устройства в порядке предпочтения системы).
 */
export function chooseDeviceId(devices: { deviceId: string }[], saved?: string): string {
  if (!devices.length) return ''
  if (saved && devices.some((item) => item.deviceId === saved)) return saved
  return devices[0].deviceId
}

/** Группирует список устройств браузера по видам (пустые id не берём). */
export function groupDevices(devices: MediaDeviceInfo[]): {
  cameras: MediaDeviceInfo[]
  microphones: MediaDeviceInfo[]
  speakers: MediaDeviceInfo[]
} {
  const usable = devices.filter((item) => item.deviceId)
  return {
    cameras: usable.filter((item) => item.kind === 'videoinput'),
    microphones: usable.filter((item) => item.kind === 'audioinput'),
    speakers: usable.filter((item) => item.kind === 'audiooutput')
  }
}
