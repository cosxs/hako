import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { statusQuery } from '@/lib/hako'
import { GROUP_TYPES, isGroup, label, NODE_TYPES, shortName, updateSubscription, type Profile, type Subscription } from '@/lib/policy'
import type { UciSection } from '@/lib/uci'
import { Members } from '@/pages/policy/members'
import { usePolicyRuntime } from '@/pages/policy/runtime'
import { DeleteSubscriptionDialog, SubscriptionDialog } from '@/pages/policy/subscription-dialog'
import { AddTile, LatencyText, Section, SectionAction, Tile } from '@/pages/policy/tile'

// editing, copying and deleting move to the app in the next steps
function EditItems({ edit, remove, copy = true }: { edit: string; remove: string; copy?: boolean }) {
  return (
    <>
      <DropdownMenuItem disabled>{edit}</DropdownMenuItem>
      {copy && <DropdownMenuItem disabled>创建副本</DropdownMenuItem>}
      <DropdownMenuItem disabled>{remove}</DropdownMenuItem>
    </>
  )
}

function TestItem({ tag }: { tag: string | null }) {
  const { group, testing, test } = usePolicyRuntime()
  const busy = tag ? testing(tag) : false
  return (
    <DropdownMenuItem disabled={!tag || !group(tag) || busy} closeOnClick={false} onClick={() => tag && test(tag)}>
      {busy ? '测试中…' : '测试延迟'}
    </DropdownMenuItem>
  )
}

// the tag of the group the Global mode uses, which holds every node:
// testing it tests them all
function globalTag(profile: Profile | undefined) {
  const section = profile?.outbounds.find((item) => item['.name'] === profile.globalGroup)
  return section ? label(section) : null
}

export function NodesSection({ profile }: { profile: Profile | undefined }) {
  const { group, delay, testing, test } = usePolicyRuntime()
  const nodes = useMemo(() => profile?.outbounds.filter((section) => !isGroup(section) && section.hidden !== '1') ?? [], [profile])
  const all = globalTag(profile)
  const busy = all ? testing(all) : false

  return (
    <Section
      title="节点"
      action={
        <SectionAction busy={busy} disabled={!all || !group(all)} onClick={() => all && test(all)}>
          测试全部
        </SectionAction>
      }
    >
      {nodes.map((node) => (
        <Tile
          key={node['.name']}
          caption={NODE_TYPES[node.type as string] ?? String(node.type)}
          name={label(node)}
          foot={<LatencyText delay={delay(label(node))} testing={busy} />}
        >
          <EditItems edit="编辑节点…" remove="删除节点…" />
          <DropdownMenuSeparator />
          <TestItem tag={all} />
        </Tile>
      ))}
      <AddTile label="添加节点" />
    </Section>
  )
}

// the current outbound of a running group, shortened
function Now({ tag, name = (member) => member }: { tag: string; name?: (member: string) => string }) {
  const { runtime, group } = usePolicyRuntime()
  const now = group(tag)?.now
  if (now) return <span className="truncate text-muted-foreground">{name(now)}</span>
  const stopped = runtime && !runtime.available && runtime.reason === 'not_running'
  return <span className="text-muted-foreground">{stopped ? '未运行' : '-'}</span>
}

