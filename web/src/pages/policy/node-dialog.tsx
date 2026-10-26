import { revalidateLogic, useForm, useStore, type AnyFieldApi } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlertIcon, EyeIcon, EyeOffIcon, PlusIcon, XIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Alert, AlertTitle } from '@/components/reui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldContent, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  fieldTab,
  NODE_FIELDS,
  NODE_PROTOCOLS,
  nodeOptions,
  nodeSchema,
  nodeTabs,
  nodeValues,
  SECTIONS,
  TABS,
  tlsRequired,
  type NodeField,
  type NodeValues,
  type Tab,
} from '@/lib/node-fields'
import { copyName, saveOutbound } from '@/lib/outbounds'
import { isGroup, label, type Profile, type Subscription } from '@/lib/policy'
import { call } from '@/lib/ubus'
import type { UciSection } from '@/lib/uci'

// the width of a control in its row
const WIDTHS = { short: 'w-2/5', tiny: 'w-1/3', wide: 'w-2/3' }

// a value of none, which a segmented control has no item for
const NONE = '-'

// the network devices of the router, by the interface they carry
const devicesQuery = {
  queryKey: ['hako', 'devices'],
  queryFn: async () => {
    const result = await call<{ interface?: { interface: string; l3_device?: string; device?: string }[] }>('network.interface', 'dump')
    const devices = new Map<string, string>()
    for (const item of result.interface ?? []) {
      const device = item.l3_device ?? item.device
      if (device && device !== 'lo' && !devices.has(device)) devices.set(device, `${device}（${item.interface}）`)
    }
    return [...devices]
  },
}

// a row of a section: the label, with what it means under it, and the
// control on the right; an error shows as such, without a message
function Row({ id, def, children, align = 'center' }: { id?: string; def: NodeField; children: ReactNode; align?: 'center' | 'start' }) {
  return (
    <Field
      orientation="horizontal"
      className={cn('gap-4 py-2.5', align === 'center' ? 'items-center has-[>[data-slot=field-content]]:items-center' : 'items-start')}
    >
      <FieldContent className="min-w-0 gap-0.5">
        <FieldLabel htmlFor={id} className="font-normal">
          {def.label}
        </FieldLabel>
      </FieldContent>
      {children}
    </Field>
  )
}

