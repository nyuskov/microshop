import { describe, expect, it } from 'vitest'

import { createQrMatrix, qrSvgPath, qrSvgSize, qrVersionFor } from '@/utils/qr'

/**
 * QR-код рисуем сами, без библиотеки.
 *
 * Своя реализация — риск: ошибка в кодах коррекции, в маске или в укладке данных
 * не видна ни типами, ни глазом (код «нарисован», но не читается сканером).
 * Поэтому эталонные матрицы сняты не с нашего кода, а с независимой реализации
 * (python-qrcode, байтовый режим, уровень M, фиксированная маска 0): тест ловит
 * любую ошибку укладки. Дополнительно кодировщик сверен по всем восьми маскам и
 * проверен настоящим сканером (zxing) — все коды читаются.
 */

/** Разбирает «картинку» из решётки и точек в матрицу. */
const parse = (rows: string[]): boolean[][] =>
  rows.map((row) => row.split('').map((cell) => cell === '#'))

/** Эталон: «A», версия 1 (21×21), уровень M, маска 0. */
const GOLDEN_A = parse([
  '#######..###..#######',
  '#.....#.#.###.#.....#',
  '#.###.#...#...#.###.#',
  '#.###.#..#....#.###.#',
  '#.###.#.##..#.#.###.#',
  '#.....#...#.#.#.....#',
  '#######.#.#.#.#######',
  '...........##........',
  '#.#.#.#...##....#..#.',
  '#..###...#....#...##.',
  '.#....#.###.#...#...#',
  '#.#.#....##...#...#..',
  '#.#..##.#.#.#.#.#.#.#',
  '........####.#.#.#.#.',
  '#######....#.###.####',
  '#.....#..#.###.###...',
  '#.###.#.##.#.###.##.#',
  '#.###.#.......#...##.',
  '#.###.#.##..#...#...#',
  '#.....#..##...#...##.',
  '#######.#...#.#.#.###'
])

/** Эталон: ссылка на профиль, версия 2 (25×25) — здесь уже есть выравнивание. */
const GOLDEN_LINK = parse([
  '#######..#.#..##..#######',
  '#.....#.#..##..##.#.....#',
  '#.###.#...##....#.#.###.#',
  '#.###.#..##...##..#.###.#',
  '#.###.#.#.#.#.##..#.###.#',
  '#.....#..#######..#.....#',
  '#######.#.#.#.#.#.#######',
  '.........#.#####.........',
  '#.#.#.#..#.#.##.....#..#.',
  '...###...#......###.....#',
  '#.######.##..#......#.###',
  '.#####..#.#####....#...#.',
  '.##...#..##.##...###.#.##',
  '.##..#.########.#.#..#..#',
  '#..##########...#.##..###',
  '.#..##..###.###.#.#.#..#.',
  '#.#.#.###.############...',
  '........####...##...##.##',
  '#######......#.##.#.##.##',
  '#.....#..#.######...##...',
  '#.###.#.##...#..######...',
  '#.###.#...#.#...#..####..',
  '#.###.#.#....#.#....#...#',
  '#.....#...##.#.##.#.##.#.',
  '#######.#..#.#.#####...##'
])

const asGrid = (matrix: boolean[][]): string[] =>
  matrix.map((row) => row.map((cell) => (cell ? '#' : '.')).join(''))

/** Поисковый узор 7×7 в левом верхнем углу с нужным смещением. */
const isFinderAt = (matrix: boolean[][], top: number, left: number): boolean => {
  const expected = ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######']
  for (let row = 0; row < 7; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      if (matrix[top + row][left + col] !== (expected[row][col] === '#')) return false
    }
  }
  return true
}

