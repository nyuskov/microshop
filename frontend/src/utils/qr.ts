/**
 * Генератор QR-кодов (модель 2) — свой, без внешних зависимостей.
 *
 * Зачем свой: QR нужен всего в трёх местах (ссылка на профиль, приглашение в
 * группу, ссылка на канал), а библиотека весит больше и тянет за собой
 * скачивание. Здесь байтовый режим и уровень коррекции M — ровно то, что нужно
 * для коротких ссылок (`https://pismo.space/u/логин`): до 200 знаков хватает с
 * запасом, а ошибок такой код выдерживает ~15%.
 *
 * Что реализовано по стандарту ISO/IEC 18004: выбор версии 1–10, байтовое
 * кодирование с префиксом режима и длины, коды Рида-Соломона над GF(256),
 * чередование блоков, служебные узоры (поисковые, синхронизации, выравнивания,
 * «тёмный модуль»), сведения о формате и версии, укладка данных «змейкой» и
 * выбор маски по штрафным очкам.
 */
import { t } from '@/i18n'

/** Уровень коррекции: M — «средний» (~15% ошибок), стандарт для ссылок. */
const ECC_M = 0b00

/** Сколько EC-кодовых слов и как разбиты блоки (уровень M, версии 1–10). */
interface EcSpec {
  /** Число EC-кодовых слов В БЛОКЕ. */
  ecPerBlock: number
  /** Блоки: сколько и сколько в каждом данных. */
  blocks: Array<{ count: number; dataCodewords: number }>
}

const EC_TABLE: Record<number, EcSpec> = {
  1: { ecPerBlock: 10, blocks: [{ count: 1, dataCodewords: 16 }] },
  2: { ecPerBlock: 16, blocks: [{ count: 1, dataCodewords: 28 }] },
  3: { ecPerBlock: 26, blocks: [{ count: 1, dataCodewords: 44 }] },
  4: { ecPerBlock: 18, blocks: [{ count: 2, dataCodewords: 32 }] },
  5: { ecPerBlock: 24, blocks: [{ count: 2, dataCodewords: 43 }] },
  6: { ecPerBlock: 16, blocks: [{ count: 4, dataCodewords: 27 }] },
  7: { ecPerBlock: 18, blocks: [{ count: 4, dataCodewords: 31 }] },
  8: {
    ecPerBlock: 22,
    blocks: [
      { count: 2, dataCodewords: 38 },
      { count: 2, dataCodewords: 39 }
    ]
  },
  9: {
    ecPerBlock: 22,
    blocks: [
      { count: 3, dataCodewords: 36 },
      { count: 2, dataCodewords: 37 }
    ]
  },
  10: {
    ecPerBlock: 26,
    blocks: [
      { count: 4, dataCodewords: 43 },
      { count: 1, dataCodewords: 44 }
    ]
  }
}

/** Максимальная версия: хватает на 200+ знаков при уровне M. */
const MAX_VERSION = 10

/** Центры узоров выравнивания (для каждой версии — свои, см. стандарт). */
const ALIGNMENT_CENTERS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50]
}

/** Сведения о версии (18 бит) для версий 7–10: остальное берётся по формуле. */
const VERSION_INFO: Record<number, number> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3
}

/** Сколько бит занимает счётчик длины в байтовом режиме (1–9: 8 бит, 10+: 16). */
const lengthBitsFor = (version: number): number => (version >= 10 ? 16 : 8)

/** Сколько байтов данных влезает в версию при уровне M. */
const dataCapacity = (version: number): number => {
  const spec = EC_TABLE[version]
  const codewords = spec.blocks.reduce((sum, block) => sum + block.count * block.dataCodewords, 0)
  const bits = codewords * 8 - 4 - lengthBitsFor(version)
  return Math.floor(bits / 8)
}

const textToBytes = (text: string): number[] => Array.from(new TextEncoder().encode(text))

/** Подбирает минимальную версию, в которую влезает текст (уровень M). */
export const qrVersionFor = (text: string): number => {
  const size = textToBytes(text).length
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    if (size <= dataCapacity(version)) return version
  }
  throw new Error(
    t('Слишком длинный текст для QR (больше {max} знаков)', {
      max: dataCapacity(MAX_VERSION)
    })
  )
}

// ---------- Поля Галуа GF(256) и коды Рида-Соломона ----------

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)

;(() => {
  let value = 1
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = value
    LOG[value] = i
    value <<= 1
    if (value & 0x100) value ^= 0x11d
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]
})()

const gfMul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

