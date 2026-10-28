import { revalidateLogic, useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { effectToast, untilApplied } from '@/lib/hako'
import { saveSettings, settingsQuery, type Settings } from '@/lib/settings'
import { FieldRow, FieldSection } from '@/pages/rules/form'
import { SingBoxSection } from '@/pages/sing-box'

const URL_PATTERN = /^https?:\/\/\S+$/

// the settings of Hako itself: sing-box and the latency tests
export function SettingsPage() {
  const settingsResult = useQuery(settingsQuery)
  const error = settingsResult.error?.message

  useEffect(() => {
    if (error) toast.error(`读取设置失败：${error}`, { id: 'settings-error' })
  }, [error])

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-6">
      <SingBoxSection />
      {/* a form of the settings read, again once they are saved */}
      {settingsResult.data ? (
        <SettingsForm key={JSON.stringify(settingsResult.data)} settings={settingsResult.data} />
      ) : (
        <Skeleton className="h-28 w-full rounded-lg" />
      )}
    </div>
  )
}

function SettingsForm({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: (values: Settings) => untilApplied(() => saveSettings(values)),
    onSuccess: ({ effect }) => {
      effectToast('已保存设置', effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
    },
    onError: (failure: Error) => toast.error(`保存失败：${failure.message}`),
  })

  const schema = z.object({
    testUrl: z.string().refine((value) => !value.trim() || URL_PATTERN.test(value.trim())),
    testTimeout: z.string().refine((value) => /^(\d*|(\d+(ms|s|m))+)$/.test(value.trim())),
  })

  const form = useForm({
    defaultValues: settings,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema },
    onSubmit: ({ value }) => save.mutate(value),
  })

  const invalid = (meta: { isTouched: boolean; isValid: boolean }) => meta.isTouched && !meta.isValid

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        form.handleSubmit()
      }}
    >
      <FieldSection title="测速">
        <form.Field name="testUrl">
          {(field) => (
            <FieldRow label="测速地址" htmlFor="settings-test-url" wide>
              <Input
                id="settings-test-url"
                value={field.state.value}
                aria-invalid={invalid(field.state.meta)}
                className="bg-background font-mono text-[13px]"
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </FieldRow>
          )}
        </form.Field>
        <form.Field name="testTimeout">
          {(field) => (
            <FieldRow label="测速超时" htmlFor="settings-test-timeout" wide>
              <InputGroup className="bg-background">
                <InputGroupInput
                  id="settings-test-timeout"
                  value={field.state.value}
                  aria-invalid={invalid(field.state.meta)}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>秒</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </FieldRow>
          )}
        </form.Field>
      </FieldSection>

      <div className="flex justify-end">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Spinner />}
          保存
        </Button>
      </div>
    </form>
  )
}
