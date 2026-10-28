import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { GripVerticalIcon, PlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Badge } from '@/components/reui/badge'
import { Sortable, SortableItem, SortableItemHandle } from '@/components/reui/sortable'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { effectToast, untilApplied } from '@/lib/hako'
import { cn } from '@/lib/utils'
import {
  copyName,
  durationField,
  durationValue,
  findOutbound,
  findSubscription,
  groupContainers,
  isDuration,
  list,
  saveOutbound,
} from '@/lib/outbounds'
import { GROUP_TYPES, isGroup, label, shortName, type Profile, type Subscription } from '@/lib/policy'
import { Row, Section } from '@/pages/policy/dialog-layout'
import type { UciSection } from '@/lib/uci'

// a member as the dialog lists it: what it is, by the reference stored
function describe(profile: Profile, subscriptions: Subscription[], ref: string) {
  const section = findOutbound(profile, ref)
  if (section) return { label: label(section), kind: isGroup(section) ? '策略组' : section.type === 'direct' ? '直连' : '节点' }
  const sub = findSubscription(subscriptions, ref)
  if (sub) return { label: sub.tag, kind: '订阅' }
  if (subscriptions.some((item) => item.nodes.some((node) => node.tag === ref))) return { label: ref, kind: '订阅节点' }
  return { label: ref, kind: '已失效' }
}

// the regex of the node filter, any case; null for one that is no regex
function nodeFilter(value: string) {
  try {
    return new RegExp(value, 'i')
  } catch {
    return null
  }
}

// the nodes of the subscriptions included that the filter takes, by their
// names in the download
function includedNodes(subscriptions: Subscription[], include: string[], filter: string) {
  const pattern = nodeFilter(filter)
  if (!pattern) return []
  return include.flatMap((ref) => {
    const sub = findSubscription(subscriptions, ref)
    if (!sub?.enabled) return []
    return sub.nodes.filter((node) => node.type !== 'shadowtls' && pattern.test(node.name ?? shortName(sub, node.tag))).map((node) => ({ tag: node.tag, name: node.name ?? shortName(sub, node.tag) }))
  })
}

type Fields = {
  name: string
  type: string
  outbounds: string[]
  include: string[]
  filter: string
  default: string
  url: string
  interval: string
  idle: string
  tolerance: string
  interrupt: boolean
}

function fieldsOf(section: UciSection | null, name: string): Fields {
  const text = (key: string) => (typeof section?.[key] === 'string' ? (section[key] as string) : '')
  return {
    name,
    type: text('type') || 'selector',
    outbounds: list(section?.outbounds),
    include: list(section?.include),
    filter: text('filter'),
    default: text('default'),
    url: text('url'),
    interval: durationField(section?.interval, 'm'),
    idle: durationField(section?.idle_timeout, 'm'),
    tolerance: text('tolerance'),
    // on for a new group
    interrupt: section ? section.interrupt_exist_connections === '1' : true,
  }
}

