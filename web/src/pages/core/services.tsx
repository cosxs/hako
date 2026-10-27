import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import {
  deleteProfileSection,
  detourChoices,
  httpClientUsers,
  httpClientValues,
  joined,
  saveHttpClient,
  saveService,
  sectionsOf,
  serviceValues,
  validDuration,
  type HttpClientValues,
  type ServiceValues,
} from '@/lib/core'
import { effectToast, untilApplied } from '@/lib/hako'
import { label, type Profile } from '@/lib/policy'
import type { UciSection } from '@/lib/uci'
import { cn } from '@/lib/utils'
import { ChoiceSelect, DeleteSectionDialog, SectionTable, TextInput, UnitInput } from '@/pages/core/fields'
import { FieldRow, FieldSection, SwitchRow } from '@/pages/rules/form'

const HTTP_VERSIONS = { '1': 'HTTP/1.1', '2': 'HTTP/2', '3': 'HTTP/3' }
const URL_PATTERN = /^https?:\/\/\S+$/

function invalid(meta: { isTouched: boolean; isValid: boolean }) {
  return meta.isTouched && !meta.isValid
}

function validPort(port: string) {
  return /^\d+$/.test(port.trim()) && Number(port) > 0 && Number(port) < 65536
}

// sections of a type listed in a table, each changed by its own dialog and
// deleted when nothing uses it
function SectionList({
  profile,
  type,
  kind,
  columns,
  cells,
  users,
  dialog,
}: {
  profile: Profile
  type: string
  kind: string
  columns: string[]
  cells: (section: UciSection) => ReactNode[]
  users: (section: UciSection) => string[]
  dialog: (section: UciSection | null, onOpenChange: (open: boolean) => void) => ReactNode
}) {
  const queryClient = useQueryClient()
  const [opened, setOpened] = useState<{ section: UciSection | null } | null>(null)
  const [deleting, setDeleting] = useState<UciSection | null>(null)

  const remove = useMutation({
    mutationFn: (section: UciSection) => untilApplied(() => deleteProfileSection(profile, section)),
    onSuccess: ({ effect }, section) => {
      effectToast(`${joined('已删除', kind)} ${label(section)}`, effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      setDeleting(null)
    },
    onError: (error: Error, section) => toast.error(`${joined('无法删除', kind)} ${label(section)}：${error.message}`),
  })

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-2">
      <h3 className="px-0.5 text-[13px] font-semibold">{kind}</h3>
      <SectionTable
        label={kind}
        columns={columns}
        sections={sectionsOf(profile, type)}
        cells={cells}
        busy={remove.isPending}
        onOpen={(section) => setOpened({ section })}
        onDelete={setDeleting}
      />
      {opened && dialog(opened.section, (open) => !open && setOpened(null))}
      <DeleteSectionDialog
        kind={kind}
        name={deleting ? label(deleting) : ''}
        users={deleting ? users(deleting) : []}
        open={!!deleting}
        pending={remove.isPending}
        onDelete={() => deleting && remove.mutate(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
      />
    </div>
  )
}

// a dialog of one section, framed as the rule set dialog
// of one column, as the rule set dialog; of two, as the node dialog, the
// sections given left and right
function SectionDialog({
  title,
  pending,
  children,
  columns,
  onSubmit,
  onOpenChange,
}: {
  title: string
  pending: boolean
  children?: ReactNode
  columns?: [ReactNode, ReactNode]
  onSubmit: () => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex flex-col gap-0 overflow-hidden p-0',
          columns ? 'h-[min(38rem,calc(100dvh-2rem))] sm:max-w-[960px]' : 'max-h-[calc(100dvh-2rem)] sm:max-w-xl',
        )}
      >
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <DialogHeader className="border-b px-6 pt-5 pb-3.5">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">保存后立即生效。</DialogDescription>
          </DialogHeader>
          {columns ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="grid items-start gap-6 sm:grid-cols-2">
                <div className="flex flex-col gap-5">{columns[0]}</div>
                <div className="flex flex-col gap-5">{columns[1]}</div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">{children}</div>
          )}
          <DialogFooter className="border-t px-6 py-3.5">
            <DialogClose render={<Button type="button" variant="outline" />}>取消</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function useSaveSection<T>(save: (values: T) => Promise<void>, done: string, onOpenChange: (open: boolean) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: T) => untilApplied(() => save(values)),
    onSuccess: ({ effect }) => {
      effectToast(done, effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onOpenChange(false)
    },
    onError: (error: Error) => toast.error(`保存失败：${error.message}`),
  })
}

