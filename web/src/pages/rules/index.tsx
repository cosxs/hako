import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MinusIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { useEffect, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

import { Sortable, SortableItem, SortableItemHandle } from '@/components/reui/sortable'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { effectToast, untilApplied } from '@/lib/hako'
import { profileQuery, subscriptionsQuery, type Profile, type Subscription } from '@/lib/policy'
import { outboundChoice, outboundText, reorderRules, ruleKind, ruleText, setRuleEnabled, routeRules, type RuleKind } from '@/lib/rules'
import type { UciSection } from '@/lib/uci'
import { cn } from '@/lib/utils'
import { LogicalDialog } from '@/pages/rules/logical-dialog'
import { RuleDialog } from '@/pages/rules/rule-dialog'
import { RuleSetList } from '@/pages/rules/rule-sets'
import { RouteSettings } from '@/pages/rules/route-settings'
import { DeleteRuleDialog } from '@/pages/rules/small-dialogs'

type Opened = { kind: RuleKind; section: UciSection | null }

type Tab = 'rules' | 'sets' | 'route'

// the rules of the profile in use, as Surge lists them: matched from the
// top. A rule is selected by a click and opened by a double click, and
// dragged to another place. The rule sets they name, and the rest of the
// route with the default outbound, are apart, as sing-box has them
export function RulesPage() {
  const queryClient = useQueryClient()
  const profileResult = useQuery(profileQuery)
  const subscriptionsResult = useQuery(subscriptionsQuery)
  const profile = profileResult.data
  const subscriptions = subscriptionsResult.data ?? []
  const error = (profileResult.error ?? subscriptionsResult.error)?.message

  const [tab, setTab] = useState<Tab>('rules')
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [opened, setOpened] = useState<Opened | null>(null)
  const [deleting, setDeleting] = useState<UciSection | null>(null)
  // the order dragged to, until the profile read again has it
  const [moved, setMoved] = useState<string[] | null>(null)

  // once for each failure, not again at each refetch failing as well
  useEffect(() => {
    if (error) toast.error(`读取配置失败：${error}`, { id: 'rules-error' })
  }, [error])

  const reorder = useMutation({
    mutationFn: (names: string[]) => untilApplied(() => reorderRules(profile!, names)),
    onSuccess: async ({ effect }) => {
      effectToast('已调整规则顺序', effect)
      await queryClient.invalidateQueries({ queryKey: ['hako'] })
      setMoved(null)
    },
    onError: (failure: Error) => {
      toast.error(`无法调整顺序：${failure.message}`)
      setMoved(null)
    },
  })

  const toggle = useMutation({
    mutationFn: ({ section, enabled }: { section: UciSection; enabled: boolean }) => untilApplied(() => setRuleEnabled(profile!, section, enabled)),
    onSuccess: ({ effect }, { enabled }) => {
      effectToast(enabled ? '已启用规则' : '已停用规则', effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
    },
    onError: (failure: Error) => toast.error(`保存失败：${failure.message}`),
  })

  const rules = profile ? routeRules(profile) : []
  const byName = new Map(rules.map((section) => [section['.name'], section]))
  const ordered = moved ? moved.map((name) => byName.get(name)).filter((section): section is UciSection => !!section) : rules

  const query = search.trim().toLowerCase()
  const describe = (section: UciSection) => {
    const text = ruleText(profile!, section)
    const outbound = outboundChoice(profile!, subscriptions, section)
    return { ...text, outbound, outboundText: outboundText(profile!, subscriptions, outbound) }
  }
  const matches = (section: UciSection) => {
    if (!query) return true
    const text = describe(section)
    return [text.type, text.value, text.outboundText, String(section.comment ?? '')].some((part) => part.toLowerCase().includes(query))
  }
  const shown = profile ? ordered.filter(matches) : []

  const selectedRule = selected ? (byName.get(selected) ?? null) : null
  // while a new order or a rule switched on or off is applied, the table
  // waits: what it shows is not yet what the router has
  const busy = reorder.isPending || toggle.isPending
  const open = (section: UciSection) => setOpened({ kind: ruleKind(section), section })

  // a rule takes Enter and Space to be moved with the arrow keys, as a
  // sortable item does
  const keyDown = (event: KeyboardEvent, section: UciSection) => {
    if (busy) return
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      setDeleting(section)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)}>
          <TabsList>
            <TabsTrigger value="rules">规则</TabsTrigger>
            <TabsTrigger value="sets">规则集</TabsTrigger>
            <TabsTrigger value="route">设置</TabsTrigger>
          </TabsList>
        </Tabs>
        <InputGroup className={cn('w-64 max-w-full', tab === 'route' && 'invisible')}>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label={tab === 'rules' ? '搜索规则' : '搜索规则集'}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </InputGroup>
      </div>

      {tab === 'route' ? (
        profile && <RouteSettings profile={profile} subscriptions={subscriptions} />
      ) : tab === 'sets' ? (
        <RuleSetList profile={profile} search={search} />
      ) : (
        <div className="flex flex-col overflow-hidden rounded-xl border shadow-xs">
          {/* drags rows of the table; what it adds for screen readers goes
            beside the table, not in it */}
          <Sortable
            aria-busy={busy}
            className={cn('transition-opacity', busy && 'pointer-events-none opacity-60')}
            value={ordered.map((section) => section['.name'])}
            getItemValue={(name) => name}
            onValueChange={(names) => {
              setMoved(names)
              reorder.mutate(names)
            }}
          >
            <Table className="min-w-[760px] table-fixed select-none">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-11 pl-4">
                    <span className="sr-only">启用</span>
                  </TableHead>
                  <TableHead className="w-44">类型</TableHead>
                  <TableHead>值</TableHead>
                  <TableHead className="w-40">出站</TableHead>
                  <TableHead className="w-40 pr-4">注释</TableHead>
                </TableRow>
              </TableHeader>

              {!profile ? (
                <TableBody>
                  {Array.from({ length: 6 }, (_, index) => (
                    <TableRow key={index} className="hover:bg-transparent">
                      <TableCell colSpan={5} className="px-4">
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              ) : (
                <TableBody>
                  {shown.map((section) => {
                    const text = describe(section)
                    const enabled = section.enabled !== '0'
                    const name = section['.name']
                    return (
                      <SortableItem
                        key={name}
                        value={name}
                        disabled={!!query || busy}
                        // the whole row drags, as in Surge: a click selects it and a
                        // double click opens it, a drag of some pixels moves it
                        render={<SortableItemHandle render={<TableRow />} cursor={false} />}
                        data-state={selected === name ? 'selected' : undefined}
                        tabIndex={0}
                        className={cn('cursor-default bg-background data-disabled:opacity-100', !enabled && 'text-muted-foreground')}
                        onClick={() => setSelected(name)}
                        onDoubleClick={() => open(section)}
                        onKeyDown={(event: KeyboardEvent) => keyDown(event, section)}
                      >
                        <TableCell className="pl-4">
                          <Checkbox
                            checked={enabled}
                            aria-label={`启用规则 ${text.type} ${text.value}`}
                            disabled={busy}
                            onClick={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                            onCheckedChange={(checked) => toggle.mutate({ section, enabled: !!checked })}
                          />
                        </TableCell>
                        <TableCell className="truncate font-mono text-[13px]">{text.type}</TableCell>
                        <TableCell className="truncate font-mono text-[13px]" title={text.value}>
                          {text.value}
                        </TableCell>
                        <TableCell className="truncate">{text.outboundText}</TableCell>
                        <TableCell className="truncate pr-4 text-muted-foreground">{String(section.comment ?? '')}</TableCell>
                      </SortableItem>
                    )
                  })}
                </TableBody>
              )}
            </Table>
          </Sortable>

          <div className="flex items-center gap-1 border-t bg-muted/50 px-3 py-2">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="添加规则" disabled={!profile || busy} />}>
                <PlusIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-40">
                <DropdownMenuItem onClick={() => setOpened({ kind: 'standard', section: null })}>普通规则</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setOpened({ kind: 'logical', section: null })}>逻辑规则</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="icon-sm" aria-label="删除选中的规则" disabled={!selectedRule || busy} onClick={() => setDeleting(selectedRule)}>
              <MinusIcon />
            </Button>
          </div>
        </div>
      )}

      {profile && <Dialogs profile={profile} subscriptions={subscriptions} opened={opened} onClose={() => setOpened(null)} />}
      {profile && (
        <DeleteRuleDialog
          profile={profile}
          subscriptions={subscriptions}
          section={deleting}
          onOpenChange={(isOpen) => {
            if (isOpen) return
            if (deleting && selected === deleting['.name']) setSelected(null)
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}

function Dialogs({ profile, subscriptions, opened, onClose }: { profile: Profile; subscriptions: Subscription[]; opened: Opened | null; onClose: () => void }) {
  if (!opened) return null
  const onOpenChange = (isOpen: boolean) => !isOpen && onClose()
  const props = { profile, subscriptions, section: opened.section, onOpenChange }
  if (opened.kind === 'logical') return <LogicalDialog {...props} />
  return <RuleDialog {...props} />
}
