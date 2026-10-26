import { Badge } from '@/components/reui/badge'
import { Spinner } from '@/components/ui/spinner'

// a delay as the design system shows it: fast under 300 ms, slow up to
// 1000 ms, a timeout as 0, a dash when never measured
export function LatencyBadge({ delay, testing }: { delay: number | null; testing?: boolean }) {
  if (testing)
    return (
      <Badge variant="secondary" size="sm">
        <Spinner className="size-3" />
        测试中
      </Badge>
    )

  if (delay == null)
    return (
      <Badge variant="outline" size="sm">
        -
      </Badge>
    )

  if (delay === 0)
    return (
      <Badge variant="destructive-light" size="sm">
        超时
      </Badge>
    )

  const variant = delay < 300 ? 'success-light' : delay <= 1000 ? 'warning-light' : 'destructive-light'
  return (
    <Badge variant={variant} size="sm" className="font-mono tabular-nums">
      {delay} ms
    </Badge>
  )
}
