import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import {
  deleteProfileSection,
  detourChoices,
  DNS_TYPES,
  dnsServerUsers,
  dnsServerValues,
  dnsValues,
  finalServers,
  REMOTE_DNS_TYPES,
  saveDns,
  saveDnsServer,
  sectionsOf,
  STRATEGIES,
  TLS_DNS_TYPES,
  type DnsServerValues,
  type DnsValues,
} from '@/lib/core'
import { effectToast, untilApplied } from '@/lib/hako'
import { label, type Profile } from '@/lib/policy'
import type { UciSection } from '@/lib/uci'
import { ChoiceSelect, DeleteSectionDialog, SaveButton, SectionTable, TextInput } from '@/pages/core/fields'
import { FieldRow, FieldSection, SwitchRow } from '@/pages/rules/form'

function invalid(meta: { isTouched: boolean; isValid: boolean }) {
  return meta.isTouched && !meta.isValid
}

function isRulesJson(text: string) {
  if (!text.trim()) return true
  try {
    return Array.isArray(JSON.parse(text))
  } catch {
    return false
  }
}

// the DNS of the profile: the settings of the dns object, the servers, each
// changed by its own dialog, and DNS rules of sing-box written as JSON, put
// after the names of the LAN and before the split of mainland and foreign
// answers
export function DnsTab({ profile }: { profile: Profile }) {
  const values = dnsValues(profile)
  return <DnsForm key={JSON.stringify(values)} profile={profile} values={values} />
}

