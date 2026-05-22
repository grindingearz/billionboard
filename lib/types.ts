export const GRID_COLS = 1000
export const GRID_ROWS = 100
export const TOTAL_TILES = GRID_COLS * GRID_ROWS

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

export function tileIdToCoords(id: number): { col: number; row: number } {
  return { col: id % GRID_COLS, row: Math.floor(id / GRID_COLS) }
}

export function coordsToTileId(col: number, row: number): number {
  return col + row * GRID_COLS
}
