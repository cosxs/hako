import { PlusIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'

// a section of the page: its title, an action on the right, and its tiles
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(210px,100%),1fr))] gap-3">{children}</div>
    </section>
  )
}

export function SectionAction({ children, busy, disabled, onClick }: { children: ReactNode; busy?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" disabled={disabled || busy} onClick={onClick}>
      {busy && <Spinner />}
      {children}
    </Button>
  )
}

// a node, group or subscription as a tile: what it is, its name, and a
// last line; clicking it opens its menu, on its right
export function Tile({ caption, name, foot, children }: { caption: ReactNode; name: string; foot: ReactNode; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex min-h-26 w-full min-w-0 flex-col gap-0.5 rounded-xl border bg-card px-3.5 py-3 text-left shadow-xs transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:border-primary data-popup-open:bg-accent"
          />
        }
      >
        <span className="truncate text-xs text-muted-foreground">{caption}</span>
        <span className="truncate text-[15px] font-semibold">{name}</span>
        <span className="mt-auto flex min-w-0 items-center gap-1.5 text-sm">{foot}</span>
      </DropdownMenuTrigger>
      {/* beside the tile, as tall as the window lets it be: a long list of
          members scrolls in it */}
      <DropdownMenuContent side="right" align="start" className="w-72">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// the tile that adds one; without onClick adding is not in the app yet
export function AddTile({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      aria-label={label}
      title={onClick ? label : `${label}：暂时请在 LuCI 中操作`}
      className="flex min-h-26 items-center justify-center rounded-xl border border-dashed text-muted-foreground transition-colors outline-none hover:border-ring hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60"
    >
      <PlusIcon className="size-5" />
    </button>
  )
}

// a delay as plain text in the colors of the ReUI badges
export function LatencyText({ delay, testing }: { delay: number | null; testing?: boolean }) {
  if (testing)
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Spinner className="size-3.5" />
        测试中
      </span>
    )
  if (delay == null) return <span className="text-muted-foreground">点击测试</span>
  if (delay === 0) return <span className="font-medium text-destructive-foreground dark:text-destructive">超时</span>

  const tone =
    delay < 300
      ? 'text-success-foreground dark:text-success'
      : delay <= 1000
        ? 'text-warning-foreground dark:text-warning'
        : 'text-destructive-foreground dark:text-destructive'
  return <span className={`font-mono font-medium tabular-nums ${tone}`}>{delay} ms</span>
}
