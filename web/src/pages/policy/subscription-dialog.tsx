import { revalidateLogic, useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import {
  addSubscription,
  deleteSubscription,
  editSubscription,
  GROUP_TYPES,
  SubscriptionError,
  type Subscription,
  type SubscriptionValues,
} from '@/lib/policy'

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
// fields are checked on saving, and again as they change after that
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
    mutationFn: (values: SubscriptionValues) => (sub ? editSubscription(sub.name, values) : addSubscription(values)),
    onSuccess: (_result, values) => {
      toast.success(sub ? `已保存 ${values.title}` : `已添加 ${values.title}`)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onOpenChange(false)
    },
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

  const failure = mutation.error as SubscriptionError | null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{sub ? `订阅 » ${sub.tag}` : '订阅 » 新订阅'}</DialogTitle>
            <DialogDescription>{sub ? '改了地址或 User-Agent 会重新下载，下载失败则不保存。' : '先下载订阅，下载成功才保存。'}</DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <form.Field name="name">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="sub-name">名称</FieldLabel>
                    <Input id="sub-name" autoFocus placeholder="机场 A" value={field.state.value} aria-invalid={invalid} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>

            <div className="grid grid-cols-2 gap-4">
              <form.Field name="type">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="sub-type">类型</FieldLabel>
                    <Select items={GROUP_TYPES} value={field.state.value} onValueChange={(value) => field.handleChange(String(value))}>
                      <SelectTrigger id="sub-type" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(GROUP_TYPES).map(([value, text]) => (
                          <SelectItem key={value} value={value}>
                            {text}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>
              <form.Field name="prefix">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor="sub-prefix">节点名前缀</FieldLabel>
                      <form.Subscribe selector={(state) => state.values.name.trim()}>
                        {(name) => (
                          <Input id="sub-prefix" placeholder={name || '不填则用订阅名'} value={field.state.value} aria-invalid={invalid} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                        )}
                      </form.Subscribe>
                      {invalid && <FieldError errors={field.state.meta.errors} />}
                    </Field>
                  )
                }}
              </form.Field>
            </div>

            <form.Field name="url">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="sub-url">订阅地址</FieldLabel>
                    <Input id="sub-url" className="font-mono" placeholder="https://example.com/sing-box.json" value={field.state.value} aria-invalid={invalid} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>

            <div className="grid grid-cols-2 gap-4">
              <form.Field name="hours">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor="sub-hours">更新间隔</FieldLabel>
                      <InputGroup>
                        <InputGroupInput id="sub-hours" placeholder="24" value={field.state.value} aria-invalid={invalid} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>小时</InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                      {invalid ? <FieldError errors={field.state.meta.errors} /> : <FieldDescription>留空则只手动更新。</FieldDescription>}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field name="agent">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="sub-agent">User-Agent</FieldLabel>
                    <Input id="sub-agent" placeholder="sing-box/1.14 Hako/0.1" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                  </Field>
                )}
              </form.Field>
            </div>

            {failure && (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>{failure.message}</AlertTitle>
                <AlertDescription>
                  {sub ? '订阅保持原样。' : '订阅没有保存。'}
                  {failure.code === 'download_failed' && '检查订阅地址后重试。'}
                  {failure.output && <pre className="mt-2 max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap">{failure.output}</pre>}
                </AlertDescription>
              </Alert>
            )}
          </FieldGroup>

          <DialogFooter>
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

// deleting a subscription: what it downloaded goes too, and the groups that
// list it no longer do
export function DeleteSubscriptionDialog({ sub, onOpenChange }: { sub: Subscription | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (target: Subscription) => deleteSubscription(target.name),
    onSuccess: (_result, target) => {
      toast.success(`已删除 ${target.tag}`)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onOpenChange(false)
    },
    onError: (error: Error, target) => toast.error(`无法删除 ${target.tag}：${error.message}`),
  })

  return (
    <AlertDialog open={!!sub} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除订阅「{sub?.tag}」？</AlertDialogTitle>
          <AlertDialogDescription>订阅和它下载的节点都会删除，列出它的策略组也不再包含它。这一步不能撤销。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={mutation.isPending} onClick={() => sub && mutation.mutate(sub)}>
            {mutation.isPending && <Spinner />}
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
