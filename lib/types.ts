export const BOARD_COLUMNS = 400
export const BOARD_ROWS = 250
export const TOTAL_TILES = BOARD_COLUMNS * BOARD_ROWS             // 100,000
export const TILE_PIXEL_SIZE = 100                                // 100×100 conceptual px per tile
export const TOTAL_CONCEPTUAL_PIXELS =
  TOTAL_TILES * TILE_PIXEL_SIZE * TILE_PIXEL_SIZE                 // 1,000,000,000

export type TileStatus = 'AVAILABLE' | 'PENDING' | 'ACTIVE' | 'EXPIRED'

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
