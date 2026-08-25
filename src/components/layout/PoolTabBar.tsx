import { useParams } from 'react-router-dom'
import { BottomTabBar } from '@/ui/components'

// The pool's persistent bottom navigation — mns-ui's BottomTabBar, which
// this app's hand-rolled bar was the Phase 0 source for. Three
// destinations, always visible, current one lit. Pages that pin their
// own bar (the picks save/submit bar) stack it directly above this one.
export function PoolTabBar() {
  const { id: poolId = '' } = useParams()
  return <BottomTabBar basePath={`/pool/${poolId}`} />
}
