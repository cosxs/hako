import { revalidateLogic, useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from 'zod'

import { Skeleton } from '@/components/ui/skeleton'
import {
  detourChoices,
  experimentalQuery,
  LOG_LEVELS,
  logValues,
  ntpValues,
  saveExperimental,
  saveLog,
  saveNtp,
  validDuration,
  type ExperimentalValues,
  type LogValues,
  type NtpValues,
} from '@/lib/core'
import { effectToast, untilApplied } from '@/lib/hako'
import { label, type Profile } from '@/lib/policy'
import { ChoiceSelect, SaveButton, TextInput, UnitInput } from '@/pages/core/fields'
import { FieldRow, FieldSection, SwitchRow } from '@/pages/rules/form'

const URL_PATTERN = /^https?:\/\/\S+$/

function invalid(meta: { isTouched: boolean; isValid: boolean }) {
  return meta.isTouched && !meta.isValid
}

// a save of a tab, applied and waited for; the forms read their values
// again once the profile is
function useSave<T>(save: (values: T) => Promise<void>, done: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: T) => untilApplied(() => save(values)),
    onSuccess: ({ effect }) => {
      effectToast(done, effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
    },
    onError: (error: Error) => toast.error(`保存失败：${error.message}`),
  })
}

export function LogTab({ profile }: { profile: Profile }) {
  const values = logValues(profile)
  return <LogForm key={JSON.stringify(values)} profile={profile} values={values} />
}

function LogForm({ profile, values }: { profile: Profile; values: LogValues }) {
  const save = useSave((next: LogValues) => saveLog(profile, next), '已保存日志设置')
  const form = useForm({ defaultValues: values, onSubmit: ({ value }) => save.mutate(value) })

  return (
    <form
      noValidate
      className="flex w-full max-w-[720px] flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        form.handleSubmit()
      }}
    >
      <FieldSection title="日志">
        <form.Field name="disabled">
          {(field) => <SwitchRow id="log-disabled" label="关闭日志" checked={field.state.value} onCheckedChange={field.handleChange} />}
        </form.Field>
        <form.Field name="level">
          {(field) => (
            <FieldRow label="级别" htmlFor="log-level" wide>
              <ChoiceSelect
                id="log-level"
                mono
                items={Object.fromEntries(LOG_LEVELS.map((level) => [level, level]))}
                value={field.state.value}
                onChange={field.handleChange}
              />
            </FieldRow>
          )}
        </form.Field>
        <form.Field name="timestamp">
          {(field) => <SwitchRow id="log-timestamp" label="时间戳" checked={field.state.value} onCheckedChange={field.handleChange} />}
        </form.Field>
      </FieldSection>
      <SaveButton pending={save.isPending} />
    </form>
  )
}

export function NtpTab({ profile }: { profile: Profile }) {
  const values = ntpValues(profile)
  return <NtpForm key={JSON.stringify(values)} profile={profile} values={values} />
}

function NtpForm({ profile, values }: { profile: Profile; values: NtpValues }) {
  const save = useSave((next: NtpValues) => saveNtp(profile, next), '已保存 NTP 设置')
  const form = useForm({
    defaultValues: values,
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z
        .object({ enabled: z.boolean(), server: z.string(), port: z.string(), interval: z.string(), detour: z.string() })
        .superRefine((value, context) => {
          const fail = (path: string) => context.addIssue({ code: 'custom', path: [path], message: '' })
          if (value.enabled && !value.server.trim()) fail('server')
          if (value.port.trim() && !(/^\d+$/.test(value.port.trim()) && Number(value.port) > 0 && Number(value.port) < 65536)) fail('port')
          if (!validDuration(value.interval)) fail('interval')
        }),
    },
    onSubmit: ({ value }) => save.mutate(value),
  })

  return (
    <form
      noValidate
      className="flex w-full max-w-[720px] flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        form.handleSubmit()
      }}
    >
      <FieldSection title="NTP">
        <form.Field name="enabled">
          {(field) => <SwitchRow id="ntp-enabled" label="启用" checked={field.state.value} onCheckedChange={field.handleChange} />}
        </form.Field>
        <form.Field name="server">
          {(field) => (
            <FieldRow label="服务器" htmlFor="ntp-server" wide>
              <TextInput id="ntp-server" mono value={field.state.value} invalid={invalid(field.state.meta)} onChange={field.handleChange} />
            </FieldRow>
          )}
        </form.Field>
        <form.Field name="port">
          {(field) => (
            <FieldRow label="端口" htmlFor="ntp-port" wide>
              <TextInput id="ntp-port" value={field.state.value} invalid={invalid(field.state.meta)} onChange={field.handleChange} />
            </FieldRow>
          )}
        </form.Field>
        <form.Field name="interval">
          {(field) => (
            <FieldRow label="同步间隔" htmlFor="ntp-interval" wide>
              <UnitInput id="ntp-interval" unit="分钟" value={field.state.value} invalid={invalid(field.state.meta)} onChange={field.handleChange} />
            </FieldRow>
          )}
        </form.Field>
        <form.Field name="detour">
          {(field) => (
            <FieldRow label="出站" htmlFor="ntp-detour" wide>
              <ChoiceSelect id="ntp-detour" items={detourChoices(profile)} value={field.state.value} onChange={field.handleChange} />
            </FieldRow>
          )}
        </form.Field>
      </FieldSection>
      <SaveButton pending={save.isPending} />
    </form>
  )
}

