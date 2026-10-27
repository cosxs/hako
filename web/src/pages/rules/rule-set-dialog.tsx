import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { effectToast, untilApplied } from '@/lib/hako'
import { label, type Profile } from '@/lib/policy'
import {
  httpClients,
  intervalHours,
  RULE_SET_FORMATS,
  RULE_SET_TYPES,
  ruleSetFormat,
  ruleSets,
  ruleSetType,
  saveRuleSet,
  type RuleSetType,
  type RuleSetValues,
} from '@/lib/rules'
import type { UciSection } from '@/lib/uci'
import { cn } from '@/lib/utils'
import { FieldRow, FieldSection } from '@/pages/rules/form'

function isJsonArray(text: string) {
  try {
    return Array.isArray(JSON.parse(text))
  } catch {
    return false
  }
}

// a rule set, new or changed, as route.rule_set of sing-box has it: a tag the
// rules name it by, and where its rules are. Laid out as the rule dialogs
export function RuleSetDialog({ profile, section, onOpenChange }: { profile: Profile; section: UciSection | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const others = ruleSets(profile)
    .filter((set) => set !== section)
    .map(label)
  const clients: Record<string, string> = Object.fromEntries([
    ['', '默认 HTTP 客户端'],
    ...httpClients(profile).map((client) => [client['.name'], label(client)]),
  ])
  const text = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '')

  const mutation = useMutation({
    mutationFn: (values: RuleSetValues) => untilApplied(() => saveRuleSet(profile, section, values)),
    onSuccess: ({ effect }) => {
      effectToast(section ? '已保存规则集' : '已添加规则集', effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onOpenChange(false)
    },
    onError: (error: Error) => toast.error(`保存失败：${error.message}`),
  })

  const schema = z
    .object({
      tag: z.string(),
      type: z.string(),
      format: z.string(),
      url: z.string(),
      path: z.string(),
      rules: z.string(),
      interval: z.string(),
      client: z.string(),
    })
    .superRefine((value, context) => {
      const fail = (path: string) => context.addIssue({ code: 'custom', path: [path], message: '' })
      const tag = value.tag.trim()
      if (!tag || others.includes(tag)) fail('tag')
      if (value.type === 'remote' && !/^https?:\/\/\S+$/.test(value.url.trim())) fail('url')
      if (value.type === 'remote' && !/^(\d*|(\d+[smhd])+)$/.test(value.interval.trim())) fail('interval')
      if (value.type === 'local' && !/^\/\S+$/.test(value.path.trim())) fail('path')
      if (value.type !== 'inline' && !RULE_SET_FORMATS.includes(value.format)) fail('format')
      if (value.type === 'inline' && !isJsonArray(value.rules)) fail('rules')
    })

  const form = useForm({
    defaultValues: {
      tag: text(section?.tag),
      type: (section ? ruleSetType(section) : 'remote') as string,
      format: ruleSetFormat(section) || 'binary',
      url: text(section?.url),
      path: text(section?.path),
      rules: text(section?.rules),
      interval: section ? intervalHours(section.update_interval) : '24',
      client: text(section?.http_client),
    },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema },
    onSubmit: ({ value }) => mutation.mutate({ ...value, type: value.type as RuleSetType }),
  })

  const type = useStore(form.store, (state) => state.values.type)
  const invalid = (meta: { isTouched: boolean; isValid: boolean }) => meta.isTouched && !meta.isValid

  // a field of the type chosen, in its row
  const textRow = (name: 'tag' | 'url' | 'path', title: string, mono = true) => (
    <form.Field name={name}>
      {(field) => (
        <FieldRow label={title} htmlFor={`rule-set-${name}`} wide>
          <Input
            id={`rule-set-${name}`}
            value={field.state.value}
            aria-invalid={invalid(field.state.meta)}
            className={cn('bg-background', mono && 'font-mono text-[13px]')}
            onChange={(event) => field.handleChange(event.target.value)}
          />
        </FieldRow>
      )}
    </form.Field>
  )

  return (
    <Dialog open onOpenChange={onOpenChange}>
      {/* framed as the rule dialogs, of one column: the fields scroll
          between the title and the buttons */}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
        >
          <DialogHeader className="border-b px-6 pt-5 pb-3.5">
            <DialogTitle>{section ? '编辑规则集' : '新增规则集'}</DialogTitle>
            <DialogDescription className="sr-only">保存后立即生效。</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <FieldSection title="规则集">
              {textRow('tag', '名称', false)}
              <form.Field name="type">
                {(field) => (
                  <FieldRow label="类型" htmlFor="rule-set-type" wide>
                    <Tabs value={field.state.value} onValueChange={(next) => field.handleChange(String(next))}>
                      <TabsList id="rule-set-type" className="w-full bg-input/70">
                        {(Object.keys(RULE_SET_TYPES) as RuleSetType[]).map((key) => (
                          <TabsTrigger key={key} value={key} className="px-2.5">
                            {RULE_SET_TYPES[key]}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  </FieldRow>
                )}
              </form.Field>
              {type === 'remote' && textRow('url', '地址')}
              {type === 'local' && textRow('path', '路径')}
              {type === 'inline' && (
                <form.Field name="rules">
                  {(field) => (
                    <Field className="gap-2 py-2.5">
                      <FieldLabel htmlFor="rule-set-rules" className="font-normal">
                        规则
                      </FieldLabel>
                      <Textarea
                        id="rule-set-rules"
                        rows={10}
                        spellCheck={false}
                        value={field.state.value}
                        aria-invalid={invalid(field.state.meta)}
                        className="max-h-80 min-h-40 bg-background font-mono text-[13px]"
                        onChange={(event) => field.handleChange(event.target.value)}
                      />
                    </Field>
                  )}
                </form.Field>
              )}
              {type !== 'inline' && (
                <form.Field name="format">
                  {(field) => (
                    <FieldRow label="格式" htmlFor="rule-set-format" wide>
                      <Tabs value={field.state.value} onValueChange={(next) => field.handleChange(String(next))}>
                        <TabsList id="rule-set-format" aria-invalid={invalid(field.state.meta)} className="w-full bg-input/70">
                          {RULE_SET_FORMATS.map((format) => (
                            <TabsTrigger key={format} value={format} className="px-2.5">
                              {format}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </Tabs>
                    </FieldRow>
                  )}
                </form.Field>
              )}
              {type === 'remote' && (
                <form.Field name="interval">
                  {(field) => (
                    <FieldRow label="更新间隔" htmlFor="rule-set-interval" wide>
                      <InputGroup className="bg-background">
                        <InputGroupInput
                          id="rule-set-interval"
                          value={field.state.value}
                          aria-invalid={invalid(field.state.meta)}
                          onChange={(event) => field.handleChange(event.target.value)}
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>小时</InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                    </FieldRow>
                  )}
                </form.Field>
              )}
              {type === 'remote' && (
                <form.Field name="client">
                  {(field) => (
                    <FieldRow label="下载方式" htmlFor="rule-set-client" wide>
                      <Select
                        items={clients}
                        value={field.state.value in clients ? field.state.value : ''}
                        onValueChange={(next) => field.handleChange(String(next ?? ''))}
                      >
                        <SelectTrigger id="rule-set-client" className="w-full bg-background data-placeholder:text-foreground">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(clients).map(([value, title]) => (
                            <SelectItem key={value} value={value}>
                              {title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
