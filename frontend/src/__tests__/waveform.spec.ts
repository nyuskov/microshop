/**
 * Расчёт волны голосового: поведение без WebAudio.
 *
 * Здесь намеренно НЕТ подмены модуля — проверяем настоящую `waveformPeaks`. В
 * jsdom нет `OfflineAudioContext`, поэтому функция обязана не падать и вернуть
 * `null`: плеер в этом случае показывает прежнюю плоскую полосу (это запасной вид,
 * а не ошибка).
 */
import { describe, expect, it, vi } from 'vitest'

import { WAVE_BARS, resetWaveformCache, waveformPeaks } from '@/utils/waveform'

describe('waveformPeaks', () => {
  it('без WebAudio возвращает null и не бросает', async () => {
    resetWaveformCache()
    await expect(waveformPeaks(101, '/a.mp3')).resolves.toBeNull()
  })

  it('без WebAudio файл даже не скачивается: рисовать волну всё равно нечем', async () => {
    resetWaveformCache()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await waveformPeaks(102, '/b.mp3')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('число столбиков по умолчанию — 36 (как в МАКСе по ширине пузыря)', () => {
    expect(WAVE_BARS).toBe(36)
  })
})