// a group added, changed or copied: section is the one edited, or the one
// copied when copy is set, or null for a new one. The fields are checked on
// saving, and again as they change after that
export function GroupDialog({
  profile,
  subscriptions,
  section,
  copy = false,
  onOpenChange,
}: {
  profile: Profile
  subscriptions: Subscription[]
  section: UciSection | null
  copy?: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const editing = copy ? null : section
  const self = editing?.['.name'] ?? null
  const taken = profile.outbounds.filter((other) => other['.name'] !== self).map(label)

  const mutation = useMutation({
    mutationFn: (values: Record<string, string | string[]>) => untilApplied(() => saveOutbound(profile.config, editing, values, 'group')),
    onSuccess: ({ effect }, values) => {
      effectToast(editing ? `已保存 ${values.tag}` : `已添加 ${values.tag}`, effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onOpenChange(false)
    },
    onError: (error: Error) => toast.error(`保存失败：${error.message}`),
  })

  const schema = z
    .object({
      name: z
        .string()
        .trim()
        .min(1)
        .refine((value) => value !== 'GLOBAL' && !taken.includes(value)),
      type: z.string(),
      outbounds: z.array(z.string()),
      include: z.array(z.string()),
      filter: z.string().refine((value) => nodeFilter(value) != null),
      default: z.string(),
      url: z.string().trim().regex(/^(https?:\/\/\S+)?$/),
      interval: z.string().refine(isDuration),
      idle: z.string().refine(isDuration),
      tolerance: z.string().trim().regex(/^\d*$/),
      interrupt: z.boolean(),
    })
    // a group takes at least one member
    .refine((value) => value.outbounds.length || value.include.length, { path: ['outbounds'] })

  const form = useForm({
    defaultValues: fieldsOf(section, copy && section ? copyName(profile, label(section)) : section ? label(section) : ''),
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema },
    onSubmit: ({ value }) => {
      const auto = value.type === 'urltest'
      mutation.mutate({
        tag: value.name.trim(),
        type: value.type,
        outbounds: value.outbounds,
        include: value.include,
        filter: value.include.length ? value.filter.trim() : '',
        default: auto ? '' : value.default,
        url: auto ? value.url.trim() : '',
        interval: auto ? durationValue(value.interval, 'm') : '',
        idle_timeout: auto ? durationValue(value.idle, 'm') : '',
        tolerance: auto ? value.tolerance.trim() : '',
        interrupt_exist_connections: value.interrupt ? '1' : '',
      })
    },
  })

  const values = useStore(form.store, (state) => state.values)
  const auto = values.type === 'urltest'
  const matched = includedNodes(subscriptions, values.include, values.filter)

  // what can be added, by kind: the nodes, the subscriptions, the groups but
  // those containing this one, and the hidden nodes such as Direct
  const containers = groupContainers(profile, self)
  const listed = (section: UciSection) => values.outbounds.some((ref) => ref === section['.name'] || ref === label(section))
  const outbounds = profile.outbounds.filter((other) => other['.name'] !== self && !listed(other) && other.type !== 'shadowtls')
  const choices = [
    { title: '节点', items: outbounds.filter((other) => !isGroup(other) && other.hidden !== '1').map((other) => [other['.name'], label(other)]) },
    { title: '订阅', items: subscriptions.filter((sub) => sub.enabled && !values.outbounds.includes(sub.name)).map((sub) => [sub.name, sub.tag]) },
    { title: '策略组', items: outbounds.filter((other) => isGroup(other) && other.hidden !== '1' && !containers.has(other)).map((other) => [other['.name'], label(other)]) },
    { title: '其他', items: outbounds.filter((other) => !isGroup(other) && other.hidden === '1').map((other) => [other['.name'], label(other)]) },
  ].filter((group) => group.items.length)

  // the default outbound is one of the members: those listed, then the nodes
  // the filter takes
  const defaults: Record<string, string> = { '': '第一个成员' }
  for (const ref of values.outbounds) defaults[ref] = describe(profile, subscriptions, ref).label
  for (const node of matched) defaults[node.tag] = node.tag

  const title = editing ? '编辑策略组' : '新增策略组'

  return (
    <Dialog open onOpenChange={onOpenChange}>
      {/* as the node dialog: of one height whatever the type, the fields
          scroll between the title and the buttons */}
      <DialogContent className="flex h-[min(44rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]">
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
        >
          <DialogHeader className="border-b px-6 pt-5 pb-3.5">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">保存后立即生效。</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid items-start gap-6 sm:grid-cols-2">
              <div className="flex flex-col gap-5">
                <Section title="基本信息">
                  <form.Field name="name">
                    {(field) => (
                      <Row label="名称" htmlFor="group-name">
                        <div className="w-[56%] shrink-0">
                          <Input
                            id="group-name"
                            autoFocus
                            className="bg-background"
                            value={field.state.value}
                            aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                          />
                        </div>
                      </Row>
                    )}
                  </form.Field>
                  <form.Field name="type">
                    {(field) => (
                      <Row label="类型" htmlFor="group-type">
                        <Tabs value={field.state.value} onValueChange={(value) => field.handleChange(String(value))}>
                          <TabsList id="group-type" className="bg-input/70">
                            {Object.entries(GROUP_TYPES).map(([value, text]) => (
                              <TabsTrigger key={value} value={value} className="px-2.5">
                                {text}
                              </TabsTrigger>
                            ))}
                          </TabsList>
                        </Tabs>
                      </Row>
                    )}
                  </form.Field>
                </Section>

                {!auto && (
                  <Section title="出站">
                    <form.Field name="default">
                      {(field) => (
                        <Row label="出站标签" htmlFor="group-default">
                          <div className="w-[56%] shrink-0">
                            <Select items={defaults} value={field.state.value in defaults ? field.state.value : ''} onValueChange={(value) => field.handleChange(String(value ?? ''))}>
                              <SelectTrigger id="group-default" className="w-full bg-background data-placeholder:text-foreground">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(defaults).map(([value, text]) => (
                                  <SelectItem key={value} value={value}>
                                    {text}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </Row>
                      )}
                    </form.Field>
                  </Section>
                )}

                {auto && (
                  <Section title="测速">
                    <form.Field name="url">
                      {(field) => (
                        <Row label="测速地址" htmlFor="group-url">
                          <div className="w-2/3 shrink-0">
                            <Input
                              id="group-url"
                              className="bg-background font-mono"
                              value={field.state.value}
                              aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value)}
                            />
                          </div>
                        </Row>
                      )}
                    </form.Field>
                    {/* the three short ones side by side, each labelled above */}
                    <div className="grid grid-cols-3 gap-3 py-2.5">
                      {(
                        [
                          ['interval', '测速间隔', '分钟'],
                          ['idle', '闲置超时', '分钟'],
                          ['tolerance', '容差', '毫秒'],
                        ] as const
                      ).map(([name, text, unit]) => (
                        <form.Field key={name} name={name}>
                          {(field) => (
                            <Field className="gap-1.5">
                              <FieldLabel htmlFor={`group-${name}`} className="font-normal">
                                {text}
                              </FieldLabel>
                              <InputGroup className="bg-background">
                                <InputGroupInput
                                  id={`group-${name}`}
                                  value={field.state.value}
                                  aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                                  onBlur={field.handleBlur}
                                  onChange={(event) => field.handleChange(event.target.value)}
                                />
                                <InputGroupAddon align="inline-end">
                                  <InputGroupText>{unit}</InputGroupText>
                                </InputGroupAddon>
                              </InputGroup>
                            </Field>
                          )}
                        </form.Field>
                      ))}
                    </div>
                  </Section>
                )}

                <Section title="选项">
                  <form.Field name="interrupt">
                    {(field) => (
                      <Row label="中断现有连接" htmlFor="group-interrupt">
                        <Switch id="group-interrupt" checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked)} />
                      </Row>
                    )}
                  </form.Field>
                </Section>
              </div>

              <div className="flex flex-col gap-5">
                <form.Field name="outbounds">
                  {(field) => {
                    const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Section title="成员" invalid={invalid}>
                        {/* the members, if any, a row each, and a row to add one */}
                        {!!field.state.value.length && (
                        <Sortable value={field.state.value} getItemValue={(ref) => ref} onValueChange={(refs) => field.handleChange(refs)} className="divide-y">
                          {field.state.value.map((ref) => {
                            const member = describe(profile, subscriptions, ref)
                            return (
                              <SortableItem key={ref} value={ref} className="-mx-3.5 flex h-11 items-center gap-2 bg-muted pr-2 pl-2.5">
                                <SortableItemHandle className="flex text-muted-foreground" aria-label={`拖动 ${member.label}`}>
                                  <GripVerticalIcon className="size-4" />
                                </SortableItemHandle>
                                <span className="min-w-0 flex-1 truncate">{member.label}</span>
                                <Badge variant={member.kind === '已失效' ? 'destructive-light' : 'secondary'}>{member.kind}</Badge>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`移除 ${member.label}`}
                                  onClick={() => field.handleChange(field.state.value.filter((item) => item !== ref))}
                                >
                                  <XIcon />
                                </Button>
                              </SortableItem>
                            )
                          })}
                        </Sortable>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            disabled={!choices.length}
                            render={
                              <button
                                type="button"
                                className="-mx-3.5 flex h-11 w-[calc(100%+1.75rem)] items-center gap-2 px-3 text-left text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground disabled:opacity-50"
                              />
                            }
                          >
                            <PlusIcon className="size-4" />
                            添加成员…
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="max-h-80 w-64">
                            {choices.map((group) => (
                              <DropdownMenuGroup key={group.title}>
                                <DropdownMenuLabel>{group.title}</DropdownMenuLabel>
                                {group.items.map(([value, text]) => (
                                  <DropdownMenuItem key={value} onClick={() => field.handleChange([...field.state.value, value])}>
                                    {text}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuGroup>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </Section>
                    )
                  }}
                </form.Field>

                <Section title="包含订阅节点">
                  <form.Field name="include">
                    {(field) => (
                      <>
                        {subscriptions
                          .filter((sub) => sub.enabled || field.state.value.includes(sub.name))
                          .map((sub) => (
                            <Row key={sub.name} label={sub.tag} htmlFor={`group-include-${sub.name}`}>
                              <Switch
                                id={`group-include-${sub.name}`}
                                checked={field.state.value.includes(sub.name)}
                                onCheckedChange={(checked) =>
                                  field.handleChange(
                                    checked
                                      ? subscriptions.filter((item) => item.name === sub.name || field.state.value.includes(item.name)).map((item) => item.name)
                                      : field.state.value.filter((item) => item !== sub.name),
                                  )
                                }
                              />
                            </Row>
                          ))}
                        {!subscriptions.length && <p className="py-2.5 text-sm text-muted-foreground">还没有订阅。</p>}
                      </>
                    )}
                  </form.Field>
                  <form.Field name="filter">
                    {(field) => (
                      <Row label="节点筛选" htmlFor="group-filter">
                        <div className="w-[56%] shrink-0">
                          <Input
                            id="group-filter"
                            className="bg-background"
                            value={field.state.value}
                            aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                          />
                        </div>
                      </Row>
                    )}
                  </form.Field>
                </Section>
              </div>
            </div>
          </div>

          <DialogFooter className="border-t px-6 py-3.5">
            <DialogClose render={<Button type="button" variant="outline" />}>取消</DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Spinner />}
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
