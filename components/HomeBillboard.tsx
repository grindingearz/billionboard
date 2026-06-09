'use client'

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react'
import Billboard from './Billboard'
import Loupe from './Loupe'
import type { TileInfoMap, TileInfo } from '@/lib/types'
import { BOARD_COLUMNS, BOARD_ROWS } from '@/lib/types'
import { trackEvent } from '@/lib/analytics'

const ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6, 8] as const
type ZoomLevel = (typeof ZOOM_LEVELS)[number]

const PAD_TOP = 80
const PAD_BOTTOM = 140
const PAD_X = 80

// Returns the best zoom index for a campaign of given tile span, using actual
// viewport dimensions. Targets ~65% of available area. Clamped to 1× – 4×.
function computeTargetZoomIdx(
  spanCols: number,
  spanRows: number,
  containerW: number,
  containerH: number,
  fitW: number,
): number {
  if (containerW === 0 || containerH === 0 || fitW === 0) return 0
  const aspect = BOARD_COLUMNS / BOARD_ROWS
  const fitH = fitW / aspect
  const availW = Math.max(50, containerW - PAD_X)
  const availH = Math.max(50, containerH - PAD_TOP - PAD_BOTTOM)
  const safeCols = Math.max(1, spanCols)
  const safeRows = Math.max(1, spanRows)
  const zMaxW = (availW * BOARD_COLUMNS) / (safeCols * fitW)
  const zMaxH = (availH * BOARD_ROWS) / (safeRows * fitH)
  const zTarget = 0.65 * Math.min(zMaxW, zMaxH)
  const zClamped = Math.max(1, Math.min(zTarget, 4))
  return ZOOM_LEVELS.reduce(
    (best, z, idx) => (Math.abs(z - zClamped) < Math.abs(ZOOM_LEVELS[best] - zClamped) ? idx : best),
    0,
  )
}

interface AdGroup {
  key: string
  tileIds: number[]
  centroidCol: number
  centroidRow: number
  minCol: number
  maxCol: number
  minRow: number
  maxRow: number
  info: TileInfo
}

interface HomeBillboardProps {
  tiles: TileInfoMap
  tilePrice?: number
  focusCampaign?: string
}

