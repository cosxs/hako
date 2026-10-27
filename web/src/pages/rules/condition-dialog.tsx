import { revalidateLogic, useForm } from '@tanstack/react-form'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import type { Profile } from '@/lib/policy'
import { conditionKeys, conditionOptions, conditionValue, conditionValues, initialValue, MATCH_SOURCE, validCondition } from '@/lib/rules'
import { ConditionFields } from '@/pages/rules/condition-fields'

// a condition of a logical rule, added or changed; nothing is saved until the
// rule is. options is the condition changed, of one type
export function ConditionDialog({
  profile,
  options,
  onDone,
  onOpenChange,
}: {
  profile: Profile
  options: Record<string, string | string[]> | null
  onDone: (options: Record<string, string | string[]>) => void
  onOpenChange: (open: boolean) => void
}) {
  const startKey = options ? conditionKeys(options)[0] : 'domain_suffix'

  const form = useForm({
    defaultValues: { key: startKey, value: options ? conditionValue(profile, startKey, options) : '', matchSource: options?.[MATCH_SOURCE] === '1' },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z
        .object({ key: z.string(), value: z.string(), matchSource: z.boolean() })
        .refine((value) => validCondition(profile, value.key, value.value), { path: ['value'] }),
    },
    onSubmit: ({ value }) => {
      onDone({
        ...conditionOptions(profile, value.key, conditionValues(value.key, value.value)),
        ...(value.key === 'rule_set' && value.matchSource ? { [MATCH_SOURCE]: '1' } : {}),
        ...(options?.invert === '1' ? { invert: '1' } : {}),
      })
      onOpenChange(false)
    },
  })

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            form.handleSubmit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{options ? '编辑条件' : '添加条件'}</DialogTitle>
            <DialogDescription className="sr-only">保存规则时一并保存。</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <form.Field name="key">
              {(keyField) => (
                <form.Field name="value">
                  {(field) => (
                    <ConditionFields
                      profile={profile}
                      id="condition"
                      stacked
                      type={keyField.state.value}
                      value={field.state.value}
                      invalid={field.state.meta.isTouched && !field.state.meta.isValid}
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
            <form.Subscribe selector={(state) => state.values.key}>
              {(key) =>
                key === 'rule_set' && (
                  <form.Field name="matchSource">
                    {(field) => (
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor="condition-match-source">匹配来源地址</FieldLabel>
                        <Switch id="condition-match-source" checked={field.state.value} onCheckedChange={field.handleChange} />
                      </Field>
                    )}
                  </form.Field>
                )
              }
            </form.Subscribe>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>取消</DialogClose>
            <Button type="submit">{options ? '完成' : '添加'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
