import { revalidateLogic, useForm, useStore, type AnyFieldApi } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRightIcon, CircleAlertIcon, EyeIcon, EyeOffIcon, PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Alert, AlertTitle } from '@/components/reui/alert'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { NODE_FIELDS, NODE_PROTOCOLS, nodeOptions, nodeSchema, nodeTabs, nodeValues, TABS, tlsRequired, type NodeField, type NodeValues, type Tab } from '@/lib/node-fields'
import { copyName, saveOutbound } from '@/lib/outbounds'
import { label, type Profile } from '@/lib/policy'
import type { UciSection } from '@/lib/uci'

const SPANS = { 2: 'sm:col-span-2', 3: 'sm:col-span-3', 4: 'sm:col-span-4', 6: '' }

// a field of the dialog by its kind; an error shows as such, without a
// message
function NodeInput({ field, def, invalid, choices }: { field: AnyFieldApi; def: NodeField; invalid: boolean; choices?: [string, string][] }) {
  const [reveal, setReveal] = useState(false)
  const value = field.state.value as string | string[]
  const id = `node-${def.key}`
  const text = typeof value === 'string' ? value : ''

  if (def.kind === 'switch')
    return (
      <Field orientation="horizontal" className="justify-between">
        <FieldContent>
          <FieldLabel htmlFor={id}>{def.label}</FieldLabel>
          {def.description && <FieldDescription>{def.description}</FieldDescription>}
        </FieldContent>
        <Switch id={id} checked={value === '1'} onCheckedChange={(checked) => field.handleChange(checked ? '1' : '')} />
      </Field>
    )

  let control
  if (def.kind === 'select') {
    const items = Object.fromEntries(choices ?? def.choices ?? [])
    control = (
      <Select items={items} value={text} onValueChange={(next) => field.handleChange(String(next ?? ''))}>
        <SelectTrigger id={id} className="w-full" aria-invalid={invalid}>
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
  } else if (def.kind === 'list') {
    // one empty item to start with
    const items = Array.isArray(value) && value.length ? value : ['']
    control = (
      <div className="flex flex-col gap-2">
        {items.map((item, index) => (
          <div key={index} className="flex gap-2">
            <Input
              aria-label={def.label}
              className={cn(def.mono && 'font-mono')}
              placeholder={def.placeholder}
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
    )
  } else if (def.kind === 'textarea' || def.kind === 'json')
    control = (
      <Textarea
        id={id}
        rows={def.kind === 'json' ? 6 : 4}
        className="font-mono text-[13px]"
        placeholder={def.placeholder}
        value={text}
        aria-invalid={invalid}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
      />
    )
  else if (def.unit || def.kind === 'password')
    control = (
      <InputGroup>
        <InputGroupInput
          id={id}
          type={def.kind === 'password' && !reveal ? 'password' : 'text'}
          className={cn(def.mono && 'font-mono')}
          placeholder={def.placeholder}
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
        className={cn(def.mono && 'font-mono')}
        placeholder={def.placeholder}
        value={text}
        aria-invalid={invalid}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
      />
    )

  return (
    <Field>
      <FieldLabel htmlFor={def.kind === 'list' ? undefined : id}>{def.label}</FieldLabel>
      {control}
      {def.description && <FieldDescription>{def.description}</FieldDescription>}
    </Field>
  )
}

// a node added, changed or copied: section is the one edited, or the one
// copied when copy is set, or null for a new one. The fields are those of its
// protocol, by tab, the rare ones under More options; they are checked on
// saving, and again as they change after that
export function NodeDialog({
  profile,
  section,
  copy = false,
  onOpenChange,
}: {
  profile: Profile
  section: UciSection | null
  copy?: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const editing = copy ? null : section
  const taken = profile.outbounds.filter((other) => other['.name'] !== editing?.['.name']).map(label)
  const [tab, setTab] = useState<Tab>('general')
  const [more, setMore] = useState(false)

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
    // the first field in error may be on another tab, or under More options
    onSubmitInvalid: ({ value }) => {
      const fields = errors(value)
      const first = NODE_FIELDS.find((def) => fields && def.key in fields)
      if (!first) return
      setTab(first.tab)
      setMore(!!first.more)
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
  const shown = NODE_FIELDS.filter((def) => def.tab === current && def.show(values))
  const httpClients: [string, string][] = [['', '默认 HTTP 客户端'], ...profile.sections.filter((s) => s['.type'] === 'http_client').map((s): [string, string] => [s['.name'], label(s)])]

  const render = (def: NodeField) => (
    <form.Field key={def.key} name={def.key}>
      {(field) => (
        <div className={cn('col-span-6', SPANS[def.span ?? 6])}>
          <NodeInput
            field={field}
            def={def}
            invalid={def.key in invalid}
            choices={def.key === 'realm_http_client' ? httpClients : undefined}
          />
        </div>
      )}
    </form.Field>
  )
  const failure = mutation.error

  return (
    <Dialog open onOpenChange={onOpenChange}>
      {/* of one height whatever the tab: the fields scroll between the tabs
          and the buttons */}
      <DialogContent className="h-[min(44rem,calc(100dvh-2rem))] grid-rows-1 overflow-hidden sm:max-w-2xl">
        <form
          noValidate
          className="flex min-h-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? `节点 » ${label(editing)}` : '节点 » 新节点'}</DialogTitle>
            <DialogDescription>保存后立即生效。</DialogDescription>
          </DialogHeader>

          <Tabs
            value={current}
            onValueChange={(next) => {
              setTab(next as Tab)
              setMore(false)
            }}
          >
            <TabsList>
              {tabs.map((item) => (
                <TabsTrigger key={item} value={item}>
                  {TABS[item]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="-m-1 grid min-h-0 flex-1 auto-rows-min grid-cols-6 gap-x-4 gap-y-5 overflow-y-auto p-1">
            {current === 'tls' && tlsRequired(type) && (
              <Field orientation="horizontal" className="col-span-6 justify-between">
                <FieldContent>
                  <FieldLabel htmlFor="node-tls-required">启用 TLS</FieldLabel>
                  <FieldDescription>{NODE_PROTOCOLS[type]} 总是使用 TLS。</FieldDescription>
                </FieldContent>
                <Switch id="node-tls-required" checked disabled />
              </Field>
            )}
            {shown.filter((def) => !def.more).map(render)}
            {shown.some((def) => def.more) && (
              <Collapsible open={more} onOpenChange={setMore} className="col-span-6 flex flex-col gap-5">
                <CollapsibleTrigger render={<Button type="button" variant="ghost" size="sm" className="-ml-2.5 self-start" />}>
                  <ChevronRightIcon className={cn('transition-transform', more && 'rotate-90')} />
                  更多选项
                </CollapsibleTrigger>
                <CollapsibleContent className="grid grid-cols-6 gap-x-4 gap-y-5">{shown.filter((def) => def.more).map(render)}</CollapsibleContent>
              </Collapsible>
            )}
          </div>

          {failure && (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>保存失败：{failure.message}</AlertTitle>
            </Alert>
          )}

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