function NodeInput({ field, def, invalid, choices }: { field: AnyFieldApi; def: NodeField; invalid: boolean; choices?: [string, string][] }) {
  const [reveal, setReveal] = useState(false)
  const value = field.state.value as string | string[]
  const id = `node-${def.key}`
  const text = typeof value === 'string' ? value : ''
  const width = def.width ? WIDTHS[def.width] : 'w-[56%]'

  if (def.kind === 'switch')
    return (
      <Row id={id} def={def}>
        <Switch id={id} checked={value === '1'} onCheckedChange={(checked) => field.handleChange(checked ? '1' : '')} />
      </Row>
    )

  if (def.kind === 'segmented')
    return (
      <Row id={id} def={def}>
        <Tabs value={text || NONE} onValueChange={(next) => field.handleChange(next === NONE ? '' : String(next))}>
          <TabsList id={id} className="bg-input/70">
            {(def.choices ?? []).map(([item, name]) => (
              <TabsTrigger key={item} value={item || NONE} className="px-2.5">
                {name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </Row>
    )

  if (def.kind === 'textarea' || def.kind === 'json')
    return (
      <Field className="gap-2 py-2.5">
        <FieldLabel htmlFor={id} className="font-normal">
          {def.label}
        </FieldLabel>
        <Textarea
          id={id}
          rows={4}
          className="bg-background font-mono text-[13px]"
          value={text}
          aria-invalid={invalid}
          onBlur={field.handleBlur}
          onChange={(event) => field.handleChange(event.target.value)}
        />
      </Field>
    )

  if (def.kind === 'list') {
    // one empty item to start with
    const items = Array.isArray(value) && value.length ? value : ['']
    return (
      <Row def={def} align="start">
        <div className="flex w-[56%] shrink-0 flex-col gap-1.5">
          {items.map((item, index) => (
            <div key={index} className="flex gap-1.5">
              <Input
                aria-label={def.label}
                className={cn('bg-background', def.mono && 'font-mono')}
                value={item}
                aria-invalid={invalid}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(items.map((other, i) => (i === index ? event.target.value : other)))}
              />
              <Button type="button" variant="ghost" size="icon" aria-label="移除" onClick={() => field.handleChange(items.filter((_, i) => i !== index))}>
                <XIcon />
              </Button>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => field.handleChange([...items, ''])}>
            <PlusIcon />
            添加
          </Button>
        </div>
      </Row>
    )
  }

  let control
  if (def.kind === 'select') {
    const items = Object.fromEntries(choices ?? def.choices ?? [])
    // a value saved that is no choice is kept and shown as it is
    if (text && !(text in items)) items[text] = text
    control = (
      <Select items={items} value={text} onValueChange={(next) => field.handleChange(String(next ?? ''))}>
        {/* an empty value is a choice too, shown as the others */}
        <SelectTrigger id={id} className="w-full bg-background data-placeholder:text-foreground" aria-invalid={invalid}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(items).map(([item, name]) => (
            <SelectItem key={item} value={item}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  } else if (def.unit || def.kind === 'password')
    control = (
      <InputGroup className="bg-background">
        <InputGroupInput
          id={id}
          type={def.kind === 'password' && !reveal ? 'password' : 'text'}
          className={cn(def.mono && 'font-mono')}
          value={text}
          aria-invalid={invalid}
          onBlur={field.handleBlur}
          onChange={(event) => field.handleChange(event.target.value)}
        />
        <InputGroupAddon align="inline-end">
          {def.unit && <InputGroupText>{def.unit}</InputGroupText>}
          {def.kind === 'password' && (
            <InputGroupButton size="icon-xs" aria-label={reveal ? '隐藏' : '显示'} onClick={() => setReveal(!reveal)}>
              {reveal ? <EyeOffIcon /> : <EyeIcon />}
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    )
  else
    control = (
      <Input
        id={id}
        className={cn('bg-background', def.mono && 'font-mono')}
        value={text}
        aria-invalid={invalid}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
      />
    )

  return (
    <Row id={id} def={def}>
      <div className={cn('shrink-0', width)}>{control}</div>
    </Row>
  )
}

// a node added, changed or copied: section is the one edited, or the one
// copied when copy is set, or null for a new one. The fields are those of its
// protocol, in sections on tabs, each tab in two columns; they are checked
// on saving, and again as they change after that
export function NodeDialog({
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
  const taken = profile.outbounds.filter((other) => other['.name'] !== editing?.['.name']).map(label)
  const [tab, setTab] = useState<Tab>('general')
  const { data: devices } = useQuery(devicesQuery)

  const mutation = useMutation({
    mutationFn: (options: Record<string, string | string[]>) => saveOutbound(profile.config, editing, options, 'node'),
    onSuccess: (_result, options) => {
      toast.success(editing ? `已保存 ${options.tag}` : `已添加 ${options.tag}`)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onOpenChange(false)
    },
  })

  // the errors of the fields shown, by key
  const errors = (value: NodeValues) => {
    const result = nodeSchema(value, taken).safeParse(value)
    if (result.success) return undefined
    const fields: Record<string, string> = {}
    for (const issue of result.error.issues) fields[String(issue.path[0])] ??= issue.message
    return fields
  }

  const initial = nodeValues(section)
  if (copy && section) initial.tag = copyName(profile, label(section))

  const form = useForm({
    defaultValues: initial,
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: ({ value }) => {
        const fields = errors(value)
        return fields ? { fields } : undefined
      },
    },
    onSubmit: ({ value }) => mutation.mutate(nodeOptions(value)),
    // the first field in error may be on another tab
    onSubmitInvalid: ({ value }) => {
      const fields = errors(value)
      const first = NODE_FIELDS.find((def) => fields && def.key in fields)
      if (first) setTab(fieldTab(first))
    },
  })

  const values = useStore(form.store, (state) => state.values)
  // once saved, the fields in error show as such, wherever they are: those
  // of other tabs mount without the errors of the form
  const submitted = useStore(form.store, (state) => state.submissionAttempts > 0)
  const invalid = submitted ? (errors(values) ?? {}) : {}
  const type = values.type as string
  const tabs = nodeTabs(type)
  const current = tabs.includes(tab) ? tab : 'general'

  // what the selects of the profile and the router offer
  const self = editing?.['.name']
  const choices: Record<string, [string, string][]> = {
    realm_http_client: [['', '默认 HTTP 客户端'], ...profile.sections.filter((s) => s['.type'] === 'http_client').map((s): [string, string] => [s['.name'], label(s)])],
    // another outbound by its tag, as sing-box takes it: not direct, nor a
    // group of a mode
    dial_detour: [
      ['', '不使用'],
      ...profile.outbounds
        .filter((other) => other['.name'] !== self && other.type !== 'direct' && !(isGroup(other) && other.hidden === '1'))
        .map((other): [string, string] => [label(other), label(other)]),
      ...subscriptions.filter((sub) => sub.enabled).map((sub): [string, string] => [sub.tag, `${sub.tag}（订阅）`]),
    ],
    dial_bind_interface: [['', '不指定'], ...(devices ?? [])],
  }

  const render = (def: NodeField) => {
    if (def.key === 'server_port') return null
    if (def.kind === 'server')
      return (
        <Row key={def.key} id="node-server" def={def}>
          <div className="flex w-2/3 shrink-0 items-center gap-2">
            <form.Field name="server">
              {(field) => (
                <Input
                  id="node-server"
                  className="bg-background font-mono"
                  value={field.state.value as string}
                  aria-invalid={'server' in invalid}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </form.Field>
            <span className="text-muted-foreground">:</span>
            <form.Field name="server_port">
              {(field) => (
                <Input
                  aria-label="端口"
                  className="w-20 shrink-0 bg-background font-mono"
                  value={field.state.value as string}
                  aria-invalid={'server_port' in invalid}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </form.Field>
          </div>
        </Row>
      )
    if (def.kind === 'streams')
      return (
        <Row key={def.key} id="node-multiplex_streams" def={def}>
          <div className="flex w-[56%] shrink-0 gap-2">
            <form.Field name="multiplex_streams_kind">
              {(field) => (
                <Select items={{ min: '最小', max: '最大' }} value={field.state.value as string} onValueChange={(next) => field.handleChange(String(next))}>
                  <SelectTrigger aria-label="按最小或最大流数" className="w-24 shrink-0 bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="min">最小</SelectItem>
                    <SelectItem value="max">最大</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </form.Field>
            <form.Field name="multiplex_streams">
              {(field) => (
                <Input
                  id="node-multiplex_streams"
                  className="bg-background"
                  value={field.state.value as string}
                  aria-invalid={'multiplex_streams' in invalid}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </form.Field>
          </div>
        </Row>
      )
    return (
      <form.Field key={def.key} name={def.key}>
        {(field) => <NodeInput field={field} def={def} invalid={def.key in invalid} choices={choices[def.key]} />}
      </form.Field>
    )
  }

  // the sections of the tab with something to show, by column
  const column = (side: 'left' | 'right') =>
    SECTIONS.filter((item) => item.tab === current && item.column === side).map((item) => {
      const rows = NODE_FIELDS.filter((def) => def.section === item.id && def.show(values)).map(render)
      // a protocol that always uses TLS shows it on
      const required = item.id === 'tls' && tlsRequired(type) && (
        <Field key="tls-required" orientation="horizontal" className="items-center gap-4 py-2.5 has-[>[data-slot=field-content]]:items-center">
          <FieldContent className="min-w-0 gap-0.5">
            <FieldLabel htmlFor="node-tls-required" className="font-normal">
              启用 TLS
            </FieldLabel>
          </FieldContent>
          <Switch id="node-tls-required" checked disabled />
        </Field>
      )
      if (!rows.length && !required) return null
      return (
        <section key={item.id} className="flex flex-col gap-2">
          <h3 className="px-0.5 text-[13px] font-semibold">{item.title || NODE_PROTOCOLS[type] || type}</h3>
          <div className="divide-y rounded-lg bg-muted px-3.5">
            {required}
            {rows}
          </div>
        </section>
      )
    })
  const failure = mutation.error

  return (
    <Dialog open onOpenChange={onOpenChange}>
      {/* of one height whatever the protocol and the tab: the fields scroll
          between the tabs and the buttons */}
      <DialogContent className="flex h-[min(38rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]">
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
        >
          <DialogHeader className="gap-3.5 border-b px-6 pt-5 pb-3.5">
            <DialogTitle>{editing ? `节点 » ${label(editing)}` : '节点 » 新节点'}</DialogTitle>
            <DialogDescription className="sr-only">保存后立即生效。</DialogDescription>
            <Tabs value={current} onValueChange={(next) => setTab(next as Tab)}>
              <TabsList>
                {tabs.map((item) => (
                  <TabsTrigger key={item} value={item}>
                    {TABS[item]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid items-start gap-6 sm:grid-cols-2">
              <div className="flex flex-col gap-5">{column('left')}</div>
              <div className="flex flex-col gap-5">{column('right')}</div>
            </div>
            {failure && (
              <Alert variant="destructive" className="mt-5">
                <CircleAlertIcon />
                <AlertTitle>保存失败：{failure.message}</AlertTitle>
              </Alert>
            )}
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
