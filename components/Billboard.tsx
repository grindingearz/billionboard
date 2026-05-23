'use client'

import { useRef, useEffect, useCallback, useState } from 'react'
import {
  BOARD_COLUMNS,
  BOARD_ROWS,
  TILE_COLORS,
  TILE_COLORS_BRIGHT,
  type TileStatus,
  type TileInfoMap,
  tileIdToCoords,
} from '@/lib/types'

interface BillboardProps {
  tiles: TileInfoMap
  selectedTiles?: Set<number>
  onTileClick?: (tileId: number) => void
  /** Canvas resolution multiplier — higher = crisper at zoom, slower render. Default 3. */
  pixelSize?: number
  interactive?: boolean
  className?: string
  onCursorMove?: (info: {
    tileId: number | null
    canvasX: number
    canvasY: number
    viewportX: number
    viewportY: number
    canvas: HTMLCanvasElement
  }) => void
  onCursorLeave?: () => void
}

const SELECTED_COLOR = '#2563eb'
const SELECTED_OUTLINE = '#60a5fa'
const HOVER_COLOR = '#2a2a2a'

export default function Billboard({
  tiles,
  selectedTiles,
  onTileClick,
  pixelSize = 3,
  interactive = false,
  className = '',
  onCursorMove,
  onCursorLeave,
}: BillboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const hoveredTile = useRef<number | null>(null)
  const imageCache = useRef<Map<string, HTMLImageElement | 'loading' | 'error'>>(new Map())
  const [imageVersion, setImageVersion] = useState(0)

  const [tooltip, setTooltip] = useState<{
    x: number
    y: number
    tileId: number
    col: number
    row: number
    status: TileStatus
  } | null>(null)

  const getTileId = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      const scaleX = (BOARD_COLUMNS * pixelSize) / rect.width
      const scaleY = (BOARD_ROWS * pixelSize) / rect.height
      const x = (e.clientX - rect.left) * scaleX
      const y = (e.clientY - rect.top) * scaleY
      const col = Math.floor(x / pixelSize)
      const row = Math.floor(y / pixelSize)
      if (col < 0 || col >= BOARD_COLUMNS || row < 0 || row >= BOARD_ROWS) return null
      return col + row * BOARD_COLUMNS
    },
    [pixelSize]
  )

  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const gap = pixelSize > 2 ? 1 : 0
    const tileW = pixelSize - gap
    const tileH = pixelSize - gap

    ctx.fillStyle = TILE_COLORS.AVAILABLE
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    for (let row = 0; row < BOARD_ROWS; row++) {
      for (let col = 0; col < BOARD_COLUMNS; col++) {
        const tileId = col + row * BOARD_COLUMNS
        const info = tiles[tileId]
        const status = info?.status
        const isSelected = selectedTiles?.has(tileId)

        if (!status && !isSelected) continue

        if (isSelected) {
          ctx.fillStyle = SELECTED_COLOR
          ctx.fillRect(col * pixelSize, row * pixelSize, tileW, tileH)
          if (pixelSize >= 3) {
            const lw = Math.max(0.5, pixelSize * 0.18)
            ctx.strokeStyle = SELECTED_OUTLINE
            ctx.lineWidth = lw
            ctx.strokeRect(
              col * pixelSize + lw / 2,
              row * pixelSize + lw / 2,
              tileW - lw,
              tileH - lw
            )
          }
        } else if (status) {
          ctx.fillStyle = TILE_COLORS_BRIGHT[status]
          ctx.fillRect(col * pixelSize, row * pixelSize, tileW, tileH)
        }
      }
    }

    // Grid lines
    if (pixelSize >= 3) {
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'
      ctx.lineWidth = 0.5
      for (let col = 0; col <= BOARD_COLUMNS; col++) {
        ctx.beginPath()
        ctx.moveTo(col * pixelSize, 0)
        ctx.lineTo(col * pixelSize, BOARD_ROWS * pixelSize)
        ctx.stroke()
      }
      for (let row = 0; row <= BOARD_ROWS; row++) {
        ctx.beginPath()
        ctx.moveTo(0, row * pixelSize)
        ctx.lineTo(BOARD_COLUMNS * pixelSize, row * pixelSize)
        ctx.stroke()
      }
    }

    // Glow pass for ACTIVE tile clusters — single batched path for performance
    {
      ctx.save()
      ctx.shadowColor = 'rgba(74, 222, 128, 0.9)'
      ctx.shadowBlur = pixelSize * 6
      ctx.fillStyle = 'rgba(74, 222, 128, 0.15)'
      ctx.beginPath()
      let hasActive = false
      for (const [tileIdStr, info] of Object.entries(tiles)) {
        if (info.status !== 'ACTIVE') continue
        hasActive = true
        const tid = Number(tileIdStr)
        const c = tid % BOARD_COLUMNS
        const r = Math.floor(tid / BOARD_COLUMNS)
        ctx.rect(c * pixelSize, r * pixelSize, tileW, tileH)
      }
      if (hasActive) ctx.fill()
      ctx.restore()
    }

    // Draw creative images grouped by creativeId
    // STRETCH: one image across bounding box; REPEAT: image per tile
    type Group = {
      imageUrl: string
      displayMode: 'REPEAT' | 'STRETCH'
      minCol: number; maxCol: number; minRow: number; maxRow: number
      tileCoords: { col: number; row: number }[]
    }
    const groups = new Map<string, Group>()
    for (const [tileIdStr, info] of Object.entries(tiles)) {
      if (info.status === 'ACTIVE' && info.imageUrl && info.creativeId) {
        const tileId = Number(tileIdStr)
        const { col, row } = tileIdToCoords(tileId)
        const mode = info.displayMode ?? 'REPEAT'
        const g = groups.get(info.creativeId)
        if (!g) {
          groups.set(info.creativeId, {
            imageUrl: info.imageUrl,
            displayMode: mode,
            minCol: col, maxCol: col, minRow: row, maxRow: row,
            tileCoords: [{ col, row }],
          })
        } else {
          if (col < g.minCol) g.minCol = col
          if (col > g.maxCol) g.maxCol = col
          if (row < g.minRow) g.minRow = row
          if (row > g.maxRow) g.maxRow = row
          g.tileCoords.push({ col, row })
        }
      }
    }

    for (const g of groups.values()) {
      const cached = imageCache.current.get(g.imageUrl)
      if (!(cached instanceof HTMLImageElement)) continue
      if (g.displayMode === 'STRETCH') {
        const x = g.minCol * pixelSize
        const y = g.minRow * pixelSize
        const w = (g.maxCol - g.minCol + 1) * pixelSize
        const h = (g.maxRow - g.minRow + 1) * pixelSize
        ctx.drawImage(cached, x, y, w, h)
      } else {
        const tw = pixelSize - gap
        const th = pixelSize - gap
        for (const { col, row } of g.tileCoords) {
          ctx.drawImage(cached, col * pixelSize, row * pixelSize, tw, th)
        }
      }
    }
  }, [tiles, selectedTiles, pixelSize])

  // Preload creative images whenever tiles change.
  // No crossOrigin — R2 public URLs load fine without it, and the Loupe only
  // uses drawImage (not getImageData/toDataURL), so CORS is not required.
  useEffect(() => {
    const needed = new Map<string, string>()
    for (const info of Object.values(tiles)) {
      if (info.status === 'ACTIVE' && info.imageUrl) {
        if (!imageCache.current.has(info.imageUrl)) {
          needed.set(info.imageUrl, info.imageUrl)
        }
      }
    }
    for (const [, url] of needed) {
      imageCache.current.set(url, 'loading')
      const img = new Image()
      img.onload = () => {
        imageCache.current.set(url, img)
        setImageVersion((v) => v + 1)
      }
      img.onerror = () => {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[billboard] image failed to load:', url)
        }
        imageCache.current.set(url, 'error')
        setImageVersion((v) => v + 1)
      }
      img.src = url
    }
  }, [tiles])

  // Dev debug: log image loading state whenever tiles or cache changes
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    const activeTiles = Object.values(tiles).filter((i) => i.status === 'ACTIVE')
    const activeTilesWithImageUrl = activeTiles.filter((i) => i.imageUrl)
    let loadedImagesCount = 0
    let failedImagesCount = 0
    for (const info of activeTilesWithImageUrl) {
      const cached = imageCache.current.get(info.imageUrl!)
      if (cached instanceof HTMLImageElement) loadedImagesCount++
      else if (cached === 'error') failedImagesCount++
    }
    console.log('[billboard]', {
      activeTilesCount: activeTiles.length,
      activeTilesWithImageUrlCount: activeTilesWithImageUrl.length,
      loadedImagesCount,
      failedImagesCount,
    })
  }, [tiles, imageVersion])

  useEffect(() => {
    render()
  }, [render, imageVersion])

  const renderOverlay = useCallback(
    (tileId: number | null) => {
      const canvas = overlayRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (tileId === null) return
      const { col, row } = tileIdToCoords(tileId)
      const gap = pixelSize > 2 ? 1 : 0
      ctx.fillStyle = HOVER_COLOR
      ctx.globalAlpha = 0.5
      ctx.fillRect(col * pixelSize, row * pixelSize, pixelSize - gap, pixelSize - gap)
      ctx.globalAlpha = 1
    },
    [pixelSize]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!interactive) return
      const tileId = getTileId(e)

      if (onCursorMove && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect()
        onCursorMove({
          tileId,
          canvasX: e.clientX - rect.left,
          canvasY: e.clientY - rect.top,
          viewportX: e.clientX,
          viewportY: e.clientY,
          canvas: canvasRef.current,
        })
      }

      // Update cursor: pointer for active tiles with a destUrl
      if (overlayRef.current) {
        const info = tileId !== null ? tiles[tileId] : undefined
        overlayRef.current.style.cursor =
          info?.destUrl ? 'pointer' : 'crosshair'
      }

      if (tileId === hoveredTile.current) return
      hoveredTile.current = tileId
      renderOverlay(tileId)

      if (tileId !== null) {
        const rect = canvasRef.current!.getBoundingClientRect()
        const { col, row } = tileIdToCoords(tileId)
        setTooltip({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          tileId,
          col,
          row,
          status: tiles[tileId]?.status ?? 'AVAILABLE',
        })
      } else {
        setTooltip(null)
      }
    },
    [interactive, getTileId, renderOverlay, tiles, onCursorMove]
  )

  const handleMouseLeave = useCallback(() => {
    hoveredTile.current = null
    renderOverlay(null)
    setTooltip(null)
    onCursorLeave?.()
  }, [renderOverlay, onCursorLeave])

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!interactive) return
      const tileId = getTileId(e)
      if (tileId !== null) onTileClick?.(tileId)
    },
    [interactive, getTileId, onTileClick]
  )

  const width = BOARD_COLUMNS * pixelSize
  const height = BOARD_ROWS * pixelSize

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ aspectRatio: `${BOARD_COLUMNS}/${BOARD_ROWS}` }}
    >
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
          onClick={handleClick}
        />
      )}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded bg-black/90 border border-white/10 px-2 py-1.5 text-xs text-white whitespace-nowrap"
          style={{ left: tooltip.x + 14, top: tooltip.y - 36 }}
        >
          <span className="text-white/40">#{tooltip.tileId}</span>
          <span className="text-white/30 mx-1">·</span>
          <span className="text-white/60">C{tooltip.col} R{tooltip.row}</span>
          <span className="text-white/30 mx-1">·</span>
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
