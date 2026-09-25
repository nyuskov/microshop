import { describe, expect, it } from 'vitest'

import { PCM_SAMPLE_RATE, trimSilence, trimSilencePcm } from '@/utils/audioPcm'

/**
 * Обрезка тишины по краям записи перед распознаванием.
 *
 * Зачем проверяем: долгая пауза в начале/конце съедает окно распознавателя
 * (30 с) и подталкивает модель к «фразам» из воздуха. При этом важно не
 * перестараться — речь трогать нельзя, поэтому у границы остаётся запас, а
 * запись без речи вообще не обрезается (решение «здесь тишина» принимает
 * вызывающий код со своим порогом).
 */
const silence = (seconds: number): number[] =>
  new Array(Math.round(seconds * PCM_SAMPLE_RATE)).fill(0)

/** «Речь» — синус 440 Гц: важно лишь то, что уровень выше порога. */
const speech = (seconds: number): number[] => {
  const length = Math.round(seconds * PCM_SAMPLE_RATE)
  return Array.from({ length }, (_, index) => Math.sin((2 * Math.PI * 440 * index) / PCM_SAMPLE_RATE) * 0.6)
}

describe('обрезка тишины перед распознаванием', () => {
  it('срезает тишину в начале и в конце записи', () => {
    const samples = Float32Array.from([...silence(0.6), ...speech(1), ...silence(0.6)])
    const trimmed = trimSilence(samples)

    expect(trimmed.length).toBeLessThan(samples.length)
    // Речь (1 с) осталась целиком, исчезла только тишина и её часть.
    expect(trimmed.length).toBeGreaterThan(PCM_SAMPLE_RATE)
    // В начале результата — запас тишины перед речью, а не сразу звук.
    expect(Math.abs(trimmed[0])).toBeLessThan(0.01)
  })

  it('запись без речи не трогает: обрезка здесь не решает ничего', () => {
    const samples = Float32Array.from(silence(1.2))
    // Возвращается тот же массив: обрезка «в ноль» превратила бы запись в
    // пустую, а это хуже исходной.
    expect(trimSilence(samples)).toBe(samples)
  })

  it('короткую запись не трогает: на двух словах резать нечего', () => {
    const samples = Float32Array.from(speech(0.02))
    expect(trimSilence(samples)).toBe(samples)
  })

  it('для PCM 16 бит границы те же', () => {
    const floats = [...silence(0.4), ...speech(0.8), ...silence(0.4)]
    const pcm = Int16Array.from(floats.map((value) => Math.round(value * 32767)))

    const trimmedFloat = trimSilence(Float32Array.from(floats))
    const trimmedPcm = trimSilencePcm(pcm)

    expect(trimmedPcm.length).toBe(trimmedFloat.length)
    expect(pcm.length - trimmedPcm.length).toBeGreaterThan(0)
  })
})
