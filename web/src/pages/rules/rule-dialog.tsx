import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { effectToast, untilApplied } from '@/lib/hako'
import type { Profile, Subscription } from '@/lib/policy'
import {
  conditionKeys,
  conditionText,
  conditionValue,
  conditionValues,
  initialValue,
  MATCH_SOURCE,
  outboundChoice,
  outboundChoices,
  REJECT,
  saveStandardRule,
  validCondition,
} from '@/lib/rules'
import type { UciSection } from '@/lib/uci'
import { ConditionFields } from '@/pages/rules/condition-fields'
import { FieldRow, FieldSection, OutboundSelect, SwitchRow } from '@/pages/rules/form'

// a standard rule, new or changed: a condition, the outbound, and options. A
// rule of several conditions, written by hand, keeps them and changes the rest
export function RuleDialog({
  profile,
  subscriptions,
  section,
  onOpenChange,
}: {
  profile: Profile
  subscriptions: Subscription[]
  section: UciSection | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const keys = section ? conditionKeys(section).filter((key) => key !== 'clash_mode') : []
  const startKey = !section ? 'domain_suffix' : keys.length === 1 ? keys[0] : 'multiple'
  const extra = startKey === 'multiple' ? startKey : undefined

  const mutation = useMutation({
    mutationFn: (values: Parameters<typeof saveStandardRule>[2]) => untilApplied(() => saveStandardRule(profile, section, values)),
    onSuccess: ({ effect }) => {
      effectToast(section ? '已保存规则' : '已添加规则', effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onOpenChange(false)
    },
    onError: (error: Error) => toast.error(`保存失败：${error.message}`),
  })

  const schema = z
    .object({
      key: z.string(),
      value: z.string(),
      matchSource: z.boolean(),
      invert: z.boolean(),
      outbound: z.string().min(1),
      drop: z.boolean(),
      comment: z.string(),
    })
    .refine((value) => value.key === 'multiple' || validCondition(profile, value.key, value.value), { path: ['value'] })

  const choices = outboundChoices(profile, subscriptions, section ? outboundChoice(profile, subscriptions, section) : '')

  const form = useForm({
    defaultValues: {
      key: startKey,
      value: startKey === 'multiple' ? conditionText(profile, { ...section, invert: '' }).value : section ? conditionValue(profile, startKey, section) : '',
      matchSource: section?.[MATCH_SOURCE] === '1',
      invert: section?.invert === '1',
      outbound: section ? outboundChoice(profile, subscriptions, section) : (choices[0]?.items[0]?.[0] ?? ''),
      drop: section?.method === 'drop',
      comment: typeof section?.comment === 'string' ? section.comment : '',
    },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema },
    onSubmit: ({ value }) =>
      mutation.mutate({
        key: value.key === 'multiple' ? '' : value.key,
        values: conditionValues(value.key, value.value),
        matchSource: value.matchSource,
        invert: value.invert,
        outbound: value.outbound,
        drop: value.drop,
        comment: value.comment,
      }),
  })

  const outbound = useStore(form.store, (state) => state.values.outbound)
  const key = useStore(form.store, (state) => state.values.key)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      {/* of one height, as the node dialog: the fields scroll between the
          title and the buttons */}
      <DialogContent className="flex h-[min(38rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]">
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
        >
          <DialogHeader className="border-b px-6 pt-5 pb-3.5">
            <DialogTitle>{section ? '编辑普通规则' : '新增普通规则'}</DialogTitle>
            <DialogDescription className="sr-only">保存后立即生效。</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid items-start gap-6 sm:grid-cols-2">
              <div className="flex flex-col gap-5">
                <FieldSection title="规则">
                  <form.Field name="key">
                    {(keyField) => (
                      <form.Field name="value">
                        {(field) => (
                          <ConditionFields
                            profile={profile}
                            id="rule"
                            type={keyField.state.value}
                            value={field.state.value}
                            invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                            extra={extra}
                            onTypeChange={(key) => {
                              keyField.handleChange(key)
                              field.handleChange(initialValue(key))
                            }}
                            onValueChange={field.handleChange}
                          />
                        )}
                      </form.Field>
                    )}
                  </form.Field>
                </FieldSection>

                <FieldSection title="动作">
                  <form.Field name="outbound">
                    {(field) => (
                      <FieldRow label="出站" htmlFor="rule-outbound">
                        <OutboundSelect
                          id="rule-outbound"
                          choices={choices}
                          value={field.state.value}
                          invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                          onChange={field.handleChange}
                        />
                      </FieldRow>
                    )}
                  </form.Field>
                  {outbound === REJECT && (
                    <form.Field name="drop">
                      {(field) => <SwitchRow id="rule-drop" label="静默丢弃" checked={field.state.value} onCheckedChange={field.handleChange} />}
                    </form.Field>
                  )}
                </FieldSection>
              </div>

              <div className="flex flex-col gap-5">
                <FieldSection title="选项">
                  <form.Field name="invert">
                    {(field) => <SwitchRow id="rule-invert" label="反向匹配" checked={field.state.value} onCheckedChange={field.handleChange} />}
                  </form.Field>
                  {key === 'rule_set' && (
                    <form.Field name="matchSource">
                      {(field) => <SwitchRow id="rule-match-source" label="匹配来源地址" checked={field.state.value} onCheckedChange={field.handleChange} />}
                    </form.Field>
                  )}
                </FieldSection>

                <FieldSection title="杂项">
                  <form.Field name="comment">
                    {(field) => (
                      <FieldRow label="注释" htmlFor="rule-comment">
                        <Input
                          id="rule-comment"
                          className="bg-background"
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                        />
                      </FieldRow>
                    )}
                  </form.Field>
                </FieldSection>
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