describe('генератор QR-кодов', () => {
  it('совпадает с независимым эталоном для версии 1', () => {
    expect(asGrid(createQrMatrix('A', { mask: 0 }))).toEqual(asGrid(GOLDEN_A))
  })

  it('совпадает с независимым эталоном для ссылки (версия 2)', () => {
    expect(asGrid(createQrMatrix('https://pismo.space/u/nyu', { mask: 0 }))).toEqual(
      asGrid(GOLDEN_LINK)
    )
  })

  it('подбирает версию по длине текста и жалуется на слишком длинный', () => {
    expect(qrVersionFor('A')).toBe(1)
    expect(qrVersionFor('https://pismo.space/u/nyu')).toBe(2)
    // Границы: 14 байт — предел версии 1 (16 кодовых слов данных минус
    // служебные биты режима и длины), 15 — уже версия 2.
    expect(qrVersionFor('x'.repeat(14))).toBe(1)
    expect(qrVersionFor('x'.repeat(15))).toBe(2)
    // Кириллица в UTF-8 занимает два байта на знак.
    expect(qrVersionFor('я'.repeat(9))).toBe(2)
    expect(() => qrVersionFor('x'.repeat(400))).toThrow(/Слишком длинный/)
  })

  it('делает матрицу нужного размера и рисует три поисковых узора', () => {
    const matrix = createQrMatrix('https://pismo.space/u/nyu')
    const size = matrix.length

    expect(size).toBe(qrVersionFor('https://pismo.space/u/nyu') * 4 + 17)
    expect(isFinderAt(matrix, 0, 0)).toBe(true)
    expect(isFinderAt(matrix, 0, size - 7)).toBe(true)
    expect(isFinderAt(matrix, size - 7, 0)).toBe(true)
  })

  it('рисует синхронизацию и тёмный модуль', () => {
    const matrix = createQrMatrix('A')
    const size = matrix.length

    for (let i = 8; i < size - 8; i += 1) {
      expect(matrix[6][i]).toBe(i % 2 === 0)
      expect(matrix[i][6]).toBe(i % 2 === 0)
    }
    // «Тёмный модуль» рядом с левым нижним поисковым узором всегда тёмный.
    expect(matrix[size - 8][8]).toBe(true)
  })

  it('ставит выравнивание там, где велит стандарт', () => {
    const matrix = createQrMatrix('https://pismo.space/u/nyu')

    // Версия 2: единственный узор выравнивания с центром (18, 18).
    for (let row = 16; row <= 20; row += 1) {
      for (let col = 16; col <= 20; col += 1) {
        const edge = row === 16 || row === 20 || col === 16 || col === 20
        const center = row === 18 && col === 18
        expect(matrix[row][col]).toBe(edge || center)
      }
    }
  })

  it('выбирает одну и ту же маску при повторном вызове', () => {
    const first = asGrid(createQrMatrix('https://pismo.space/u/nyu')).join('\n')
    const second = asGrid(createQrMatrix('https://pismo.space/u/nyu')).join('\n')

    expect(first).toBe(second)
    // Выбранная автоматически маска совпадает с одной из восьми явных.
    const explicit = Array.from({ length: 8 }, (_, mask) =>
      asGrid(createQrMatrix('https://pismo.space/u/nyu', { mask })).join('\n')
    )
    expect(explicit).toContain(first)
  })

  it('разные маски дают разные коды, а поле покоя не меняет матрицу', () => {
    const masks = Array.from({ length: 8 }, (_, mask) =>
      asGrid(createQrMatrix('https://pismo.space/u/nyu', { mask }))
    )

    expect(new Set(masks).size).toBe(8)
    // Поле покоя добавляет только отрисовка, в матрице его нет.
    const matrix = createQrMatrix('A')
    expect(matrix).toHaveLength(21)
    expect(matrix[0]).toHaveLength(21)
  })

  it('отдаёт SVG одним путём с полем покоя', () => {
    const matrix = createQrMatrix('A')
    const path = qrSvgPath(matrix)
    const dark = matrix.flat().filter(Boolean).length

    expect(path.startsWith('M4 4h')).toBe(true)
    expect(path.endsWith('z')).toBe(true)
    // Полосы склеиваются: подпутей не больше, чем тёмных модулей.
    const subpaths = path.split('M').length - 1
    expect(subpaths).toBeGreaterThan(0)
    expect(subpaths).toBeLessThanOrEqual(dark)
    expect(qrSvgSize(matrix)).toBe(matrix.length + 8)
    expect(qrSvgSize(matrix, { quietZone: 0 })).toBe(matrix.length)
    expect(qrSvgPath(matrix, { quietZone: 0 }).startsWith('M0 0h')).toBe(true)
  })
})
