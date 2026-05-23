export const BOARD_COLUMNS = 400
export const BOARD_ROWS = 250
export const TOTAL_TILES = BOARD_COLUMNS * BOARD_ROWS             // 100,000
export const TILE_PIXEL_SIZE = 100                                // 100×100 conceptual px per tile
export const TOTAL_CONCEPTUAL_PIXELS =
  TOTAL_TILES * TILE_PIXEL_SIZE * TILE_PIXEL_SIZE                 // 1,000,000,000

export type TileStatus = 'AVAILABLE' | 'PENDING' | 'ACTIVE' | 'EXPIRED'
export type DisplayMode = 'REPEAT' | 'STRETCH'

export const TILE_COLORS: Record<TileStatus, string> = {
  AVAILABLE: '#141414',
  PENDING: '#b45309',
  ACTIVE: '#15803d',
  EXPIRED: '#1f2937',
}

export const TILE_COLORS_BRIGHT: Record<TileStatus, string> = {
  AVAILABLE: '#1c1c1c',
  PENDING: '#d97706',
  ACTIVE: '#16a34a',
  EXPIRED: '#374151',
}

export interface TileData {
  tileId: number
  status: TileStatus
  creativeId?: string
  imageUrl?: string
  destUrl?: string
  altText?: string
  advertiserEmail?: string
}

export interface TileStatusMap {
  [tileId: number]: TileStatus
}

export interface TileInfo {
  status: TileStatus
  creativeId?: string
  imageUrl?: string
  destUrl?: string
  altText?: string
  advertiserEmail?: string
  displayMode?: DisplayMode
}

export interface TileInfoMap {
  [tileId: number]: TileInfo
}

export function tileIdToCoords(id: number): { col: number; row: number } {
  return { col: id % BOARD_COLUMNS, row: Math.floor(id / BOARD_COLUMNS) }
}

export function coordsToTileId(col: number, row: number): number {
  return col + row * BOARD_COLUMNS
}

// Returns true iff tileIds form a complete filled rectangle (including 1×1, 1×N, N×1, N×M).
// Rejects scattered tiles, L-shapes, incomplete rectangles, and selections with gaps.
// Uses BOARD_COLUMNS=400 for coordinate math — consistent with tileIdToCoords/coordsToTileId.
export function isRectangularSelection(tileIds: number[]): boolean {
  if (tileIds.length === 0) return false

  // Deduplicate: a Set→Array ensures length reflects unique tiles
  const ids = Array.from(new Set(tileIds))
  if (ids.length === 1) return true

  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity
  for (const id of ids) {
    const { col, row } = tileIdToCoords(id)  // col = id % 400, row = floor(id / 400)
    if (col < minCol) minCol = col
    if (col > maxCol) maxCol = col
    if (row < minRow) minRow = row
    if (row > maxRow) maxRow = row
  }

  // Expected count for a filled rectangle
  const expectedCount = (maxCol - minCol + 1) * (maxRow - minRow + 1)

  // Fast reject: wrong tile count (catches scattered, L-shapes, holes)
  if (ids.length !== expectedCount) return false

  // Verify every position in the bounding box is present
  const tileSet = new Set(ids)
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      if (!tileSet.has(coordsToTileId(c, r))) return false  // c + r * 400
    }
  }
  return true
}

// Dev-only: run known test cases and log pass/fail to the console.
// Call once on mount (e.g. in useEffect) to verify the function during development.
export function runRectangularSelectionTests(): void {
  if (process.env.NODE_ENV === 'production') return

  // Build rectangles using BOARD_COLUMNS so tests stay consistent with production math
  const row = (r: number, cStart: number, cEnd: number) =>
    Array.from({ length: cEnd - cStart + 1 }, (_, i) => coordsToTileId(cStart + i, r))

  const rect = (rStart: number, rEnd: number, cStart: number, cEnd: number) =>
    Array.from({ length: (rEnd - rStart + 1) * (cEnd - cStart + 1) }, (_, i) => {
      const dr = Math.floor(i / (cEnd - cStart + 1))
      const dc = i % (cEnd - cStart + 1)
      return coordsToTileId(cStart + dc, rStart + dr)
    })

  const cases: [string, number[], boolean][] = [
    ['1×1 single tile',   [0],                                          true],
    ['1×3 horizontal',    row(0, 0, 2),                                  true],
    ['3×1 vertical',      [0, coordsToTileId(0,1), coordsToTileId(0,2)], true],
    ['2×2 square',        rect(0, 1, 0, 1),                              true],
    ['3×3 square',        rect(0, 2, 0, 2),                              true],
    ['5×5 square',        rect(0, 4, 0, 4),                              true],
    ['10×3 wide',         rect(0, 2, 0, 9),                              true],
    ['20×10',             rect(0, 9, 0, 19),                             true],
    ['scattered tiles',   [0, 5, coordsToTileId(0, 2)],                 false],
    ['L-shape',           [...row(0, 0, 1), coordsToTileId(0, 1)],       false],
    ['missing center',    rect(0,2,0,2).filter(id => id !== coordsToTileId(1,1)), false],
    ['empty',             [],                                             false],
  ]

  let passed = 0
  for (const [name, ids, expected] of cases) {
    const result = isRectangularSelection(ids)
    const ok = result === expected
    if (ok) passed++
    console[ok ? 'log' : 'warn'](
      `[isRectangularSelection] ${ok ? '✓' : '✗'} ${name} (${ids.length} tiles): expected=${expected}, got=${result}`
    )
  }
  console.log(`[isRectangularSelection] ${passed}/${cases.length} tests passed`)
}
