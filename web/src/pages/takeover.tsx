import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusIcon, XIcon } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { effectToast, untilApplied } from '@/lib/hako'
import { profileQuery, type Profile } from '@/lib/policy'
import {
  deviceQuery,
  items,
  proxyPort,
  ruleSetChoices,
  saveTakeover,
  takeoverValues,
  validCidr,
  validCidr4,
  validCidr6,
  validPort,
  type Device,
  type TakeoverMode,
  type TakeoverValues,
} from '@/lib/takeover'
import { cn } from '@/lib/utils'
import { SaveButton, TextInput } from '@/pages/core/fields'
import { FieldRow, FieldSection, SwitchRow } from '@/pages/rules/form'

const MODES: Record<TakeoverMode, string> = { tun: 'TUN', tproxy: 'TProxy' }

function invalid(meta: { isTouched: boolean; isValid: boolean }) {
  return meta.isTouched && !meta.isValid
}

// the proxy port is checked where there is one
const schema = (hasMixed: boolean) =>
  z
    .object({
      mode: z.enum(['tun', 'tproxy']),
      ipv6: z.boolean(),
      tunName: z.string(),
      tunAddress: z.array(z.string()),
      tunMtu: z.string(),
      tunBypassSets: z.array(z.string()),
      tproxyPort: z.string(),
      mixed: z.boolean(),
      lan: z.array(z.string()),
      bypass4: z.array(z.string()),
      bypass6: z.array(z.string()),
      mixedPort: z.string(),
      username: z.string(),
      password: z.string(),
    })
    .superRefine((value, context) => {
      const fail = (path: string) => context.addIssue({ code: 'custom', path: [path], message: '' })
      if (value.mode === 'tun') {
        const name = value.tunName.trim()
        if (!name || name.length > 15 || /[\s/]/.test(name)) fail('tunName')
        if (!items(value.tunAddress).length || !value.tunAddress.every(validCidr)) fail('tunAddress')
        if (value.tunMtu.trim() && !(/^\d+$/.test(value.tunMtu.trim()) && Number(value.tunMtu) >= 1280 && Number(value.tunMtu) <= 65535)) fail('tunMtu')
      } else {
        if (!validPort(value.tproxyPort)) fail('tproxyPort')
        if (!value.lan.length) fail('lan')
      }
      if (!value.bypass4.every(validCidr4)) fail('bypass4')
      if (!value.bypass6.every(validCidr6)) fail('bypass6')
      if (hasMixed && value.mixed && !validPort(value.mixedPort)) fail('mixedPort')
      if (hasMixed && value.mixed && value.username.trim() && !value.password) fail('password')
    })

// the takeover of the LAN and the router while sing-box runs, by TUN or
// TProxy, and the proxy port for devices set up by hand. FakeIP is a DNS
// server of the profile, set under Core settings › DNS
export function TakeoverPage() {
  const profileResult = useQuery(profileQuery)
  const deviceResult = useQuery(deviceQuery)
  const error = profileResult.error?.message ?? deviceResult.error?.message

  useEffect(() => {
    if (error) toast.error(`读取配置失败：${error}`, { id: 'takeover-error' })
  }, [error])

  const profile = profileResult.data
  const device = deviceResult.data
  if (!profile || !device)
    return (
      <div className="flex w-full max-w-[1120px] flex-col gap-6">
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )

  // a form of the settings read, again once they are saved
  const values = takeoverValues(device)
  return <TakeoverForm key={JSON.stringify(values)} profile={profile} device={device} values={values} />
}

