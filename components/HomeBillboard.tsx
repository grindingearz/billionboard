'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Billboard from './Billboard'
import Loupe from './Loupe'
import type { TileInfoMap, TileInfo } from '@/lib/types'
import { BOARD_COLUMNS, BOARD_ROWS } from '@/lib/types'

const ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6, 8] as const
type ZoomLevel = (typeof ZOOM_LEVELS)[number]
const AD_ZOOM_IDX = 4 // 4× when centering on ads

interface AdGroup {
  key: string
  tileIds: number[]
  centroidCol: number
  centroidRow: number
  info: TileInfo
}

interface HomeBillboardProps {
  tiles: TileInfoMap
  tilePrice?: number
}

function ActiveAdCard({
  tileInfo,
  tileCount,
  viewportX,
  viewportY,
  containerRect,
}: {
  tileInfo: TileInfo
  tileCount: number
  viewportX: number
  viewportY: number
  containerRect: DOMRect | null
}) {
  const CARD_W = 220
  const CARD_H = tileInfo.imageUrl ? 196 : 96
  const OFFSET = 24

  let left = viewportX + OFFSET
  let top = viewportY - CARD_H / 2

  if (containerRect) {
    if (left + CARD_W > containerRect.right - 8) left = viewportX - OFFSET - CARD_W
    if (top + CARD_H > containerRect.bottom - 8) top = containerRect.bottom - CARD_H - 8
    if (top < containerRect.top + 8) top = containerRect.top + 8
  }

  return (
    <div
      className="pointer-events-none fixed z-50 bg-black/95 border border-green-400/30 rounded-xl overflow-hidden shadow-2xl shadow-black/60"
      style={{ left, top, width: CARD_W }}
    >
      {tileInfo.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tileInfo.imageUrl}
          alt={tileInfo.altText ?? 'Ad'}
          className="w-full h-28 object-cover block"
        />
      )}
      <div className="px-3 py-2.5">
        {tileInfo.destUrl && (
          <div
            className="text-green-400 text-xs font-medium truncate mb-1"
            title={tileInfo.destUrl}
          >
            {tileInfo.destUrl.replace(/^https?:\/\//, '')}
          </div>
        )}
        <div className="flex items-center gap-1.5 text-[10px] text-white/40 mb-1.5">
          <span>
            {tileCount} tile{tileCount !== 1 ? 's' : ''}
          </span>
          <span>·</span>
          <span>{tileInfo.displayMode ?? 'REPEAT'}</span>
        </div>
        <div className="text-green-400/70 text-[11px] font-medium">Click to visit →</div>
      </div>
    </div>
  )
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
  const boardW = fitW * zoom
  const boardH = (fitW / aspect) * zoom

  // Precompute active ad groups
  const adGroups = useMemo<AdGroup[]>(() => {
    const groupMap = new Map<string, { tileIds: number[]; info: TileInfo }>()
    for (const [tileIdStr, info] of Object.entries(tiles)) {
      if (info.status !== 'ACTIVE') continue
      const tileId = Number(tileIdStr)
      const key = info.creativeId ?? `solo-${tileId}`
      const g = groupMap.get(key)
      if (!g) {
        groupMap.set(key, { tileIds: [tileId], info })
      } else {
        g.tileIds.push(tileId)
      }
    }
    return Array.from(groupMap.entries()).map(([key, g]) => {
      const sumCol = g.tileIds.reduce((s, id) => s + (id % BOARD_COLUMNS), 0)
      const sumRow = g.tileIds.reduce((s, id) => s + Math.floor(id / BOARD_COLUMNS), 0)
      return {
        key,
        tileIds: g.tileIds,
        centroidCol: sumCol / g.tileIds.length,
        centroidRow: sumRow / g.tileIds.length,
        info: g.info,
      }
    })
  }, [tiles])

  // creativeId → tile count (for hover card + loupe)
  const creativeTileCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of adGroups) m.set(g.key, g.tileIds.length)
    return m
  }, [adGroups])

  const [currentAdIdx, setCurrentAdIdx] = useState(0)

  // Resize observer
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

  // Smart initial camera: center on active ad cluster if any, otherwise fit
  useEffect(() => {
    if (initialScrollDone.current) return
    const el = boardContainerRef.current
    if (!el || containerSize.w === 0) return
    initialScrollDone.current = true

    const newFitW =
      containerSize.h > 0
        ? Math.min(containerSize.w, containerSize.h * aspect)
        : containerSize.w || 800

    if (adGroups.length > 0) {
      const allIds = adGroups.flatMap((g) => g.tileIds)
      const avgCol = allIds.reduce((s, id) => s + (id % BOARD_COLUMNS), 0) / allIds.length
      const avgRow =
        allIds.reduce((s, id) => s + Math.floor(id / BOARD_COLUMNS), 0) / allIds.length
      const newBoardW = newFitW * ZOOM_LEVELS[AD_ZOOM_IDX]
      const newBoardH = (newFitW / aspect) * ZOOM_LEVELS[AD_ZOOM_IDX]
      setZoomIdx(AD_ZOOM_IDX)
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(
          0,
          ((avgCol + 0.5) / BOARD_COLUMNS) * newBoardW - containerSize.w / 2
        )
        el.scrollTop = Math.max(
          0,
          ((avgRow + 0.5) / BOARD_ROWS) * newBoardH - containerSize.h / 2
        )
      })
    } else {
      const bW = newFitW * ZOOM_LEVELS[0]
      const bH = (newFitW / aspect) * ZOOM_LEVELS[0]
      el.scrollLeft = Math.max(0, (bW - containerSize.w) / 2)
      el.scrollTop = Math.max(0, (bH - containerSize.h) / 2)
    }
  }, [containerSize.w, containerSize.h, adGroups, aspect])

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

  // Scroll to a fractional col/row at a given zoom index
  const scrollToPosition = useCallback(
    (col: number, row: number, targetZoomIdx: number) => {
      const el = boardContainerRef.current
      if (!el || containerSize.w === 0) return
      const newZoomIdx = Math.min(targetZoomIdx, ZOOM_LEVELS.length - 1)
      const newZoom = ZOOM_LEVELS[newZoomIdx]
      const newFitW =
        containerSize.h > 0
          ? Math.min(containerSize.w, containerSize.h * aspect)
          : containerSize.w || 800
      const newBoardW = newFitW * newZoom
      const newBoardH = (newFitW / aspect) * newZoom
      setZoomIdx(newZoomIdx)
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(
          0,
          ((col + 0.5) / BOARD_COLUMNS) * newBoardW - containerSize.w / 2
        )
        el.scrollTop = Math.max(
          0,
          ((row + 0.5) / BOARD_ROWS) * newBoardH - containerSize.h / 2
        )
      })
    },
    [containerSize, aspect]
  )

  // Ad navigation
  const jumpToAds = useCallback(() => {
    if (adGroups.length === 0) return
    const allIds = adGroups.flatMap((g) => g.tileIds)
    const avgCol = allIds.reduce((s, id) => s + (id % BOARD_COLUMNS), 0) / allIds.length
    const avgRow =
      allIds.reduce((s, id) => s + Math.floor(id / BOARD_COLUMNS), 0) / allIds.length
    scrollToPosition(avgCol, avgRow, AD_ZOOM_IDX)
    setCurrentAdIdx(0)
  }, [adGroups, scrollToPosition])

  const goToAd = useCallback(
    (idx: number) => {
      const g = adGroups[idx]
      if (!g) return
      scrollToPosition(g.centroidCol, g.centroidRow, Math.max(zoomIdx, AD_ZOOM_IDX))
      setCurrentAdIdx(idx)
    },
    [adGroups, scrollToPosition, zoomIdx]
  )

  const nextAd = useCallback(() => {
    if (adGroups.length === 0) return
    goToAd((currentAdIdx + 1) % adGroups.length)
  }, [currentAdIdx, adGroups.length, goToAd])

  const prevAd = useCallback(() => {
    if (adGroups.length === 0) return
    goToAd((currentAdIdx - 1 + adGroups.length) % adGroups.length)
  }, [currentAdIdx, adGroups.length, goToAd])

  const fitBoard = useCallback(() => {
    setZoomIdx(0)
    requestAnimationFrame(() => {
      const el = boardContainerRef.current
      if (!el || containerSize.w === 0) return
      const newFitW =
        containerSize.h > 0
          ? Math.min(containerSize.w, containerSize.h * aspect)
          : containerSize.w || 800
      const bW = newFitW * ZOOM_LEVELS[0]
      const bH = (newFitW / aspect) * ZOOM_LEVELS[0]
      el.scrollLeft = Math.max(0, (bW - containerSize.w) / 2)
      el.scrollTop = Math.max(0, (bH - containerSize.h) / 2)
    })
  }, [containerSize, aspect])

  // Loupe + hover card cursor tracking (always active)
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
      setLoupeCursor({ ...info })
    },
    []
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

  // Hover card for active ads (shown when loupe is off)
  const hoveredTileId = loupeCursor?.tileId ?? null
  const hoverTileInfo = hoveredTileId !== null ? tiles[hoveredTileId] : undefined
  const showHoverCard =
    !loupeEnabled &&
    hoverTileInfo?.status === 'ACTIVE' &&
    !!hoverTileInfo?.destUrl &&
    loupeCursor !== null

  const hoverTileCount = hoverTileInfo?.creativeId
    ? (creativeTileCount.get(hoverTileInfo.creativeId) ?? 1)
    : 1

  const loupeTileCount = (() => {
    if (hoveredTileId === null) return 1
    const cid = tiles[hoveredTileId]?.creativeId
    return cid ? (creativeTileCount.get(cid) ?? 1) : 1
  })()

  return (
    <div className="relative w-full h-full">
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
                onCursorMove={handleCursorMove}
                onCursorLeave={handleCursorLeave}
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
          tileCount={loupeTileCount}
        />
      )}

      {showHoverCard && loupeCursor && (
        <ActiveAdCard
          tileInfo={hoverTileInfo!}
          tileCount={hoverTileCount}
          viewportX={loupeCursor.viewportX}
          viewportY={loupeCursor.viewportY}
          containerRect={boardContainerRef.current?.getBoundingClientRect() ?? null}
        />
      )}

      {/* Legend */}
      <div className="absolute top-3 right-3 z-20 flex flex-col gap-1.5 bg-black/70 border border-white/10 rounded-lg px-3 py-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-white/10 border border-white/20 shrink-0" />
          <span className="text-white/40">Available</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-400/40 border border-amber-400/30 shrink-0" />
          <span className="text-white/40">Pending</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-green-400/50 border border-green-400/30 shrink-0" />
          <span className="text-white/40">Active</span>
        </div>
        {adGroups.length === 0 && (
          <div className="mt-0.5 text-white/25 text-[10px] leading-tight max-w-[120px]">
            No ads yet — be the first!
          </div>
        )}
      </div>

      {/* Floating controls */}
      <div className="absolute bottom-3 left-3 z-20 flex flex-col gap-1 items-start">
        {/* Ad navigation row (only when active ads exist) */}
        {adGroups.length > 0 && (
          <div className="flex items-center gap-1 bg-black/80 border border-green-400/20 rounded-lg px-2 py-1 text-xs">
            <button
              onClick={jumpToAds}
              className="text-green-400 hover:text-green-300 transition-colors font-medium px-1"
              title="Center on active ads"
            >
              Jump to Ads
            </button>
            {adGroups.length > 1 && (
              <>
                <span className="text-white/20 mx-0.5">·</span>
                <button
                  onClick={prevAd}
                  className="w-5 h-5 flex items-center justify-center text-white/60 hover:text-white transition-colors text-base leading-none"
                  title="Previous ad"
                >
                  ‹
                </button>
                <span className="text-white/50 text-[11px] tabular-nums w-7 text-center">
                  {currentAdIdx + 1}/{adGroups.length}
                </span>
                <button
                  onClick={nextAd}
                  className="w-5 h-5 flex items-center justify-center text-white/60 hover:text-white transition-colors text-base leading-none"
                  title="Next ad"
                >
                  ›
                </button>
              </>
            )}
          </div>
        )}

        {/* Zoom + Fit + Loupe row */}
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
            onClick={fitBoard}
            className="text-white/50 hover:text-white transition-colors px-1"
            title="Fit board to screen"
          >
            Fit Board
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