/** Порождающий многочлен для нужного числа EC-кодовых слов. */
const generatorPolynomial = (degree: number): number[] => {
  let poly = [1]
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

/** Остаток от деления данных на порождающий многочлен — это и есть EC-слова. */
const ecCodewords = (data: number[], degree: number): number[] => {
  const generator = generatorPolynomial(degree)
  const remainder = new Array<number>(degree).fill(0)
  for (const byte of data) {
    const factor = byte ^ remainder[0]
    remainder.shift()
    remainder.push(0)
    for (let i = 0; i < degree; i += 1) {
      remainder[i] ^= gfMul(generator[i + 1], factor)
    }
  }
  return remainder
}

// ---------- Данные ----------

/** Собирает поток бит: режим (0100) + длина + байты + терминатор + набивка. */
const buildBitStream = (bytes: number[], version: number, capacityCodewords: number): number[] => {
  const bits: number[] = []
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1)
  }
  push(0b0100, 4) // байтовый режим
  push(bytes.length, lengthBitsFor(version))
  for (const byte of bytes) push(byte, 8)

  const capacityBits = capacityCodewords * 8
  // Терминатор: до четырёх нулей, но не больше, чем осталось места.
  const terminator = Math.min(4, capacityBits - bits.length)
  for (let i = 0; i < terminator; i += 1) bits.push(0)
  while (bits.length % 8 !== 0) bits.push(0)

  const codewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j]
    codewords.push(byte)
  }
  // Набивка чередующимися байтами 0xEC/0x11 — так требует стандарт.
  const fillers = [0xec, 0x11]
  let index = 0
  while (codewords.length < capacityCodewords) {
    codewords.push(fillers[index % 2])
    index += 1
  }
  return codewords
}

/** Готовит кодовые слова: данные по блокам, EC, затем чередование. */
const buildCodewords = (text: string, version: number): number[] => {
  const spec = EC_TABLE[version]
  const dataBlocks: number[][] = []
  const ecBlocks: number[][] = []
  const capacity = spec.blocks.reduce((sum, block) => sum + block.count * block.dataCodewords, 0)
  const stream = buildBitStream(textToBytes(text), version, capacity)

  let offset = 0
  for (const block of spec.blocks) {
    for (let i = 0; i < block.count; i += 1) {
      const data = stream.slice(offset, offset + block.dataCodewords)
      offset += block.dataCodewords
      dataBlocks.push(data)
      ecBlocks.push(ecCodewords(data, spec.ecPerBlock))
    }
  }

  // Чередование: сначала по одному слову из каждого блока данных, потом EC.
  const result: number[] = []
  const maxData = Math.max(...dataBlocks.map((block) => block.length))
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) {
      if (i < block.length) result.push(block[i])
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const block of ecBlocks) result.push(block[i])
  }
  return result
}

// ---------- Матрица ----------

type Matrix = (boolean | null)[][]

const createMatrix = (size: number): Matrix =>
  Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null))

/** Поисковый узор 7×7 с разделителем вокруг. */
const placeFinder = (matrix: Matrix, row: number, col: number): void => {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const y = row + r
      const x = col + c
      if (y < 0 || x < 0 || y >= matrix.length || x >= matrix.length) continue
      const inRing = r === 0 || r === 6 || c === 0 || c === 6
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4
      matrix[y][x] = (r >= 0 && r <= 6 && c >= 0 && c <= 6 && (inRing || inCore)) || false
    }
  }
}

/** Служебные узоры: поисковые, синхронизации, выравнивания, тёмный модуль. */
const placePatterns = (matrix: Matrix, version: number): void => {
  const size = matrix.length
  placeFinder(matrix, 0, 0)
  placeFinder(matrix, 0, size - 7)
  placeFinder(matrix, size - 7, 0)

  // Линии синхронизации.
  for (let i = 8; i < size - 8; i += 1) {
    matrix[6][i] = i % 2 === 0
    matrix[i][6] = i % 2 === 0
  }

  // Узоры выравнивания (кроме пересечений с поисковыми).
  const centers = ALIGNMENT_CENTERS[version]
  for (const row of centers) {
    for (const col of centers) {
      const nearFinder =
        (row === 6 && col === 6) ||
        (row === 6 && col === size - 7) ||
        (row === size - 7 && col === 6)
      if (nearFinder) continue
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const ring = Math.max(Math.abs(r), Math.abs(c))
          matrix[row + r][col + c] = ring !== 1
        }
      }
    }
  }

  // Тёмный модуль обязателен по стандарту.
  matrix[size - 8][8] = true

  // Резерв под сведения о формате (заполним после выбора маски).
  const reserveFormat = (row: number, col: number): void => {
    if (matrix[row][col] === null) matrix[row][col] = false
  }
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      reserveFormat(8, i)
      reserveFormat(i, 8)
    }
  }
  for (let i = 0; i < 8; i += 1) {
    reserveFormat(8, size - 8 + i)
    reserveFormat(size - 8 + i, 8)
  }
  // Сведения о версии (только 7+).
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const row = Math.floor(i / 3)
      const col = i % 3
      reserveFormat(size - 11 + col, row)
      reserveFormat(row, size - 11 + col)
    }
  }
}