function DnsForm({ profile, values }: { profile: Profile; values: DnsValues }) {
  const queryClient = useQueryClient()
  const [opened, setOpened] = useState<{ section: UciSection | null } | null>(null)
  const [deleting, setDeleting] = useState<UciSection | null>(null)

  const save = useMutation({
    mutationFn: (next: DnsValues) => untilApplied(() => saveDns(profile, next)),
    onSuccess: ({ effect }) => {
      effectToast('已保存 DNS 设置', effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
    },
    onError: (error: Error) => toast.error(`保存失败：${error.message}`),
  })

  const remove = useMutation({
    mutationFn: (section: UciSection) => untilApplied(() => deleteProfileSection(profile, section)),
    onSuccess: ({ effect }, section) => {
      effectToast(`已删除 DNS 服务器 ${label(section)}`, effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      setDeleting(null)
    },
    onError: (error: Error, section) => toast.error(`无法删除 DNS 服务器 ${label(section)}：${error.message}`),
  })

  const finals = Object.fromEntries(finalServers(profile).map((server) => [server['.name'], label(server)]))
  const form = useForm({
    defaultValues: values,
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        final: z.string(),
        strategy: z.string(),
        optimistic: z.boolean(),
        customRules: z.string().refine(isRulesJson),
      }),
    },
    onSubmit: ({ value }) => save.mutate(value),
  })

  const servers = sectionsOf(profile, 'dns_server')
  const server = (section: UciSection) => {
    if (section.type === 'fakeip') return [section.inet4_range, section.inet6_range].filter(Boolean).join(', ') || '—'
    return typeof section.server === 'string' && section.server ? section.server : '—'
  }
  const detours = detourChoices(profile)

  return (
    <form
      noValidate
      className="flex w-full max-w-[720px] flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        form.handleSubmit()
      }}
    >
      <FieldSection title="DNS">
        <form.Field name="final">
          {(field) => (
            <FieldRow label="默认 DNS 服务器" htmlFor="dns-final" wide>
              <ChoiceSelect id="dns-final" mono items={finals} value={field.state.value} onChange={field.handleChange} />
            </FieldRow>
          )}
        </form.Field>
        <form.Field name="strategy">
          {(field) => (
            <FieldRow label="解析策略" htmlFor="dns-strategy" wide>
              <ChoiceSelect id="dns-strategy" items={STRATEGIES} value={field.state.value} onChange={field.handleChange} />
            </FieldRow>
          )}
        </form.Field>
        <form.Field name="optimistic">
          {(field) => <SwitchRow id="dns-optimistic" label="乐观缓存" checked={field.state.value} onCheckedChange={field.handleChange} />}
        </form.Field>
      </FieldSection>

      <section className="flex flex-col gap-2">
        <h3 className="px-0.5 text-[13px] font-semibold">DNS 服务器</h3>
        <SectionTable
          label="DNS 服务器"
          columns={['名称', '类型', '服务器', '出站']}
          sections={servers}
          cells={(section) => [
            label(section),
            DNS_TYPES[String(section.type)] ?? String(section.type ?? ''),
            server(section),
            section.detour ? (detours[String(section.detour)] ?? String(section.detour)) : '—',
          ]}
          busy={remove.isPending}
          onOpen={(section) => setOpened({ section })}
          onDelete={setDeleting}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="px-0.5 text-[13px] font-semibold">自定义规则</h3>
        <form.Field name="customRules">
          {(field) => (
            <Textarea
              aria-label="自定义 DNS 规则"
              rows={9}
              spellCheck={false}
              value={field.state.value}
              aria-invalid={invalid(field.state.meta)}
              className="max-h-96 min-h-36 font-mono text-[13px]"
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>
      </section>

      <SaveButton pending={save.isPending} />

      {opened && <DnsServerDialog profile={profile} section={opened.section} onOpenChange={(open) => !open && setOpened(null)} />}
      <DeleteSectionDialog
        kind="DNS 服务器"
        name={deleting ? label(deleting) : ''}
        users={deleting ? dnsServerUsers(profile, deleting) : []}
        open={!!deleting}
        pending={remove.isPending}
        onDelete={() => deleting && remove.mutate(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
      />
    </form>
  )
}

// a DNS server, new or changed: the fields of its type
function DnsServerDialog({ profile, section, onOpenChange }: { profile: Profile; section: UciSection | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const others = sectionsOf(profile, 'dns_server').filter((other) => other !== section)
  const resolvers: Record<string, string> = Object.fromEntries([
    ['', '默认'],
    ...others.filter((other) => other.type !== 'fakeip').map((other) => [other['.name'], label(other)]),
  ])

  const mutation = useMutation({
    mutationFn: (values: DnsServerValues) => untilApplied(() => saveDnsServer(profile, section, values)),
    onSuccess: ({ effect }) => {
      effectToast(section ? '已保存 DNS 服务器' : '已添加 DNS 服务器', effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onOpenChange(false)
    },
    onError: (error: Error) => toast.error(`保存失败：${error.message}`),
  })

  const form = useForm({
    defaultValues: dnsServerValues(section),
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z
        .object({
          tag: z.string(),
          type: z.string(),
          server: z.string(),
          port: z.string(),
          path: z.string(),
          tlsServerName: z.string(),
          detour: z.string(),
          domainResolver: z.string(),
          inet4Range: z.string(),
          inet6Range: z.string(),
        })
        .superRefine((value, context) => {
          const fail = (path: string) => context.addIssue({ code: 'custom', path: [path], message: '' })
          const tag = value.tag.trim()
          if (!tag || others.map(label).includes(tag)) fail('tag')
          if (REMOTE_DNS_TYPES.includes(value.type) && !value.server.trim()) fail('server')
          if (value.port.trim() && !(/^\d+$/.test(value.port.trim()) && Number(value.port) > 0 && Number(value.port) < 65536)) fail('port')
          if (value.type === 'fakeip' && !value.inet4Range.trim() && !value.inet6Range.trim()) fail('inet4Range')
        }),
    },
    onSubmit: ({ value }) => mutation.mutate(value),
  })

  const type = useStore(form.store, (state) => state.values.type)
  const remote = REMOTE_DNS_TYPES.includes(type)

  const text = (name: 'tag' | 'server' | 'port' | 'path' | 'tlsServerName' | 'inet4Range' | 'inet6Range', title: string, mono = true) => (
    <form.Field name={name}>
      {(field) => (
        <FieldRow label={title} htmlFor={`dns-server-${name}`} wide>
          <TextInput id={`dns-server-${name}`} mono={mono} value={field.state.value} invalid={invalid(field.state.meta)} onChange={field.handleChange} />
        </FieldRow>
      )}
    </form.Field>
  )

  return (
    <Dialog open onOpenChange={onOpenChange}>
      {/* framed as the rule set dialog, of one column */}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            form.handleSubmit()
          }}
        >
          <DialogHeader className="border-b px-6 pt-5 pb-3.5">
            <DialogTitle>{section ? '编辑 DNS 服务器' : '新增 DNS 服务器'}</DialogTitle>
            <DialogDescription className="sr-only">保存后立即生效。</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <FieldSection title="DNS 服务器">
              {text('tag', '名称', false)}
              <form.Field name="type">
                {(field) => (
                  <FieldRow label="类型" htmlFor="dns-server-type" wide>
                    <ChoiceSelect id="dns-server-type" items={DNS_TYPES} value={field.state.value} onChange={field.handleChange} />
                  </FieldRow>
                )}
              </form.Field>
              {remote && text('server', '服务器')}
              {remote && text('port', '端口', false)}
              {(type === 'https' || type === 'h3') && text('path', '路径')}
              {TLS_DNS_TYPES.includes(type) && text('tlsServerName', 'TLS 服务器名称')}
              {type === 'fakeip' && text('inet4Range', 'IPv4 地址段')}
              {type === 'fakeip' && text('inet6Range', 'IPv6 地址段')}
              {type !== 'fakeip' && (
                <form.Field name="detour">
                  {(field) => (
                    <FieldRow label="出站" htmlFor="dns-server-detour" wide>
                      <ChoiceSelect id="dns-server-detour" items={detourChoices(profile)} value={field.state.value} onChange={field.handleChange} />
                    </FieldRow>
                  )}
                </form.Field>
              )}
              {type !== 'fakeip' && (
                <form.Field name="domainResolver">
                  {(field) => (
                    <FieldRow label="域名解析" htmlFor="dns-server-resolver" wide>
                      <ChoiceSelect id="dns-server-resolver" items={resolvers} value={field.state.value} onChange={field.handleChange} />
                    </FieldRow>
                  )}
                </form.Field>
              )}
            </FieldSection>
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