// a list edited an item a row, each removed on its own; an item of the wrong
// form shows as such
function ListRow({
  id,
  label,
  value,
  touched,
  check,
  onChange,
}: {
  id: string
  label: string
  value: string[]
  touched: boolean
  check: (item: string) => boolean
  onChange: (value: string[]) => void
}) {
  // one empty item to start with
  const list = value.length ? value : ['']
  return (
    <Field orientation="horizontal" className="items-start gap-4 py-2.5">
      <FieldContent className="min-w-0 gap-0.5 pt-2">
        <FieldLabel htmlFor={`${id}-0`} className="font-normal">
          {label}
        </FieldLabel>
      </FieldContent>
      <div className="flex w-2/3 shrink-0 flex-col gap-1.5">
        {list.map((item, index) => (
          <div key={index} className="flex gap-1.5">
            <Input
              id={`${id}-${index}`}
              aria-label={label}
              className="bg-background font-mono text-[13px]"
              value={item}
              aria-invalid={touched && !check(item)}
              onChange={(event) => onChange(list.map((other, i) => (i === index ? event.target.value : other)))}
            />
            <Button type="button" variant="ghost" size="icon" aria-label="移除" onClick={() => onChange(list.filter((_, i) => i !== index))}>
              <XIcon />
            </Button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => onChange([...list, ''])}>
          <PlusIcon />
          添加
        </Button>
      </div>
    </Field>
  )
}

// several of the items chosen; none chosen shows as such
function MultiSelect({
  id,
  items,
  value,
  invalid,
  onChange,
}: {
  id: string
  items: Record<string, string>
  value: string[]
  invalid?: boolean
  onChange: (value: string[]) => void
}) {
  const all = { ...items, ...Object.fromEntries(value.filter((item) => !(item in items)).map((item) => [item, item])) }
  return (
    <Select multiple items={all} value={value} onValueChange={(next) => onChange(next as string[])}>
      <SelectTrigger id={id} aria-invalid={invalid} className="w-full bg-background font-mono text-[13px]">
        <SelectValue className={cn('min-w-0 truncate', !value.length && 'text-muted-foreground')}>
          {(chosen: string[]) => (chosen.length ? chosen.map((item) => all[item] ?? item).join(', ') : '无')}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {Object.entries(all).map(([item, text]) => (
          <SelectItem key={item} value={item} className="font-mono text-[13px]">
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function TakeoverForm({ profile, device, values }: { profile: Profile; device: Device; values: TakeoverValues }) {
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: (next: TakeoverValues) => untilApplied(() => saveTakeover(device, next)),
    onSuccess: ({ effect }) => {
      effectToast('已保存接管设置', effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
    },
    onError: (error: Error) => toast.error(`保存失败：${error.message}`),
  })

  const form = useForm({
    defaultValues: values,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema(!!proxyPort(device)) },
    onSubmit: ({ value }) => save.mutate(value),
  })

  const mode = useStore(form.store, (state) => state.values.mode)
  const mixed = useStore(form.store, (state) => state.values.mixed)
  const username = useStore(form.store, (state) => state.values.username)
  // once saved, the items in error show as such
  const submitted = useStore(form.store, (state) => state.submissionAttempts > 0)
  const hasMixed = !!proxyPort(device)

  type Name = keyof TakeoverValues
  type ListName = 'tunAddress' | 'bypass4' | 'bypass6'
  const text = (name: Name, title: string, mono = true) => (
    <form.Field name={name}>
      {(field) => (
        <FieldRow label={title} htmlFor={`takeover-${name}`} wide>
          <TextInput
            id={`takeover-${name}`}
            mono={mono}
            value={field.state.value as string}
            invalid={invalid(field.state.meta)}
            onChange={(next) => field.handleChange(next as never)}
          />
        </FieldRow>
      )}
    </form.Field>
  )
  const list = (name: ListName, title: string, check: (item: string) => boolean) => (
    <form.Field name={name}>
      {(field) => (
        <ListRow
          id={`takeover-${name}`}
          label={title}
          value={field.state.value}
          touched={submitted || field.state.meta.isTouched}
          check={check}
          onChange={field.handleChange}
        />
      )}
    </form.Field>
  )

  return (
    <form
      noValidate
      className="flex w-full max-w-[1120px] flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        form.handleSubmit()
      }}
    >
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="flex flex-col gap-6">
          <FieldSection title="接管设置">
            <form.Field name="mode">
              {(field) => (
                <Field orientation="horizontal" className="items-center gap-4 py-2.5 has-[>[data-slot=field-content]]:items-center">
                  <FieldContent className="min-w-0 gap-0.5">
                    <FieldLabel htmlFor="takeover-mode" className="font-normal">
                      方式
                    </FieldLabel>
                  </FieldContent>
                  <Tabs value={field.state.value} onValueChange={(next) => field.handleChange(next as TakeoverMode)}>
                    <TabsList id="takeover-mode" className="bg-input/70">
                      {Object.entries(MODES).map(([value, name]) => (
                        <TabsTrigger key={value} value={value} className="px-2.5">
                          {name}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </Field>
              )}
            </form.Field>
          </FieldSection>

          <FieldSection title="绕过的地址">
            {list('bypass4', 'IPv4', validCidr4)}
            {list('bypass6', 'IPv6', validCidr6)}
          </FieldSection>
        </div>

        <div className="flex flex-col gap-6">
          {mode === 'tun' ? (
            <FieldSection title="TUN">
              {text('tunName', '接口名')}
              {list('tunAddress', '地址', validCidr)}
              {text('tunMtu', 'MTU', false)}
              <form.Field name="tunBypassSets">
                {(field) => (
                  <FieldRow label="绕过的规则集" htmlFor="takeover-tunBypassSets" wide>
                    <MultiSelect id="takeover-tunBypassSets" items={ruleSetChoices(profile)} value={field.state.value} onChange={field.handleChange} />
                  </FieldRow>
                )}
              </form.Field>
            </FieldSection>
          ) : (
            <FieldSection title="TProxy">
              {text('tproxyPort', '端口', false)}
              <form.Field name="ipv6">
                {(field) => <SwitchRow id="takeover-ipv6" label="接管 IPv6" checked={field.state.value} onCheckedChange={field.handleChange} />}
              </form.Field>
              <form.Field name="lan">
                {(field) => (
                  <FieldRow label="局域网接口" htmlFor="takeover-lan" wide>
                    <MultiSelect
                      id="takeover-lan"
                      items={Object.fromEntries(device.interfaces.map((name) => [name, name]))}
                      value={field.state.value}
                      invalid={invalid(field.state.meta)}
                      onChange={field.handleChange}
                    />
                  </FieldRow>
                )}
              </form.Field>
            </FieldSection>
          )}

          {hasMixed && (
            <FieldSection title="代理端口设置">
              <form.Field name="mixed">
                {(field) => <SwitchRow id="takeover-mixed" label="系统代理" checked={field.state.value} onCheckedChange={field.handleChange} />}
              </form.Field>
              {mixed && text('mixedPort', '端口', false)}
              {mixed && text('username', '用户名', false)}
              {mixed && username.trim() && (
                <form.Field name="password">
                  {(field) => (
                    <FieldRow label="密码" htmlFor="takeover-password" wide>
                      <TextInput
                        id="takeover-password"
                        type="password"
                        value={field.state.value}
                        invalid={invalid(field.state.meta)}
                        onChange={field.handleChange}
                      />
                    </FieldRow>
                  )}
                </form.Field>
              )}
            </FieldSection>
          )}
        </div>
      </div>

      <SaveButton pending={save.isPending} />
    </form>
  )
}
