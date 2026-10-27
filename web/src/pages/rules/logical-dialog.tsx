import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MinusIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { effectToast, untilApplied } from '@/lib/hako'
import type { Profile, Subscription } from '@/lib/policy'
import { conditionKeys, conditionText, logicalMode, outboundChoice, outboundChoices, REJECT, saveLogicalRule, subrulesOf, type LogicalValues } from '@/lib/rules'
import type { UciSection } from '@/lib/uci'
import { cn } from '@/lib/utils'
import { ConditionDialog } from '@/pages/rules/condition-dialog'
import { FieldRow, FieldSection, OutboundSelect, SwitchRow } from '@/pages/rules/form'

// the modes of sing-box; not is the rule inverted
const MODES = { and: 'AND', or: 'OR' }

type Options = Record<string, string | string[]>

// the options of a condition of the rule, but the rule it belongs to
function ownOptions(section: UciSection): Options {
  return Object.fromEntries(Object.entries(section).filter(([key]) => !key.startsWith('.') && key !== 'rule')) as Options
}

// a logical rule, new or changed: its operator, outbound and conditions. A
// condition is added or changed in a dialog of its own, and saved with the rule
export function LogicalDialog({
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
  const [picked, setPicked] = useState<number | null>(null)
  // the condition a dialog edits: its index, or -1 for a new one
  const [editing, setEditing] = useState<number | null>(null)

  const mutation = useMutation({
    mutationFn: (values: LogicalValues) => untilApplied(() => saveLogicalRule(profile, section, values)),
    onSuccess: ({ effect }) => {
      effectToast(section ? '已保存规则' : '已添加规则', effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onOpenChange(false)
    },
    onError: (error: Error) => toast.error(`保存失败：${error.message}`),
  })

  const choices = outboundChoices(profile, subscriptions, section ? outboundChoice(profile, subscriptions, section) : '')

  const form = useForm({
    defaultValues: {
      mode: (section ? logicalMode(section) : 'and') as LogicalValues['mode'],
      invert: section?.invert === '1',
      outbound: section ? outboundChoice(profile, subscriptions, section) : (choices[0]?.items[0]?.[0] ?? ''),
      drop: section?.method === 'drop',
      comment: typeof section?.comment === 'string' ? section.comment : '',
      conditions: section ? subrulesOf(profile, section).map(ownOptions) : ([] as Options[]),
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        mode: z.enum(['and', 'or']),
        invert: z.boolean(),
        outbound: z.string().min(1),
        drop: z.boolean(),
        comment: z.string(),
        conditions: z.array(z.record(z.string(), z.union([z.string(), z.array(z.string())]))).min(1),
      }),
    },
    onSubmit: ({ value }) => mutation.mutate(value),
  })

  const outbound = useStore(form.store, (state) => state.values.outbound)

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
            <DialogTitle>{section ? '编辑逻辑规则' : '新增逻辑规则'}</DialogTitle>
            <DialogDescription className="sr-only">保存后立即生效。</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid items-start gap-6 sm:grid-cols-2">
              <div className="flex flex-col gap-5">
                <FieldSection title="规则">
                  <form.Field name="mode">
                    {(field) => (
                      <FieldRow label="运算符" htmlFor="logical-mode">
                        <Select items={MODES} value={field.state.value} onValueChange={(next) => field.handleChange(next as LogicalValues['mode'])}>
                          <SelectTrigger id="logical-mode" className="w-full bg-background font-mono text-[13px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(MODES).map(([value, text]) => (
                              <SelectItem key={value} value={value} className="font-mono text-[13px]">
                                {text}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FieldRow>
                    )}
                  </form.Field>
                </FieldSection>

                <FieldSection title="动作">
                  <form.Field name="outbound">
                    {(field) => (
                      <FieldRow label="出站" htmlFor="logical-outbound">
                        <OutboundSelect
                          id="logical-outbound"
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
                      {(field) => <SwitchRow id="logical-drop" label="静默丢弃" checked={field.state.value} onCheckedChange={field.handleChange} />}
                    </form.Field>
                  )}
                </FieldSection>
              </div>

              <div className="flex flex-col gap-5">
                <FieldSection title="选项">
                  <form.Field name="invert">
                    {(field) => <SwitchRow id="logical-invert" label="反向匹配" checked={field.state.value} onCheckedChange={field.handleChange} />}
                  </form.Field>
                </FieldSection>

                <FieldSection title="杂项">
                  <form.Field name="comment">
                    {(field) => (
                      <FieldRow label="注释" htmlFor="logical-comment">
                        <Input id="logical-comment" className="bg-background" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} />
                      </FieldRow>
                    )}
                  </form.Field>
                </FieldSection>

                <form.Field name="conditions" mode="array">
                  {(field) => {
                    const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                    const conditions = field.state.value
                    return (
                      <section className="flex flex-col gap-2">
                        <h3 className="px-0.5 text-[13px] font-semibold">条件</h3>
                        <div className={cn('flex flex-col overflow-hidden rounded-lg bg-muted', invalid && 'ring-3 ring-destructive/20 outline outline-destructive')}>
                          <div className="h-64 overflow-y-auto">
                            <Table className="select-none">
                              <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                  <TableHead className="w-44 px-3.5">类型</TableHead>
                                  <TableHead className="px-3.5">值</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {conditions.map((options, index) => {
                                  const text = conditionText(profile, options)
                                  const editable = conditionKeys(options).length === 1 && typeof options.json !== 'string'
                                  return (
                                    <TableRow
                                      key={index}
                                      data-state={picked === index ? 'selected' : undefined}
                                      tabIndex={0}
                                      className="cursor-default font-mono text-[13px] hover:bg-background/60 data-[state=selected]:bg-background"
                                      onClick={() => setPicked(index)}
                                      onDoubleClick={() => editable && setEditing(index)}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter' && editable) {
                                          event.preventDefault()
                                          setEditing(index)
                                        }
                                      }}
                                    >
                                      <TableCell className="px-3.5">{text.type}</TableCell>
                                      <TableCell className="max-w-0 truncate px-3.5">{text.value}</TableCell>
                                    </TableRow>
                                  )
                                })}
                              </TableBody>
                            </Table>
                          </div>
                          <div className="flex items-center gap-1 border-t px-2.5 py-2">
                            <Button type="button" variant="outline" size="icon-sm" aria-label="添加条件" onClick={() => setEditing(-1)}>
                              <PlusIcon />
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-sm"
                              aria-label="删除选中的条件"
                              disabled={picked == null || picked >= conditions.length}
                              onClick={() => {
                                if (picked == null) return
                                field.removeValue(picked)
                                setPicked(null)
                              }}
                            >
                              <MinusIcon />
                            </Button>
                          </div>
                        </div>
                        {editing != null && (
                          <ConditionDialog
                            profile={profile}
                            options={editing >= 0 ? conditions[editing] : null}
                            onDone={(options) => (editing >= 0 ? field.replaceValue(editing, options) : field.pushValue(options))}
                            onOpenChange={(open) => !open && setEditing(null)}
                          />
                        )}
                      </section>
                    )
                  }}
                </form.Field>
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