// the groups of the profile; the one of the Global mode comes first, in that
// mode only: the mode sing-box runs with, else the one chosen
export function GroupsSection({ profile }: { profile: Profile | undefined }) {
  const { data: status } = useQuery(statusQuery)
  const { group, test, testing } = usePolicyRuntime()
  const mode = (status?.running && status.clash_api?.mode) || profile?.mode || ''

  const groups = useMemo(() => {
    if (!profile) return [] as UciSection[]
    const global = mode.toLowerCase() === 'global' ? profile.globalGroup : null
    const shown = profile.outbounds.filter((section) => isGroup(section) && (section.hidden !== '1' || section['.name'] === global))
    return [...shown.filter((section) => section['.name'] === global), ...shown.filter((section) => section['.name'] !== global)]
  }, [profile, mode])

  const running = groups.map(label).filter((tag) => group(tag))

  return (
    <Section
      title="策略组"
      action={
        <SectionAction busy={running.some(testing)} disabled={!running.length} onClick={() => running.forEach(test)}>
          测试全部
        </SectionAction>
      }
    >
      {groups.map((section) => {
        const tag = label(section)
        return (
          <Tile key={section['.name']} caption={GROUP_TYPES[section.type as string]} name={tag} foot={<Now tag={tag} />}>
            <EditItems edit="编辑策略组…" remove="删除策略组…" />
            <DropdownMenuSeparator />
            <TestItem tag={tag} />
            <DropdownMenuSeparator />
            <Members tag={tag} />
          </Tile>
        )
      })}
      <AddTile label="添加策略组" />
    </Section>
  )
}

function subscriptionCaption(sub: Subscription) {
  if (!sub.enabled) return '已停用'
  if (sub.last_error) return <span className="text-destructive-foreground dark:text-destructive">更新失败</span>
  const type = GROUP_TYPES[sub.type] ?? GROUP_TYPES.selector
  return sub.downloaded ? `${type} · ${sub.nodes.length} 个节点` : `${type} · 未下载`
}

export function SubscriptionsSection({ profile, subscriptions }: { profile: Profile | undefined; subscriptions: Subscription[] | undefined }) {
  const queryClient = useQueryClient()
  const [updatingAll, setUpdatingAll] = useState(false)
  // the dialog: null to add one; key opens it anew each time
  const [dialog, setDialog] = useState<{ sub: Subscription | null; key: number } | null>(null)
  const [deleting, setDeleting] = useState<Subscription | null>(null)
  const openDialog = (sub: Subscription | null) => setDialog({ sub, key: Date.now() })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['hako'] })
  const update = useMutation({
    mutationFn: (sub: Subscription) => updateSubscription(sub.name),
    onSuccess: (result, sub) => toast.success(result.changed ? (result.reloaded ? `${sub.tag} 已更新，sing-box 已重载` : `${sub.tag} 已更新`) : `${sub.tag} 已是最新`),
    onError: (error: Error, sub) => toast.error(`${sub.tag}：${error.message}`),
    onSettled: refresh,
  })

  // one after another: the router runs one update at a time
  const updateAll = async () => {
    setUpdatingAll(true)
    for (const sub of (subscriptions ?? []).filter((item) => item.enabled))
      await update.mutateAsync(sub).catch(() => {})
    setUpdatingAll(false)
  }

  return (
    <Section
      title="订阅"
      action={
        <SectionAction busy={updatingAll} disabled={!subscriptions?.some((sub) => sub.enabled) || update.isPending} onClick={updateAll}>
          全部更新
        </SectionAction>
      }
    >
      {(subscriptions ?? []).map((sub) => {
        const name = (member: string) => shortName(sub, member)
        return (
          <Tile key={sub.name} caption={subscriptionCaption(sub)} name={sub.tag} foot={<Now tag={sub.tag} name={name} />}>
            <DropdownMenuItem onClick={() => openDialog(sub)}>编辑订阅…</DropdownMenuItem>
            <DropdownMenuItem disabled={!sub.enabled || update.isPending} onClick={() => update.mutate(sub)}>
              立即更新
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => setDeleting(sub)}>
              删除订阅…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <TestItem tag={sub.tag} />
            <DropdownMenuSeparator />
            <Members tag={sub.tag} name={name} />
          </Tile>
        )
      })}
      <AddTile label="添加订阅" onClick={() => openDialog(null)} />
      {dialog && (
        <SubscriptionDialog
          key={dialog.key}
          open
          sub={dialog.sub}
          subscriptions={subscriptions ?? []}
          outboundTags={profile?.outbounds.map(label) ?? []}
          onOpenChange={(open) => !open && setDialog(null)}
        />
      )}
      <DeleteSubscriptionDialog sub={deleting} onOpenChange={(open) => !open && setDeleting(null)} />
    </Section>
  )
}
