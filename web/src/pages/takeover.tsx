import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { effectToast, untilApplied } from '@/lib/hako'
import { profileQuery, type Profile } from '@/lib/policy'
import {
  deviceQuery,
  ruleSetChoices,
  saveTakeover,
  takeoverValues,
  validCidr4Lines,
  validCidr6Lines,
  validCidrLines,
  validPort,
  type Device,
  type TakeoverValues,
} from '@/lib/takeover'
import { cn } from '@/lib/utils'
import { ChoiceSelect, SaveButton, TextInput } from '@/pages/core/fields'
import { FieldRow, FieldSection, SwitchRow } from '@/pages/rules/form'

const MODES = { tun: 'TUN', tproxy: 'TProxy' }

function invalid(meta: { isTouched: boolean; isValid: boolean }) {
  return meta.isTouched && !meta.isValid
}

const SCHEMA = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(['tun', 'tproxy']),
    ipv6: z.boolean(),
    dnsPort: z.string(),
    tunName: z.string(),
    tunAddress: z.string(),
    tunMtu: z.string(),
    tunBypassSets: z.array(z.string()),
    tunBypass4: z.string(),
    tunBypass6: z.string(),
    tproxyPort: z.string(),
    lan: z.array(z.string()),
    bypass4: z.string(),
    bypass6: z.string(),
    mixed: z.boolean(),
    mixedPort: z.string(),
    username: z.string(),
    password: z.string(),
  })
  .superRefine((value, context) => {
    const fail = (path: string) => context.addIssue({ code: 'custom', path: [path], message: '' })
    if (!validPort(value.dnsPort)) fail('dnsPort')
    if (value.mode === 'tun') {
      const name = value.tunName.trim()
      if (!name || name.length > 15 || /[\s/]/.test(name)) fail('tunName')
      if (!value.tunAddress.trim() || !validCidrLines(value.tunAddress)) fail('tunAddress')
      if (value.tunMtu.trim() && !(/^\d+$/.test(value.tunMtu.trim()) && Number(value.tunMtu) >= 1280 && Number(value.tunMtu) <= 65535)) fail('tunMtu')
      if (!validCidr4Lines(value.tunBypass4)) fail('tunBypass4')
      if (!validCidr6Lines(value.tunBypass6)) fail('tunBypass6')
    } else {
      if (!validPort(value.tproxyPort)) fail('tproxyPort')
      if (!value.lan.length) fail('lan')
      if (!validCidr4Lines(value.bypass4)) fail('bypass4')
      if (!validCidr6Lines(value.bypass6)) fail('bypass6')
    }
    if (value.mixed && !validPort(value.mixedPort)) fail('mixedPort')
    if (value.mixed && value.username.trim() && !value.password) fail('password')
  })

// the takeover of the LAN and the router: whether and how sing-box takes the
// traffic over, and the proxy port for devices set up by hand; FakeIP is a
// DNS server of the profile, set under Core settings › DNS
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
      <div className="flex w-full max-w-[720px] flex-col gap-6">
        <Skeleton className="h-36 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    )

  const values = takeoverValues(profile, device)
  return <TakeoverForm key={JSON.stringify(values)} profile={profile} device={device} values={values} />
}

// a list edited one item a line
function LinesInput({ id, value, invalid, onChange }: { id: string; value: string; invalid?: boolean; onChange: (value: string) => void }) {
  return (
    <Textarea
      id={id}
      value={value}
      aria-invalid={invalid}
      rows={4}
      spellCheck={false}
      className="max-h-48 min-h-20 bg-background font-mono text-[13px]"
      onChange={(event) => onChange(event.target.value)}
    />
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
    mutationFn: (next: TakeoverValues) => untilApplied(() => saveTakeover(profile, device, next)),
    onSuccess: ({ effect }) => {
      effectToast('已保存接管设置', effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
    },
    onError: (error: Error) => toast.error(`保存失败：${error.message}`),
  })

  const form = useForm({
    defaultValues: values,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: SCHEMA },
    onSubmit: ({ value }) => save.mutate(value),
  })

  const mode = useStore(form.store, (state) => state.values.mode)
  const mixed = useStore(form.store, (state) => state.values.mixed)
  const username = useStore(form.store, (state) => state.values.username)

  const hasMixed = device.sections.some((section) => section['.name'] === 'mixed')

  type Name = keyof TakeoverValues
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
  const lines = (name: Name, title: string) => (
    <form.Field name={name}>
      {(field) => (
        <FieldRow label={title} htmlFor={`takeover-${name}`} wide>
          <LinesInput
            id={`takeover-${name}`}
            value={field.state.value as string}
            invalid={invalid(field.state.meta)}
            onChange={(next) => field.handleChange(next as never)}
          />
        </FieldRow>
      )}
    </form.Field>
  )
  const toggle = (name: Name, title: string) => (
    <form.Field name={name}>
      {(field) => (
        <SwitchRow id={`takeover-${name}`} label={title} checked={field.state.value as boolean} onCheckedChange={(next) => field.handleChange(next as never)} />
      )}
    </form.Field>
  )

  return (
    <form
      noValidate
      className="flex w-full max-w-[720px] flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        form.handleSubmit()
      }}
    >
      <FieldSection title="接管">
        {toggle('enabled', '接管局域网和路由器的流量')}
        <form.Field name="mode">
          {(field) => (
            <FieldRow label="接管方式" htmlFor="takeover-mode" wide>
              <ChoiceSelect id="takeover-mode" items={MODES} value={field.state.value} onChange={(next) => field.handleChange(next as 'tun' | 'tproxy')} />
            </FieldRow>
          )}
        </form.Field>
        {toggle('ipv6', '接管 IPv6')}
        {text('dnsPort', 'DNS 端口', false)}
      </FieldSection>

      {mode === 'tun' ? (
        <FieldSection title="TUN">
          {text('tunName', '接口名')}
          {lines('tunAddress', '地址')}
          {text('tunMtu', 'MTU', false)}
          <form.Field name="tunBypassSets">
            {(field) => (
              <FieldRow label="绕过的规则集" htmlFor="takeover-tunBypassSets" wide>
                <MultiSelect id="takeover-tunBypassSets" items={ruleSetChoices(profile)} value={field.state.value} onChange={field.handleChange} />
              </FieldRow>
            )}
          </form.Field>
          {lines('tunBypass4', '绕过的 IPv4 地址')}
          {lines('tunBypass6', '绕过的 IPv6 地址')}
        </FieldSection>
      ) : (
        <FieldSection title="TProxy">
          {text('tproxyPort', '端口', false)}
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
          {lines('bypass4', '绕过的 IPv4 地址')}
          {lines('bypass6', '绕过的 IPv6 地址')}
        </FieldSection>
      )}

      {hasMixed && (
        <FieldSection title="代理端口">
          {toggle('mixed', 'HTTP 和 SOCKS5 代理')}
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

      <SaveButton pending={save.isPending} />
    </form>
  )
}