/** Укладывает кодовые слова «змейкой» по двум столбцам справа налево. */
const placeData = (matrix: Matrix, codewords: number[]): void => {
  const size = matrix.length
  let bitIndex = 0
  const totalBits = codewords.length * 8
  const bitAt = (index: number): boolean =>
    index < totalBits ? ((codewords[index >> 3] >> (7 - (index & 7))) & 1) === 1 : false

  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5 // столбец синхронизации пропускаем
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step
      for (const col of [right, right - 1]) {
        if (matrix[row][col] !== null) continue
        matrix[row][col] = bitAt(bitIndex)
        bitIndex += 1
      }
    }
    upward = !upward
  }
}

const maskBit = (mask: number, row: number, col: number): boolean => {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0
    case 1:
      return row % 2 === 0
    case 2:
      return col % 3 === 0
    case 3:
      return (row + col) % 3 === 0
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0
  }
}

/** Сведения о формате: 5 бит данных + BCH(15,5) и обязательная маска 0x5412. */
const formatBits = (mask: number): number => {
  const data = (ECC_M << 3) | mask
  let value = data << 10
  for (let i = 14; i >= 10; i -= 1) {
    if ((value >> i) & 1) value ^= 0x537 << (i - 10)
  }
  return ((data << 10) | value) ^ 0x5412
}

/** Рисует сведения о формате вокруг поисковых узоров. */
const placeFormat = (matrix: Matrix, mask: number): void => {
  const size = matrix.length
  const bits = formatBits(mask)
  const bit = (index: number): boolean => ((bits >> index) & 1) === 1

  // Первая копия: столбец слева от верхнего левого узора (младшие и часть
  // старших битов) и строка над ним. Внимание: биты 0–5 идут ВНИЗ по столбцу,
  // а биты 9–14 — ВЛЕВО по строке; если перепутать ветви, код на экране выглядит
  // правильно, но сканер его не читает.
  for (let i = 0; i <= 5; i += 1) matrix[i][8] = bit(i)
  matrix[7][8] = bit(6)
  matrix[8][8] = bit(7)
  matrix[8][7] = bit(8)
  for (let i = 9; i <= 14; i += 1) matrix[8][14 - i] = bit(i)

  // Вторая копия: верхняя строка справа (биты 0–7) и левый столбец снизу
  // (биты 8–14).
  for (let i = 0; i <= 7; i += 1) matrix[8][size - 1 - i] = bit(i)
  for (let i = 8; i <= 14; i += 1) matrix[size - 15 + i][8] = bit(i)

  // Тёмный модуль не должен быть перезаписан.
  matrix[size - 8][8] = true
}

/** Рисует сведения о версии (для версий 7+). */
const placeVersion = (matrix: Matrix, version: number): void => {
  if (version < 7) return
  const size = matrix.length
  const bits = VERSION_INFO[version]
  for (let i = 0; i < 18; i += 1) {
    const value = ((bits >> i) & 1) === 1
    const row = Math.floor(i / 3)
    const col = i % 3
    matrix[size - 11 + col][row] = value
    matrix[row][size - 11 + col] = value
  }
}

/** Штрафные очки маски (чем меньше — тем «чище» узор). */
const penalty = (matrix: boolean[][]): number => {
  const size = matrix.length
  let score = 0

  const runScore = (line: boolean[]): number => {
    let total = 0
    let run = 1
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) {
        run += 1
        continue
      }
      if (run >= 5) total += 3 + (run - 5)
      run = 1
    }
    if (run >= 5) total += 3 + (run - 5)
    return total
  }

  for (let i = 0; i < size; i += 1) {
    score += runScore(matrix[i])
    score += runScore(matrix.map((row) => row[i]))
  }

  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const cell = matrix[row][col]
      if (
        matrix[row][col + 1] === cell &&
        matrix[row + 1][col] === cell &&
        matrix[row + 1][col + 1] === cell
      ) {
        score += 3
      }
    }
  }

  // Узор 1:1:3:1:1 с четырьмя светлыми модулями сбоку — «похоже на поисковый».
  // По стандарту это две последовательности по 11 модулей; они могут наложиться
  // друг на друга, и тогда очки начисляются дважды, поэтому проверяем окна, а не
  // сам семимодульный узор.
  const FINDER_LIKE = [
    [true, false, true, true, true, false, true, false, false, false, false],
    [false, false, false, false, true, false, true, true, true, false, true]
  ]
  const finderLikeCount = (line: boolean[]): number => {
    let count = 0
    for (let start = 0; start + 11 <= line.length; start += 1) {
      for (const pattern of FINDER_LIKE) {
        if (pattern.every((value, index) => line[start + index] === value)) count += 1
      }
    }
    return count
  }
  for (let i = 0; i < size; i += 1) {
    score += 40 * finderLikeCount(matrix[i])
    score += 40 * finderLikeCount(matrix.map((row) => row[i]))
  }

  let dark = 0
  for (const row of matrix) {
    for (const cell of row) if (cell) dark += 1
  }
  const ratio = (dark * 100) / (size * size)
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10
  return score
}

