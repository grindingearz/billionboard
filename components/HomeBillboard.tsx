'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Billboard from './Billboard'
import Loupe from './Loupe'
import type { TileInfoMap } from '@/lib/types'
import { BOARD_COLUMNS, BOARD_ROWS } from '@/lib/types'

const ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6, 8] as const
type ZoomLevel = (typeof ZOOM_LEVELS)[number]

interface HomeBillboardProps {
  tiles: TileInfoMap
  tilePrice?: number
}

export default function HomeBillboard({ tiles, tilePrice = 1 }: HomeBillboardProps) {
  const [zoomIdx, setZoomIdx] = useState(0)
  const zoom: ZoomLevel = ZOOM_LEVELS[zoomIdx]
  const boardContainerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const initialScrollDone = useRef(false)

  const aspect = BOARD_COLUMNS / BOARD_ROWS
  const fitW =
    containerSize.h > 0
      ? Math.min(containerSize.w, containerSize.h * aspect)
      : containerSize.w || 800
  const fitH = fitW / aspect
  const boardW = fitW * zoom
  const boardH = fitH * zoom

  useEffect(() => {
    const el = boardContainerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setContainerSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (initialScrollDone.current) return
    const el = boardContainerRef.current
    if (!el || containerSize.w === 0 || boardW === 0) return
    initialScrollDone.current = true
    el.scrollLeft = Math.max(0, (boardW - containerSize.w) / 2)
    el.scrollTop = Math.max(0, (boardH - containerSize.h) / 2)
  }, [containerSize.w, containerSize.h, boardW, boardH])

  const zoomIn = useCallback(() => setZoomIdx((i) => Math.min(i + 1, ZOOM_LEVELS.length - 1)), [])
  const zoomOut = useCallback(() => setZoomIdx((i) => Math.max(i - 1, 0)), [])

  useEffect(() => {
    const el = boardContainerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.deltaY < 0) zoomIn()
      else zoomOut()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomIn, zoomOut])

  const [loupeEnabled, setLoupeEnabled] = useState(false)
  const [loupeCursor, setLoupeCursor] = useState<{
    tileId: number | null
    canvasX: number
    canvasY: number
    viewportX: number
    viewportY: number
    canvas: HTMLCanvasElement | null
  } | null>(null)

  const handleCursorMove = useCallback(
    (info: {
      tileId: number | null
      canvasX: number
      canvasY: number
      viewportX: number
      viewportY: number
      canvas: HTMLCanvasElement
    }) => {
      if (!loupeEnabled) return
      setLoupeCursor({ ...info })
    },
    [loupeEnabled]
  )

  const handleCursorLeave = useCallback(() => setLoupeCursor(null), [])

  const handleTileClick = useCallback(
    (tileId: number) => {
      const info = tiles[tileId]
      if (info?.destUrl) {
        window.open(info.destUrl, '_blank', 'noopener,noreferrer')
      }
    },
    [tiles]
  )

  const handleFit = useCallback(() => {
    initialScrollDone.current = false
    setZoomIdx(0)
  }, [])

  return (
    <div className="relative w-full" style={{ height: 'clamp(320px, 60vh, 640px)' }}>
      <div ref={boardContainerRef} className="absolute inset-0 overflow-auto">
        <div
          className="flex items-center justify-center"
          style={{ minWidth: '100%', minHeight: '100%' }}
        >
          {boardW > 0 && (
            <div style={{ width: boardW, height: boardH, flexShrink: 0 }}>
              <Billboard
                tiles={tiles}
                pixelSize={4}
                interactive
                onTileClick={handleTileClick}
                onCursorMove={loupeEnabled ? handleCursorMove : undefined}
                onCursorLeave={loupeEnabled ? handleCursorLeave : undefined}
                className="w-full h-full"
              />
            </div>
          )}
        </div>
      </div>

      {loupeEnabled && loupeCursor && (
        <Loupe
          sourceCanvas={loupeCursor.canvas}
          canvasX={loupeCursor.canvasX}
          canvasY={loupeCursor.canvasY}
          tileId={loupeCursor.tileId}
          tiles={tiles}
          pixelSize={4}
          visible
          viewportX={loupeCursor.viewportX}
          viewportY={loupeCursor.viewportY}
          containerRect={boardContainerRef.current?.getBoundingClientRect() ?? null}
          tilePrice={tilePrice}
        />
      )}

      {/* Floating controls */}
      <div className="absolute bottom-3 left-3 z-20">
        <div className="flex items-center gap-1 bg-black/80 border border-white/10 rounded-lg px-2 py-1 text-xs">
          <button
            onClick={zoomOut}
            disabled={zoomIdx === 0}
            className="w-6 h-6 flex items-center justify-center text-white/70 hover:text-white disabled:opacity-30 transition-colors font-bold"
            title="Zoom out"
          >
            −
          </button>
          <span className="text-white/60 w-8 text-center tabular-nums">{zoom}×</span>
          <button
            onClick={zoomIn}
            disabled={zoomIdx === ZOOM_LEVELS.length - 1}
            className="w-6 h-6 flex items-center justify-center text-white/70 hover:text-white disabled:opacity-30 transition-colors font-bold"
            title="Zoom in"
          >
            +
          </button>
          <span className="text-white/20 mx-0.5">|</span>
          <button
            onClick={handleFit}
            className="text-white/50 hover:text-white transition-colors px-1"
            title="Fit to screen"
          >
            Fit
          </button>
          <span className="text-white/20 mx-0.5">|</span>
          <button
            onClick={() => setLoupeEnabled((v) => !v)}
            className={`px-1.5 py-0.5 rounded transition-colors ${
              loupeEnabled
                ? 'text-green-400 bg-green-400/10 hover:bg-green-400/20'
                : 'text-white/40 hover:text-white/70'
            }`}
            title="Toggle magnifier"
          >
            🔍 {loupeEnabled ? 'On' : 'Off'}
          </button>
        </div>
      </div>
    </div>
  )
}
