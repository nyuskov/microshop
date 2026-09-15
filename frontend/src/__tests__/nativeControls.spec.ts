import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Никаких родных выпадающих списков и календарей в интерфейсе.
 *
 * Зачем: окно родного `<select>` и календарь родного `<input type="date">` рисует
 * сам браузер, а не страница. В WebView (и при нестандартном масштабе) они
 * открываются системным окошком далеко от поля — пользователь трижды сообщал об
 * этом 15.09.2026: «Срок действия» в приглашениях, «Страна»/«Язык» в профиле,
 * дата рождения и выбор устройств в звонке. Своих контролов у этого класса
 * проблем нет: `components/common/SelectField.vue` (список) и маскированный ввод
 * (`utils/dateInput.ts`).
 *
 * Проверка статическая: jsdom не открывает родные окна, поэтому смотрим разметку
 * компонентов. HTML-комментарии вырезаем — в них эти теги упоминаются по делу.
 */
const SRC = path.resolve(import.meta.dirname, '..')

const vueFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return vueFiles(full)
    return full.endsWith('.vue') ? [full] : []
  })

const stripComments = (source: string): string => source.replace(/<!--[\s\S]*?-->/g, '')

/**
 * Разметка компонента: от первого `<template>` до последнего `</template>`.
 *
 * Смотрим только её: в комментариях исходника эти теги упоминаются по делу
 * («список вместо родного `<select>`»), и проверка ловила бы собственные
 * пояснения — уже поймала в `SelectField.vue`.
 */
const templateOf = (source: string): string => {
  const start = source.indexOf('<template>')
  const end = source.lastIndexOf('</template>')
  if (start === -1 || end === -1) return ''
  return stripComments(source.slice(start, end + '</template>'.length))
}

describe('родные контролы браузера в разметке', () => {
  const files = vueFiles(SRC)
  const templates = files.map((file) => ({ file, body: templateOf(readFileSync(file, 'utf8')) }))

  it('нашлись компоненты (проверка не «пустая»)', () => {
    expect(files.length).toBeGreaterThan(30)
    expect(templates.filter((item) => item.body.includes('<template>')).length).toBe(files.length)
  })

  it('нигде не осталось <select> — вместо него SelectField', () => {
    const offenders = templates
      .filter((item) => /<select[\s>]/.test(item.body))
      .map((item) => item.file)
    expect(offenders).toEqual([])
  })

  it('нигде не осталось календаря <input type="date">', () => {
    const offenders = templates
      .filter((item) => /<input[\s\S]{0,200}?type="date"/.test(item.body))
      .map((item) => item.file)
    expect(offenders).toEqual([])
  })
})
