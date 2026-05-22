'use client'

import { useRef, useEffect, useCallback, useState } from 'react'
import {
  GRID_COLS,
  GRID_ROWS,
  TILE_COLORS,
  TILE_COLORS_BRIGHT,
  type TileStatus,
  type TileStatusMap,
  tileIdToCoords,
} from '@/lib/types'

interface BillboardProps {
  tiles: TileStatusMap
  selectedTiles?: Set<number>
  onTileClick?: (tileId: number) => void
  pixelSize?: number
  interactive?: boolean
  className?: string
}

const SELECTED_COLOR = '#2563eb'
const HOVER_COLOR = '#2a2a2a'

export default function Billboard({
  tiles,
  selectedTiles,
  onTileClick,
  pixelSize = 2,
  interactive = false,
  className = '',
}: BillboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const hoveredTile = useRef<number | null>(null)
  const [tooltip, setTooltip] = useState<{
    x: number
    y: number
    tileId: number
    status: TileStatus
  } | null>(null)
  const isDragging = useRef(false)
  const dragStart = useRef<number | null>(null)

  const getTileId = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      const scaleX = (GRID_COLS * pixelSize) / rect.width
      const scaleY = (GRID_ROWS * pixelSize) / rect.height
      const x = (e.clientX - rect.left) * scaleX
      const y = (e.clientY - rect.top) * scaleY
      const col = Math.floor(x / pixelSize)
      const row = Math.floor(y / pixelSize)
      if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return null
      return col + row * GRID_COLS
    },
    [pixelSize]
  )

  // Main render — draws all tiles on base canvas
  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const gap = pixelSize > 3 ? 1 : 0
    const tileW = pixelSize - gap
    const tileH = pixelSize - gap

    // Background
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Available tiles base coat
    ctx.fillStyle = TILE_COLORS.AVAILABLE
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Draw occupied and selected tiles
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const tileId = col + row * GRID_COLS
        const status = tiles[tileId]
        const isSelected = selectedTiles?.has(tileId)

        if (!status && !isSelected) continue

        let color = status ? TILE_COLORS_BRIGHT[status] : TILE_COLORS.AVAILABLE
        if (isSelected) color = SELECTED_COLOR

        ctx.fillStyle = color
        ctx.fillRect(col * pixelSize, row * pixelSize, tileW, tileH)
      }
    }

    // Grid lines at larger zoom
    if (pixelSize >= 8) {
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'
      ctx.lineWidth = 0.5
      for (let col = 0; col <= GRID_COLS; col++) {
        ctx.beginPath()
        ctx.moveTo(col * pixelSize, 0)
        ctx.lineTo(col * pixelSize, GRID_ROWS * pixelSize)
        ctx.stroke()
      }
      for (let row = 0; row <= GRID_ROWS; row++) {
        ctx.beginPath()
        ctx.moveTo(0, row * pixelSize)
        ctx.lineTo(GRID_COLS * pixelSize, row * pixelSize)
        ctx.stroke()
      }
    }
  }, [tiles, selectedTiles, pixelSize])

  // Overlay render — hover highlight only
  const renderOverlay = useCallback(
    (tileId: number | null) => {
      const canvas = overlayRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (tileId === null) return
      const { col, row } = tileIdToCoords(tileId)
      const gap = pixelSize > 3 ? 1 : 0
      ctx.fillStyle = HOVER_COLOR
      ctx.globalAlpha = 0.5
      ctx.fillRect(col * pixelSize, row * pixelSize, pixelSize - gap, pixelSize - gap)
      ctx.globalAlpha = 1
    },
    [pixelSize]
  )

  useEffect(() => {
    render()
  }, [render])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!interactive) return
      const tileId = getTileId(e)
      if (tileId === hoveredTile.current) return
      hoveredTile.current = tileId
      renderOverlay(tileId)
      if (tileId !== null) {
        const canvas = canvasRef.current!
        const rect = canvas.getBoundingClientRect()
        setTooltip({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          tileId,
          status: tiles[tileId] ?? 'AVAILABLE',
        })
      } else {
        setTooltip(null)
      }
    },
    [interactive, getTileId, renderOverlay, tiles]
  )

  const handleMouseLeave = useCallback(() => {
    hoveredTile.current = null
    renderOverlay(null)
    setTooltip(null)
  }, [renderOverlay])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!interactive) return
      isDragging.current = false
      dragStart.current = getTileId(e)
    },
    [interactive, getTileId]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!interactive || isDragging.current) return
      const tileId = getTileId(e)
      if (tileId !== null) onTileClick?.(tileId)
    },
    [interactive, getTileId, onTileClick]
  )

  const width = GRID_COLS * pixelSize
  const height = GRID_ROWS * pixelSize

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ aspectRatio: `${GRID_COLS}/${GRID_ROWS}` }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="absolute inset-0 w-full h-full"
        style={{ imageRendering: 'pixelated' }}
      />
      {interactive && (
        <canvas
          ref={overlayRef}
          width={width}
          height={height}
          className="absolute inset-0 w-full h-full cursor-crosshair"
          style={{ imageRendering: 'pixelated' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onMouseDown={handleMouseDown}
          onClick={handleClick}
        />
      )}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded bg-black/90 border border-white/10 px-2 py-1 text-xs text-white whitespace-nowrap"
          style={{ left: tooltip.x + 12, top: tooltip.y - 28 }}
        >
          <span className="text-white/50">#{tooltip.tileId}</span>
          &nbsp;
          <span
            className={
              tooltip.status === 'ACTIVE'
                ? 'text-green-400'
                : tooltip.status === 'PENDING'
                  ? 'text-amber-400'
                  : 'text-white/70'
            }
          >
            {tooltip.status}
          </span>
        </div>
      )}
    </div>
  )
}
