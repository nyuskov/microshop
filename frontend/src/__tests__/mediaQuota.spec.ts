/**
 * Индикатор хранилища: форматирование размеров.
 *
 * Квота считается по файлам, которые пользователь загрузил сам (пересылки
 * переиспользуют тот же файл — см. backend/core/media_quota.py). Формат
 * размеров должен совпадать с серверным, иначе «занято 1.5 МБ» и «100 из 500»
 * будут противоречить друг другу на одном экране.
 */
import { describe, expect, it } from 'vitest'

import { formatBytes } from '../services/storage'

describe('formatBytes', () => {
  it('показывает байты без дробной части', () => {
    expect(formatBytes(0)).toBe('0 Б')
    expect(formatBytes(512)).toBe('512 Б')
  })

  it('переводит в КБ/МБ/ГБ с одним знаком', () => {
    expect(formatBytes(1024)).toBe('1.0 КБ')
    expect(formatBytes(1536)).toBe('1.5 КБ')
    expect(formatBytes(500 * 1024 * 1024)).toBe('500.0 МБ')
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 ГБ')
  })

  it('не падает на отрицательных значениях (защита от мусора с сервера)', () => {
    expect(formatBytes(-10)).toBe('0 Б')
  })
})