export function ExperimentalTab({ profile }: { profile: Profile | undefined }) {
  const result = useQuery(experimentalQuery)
  if (!result.data || !profile)
    return (
      <div className="flex w-full max-w-[720px] flex-col gap-6">
        <Skeleton className="h-60 w-full rounded-lg" />
      </div>
    )
  return <ExperimentalForm key={JSON.stringify(result.data)} profile={profile} values={result.data} />
}

function ExperimentalForm({ profile, values }: { profile: Profile; values: ExperimentalValues }) {
  const save = useSave(saveExperimental, '已保存实验性设置')
  // the outbound the panel downloads through; none is the default outbound
  const outbounds: Record<string, string> = Object.fromEntries([
    ['', '默认出站'],
    ...profile.outbounds.filter((section) => section.hidden !== '1' || section.type === 'direct').map((section) => [section['.name'], label(section)]),
  ])
  const form = useForm({
    defaultValues: values,
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z
        .object({
          controller: z.string(),
          secret: z.string(),
          uiPath: z.string(),
          uiUrl: z.string(),
          uiDetour: z.string(),
          privateNetwork: z.boolean(),
          cache: z.boolean(),
          cachePath: z.string(),
          cacheId: z.string(),
          storeFakeip: z.boolean(),
          storeDns: z.boolean(),
        })
        .superRefine((value, context) => {
          const fail = (path: string) => context.addIssue({ code: 'custom', path: [path], message: '' })
          if (value.controller.trim() && !/^(\[[0-9a-fA-F:.]+\]|[0-9.]+|[\w.-]+):\d{1,5}$/.test(value.controller.trim())) fail('controller')
          if (value.uiUrl.trim() && !URL_PATTERN.test(value.uiUrl.trim())) fail('uiUrl')
          if (value.cachePath.trim() && !value.cachePath.trim().startsWith('/')) fail('cachePath')
        }),
    },
    onSubmit: ({ value }) => save.mutate(value),
  })

  const text = (name: 'controller' | 'secret' | 'uiPath' | 'uiUrl' | 'cachePath' | 'cacheId', title: string, mono = true, type?: string) => (
    <form.Field name={name}>
      {(field) => (
        <FieldRow label={title} htmlFor={`experimental-${name}`} wide>
          <TextInput
            id={`experimental-${name}`}
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
  const toggle = (name: 'privateNetwork' | 'cache' | 'storeFakeip' | 'storeDns', title: string) => (
    <form.Field name={name}>
      {(field) => <SwitchRow id={`experimental-${name}`} label={title} checked={field.state.value} onCheckedChange={field.handleChange} />}
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
      <FieldSection title="Clash API">
        {text('controller', '监听地址')}
        {text('secret', '密钥', false, 'password')}
        {text('uiPath', '面板目录')}
        {text('uiUrl', '面板下载地址')}
        <form.Field name="uiDetour">
          {(field) => (
            <FieldRow label="面板下载出站" htmlFor="experimental-uiDetour" wide>
              <ChoiceSelect id="experimental-uiDetour" items={outbounds} value={field.state.value} onChange={field.handleChange} />
            </FieldRow>
          )}
        </form.Field>
        {toggle('privateNetwork', '允许私有网络')}
      </FieldSection>
      <FieldSection title="缓存文件">
        {toggle('cache', '启用')}
        {text('cachePath', '路径')}
        {text('cacheId', '缓存 ID')}
        {toggle('storeFakeip', '保存 FakeIP')}
        {toggle('storeDns', '保存 DNS 缓存')}
      </FieldSection>
      <SaveButton pending={save.isPending} />
    </form>
  )
}
