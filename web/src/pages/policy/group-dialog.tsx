import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlertIcon, GripVerticalIcon, PlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Alert, AlertTitle } from '@/components/reui/alert'
import { Badge } from '@/components/reui/badge'
import { Sortable, SortableItem, SortableItemHandle } from '@/components/reui/sortable'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
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
    interrupt: section?.interrupt_exist_connections === '1',
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
    mutationFn: (values: Record<string, string | string[]>) => saveOutbound(profile.config, editing, values, 'group'),
    onSuccess: (_result, values) => {
      toast.success(editing ? `已保存 ${values.tag}` : `已添加 ${values.tag}`)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onOpenChange(false)
    },
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
  const failure = mutation.error

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
  const defaults: Record<string, string> = { '': `第一个成员${values.outbounds.length ? `（${describe(profile, subscriptions, values.outbounds[0]).label}）` : ''}` }
  for (const ref of values.outbounds) defaults[ref] = describe(profile, subscriptions, ref).label
  for (const node of matched) defaults[node.tag] = node.tag

  const title = editing ? `策略组 » ${label(editing)}` : '策略组 » 新策略组'

  return (
    <Dialog open onOpenChange={onOpenChange}>
      {/* of one height whatever the type: the fields scroll between the title
          and the buttons */}
      <DialogContent className="h-[min(44rem,calc(100dvh-2rem))] grid-rows-1 overflow-hidden sm:max-w-xl">
        <form
          noValidate
          className="flex min-h-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{auto ? '自动选用延迟最低的成员。' : '在策略页或活动里手动选择用哪个成员。'}</DialogDescription>
          </DialogHeader>

          <FieldGroup className="-m-1 min-h-0 flex-1 overflow-y-auto p-1">
            <div className="grid grid-cols-2 gap-4">
              <form.Field name="name">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="group-name">名称</FieldLabel>
                    <Input
                      id="group-name"
                      autoFocus
                      value={field.state.value}
                      aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="type">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="group-type">类型</FieldLabel>
                    <Select items={GROUP_TYPES} value={field.state.value} onValueChange={(value) => field.handleChange(String(value))}>
                      <SelectTrigger id="group-type" className="w-full data-placeholder:text-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(GROUP_TYPES).map(([value, text]) => (
                          <SelectItem key={value} value={value}>
                            {text}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>
            </div>

            <form.Field name="outbounds">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field>
                    <FieldTitle>成员</FieldTitle>
                    <div className={cn('overflow-hidden rounded-lg border', invalid && 'border-destructive ring-3 ring-destructive/20')}>
                      <Sortable value={field.state.value} getItemValue={(ref) => ref} onValueChange={(refs) => field.handleChange(refs)}>
                        {field.state.value.map((ref) => {
                          const member = describe(profile, subscriptions, ref)
                          return (
                            <SortableItem key={ref} value={ref} className="flex h-9 items-center gap-2 border-b bg-background pr-1 pl-2">
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
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          disabled={!choices.length}
                          render={
                            <button
                              type="button"
                              className="flex h-9 w-full items-center gap-2 px-2 text-left text-muted-foreground outline-none hover:bg-muted/50 focus-visible:bg-muted/50 disabled:opacity-50"
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
                    </div>
                    <FieldDescription>拖动调整顺序。订阅作为一个整体加入，节点由它自己选择。</FieldDescription>
                  </Field>
                )
              }}
            </form.Field>

            <Field>
              <FieldTitle>包含订阅节点</FieldTitle>
              <form.Field name="include">
                {(field) => (
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {subscriptions
                      .filter((sub) => sub.enabled || field.state.value.includes(sub.name))
                      .map((sub) => (
                        <Field key={sub.name} orientation="horizontal" className="w-auto">
                          <Checkbox
                            id={`group-include-${sub.name}`}
                            checked={field.state.value.includes(sub.name)}
                            onCheckedChange={(checked) =>
                              field.handleChange(
                                checked ? subscriptions.filter((item) => item.name === sub.name || field.state.value.includes(item.name)).map((item) => item.name) : field.state.value.filter((item) => item !== sub.name),
                              )
                            }
                          />
                          <FieldLabel htmlFor={`group-include-${sub.name}`} className="font-normal">
                            {sub.tag}
                          </FieldLabel>
                        </Field>
                      ))}
                    {!subscriptions.length && <span className="text-muted-foreground">还没有订阅。</span>}
                  </div>
                )}
              </form.Field>
              <FieldLabel htmlFor="group-filter">节点筛选</FieldLabel>
              <form.Field name="filter">
                {(field) => (
                  <Input
                    id="group-filter"
                    value={field.state.value}
                    aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                )}
              </form.Field>
              <FieldDescription>
                {values.include.length && nodeFilter(values.filter)
                  ? `匹配 ${matched.length} 个节点${matched.length ? `：${matched.slice(0, 4).map((node) => node.name).join('、')}${matched.length > 4 ? ' 等' : ''}` : ''}。按名称匹配，不区分大小写，不含订阅前缀。`
                  : '勾选订阅后，按筛选把它的节点逐个加在成员之后。'}
              </FieldDescription>
            </Field>

            {!auto && (
              <form.Field name="default">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="group-default">默认出站</FieldLabel>
                    <Select items={defaults} value={field.state.value in defaults ? field.state.value : ''} onValueChange={(value) => field.handleChange(String(value ?? ''))}>
                      <SelectTrigger id="group-default" className="w-full data-placeholder:text-foreground">
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
                  </Field>
                )}
              </form.Field>
            )}

            {auto && (
              <>
                <form.Field name="url">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="group-url">测速地址</FieldLabel>
                      <Input
                        id="group-url"
                        className="font-mono"
                        value={field.state.value}
                        aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                      />
                    </Field>
                  )}
                </form.Field>
                <div className="grid grid-cols-3 gap-4">
                  {(
                    [
                      ['interval', '测速间隔', '分钟'],
                      ['idle', '闲置超时', '分钟'],
                      ['tolerance', '容差', '毫秒'],
                    ] as const
                  ).map(([name, text, unit]) => (
                    <form.Field key={name} name={name}>
                      {(field) => (
                        <Field>
                          <FieldLabel htmlFor={`group-${name}`}>{text}</FieldLabel>
                          <InputGroup>
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
              </>
            )}

            <form.Field name="interrupt">
              {(field) => (
                <Field orientation="horizontal">
                  <Checkbox id="group-interrupt" checked={field.state.value} onCheckedChange={(checked) => field.handleChange(!!checked)} />
                  <FieldContent>
                    <FieldLabel htmlFor="group-interrupt">中断现有连接</FieldLabel>
                    <FieldDescription>切换成员时断开经由旧成员的连接。</FieldDescription>
                  </FieldContent>
                </Field>
              )}
            </form.Field>

            {failure && (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>保存失败：{failure.message}</AlertTitle>
              </Alert>
            )}
          </FieldGroup>

          <DialogFooter>
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
