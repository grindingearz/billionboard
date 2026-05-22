'use client'

import { useRef, useEffect } from 'react'
import {
  BOARD_COLUMNS,
  BOARD_ROWS,
  type TileStatus,
  type TileInfoMap,
} from '@/lib/types'

const LOUPE_SIZE = 192
const LOUPE_ZOOM = 4

interface LoupeProps {
  sourceCanvas: HTMLCanvasElement | null
  canvasX: number
  canvasY: number
  tileId: number | null
  tiles: TileInfoMap
  selectedTiles?: Set<number>
  pixelSize: number
  visible: boolean
  viewportX: number
  viewportY: number
  containerRect: DOMRect | null
  tilePrice?: number
}

export default function Loupe({
  sourceCanvas,
  canvasX,
  canvasY,
  tileId,
  tiles,
  selectedTiles,
  pixelSize,
  visible,
  viewportX,
  viewportY,
  containerRect,
  tilePrice = 1,
}: LoupeProps) {
  const loupeRef = useRef<HTMLCanvasElement>(null)

  const col = tileId !== null ? tileId % BOARD_COLUMNS : -1
  const row = tileId !== null ? Math.floor(tileId / BOARD_COLUMNS) : -1
  const info = tileId !== null ? tiles[tileId] : undefined
  const isSelected = tileId !== null && (selectedTiles?.has(tileId) ?? false)
  const status: TileStatus = isSelected ? 'AVAILABLE' : (info?.status ?? 'AVAILABLE')

  useEffect(() => {
    if (!visible || !sourceCanvas || tileId === null) return
    const lc = loupeRef.current
    if (!lc) return
    const ctx = lc.getContext('2d')
    if (!ctx) return

    const ratio = 1 / LOUPE_ZOOM
    const srcSize = LOUPE_SIZE * ratio

    const tileCenterX = (col + 0.5) * pixelSize
    const tileCenterY = (row + 0.5) * pixelSize
    const sx = tileCenterX - srcSize / 2
    const sy = tileCenterY - srcSize / 2

    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE)

    ctx.save()
    ctx.beginPath()
    ctx.arc(LOUPE_SIZE / 2, LOUPE_SIZE / 2, LOUPE_SIZE / 2 - 1, 0, Math.PI * 2)
    ctx.clip()

    ctx.imageSmoothingEnabled = false
    ctx.drawImage(sourceCanvas, sx, sy, srcSize, srcSize, 0, 0, LOUPE_SIZE, LOUPE_SIZE)

    const centerTileScreen = LOUPE_SIZE / 2
    const tileDisplaySize = pixelSize * LOUPE_ZOOM
    const tileLeft = centerTileScreen - tileDisplaySize / 2
    const tileTop = centerTileScreen - tileDisplaySize / 2

    ctx.fillStyle = isSelected ? 'rgba(96,165,250,0.3)' : 'rgba(255,255,255,0.15)'
    ctx.fillRect(tileLeft, tileTop, tileDisplaySize, tileDisplaySize)

    ctx.strokeStyle = isSelected ? '#60a5fa' : '#ffffff'
    ctx.lineWidth = 1.5
    ctx.strokeRect(tileLeft + 0.75, tileTop + 0.75, tileDisplaySize - 1.5, tileDisplaySize - 1.5)

    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(centerTileScreen, 0)
    ctx.lineTo(centerTileScreen, LOUPE_SIZE)
    ctx.moveTo(0, centerTileScreen)
    ctx.lineTo(LOUPE_SIZE, centerTileScreen)
    ctx.stroke()

    ctx.restore()

    ctx.beginPath()
    ctx.arc(LOUPE_SIZE / 2, LOUPE_SIZE / 2, LOUPE_SIZE / 2 - 1, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }, [visible, sourceCanvas, tileId, col, row, pixelSize, isSelected, canvasX, canvasY])

  if (!visible || tileId === null) return null

  const OFFSET = 24
  const PANEL_W = LOUPE_SIZE + 8
  const PANEL_H = LOUPE_SIZE + 90

  let left = viewportX + OFFSET
  let top = viewportY - LOUPE_SIZE / 2

  if (containerRect) {
    if (left + PANEL_W > containerRect.right - 8) left = viewportX - OFFSET - LOUPE_SIZE
    if (top + PANEL_H > containerRect.bottom - 8) top = containerRect.bottom - PANEL_H - 8
    if (top < containerRect.top + 8) top = containerRect.top + 8
  }

  const statusLabel = isSelected
    ? 'SELECTED'
    : status === 'ACTIVE'
      ? 'ACTIVE'
      : status === 'PENDING'
        ? 'PENDING'
        : 'AVAILABLE'

  const statusColor = isSelected
    ? 'text-blue-400'
    : status === 'ACTIVE'
      ? 'text-green-400'
      : status === 'PENDING'
        ? 'text-amber-400'
        : 'text-white/50'

  const isTaken = status === 'ACTIVE' || status === 'PENDING'
  const priceLabel = `$${tilePrice % 1 === 0 ? tilePrice : tilePrice.toFixed(2)} / day`

  return (
    <div
      className="pointer-events-none fixed z-50 flex flex-col items-center"
      style={{ left, top }}
    >
      <canvas
        ref={loupeRef}
        width={LOUPE_SIZE}
        height={LOUPE_SIZE}
        className="rounded-full shadow-2xl shadow-black/60"
        style={{ width: LOUPE_SIZE, height: LOUPE_SIZE, imageRendering: 'pixelated', background: '#141414' }}
      />

      <div className="mt-2 bg-black/90 border border-white/10 rounded-lg px-3 py-2 text-xs min-w-[160px]">
        <div className="flex justify-between items-center mb-1">
          <span className="text-white/40">Tile #{tileId}</span>
          <span className={`font-medium ${statusColor}`}>{statusLabel}</span>
        </div>
        <div className="text-white/30 mb-1.5">Col {col} · Row {row}</div>
        {info?.advertiserEmail && (
          <div className="text-white/50 truncate mb-1" title={info.advertiserEmail}>
            {info.advertiserEmail}
          </div>
        )}
        {info?.destUrl && (
          <div className="text-green-400/80 truncate mb-1 text-[10px]" title={info.destUrl}>
            {info.destUrl.replace(/^https?:\/\//, '')}
          </div>
        )}
        <div className={`font-mono font-bold ${isTaken ? 'text-white/20 line-through' : 'text-green-400'}`}>
          {priceLabel}
        </div>
        {isTaken && !info?.destUrl && (
          <div className="text-red-400/80 text-[10px] mt-0.5">Not available</div>
        )}
        {status === 'ACTIVE' && info?.destUrl && (
          <div className="text-green-400/60 text-[10px] mt-0.5">Click to visit →</div>
        )}
      </div>
    </div>
  )
}
