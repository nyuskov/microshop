import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePhoneImport } from '@/composables/usePhoneImport'
import type { SearchUserResult } from '@/services/chatService'

/**
 * Импорт контактов по номерам: разбор ввода, поиск людей и ветка «браузер умеет
 * открывать книгу телефона». Логика вынесена из разметки сайдбара, поэтому
 * проверяется без DOM.
 */
const matchUsersByPhone = vi.fn()
vi.mock('@/services/chatService', () => ({
  matchUsersByPhone: (...args: unknown[]) => matchUsersByPhone(...args)
}))

const makeImport = () => {
  const opened: SearchUserResult[] = []
  const phoneImport = usePhoneImport({ openChat: (user) => opened.push(user) })
  return { phoneImport, opened }
}

beforeEach(() => {
  matchUsersByPhone.mockReset()
  matchUsersByPhone.mockResolvedValue([])
})

describe('разбор номеров', () => {
  it('оставляет только цифры', () => {
    const { phoneImport } = makeImport()

    expect(phoneImport.normalizePhone('+7 (900) 111-00-01')).toBe('79001110001')
  })

  it('ищет по номерам, вставленным через перенос строки, запятую и точку с запятой', async () => {
    const { phoneImport } = makeImport()
    phoneImport.manualPhones.value = '+7 900 111-00-01\n79001110002; 8 900 111-00-03'

    phoneImport.findByManualPhones()
    await vi.waitFor(() => expect(matchUsersByPhone).toHaveBeenCalled())

    expect(matchUsersByPhone).toHaveBeenCalledWith(['79001110001', '79001110002', '89001110003'])
  })

  it('слишком короткие номера отбрасывает и сообщает об этом', async () => {
    const { phoneImport } = makeImport()
    phoneImport.manualPhones.value = '12345, 999'

    phoneImport.findByManualPhones()
    await vi.waitFor(() => expect(phoneImport.phoneMatched.value).not.toBeNull())

    expect(matchUsersByPhone).not.toHaveBeenCalled()
    expect(phoneImport.phoneMatched.value).toEqual([])
    expect(phoneImport.phoneError.value).toContain('Не удалось определить номера')
  })

  it('ошибку поиска показывает сообщением, а не падением', async () => {
    const { phoneImport } = makeImport()
    matchUsersByPhone.mockRejectedValue(new Error('сеть недоступна'))
    phoneImport.manualPhones.value = '79001110001'

    phoneImport.findByManualPhones()
    await vi.waitFor(() => expect(phoneImport.phoneError.value).not.toBe(''))

    expect(phoneImport.phoneBusy.value).toBe(false)
  })
})

describe('окно импорта', () => {
  it('на десктопе открывается вставка номеров вручную', () => {
    const { phoneImport } = makeImport()

    phoneImport.onAddFromPhone()

    expect(phoneImport.phoneImportOpen.value).toBe(true)
  })

  it('закрытие сбрасывает введённые номера и результат', () => {
    const { phoneImport } = makeImport()
    phoneImport.onAddFromPhone()
    phoneImport.manualPhones.value = '79001110001'
    phoneImport.phoneMatched.value = [{ id: 1 } as SearchUserResult]

    phoneImport.closePhoneImport()

    expect(phoneImport.phoneImportOpen.value).toBe(false)
  })

  it('крестик убирает результаты поиска', () => {
    const { phoneImport } = makeImport()
    phoneImport.phoneMatched.value = [{ id: 1 } as SearchUserResult]

    phoneImport.clearPhoneMatch()

    expect(phoneImport.phoneMatched.value).toBeNull()
  })

  it('выбор найденного человека открывает с ним чат и закрывает окно', async () => {
    const { phoneImport, opened } = makeImport()
    phoneImport.onAddFromPhone()
    phoneImport.phoneMatched.value = [{ id: 7 } as SearchUserResult]

    await phoneImport.openPhoneMatch({ id: 7 } as SearchUserResult)

    expect(opened).toEqual([{ id: 7 }])
    expect(phoneImport.phoneImportOpen.value).toBe(false)
    expect(phoneImport.phoneMatched.value).toBeNull()
  })
})
