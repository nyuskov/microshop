import { beforeEach, describe, expect, it } from 'vitest'

import {
  CALL_DEVICES_STORAGE_KEY,
  chooseDeviceId,
  groupDevices,
  readCallDevices,
  writeCallDevices
} from '@/utils/callDevices'

function device(kind: MediaDeviceKind, deviceId: string, label = deviceId): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: 'g', toJSON: () => ({}) } as MediaDeviceInfo
}

describe('выбор устройств для звонка', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('по умолчанию ничего не выбрано', () => {
    expect(readCallDevices()).toEqual({})
  })

  it('сохраняет и читает выбор по видам устройств', () => {
    writeCallDevices({ camera: 'cam-1', mic: 'mic-2', speaker: 'spk-3' })
    expect(readCallDevices()).toEqual({ camera: 'cam-1', mic: 'mic-2', speaker: 'spk-3' })
  })

  it('дописывает выбор, не затирая остальные поля', () => {
    writeCallDevices({ mic: 'mic-1' })
    writeCallDevices({ speaker: 'spk-2' })
    expect(readCallDevices()).toEqual({ mic: 'mic-1', speaker: 'spk-2' })
  })

  it('битые данные в localStorage не ломают чтение', () => {
    localStorage.setItem(CALL_DEVICES_STORAGE_KEY, 'не json')
    expect(readCallDevices()).toEqual({})
  })

  it('одно сохранённое устройство без второго не мешает', () => {
    writeCallDevices({ camera: 'cam-9' })
    const saved = readCallDevices()
    expect(saved.camera).toBe('cam-9')
    expect(saved.mic).toBeUndefined()
  })

  it('сохранённое устройство используется, если оно ещё в списке', () => {
    expect(chooseDeviceId([{ deviceId: 'a' }, { deviceId: 'b' }], 'b')).toBe('b')
  })

  it('пропавшее устройство заменяется первым доступным', () => {
    expect(chooseDeviceId([{ deviceId: 'a' }, { deviceId: 'b' }], 'исчезло')).toBe('a')
  })

  it('пустой список устройств даёт пустой id', () => {
    expect(chooseDeviceId([], 'a')).toBe('')
  })

  it('группирует устройства по видам и отбрасывает пустые id', () => {
    const grouped = groupDevices([
      device('videoinput', 'cam-1'),
      device('audioinput', 'mic-1'),
      device('audioinput', ''),
      device('audiooutput', 'spk-1'),
      device('audiooutput', 'spk-2')
    ])
    expect(grouped.cameras.map((item) => item.deviceId)).toEqual(['cam-1'])
    expect(grouped.microphones.map((item) => item.deviceId)).toEqual(['mic-1'])
    expect(grouped.speakers.map((item) => item.deviceId)).toEqual(['spk-1', 'spk-2'])
  })
})
