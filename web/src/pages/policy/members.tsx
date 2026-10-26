import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu'
import { LatencyBadge } from '@/pages/policy/latency-badge'
import { usePolicyRuntime } from '@/pages/policy/runtime'

// the members of a running group, with their delays; a manual group is
// switched here, an auto group picks by itself. name shortens a member
export function Members({ tag, name = (member) => member }: { tag: string; name?: (member: string) => string }) {
  const { runtime, group: groupOf, delay, testing, select } = usePolicyRuntime()
  const group = groupOf(tag)

  if (!group) {
    const stopped = runtime && !runtime.available && runtime.reason === 'not_running'
    return <p className="px-2 py-1.5 text-sm text-muted-foreground">{stopped ? '服务未运行，没有成员可选。' : '应用后才有成员可选。'}</p>
  }

  const auto = group.type !== 'selector'
  const busy = testing(tag)

  return (
    <DropdownMenuRadioGroup value={group.now} onValueChange={(value: string) => select(tag, value)}>
      {group.all.map((member) => (
        <DropdownMenuRadioItem key={member} value={member} disabled={auto} closeOnClick>
          <span className="flex-1 truncate">{name(member)}</span>
          <LatencyBadge delay={delay(member)} testing={busy} />
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}