/**
 * Служебные клетки: их не трогает ни маска, ни данные.
 *
 * Отдельного признака у клетки нет, поэтому расположение узоров считаем один раз
 * и держим рядом с матрицей — так решение не зависит от того, что уже нарисовано.
 */
const createReservedMap = (size: number, version: number): boolean[][] => {
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const markRect = (row: number, col: number, height: number, width: number): void => {
    for (let r = row; r < row + height; r += 1) {
      for (let c = col; c < col + width; c += 1) {
        if (r >= 0 && c >= 0 && r < size && c < size) reserved[r][c] = true
      }
    }
  }
  markRect(0, 0, 9, 9)
  markRect(0, size - 8, 9, 8)
  markRect(size - 8, 0, 8, 9)
  markRect(6, 0, 1, size)
  markRect(0, 6, size, 1)
  for (const row of ALIGNMENT_CENTERS[version]) {
    for (const col of ALIGNMENT_CENTERS[version]) {
      const nearFinder =
        (row === 6 && col === 6) ||
        (row === 6 && col === size - 7) ||
        (row === size - 7 && col === 6)
      if (nearFinder) continue
      markRect(row - 2, col - 2, 5, 5)
    }
  }
  return reserved
}

/** Накладывает маску (кроме служебных клеток) и дописывает сведения о формате и версии. */
const withMask = (
  base: Matrix,
  reserved: boolean[][],
  mask: number,
  version: number
): boolean[][] => {
  const matrix = base.map((row, y) =>
    row.map((cell, x) => (reserved[y][x] ? cell === true : (cell === true) !== maskBit(mask, y, x)))
  )
  placeFormat(matrix, mask)
  placeVersion(matrix, version)
  return matrix
}

/**
 * Строит QR-код и отдаёт матрицу модулей (`true` — тёмный).
 *
 * `options.mask` фиксирует маску: нужно тестам, чтобы сверять код с эталоном по
 * каждой маске отдельно. Без него маска выбирается по штрафным очкам, как велит
 * стандарт.
 *
 * Без поля покоя: его добавляет отрисовка (стандарт требует 4 модуля по краям).
 */
export const createQrMatrix = (text: string, options: { mask?: number } = {}): boolean[][] => {
  const version = qrVersionFor(text)
  const size = version * 4 + 17

  const base = createMatrix(size)
  placePatterns(base, version)
  placeData(base, buildCodewords(text, version))
  const reserved = createReservedMap(size, version)

  if (options.mask !== undefined) return withMask(base, reserved, options.mask, version)

  let best: boolean[][] | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = withMask(base, reserved, mask, version)
    const score = penalty(candidate)
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best as boolean[][]
}

/**
 * Готовит SVG-описание кода одним `<path>`.
 *
 * Соседние тёмные модули в строке склеиваются в полосу: один путь вместо сотни
 * прямоугольников — разметка меньше, а рисовать браузеру проще (важно на телефоне).
 */
export const qrSvgPath = (matrix: boolean[][], options: { quietZone?: number } = {}): string => {
  const quiet = options.quietZone ?? 4
  const parts: string[] = []
  matrix.forEach((row, y) => {
    let start = -1
    for (let x = 0; x <= row.length; x += 1) {
      const dark = x < row.length && row[x]
      if (dark) {
        if (start < 0) start = x
        continue
      }
      if (start >= 0) {
        parts.push(`M${start + quiet} ${y + quiet}h${x - start}v1h${start - x}z`)
        start = -1
      }
    }
  })
  return parts.join('')
}

/** Размер кода в модулях, включая поле покоя (для `viewBox`). */
export const qrSvgSize = (matrix: boolean[][], options: { quietZone?: number } = {}): number =>
  matrix.length + (options.quietZone ?? 4) * 2