// HTTP clients: what remote rule sets, Hysteria2 realms and dashboards
// download with
export function HttpClientsTab({ profile }: { profile: Profile }) {
  const detours = detourChoices(profile)
  return (
    <SectionList
      profile={profile}
      type="http_client"
      kind="HTTP 客户端"
      columns={['名称', 'HTTP 版本', '出站']}
      cells={(section) => {
        const values = httpClientValues(profile, section)
        return [label(section), HTTP_VERSIONS[values.version as keyof typeof HTTP_VERSIONS] ?? values.version, detours[values.detour] ?? values.detour]
      }}
      users={(section) => httpClientUsers(profile, section)}
      dialog={(section, onOpenChange) => <HttpClientDialog profile={profile} section={section} onOpenChange={onOpenChange} />}
    />
  )
}

function HttpClientDialog({ profile, section, onOpenChange }: { profile: Profile; section: UciSection | null; onOpenChange: (open: boolean) => void }) {
  const others = sectionsOf(profile, 'http_client')
    .filter((other) => other !== section)
    .map(label)
  const save = useSaveSection(
    (values: HttpClientValues) => saveHttpClient(profile, section, values),
    section ? '已保存 HTTP 客户端' : '已添加 HTTP 客户端',
    onOpenChange,
  )

  const form = useForm({
    defaultValues: httpClientValues(profile, section),
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z
        .object({ tag: z.string(), version: z.string(), noFallback: z.boolean(), headers: z.string(), detour: z.string() })
        .superRefine((value, context) => {
          const fail = (path: string) => context.addIssue({ code: 'custom', path: [path], message: '' })
          if (!value.tag.trim() || others.includes(value.tag.trim())) fail('tag')
          if (value.headers.split('\n').some((line) => line.trim() && !/^[^:\s][^:]*:.*$/.test(line.trim()))) fail('headers')
        }),
    },
    onSubmit: ({ value }) => save.mutate(value),
  })

  return (
    <SectionDialog title={section ? '编辑 HTTP 客户端' : '新增 HTTP 客户端'} pending={save.isPending} onSubmit={form.handleSubmit} onOpenChange={onOpenChange}>
      <FieldSection title="HTTP 客户端">
        <form.Field name="tag">
          {(field) => (
            <FieldRow label="名称" htmlFor="http-client-tag" wide>
              <TextInput id="http-client-tag" value={field.state.value} invalid={invalid(field.state.meta)} onChange={field.handleChange} />
            </FieldRow>
          )}
        </form.Field>
        <form.Field name="version">
          {(field) => (
            <FieldRow label="HTTP 版本" htmlFor="http-client-version" wide>
              <ChoiceSelect id="http-client-version" items={HTTP_VERSIONS} value={field.state.value} onChange={field.handleChange} />
            </FieldRow>
          )}
        </form.Field>
        <form.Field name="noFallback">
          {(field) => <SwitchRow id="http-client-fallback" label="禁止版本回退" checked={field.state.value} onCheckedChange={field.handleChange} />}
        </form.Field>
        <form.Field name="detour">
          {(field) => (
            <FieldRow label="出站" htmlFor="http-client-detour" wide>
              <ChoiceSelect id="http-client-detour" items={detourChoices(profile)} value={field.state.value} onChange={field.handleChange} />
            </FieldRow>
          )}
        </form.Field>
        <form.Field name="headers">
          {(field) => (
            <Field className="gap-2 py-2.5">
              <FieldLabel htmlFor="http-client-headers" className="font-normal">
                请求头
              </FieldLabel>
              <Textarea
                id="http-client-headers"
                rows={3}
                spellCheck={false}
                value={field.state.value}
                aria-invalid={invalid(field.state.meta)}
                className="bg-background font-mono text-[13px]"
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>
      </FieldSection>
    </SectionDialog>
  )
}

// the sing-box API, with a dashboard of its own
export function ServicesTab({ profile }: { profile: Profile }) {
  return (
    <SectionList
      profile={profile}
      type="service"
      kind="API"
      columns={['名称', '地址', '面板']}
      cells={(section) => {
        const values = serviceValues(section)
        const host = values.listen.includes(':') ? `[${values.listen}]` : values.listen
        return [`${label(section)}${values.enabled ? '' : '（已停用）'}`, `${host}:${values.port}`, values.dashboard ? '开启' : '关闭']
      }}
      users={() => []}
      dialog={(section, onOpenChange) => <ServiceDialog profile={profile} section={section} onOpenChange={onOpenChange} />}
    />
  )
}

function ServiceDialog({ profile, section, onOpenChange }: { profile: Profile; section: UciSection | null; onOpenChange: (open: boolean) => void }) {
  const others = sectionsOf(profile, 'service')
    .filter((other) => other !== section)
    .map(label)
  const clients: Record<string, string> = Object.fromEntries([
    ['', '默认'],
    ...sectionsOf(profile, 'http_client').map((client) => [client['.name'], label(client)]),
  ])
  const save = useSaveSection((values: ServiceValues) => saveService(profile, section, values), section ? '已保存 API' : '已添加 API', onOpenChange)

  const form = useForm({
    defaultValues: serviceValues(section),
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z
        .object({
          enabled: z.boolean(),
          tag: z.string(),
          listen: z.string(),
          port: z.string(),
          secret: z.string(),
          origins: z.string(),
          privateNetwork: z.boolean(),
          dashboard: z.boolean(),
          dashboardPath: z.string(),
          dashboardUrl: z.string(),
          dashboardClient: z.string(),
          dashboardInterval: z.string(),
        })
        .superRefine((value, context) => {
          const fail = (path: string) => context.addIssue({ code: 'custom', path: [path], message: '' })
          if (!value.tag.trim() || others.includes(value.tag.trim())) fail('tag')
          if (!/^[0-9a-fA-F:.]+$/.test(value.listen.trim())) fail('listen')
          if (!validPort(value.port)) fail('port')
          if (value.dashboardUrl.trim() && !URL_PATTERN.test(value.dashboardUrl.trim())) fail('dashboardUrl')
          if (value.dashboardPath.trim() && !value.dashboardPath.trim().startsWith('/')) fail('dashboardPath')
          if (!validDuration(value.dashboardInterval)) fail('dashboardInterval')
        }),
    },
    onSubmit: ({ value }) => save.mutate(value),
  })

  const dashboard = useStore(form.store, (state) => state.values.dashboard)
  const text = (name: 'tag' | 'listen' | 'port' | 'secret' | 'origins' | 'dashboardPath' | 'dashboardUrl', title: string, mono = true, type?: string) => (
    <form.Field name={name}>
      {(field) => (
        <FieldRow label={title} htmlFor={`service-${name}`} wide>
          <TextInput
            id={`service-${name}`}
            type={type}
            mono={mono}
            value={field.state.value}
            invalid={invalid(field.state.meta)}
            onChange={field.handleChange}
          />
        </FieldRow>
      )}
    </form.Field>
  )
  const toggle = (name: 'enabled' | 'privateNetwork' | 'dashboard', title: string) => (
    <form.Field name={name}>
      {(field) => <SwitchRow id={`service-${name}`} label={title} checked={field.state.value} onCheckedChange={field.handleChange} />}
    </form.Field>
  )

  return (
    <SectionDialog
      title={section ? '编辑 API' : '新增 API'}
      pending={save.isPending}
      onSubmit={form.handleSubmit}
      onOpenChange={onOpenChange}
      columns={[
        <FieldSection key="api" title="API">
          {toggle('enabled', '启用')}
          {text('tag', '名称', false)}
          {text('listen', '监听地址')}
          {text('port', '端口', false)}
          {text('secret', '密钥', false, 'password')}
          {text('origins', '允许的来源')}
          {toggle('privateNetwork', '允许私有网络')}
        </FieldSection>,
        <FieldSection key="dashboard" title="面板">
          {toggle('dashboard', '启用')}
          {dashboard && text('dashboardPath', '目录')}
          {dashboard && text('dashboardUrl', '下载地址')}
          {dashboard && (
            <form.Field name="dashboardClient">
              {(field) => (
                <FieldRow label="HTTP 客户端" htmlFor="service-dashboardClient" wide>
                  <ChoiceSelect id="service-dashboardClient" items={clients} value={field.state.value} onChange={field.handleChange} />
                </FieldRow>
              )}
            </form.Field>
          )}
          {dashboard && (
            <form.Field name="dashboardInterval">
              {(field) => (
                <FieldRow label="更新间隔" htmlFor="service-dashboardInterval" wide>
                  <UnitInput
                    id="service-dashboardInterval"
                    unit="小时"
                    value={field.state.value}
                    invalid={invalid(field.state.meta)}
                    onChange={field.handleChange}
                  />
                </FieldRow>
              )}
            </form.Field>
          )}
        </FieldSection>,
      ]}
    />
  )
}