function getDomain(url: string): string {
  try { return new URL(url).hostname } catch { return url.replace(/^https?:\/\//, '').split('/')[0] }
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
  const CARD_H = tileInfo.imageUrl ? 196 : 110
  const OFFSET = 24

  let left = viewportX + OFFSET
  let top = viewportY - CARD_H / 2

  if (containerRect) {
    if (left + CARD_W > containerRect.right - 8) left = viewportX - OFFSET - CARD_W
    if (top + CARD_H > containerRect.bottom - 8) top = containerRect.bottom - CARD_H - 8
    if (top < containerRect.top + 8) top = containerRect.top + 8
  }

  const domain = tileInfo.destUrl ? getDomain(tileInfo.destUrl) : null

  return (
    <div
      className="pointer-events-none fixed z-50 bg-black/96 border border-white/15 rounded-xl overflow-hidden shadow-2xl shadow-black/70"
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
        {domain && (
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            <span className="text-white font-semibold text-xs truncate" title={domain}>
              {domain}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-[10px] text-white/35 mb-2">
          <span>{tileCount} tile{tileCount !== 1 ? 's' : ''}</span>
          <span className="text-white/15">·</span>
          <span>{tileInfo.displayMode ?? 'REPEAT'}</span>
        </div>
        <div className="text-green-400/80 text-[11px] font-medium">Click to visit →</div>
      </div>
    </div>
  )
}

type PendingScroll = { col: number; row: number }

export default function HomeBillboard({ tiles, tilePrice = 1, focusCampaign }: HomeBillboardProps) {
  const [zoomIdx, setZoomIdx] = useState(0)
  const zoom: ZoomLevel = ZOOM_LEVELS[zoomIdx]
  const boardContainerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const initialScrollDone = useRef(false)
  const [pendingScroll, setPendingScroll] = useState<PendingScroll | null>(null)

  const aspect = BOARD_COLUMNS / BOARD_ROWS
  const fitW =
    containerSize.h > 0
      ? Math.min(containerSize.w, containerSize.h * aspect)
      : containerSize.w || 800
  const boardW = fitW * zoom
  const boardH = (fitW / aspect) * zoom

  // Precompute active ad groups
  const adGroups = useMemo<AdGroup[]>(() => {
    const groupMap = new Map<string, { tileIds: number[]; info: TileInfo; minCol: number; maxCol: number; minRow: number; maxRow: number }>()
    for (const [tileIdStr, info] of Object.entries(tiles)) {
      if (info.status !== 'ACTIVE') continue
      const tileId = Number(tileIdStr)
      const col = tileId % BOARD_COLUMNS
      const row = Math.floor(tileId / BOARD_COLUMNS)
      const key = info.creativeId ?? `solo-${tileId}`
      const g = groupMap.get(key)
      if (!g) {
        groupMap.set(key, { tileIds: [tileId], info, minCol: col, maxCol: col, minRow: row, maxRow: row })
      } else {
        g.tileIds.push(tileId)
        if (col < g.minCol) g.minCol = col
        if (col > g.maxCol) g.maxCol = col
        if (row < g.minRow) g.minRow = row
        if (row > g.maxRow) g.maxRow = row
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
        minCol: g.minCol,
        maxCol: g.maxCol,
        minRow: g.minRow,
        maxRow: g.maxRow,
        info: g.info,
      }
    })
  }, [tiles])

  const jumpableAdGroups = useMemo(
    () => adGroups.filter((g) => g.info.campaignType !== 'ADMIN_FREE'),
    [adGroups],
  )

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

  // Fire BOARD_VIEW once on mount
  useEffect(() => { trackEvent('BOARD_VIEW', '/') }, [])

  // Initial camera — only zooms to a campaign if focusCampaign is explicitly set.
  // Without it, defaults to fit-board (1×) centered — no auto-zoom to ads.
  useEffect(() => {
    if (initialScrollDone.current) return
    const el = boardContainerRef.current
    if (!el || containerSize.w === 0) return
    initialScrollDone.current = true

    const newFitW =
      containerSize.h > 0
        ? Math.min(containerSize.w, containerSize.h * (BOARD_COLUMNS / BOARD_ROWS))
        : containerSize.w || 800

    const targetGroup = focusCampaign ? adGroups.find((g) => g.key === focusCampaign) : null

    if (focusCampaign && targetGroup) {
      const spanCols = Math.max(1, targetGroup.maxCol - targetGroup.minCol + 1)
      const spanRows = Math.max(1, targetGroup.maxRow - targetGroup.minRow + 1)
      const centerCol = (targetGroup.minCol + targetGroup.maxCol) / 2
      const centerRow = (targetGroup.minRow + targetGroup.maxRow) / 2
      const zIdx = computeTargetZoomIdx(spanCols, spanRows, containerSize.w, containerSize.h, newFitW)
      setZoomIdx(zIdx)
      setPendingScroll({ col: centerCol, row: centerRow })
    } else {
      // Default: full-board overview at 1× (fit), centered
      const bW = newFitW * ZOOM_LEVELS[0]
      const bH = (newFitW / (BOARD_COLUMNS / BOARD_ROWS)) * ZOOM_LEVELS[0]
      el.scrollLeft = Math.max(0, (bW - containerSize.w) / 2)
      el.scrollTop = Math.max(0, (bH - containerSize.h) / 2)
    }
  }, [containerSize.w, containerSize.h, adGroups, focusCampaign])

  // Commit pending scroll after React has painted the new zoom level
  useLayoutEffect(() => {
    if (!pendingScroll) return
    const el = boardContainerRef.current
    if (!el || containerSize.w === 0) return
    const effectiveCenterY = PAD_TOP + Math.max(0, containerSize.h - PAD_TOP - PAD_BOTTOM) / 2
    el.scrollLeft = Math.max(0, ((pendingScroll.col + 0.5) / BOARD_COLUMNS) * boardW - containerSize.w / 2)
    el.scrollTop = Math.max(0, ((pendingScroll.row + 0.5) / BOARD_ROWS) * boardH - effectiveCenterY)
    setPendingScroll(null)
  }, [pendingScroll, boardW, boardH, containerSize.w, containerSize.h])

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

  const scrollToPosition = useCallback(
    (col: number, row: number, newZoomIdx: number) => {
      setZoomIdx(Math.min(newZoomIdx, ZOOM_LEVELS.length - 1))
      setPendingScroll({ col, row })
    },
    [],
  )

  const goToAd = useCallback(
    (idx: number) => {
      const g = jumpableAdGroups[idx]
      if (!g) return
      const centerCol = (g.minCol + g.maxCol) / 2
      const centerRow = (g.minRow + g.maxRow) / 2
      const spanCols = Math.max(1, g.maxCol - g.minCol + 1)
      const spanRows = Math.max(1, g.maxRow - g.minRow + 1)
      const newFitW =
        containerSize.h > 0
          ? Math.min(containerSize.w, containerSize.h * (BOARD_COLUMNS / BOARD_ROWS))
          : containerSize.w || 800
      scrollToPosition(centerCol, centerRow, computeTargetZoomIdx(spanCols, spanRows, containerSize.w, containerSize.h, newFitW))
      setCurrentAdIdx(idx)
    },
    [jumpableAdGroups, scrollToPosition, containerSize],
  )

  const jumpToAds = useCallback(() => {
    if (jumpableAdGroups.length === 0) return
    goToAd(0)
  }, [jumpableAdGroups.length, goToAd])

  const nextAd = useCallback(() => {
    if (jumpableAdGroups.length === 0) return
    goToAd((currentAdIdx + 1) % jumpableAdGroups.length)
  }, [currentAdIdx, jumpableAdGroups.length, goToAd])

  const prevAd = useCallback(() => {
    if (jumpableAdGroups.length === 0) return
    goToAd((currentAdIdx - 1 + jumpableAdGroups.length) % jumpableAdGroups.length)
  }, [currentAdIdx, jumpableAdGroups.length, goToAd])

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
      if (!info?.destUrl) return
      const url = info.creativeId
        ? `/api/click/${info.creativeId}?t=${tileId}`
        : info.destUrl
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    [tiles]
  )

  const hoveredTileId = loupeCursor?.tileId ?? null
  const hoverTileInfo = hoveredTileId !== null ? tiles[hoveredTileId] : undefined
  const showHoverCard =
    !loupeEnabled &&
    hoverTileInfo?.status === 'ACTIVE' &&
    !!hoverTileInfo?.destUrl &&
    loupeCursor !== null &&
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches

  const hoverTileCount = hoverTileInfo?.creativeId
    ? (creativeTileCount.get(hoverTileInfo.creativeId) ?? 1)
    : 1

  const loupeTileCount = (() => {
    if (hoveredTileId === null) return 1
    const cid = tiles[hoveredTileId]?.creativeId
    return cid ? (creativeTileCount.get(cid) ?? 1) : 1
  })()

  // Collapsible legend
  const [legendOpen, setLegendOpen] = useState(false)
  const legendRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!legendOpen) return
    const handler = (e: MouseEvent) => {
      if (legendRef.current && !legendRef.current.contains(e.target as Node)) {
        setLegendOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [legendOpen])

  return (
    <div className="relative w-full h-full bg-black">
      {/* Board scroll container */}
      <div ref={boardContainerRef} className="absolute inset-0 overflow-auto overscroll-contain">
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

      {/* Edge vignette — subtle depth around board viewport */}
      <div
        className="absolute inset-0 z-10 pointer-events-none"
        style={{ boxShadow: 'inset 0 0 80px 20px rgba(0,0,0,0.6)' }}
      />

      {/* Loupe */}
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

      {/* Hover card */}
      {showHoverCard && loupeCursor && (
        <ActiveAdCard
          tileInfo={hoverTileInfo!}
          tileCount={hoverTileCount}
          viewportX={loupeCursor.viewportX}
          viewportY={loupeCursor.viewportY}
          containerRect={boardContainerRef.current?.getBoundingClientRect() ?? null}
        />
      )}

      {/* Status legend — collapsible pill, top right */}
      <div ref={legendRef} className="absolute top-2 right-2 sm:top-3 sm:right-3 z-20">
        <button
          onClick={() => setLegendOpen((v) => !v)}
          className="min-h-10 flex items-center gap-1.5 bg-black/80 border border-white/15 rounded-full px-3 py-1.5 text-[11px] text-white/50 hover:text-white/80 hover:border-white/30 transition-colors"
          title="Tile status legend"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0">
            <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5 4.5v2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="5" cy="3" r="0.75" fill="currentColor" />
          </svg>
          <span className="hidden sm:inline">Status</span>
          <span
            style={{
              display: 'inline-block',
              transform: legendOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 150ms',
              lineHeight: 1,
            }}
          >
            ▾
          </span>
        </button>

        {legendOpen && (
          <div className="absolute top-full right-0 mt-1.5 bg-black/92 border border-white/10 rounded-xl px-3 py-3 min-w-[148px] shadow-xl shadow-black/70">
            <div className="space-y-2 mb-2.5">
              {[
                { swatch: 'bg-white/10 border border-white/20', label: 'Available' },
                { swatch: 'bg-amber-400/40 border border-amber-400/30', label: 'Pending' },
                { swatch: 'bg-green-400/50 border border-green-400/30', label: 'Active' },
              ].map(({ swatch, label }) => (
                <div key={label} className="flex items-center gap-2 text-xs">
                  <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${swatch}`} />
                  <span className="text-white/50">{label}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-white/10 pt-2 text-[10px] text-white/25 leading-snug">
              Zoom in to explore live ads.
            </div>
          </div>
        )}
      </div>

      {/* Controls — bottom left */}
      <div className="absolute bottom-2 left-2 right-2 z-20 flex flex-col gap-1.5 items-start sm:bottom-3 sm:left-3 sm:right-auto">
        {/* Ad navigation — only shown when jumpable ads exist, never auto-triggers */}
        {jumpableAdGroups.length > 0 && (
          <div className="max-w-full flex items-center gap-1 bg-black/80 border border-green-400/20 rounded-lg px-2 py-1.5 text-xs overflow-x-auto scrollbar-none">
            <button
              onClick={jumpToAds}
              className="min-h-8 shrink-0 text-green-400 hover:text-green-300 transition-colors font-medium px-1"
              title="Jump to first ad"
            >
              Jump to Ads
            </button>
            {jumpableAdGroups.length > 1 && (
              <>
                <span className="text-white/15 mx-1">·</span>
                <button
                  onClick={prevAd}
                  className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white transition-colors text-base leading-none"
                  title="Previous ad"
                >
                  ‹
                </button>
                <span className="text-white/40 text-[11px] tabular-nums w-8 text-center select-none">
                  {currentAdIdx + 1}/{jumpableAdGroups.length}
                </span>
                <button
                  onClick={nextAd}
                  className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white transition-colors text-base leading-none"
                  title="Next ad"
                >
                  ›
                </button>
              </>
            )}
          </div>
        )}

        {/* Zoom · Fit · Loupe */}
        <div className="max-w-full flex items-center bg-black/80 border border-white/10 rounded-lg text-xs overflow-hidden">
          <button
            onClick={zoomOut}
            disabled={zoomIdx === 0}
            className="w-10 h-10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-25 transition-colors font-bold text-base leading-none"
            title="Zoom out"
          >
            −
          </button>
          <span className="text-white/45 w-9 text-center tabular-nums text-[11px] select-none">
            {zoom}×
          </span>
          <button
            onClick={zoomIn}
            disabled={zoomIdx === ZOOM_LEVELS.length - 1}
            className="w-10 h-10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-25 transition-colors font-bold text-base leading-none"
            title="Zoom in"
          >
            +
          </button>
          <div className="w-px h-4 bg-white/10 mx-0.5" />
          <button
            onClick={fitBoard}
            className="px-3 h-10 text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors text-[11px]"
            title="Fit board to screen"
          >
            Fit
          </button>
          <div className="w-px h-4 bg-white/10 mx-0.5" />
          <button
            onClick={() => setLoupeEnabled((v) => !v)}
            className={`px-3 h-10 transition-colors text-[11px] ${
              loupeEnabled
                ? 'text-green-400 bg-green-400/10 hover:bg-green-400/15'
                : 'text-white/40 hover:text-white/70 hover:bg-white/5'
            }`}
            title="Toggle magnifier"
          >
            Loupe{loupeEnabled ? ' ✓' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
