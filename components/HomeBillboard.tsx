'use client'

import { useState } from 'react'
import Billboard from './Billboard'
import TilePanel from './TilePanel'
import type { TileStatusMap } from '@/lib/types'

export default function HomeBillboard({ tiles }: { tiles: TileStatusMap }) {
  const [selectedTile, setSelectedTile] = useState<number | null>(null)

  return (
    <>
      <Billboard
        tiles={tiles}
        pixelSize={2}
        interactive={true}
        onTileClick={setSelectedTile}
        className="bg-black"
      />
      <TilePanel
        tileId={selectedTile}
        onClose={() => setSelectedTile(null)}
      />
    </>
  )
}
