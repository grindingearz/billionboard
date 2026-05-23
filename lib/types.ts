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

export function isRectangularSelection(tileIds: number[]): boolean {
  if (tileIds.length === 0) return false
  if (tileIds.length === 1) return true
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity
  for (const id of tileIds) {
    const { col, row } = tileIdToCoords(id)
    if (col < minCol) minCol = col
    if (col > maxCol) maxCol = col
    if (row < minRow) minRow = row
    if (row > maxRow) maxRow = row
  }
  const expected = (maxCol - minCol + 1) * (maxRow - minRow + 1)
  if (tileIds.length !== expected) return false
  const tileSet = new Set(tileIds)
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      if (!tileSet.has(coordsToTileId(c, r))) return false
    }
  }
  return true
}
