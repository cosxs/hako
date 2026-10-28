import { revalidateLogic, useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { effectToast, untilApplied } from '@/lib/hako'
import {
  addSubscription,
  editSubscription,
  GROUP_TYPES,
  SubscriptionError,
  type Subscription,
  type SubscriptionValues,
} from '@/lib/policy'
import { cn } from '@/lib/utils'
import { Row, Section } from '@/pages/policy/dialog-layout'

// an update interval as hours, as the dialog takes it; another duration is
// shown as it is
function intervalHours(interval?: string) {
  const match = /^(\d+)h$/.exec(interval ?? '')
  return match ? match[1] : (interval ?? '')
}

// hours are kept as a sing-box duration; none, or 0, updates by hand only
function intervalValue(hours: string) {
  const value = hours.trim()
  if (!/^\d+$/.test(value)) return value
  return Number(value) > 0 ? `${value}h` : ''
}

// names are checked against the other subscriptions and the outbounds
function subscriptionSchema(others: Subscription[], outboundTags: string[]) {
  const prefixTaken = (value: string) => others.some((other) => (other.prefix || other.tag) === value)
  return z
    .object({
      name: z
        .string()
        .trim()
        .min(1, '请填写名称。')
        .refine((value) => !others.some((other) => other.tag === value) && !outboundTags.includes(value), '已有同名的订阅或出站。'),
      type: z.string(),
      prefix: z
        .string()
        .trim()
        .refine((value) => !value || !prefixTaken(value), '另一个订阅的节点已用这个前缀。'),
      url: z
        .string()
        .trim()
        .regex(/^https?:\/\/\S+$/, '请输入 http 或 https 开头的地址。'),
      hours: z
        .string()
        .trim()
        .regex(/^(\d*|(\d+[smhd])+)$/, '请输入小时数，或 30m、1d 这样的时长。'),
      agent: z.string(),
    })
    .refine((value) => value.prefix.trim() || !prefixTaken(value.name.trim()), {
      path: ['name'],
      message: '另一个订阅的节点已用这个名字作前缀，请填写节点名前缀。',
    })
}

// a new subscription, or one changed; open with sub null to add one. the
// fields are checked on saving, and again as they change after that; a
// field in error shows only as such, without a message
export function SubscriptionDialog({
  open,
  sub,
  subscriptions,
  outboundTags,
  onOpenChange,
}: {
  open: boolean
  sub: Subscription | null
  subscriptions: Subscription[]
  outboundTags: string[]
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const others = subscriptions.filter((other) => other.name !== sub?.name)

  const mutation = useMutation({
    mutationFn: (values: SubscriptionValues) => untilApplied(() => (sub ? editSubscription(sub.name, values) : addSubscription(values))),
    onSuccess: ({ effect }, values) => {
      effectToast(sub ? `已保存 ${values.title}` : `已添加 ${values.title}`, effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onOpenChange(false)
    },
    onError: (error: SubscriptionError) =>
      toast.error(error.message, {
        description: [sub ? '订阅保持原样。' : '订阅没有保存。', error.code === 'download_failed' && '检查订阅地址后重试。', error.output]
          .filter(Boolean)
          .join(' '),
      }),
  })

  const form = useForm({
    defaultValues: {
      name: sub?.tag ?? '',
      type: sub?.type ?? 'selector',
      prefix: sub?.prefix ?? '',
      url: sub?.url ?? '',
      hours: intervalHours(sub?.update_interval),
      agent: sub?.user_agent ?? '',
    },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: subscriptionSchema(others, outboundTags) },
    onSubmit: ({ value }) =>
      mutation.mutate({
        title: value.name.trim(),
        type: value.type,
        prefix: value.prefix.trim(),
        url: value.url.trim(),
        update_interval: intervalValue(value.hours),
        user_agent: value.agent.trim(),
      }),
  })

  // a text field of a row, its width as in the node dialog
  const text = (name: 'name' | 'prefix' | 'url' | 'agent', id: string, width: string, props: { autoFocus?: boolean; mono?: boolean; placeholder?: string } = {}) => (
    <form.Field name={name}>
      {(field) => (
        <div className={cn('shrink-0', width)}>
          <Input
            id={id}
            autoFocus={props.autoFocus}
            placeholder={props.placeholder}
            className={cn('bg-background', props.mono && 'font-mono')}
            value={field.state.value}
            aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
          />
        </div>
      )}
    </form.Field>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* as the node dialog: two columns of sections between the title and
          the buttons */}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]">
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
        >
          <DialogHeader className="border-b px-6 pt-5 pb-3.5">
            <DialogTitle>{sub ? '编辑订阅' : '新增订阅'}</DialogTitle>
            <DialogDescription className="sr-only">{sub ? '改了地址或 User-Agent 会重新下载，下载失败则不保存。' : '先下载订阅，下载成功才保存。'}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid items-start gap-6 sm:grid-cols-2">
              <Section title="基本信息">
                <Row label="名称" htmlFor="sub-name">
                  {text('name', 'sub-name', 'w-[56%]', { autoFocus: true })}
                </Row>
                <form.Field name="type">
                  {(field) => (
                    <Row label="类型" htmlFor="sub-type">
                      <Tabs value={field.state.value} onValueChange={(value) => field.handleChange(String(value))}>
                        <TabsList id="sub-type" className="bg-input/70">
                          {Object.entries(GROUP_TYPES).map(([value, name]) => (
                            <TabsTrigger key={value} value={value} className="px-2.5">
                              {name}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </Tabs>
                    </Row>
                  )}
                </form.Field>
                <form.Subscribe selector={(state) => state.values.name}>
                  {(name) => (
                    <Row label="节点名前缀" htmlFor="sub-prefix">
                      {text('prefix', 'sub-prefix', 'w-[56%]', { placeholder: name.trim() || '订阅名' })}
                    </Row>
                  )}
                </form.Subscribe>
              </Section>

              <Section title="下载">
                <Row label="订阅地址" htmlFor="sub-url">
                  {text('url', 'sub-url', 'w-2/3', { mono: true })}
                </Row>
                <form.Field name="hours">
                  {(field) => (
                    <Row label="更新间隔" htmlFor="sub-hours">
                      <div className="w-2/5 shrink-0">
                        <InputGroup className="bg-background">
                          <InputGroupInput
                            id="sub-hours"
                            placeholder="手动"
                            value={field.state.value}
                            aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                          />
                          <InputGroupAddon align="inline-end">
                            <InputGroupText>小时</InputGroupText>
                          </InputGroupAddon>
                        </InputGroup>
                      </div>
                    </Row>
                  )}
                </form.Field>
                <Row label="User-Agent" htmlFor="sub-agent">
                  {text('agent', 'sub-agent', 'w-2/3')}
                </Row>
              </Section>
            </div>
          </div>

          <DialogFooter className="border-t px-6 py-3.5">
            <DialogClose render={<Button type="button" variant="outline" />}>取消</DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Spinner />}
              {sub ? '保存' : '下载并保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
