import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlertIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

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

type Fields = { name: string; type: string; prefix: string; url: string; hours: string; agent: string }

// a new subscription, or one changed; open with sub null to add one. names
// are checked against the other subscriptions and the outbounds
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
  const [fields, setFields] = useState<Fields>({
    name: sub?.tag ?? '',
    type: sub?.type ?? 'selector',
    prefix: sub?.prefix ?? '',
    url: sub?.url ?? '',
    hours: intervalHours(sub?.update_interval),
    agent: sub?.user_agent ?? '',
  })
  // a field shows its error once changed or left, and all of them on saving
  const [touched, setTouched] = useState<Set<keyof Fields>>(new Set())
  const [submitted, setSubmitted] = useState(false)

  const others = subscriptions.filter((other) => other.name !== sub?.name)
  const prefixTaken = (value: string) => others.some((other) => (other.prefix || other.tag) === value)
  const name = fields.name.trim()
  const prefix = fields.prefix.trim()

  const errors: Partial<Record<keyof Fields, string>> = {}
  if (!name) errors.name = '请填写名称。'
  else if (others.some((other) => other.tag === name) || outboundTags.includes(name)) errors.name = '已有同名的订阅或出站。'
  else if (!prefix && prefixTaken(name)) errors.name = '另一个订阅的节点已用这个名字作前缀，请填写节点名前缀。'
  if (prefix && prefixTaken(prefix)) errors.prefix = '另一个订阅的节点已用这个前缀。'
  if (!/^https?:\/\/\S+$/.test(fields.url.trim())) errors.url = '请输入 http 或 https 开头的地址。'
  if (!/^(\d*|(\d+[smhd])+)$/.test(fields.hours.trim())) errors.hours = '请输入小时数，或 30m、1d 这样的时长。'

  const shown = (key: keyof Fields) => (touched.has(key) || submitted ? errors[key] : undefined)
  const set = (key: keyof Fields) => (value: string) => {
    setFields((current) => ({ ...current, [key]: value }))
    setTouched((current) => new Set(current).add(key))
  }
  const leave = (key: keyof Fields) => () => setTouched((current) => new Set(current).add(key))

  const mutation = useMutation({
    mutationFn: (values: SubscriptionValues) => (sub ? editSubscription(sub.name, values) : addSubscription(values)),
    onSuccess: () => {
      toast.success(sub ? `已保存 ${name}` : `已添加 ${name}`)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onOpenChange(false)
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length) return

    mutation.mutate({
      title: name,
      type: fields.type,
      prefix,
      url: fields.url.trim(),
      update_interval: intervalValue(fields.hours),
      user_agent: fields.agent.trim(),
    })
  }

  const failure = mutation.error as SubscriptionError | null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{sub ? `订阅 » ${sub.tag}` : '订阅 » 新订阅'}</DialogTitle>
            <DialogDescription>{sub ? '改了地址或 User-Agent 会重新下载，下载失败则不保存。' : '先下载订阅，下载成功才保存。'}</DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Field data-invalid={!!shown('name')}>
              <FieldLabel htmlFor="sub-name">名称</FieldLabel>
              <Input id="sub-name" autoFocus placeholder="机场 A" value={fields.name} aria-invalid={!!shown('name')} onChange={(event) => set('name')(event.target.value)} onBlur={leave('name')} />
              {shown('name') && <FieldError>{shown('name')}</FieldError>}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="sub-type">类型</FieldLabel>
                <Select items={GROUP_TYPES} value={fields.type} onValueChange={(value) => set('type')(String(value))}>
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
              <Field data-invalid={!!shown('prefix')}>
                <FieldLabel htmlFor="sub-prefix">节点名前缀</FieldLabel>
                <Input id="sub-prefix" placeholder={name || '不填则用订阅名'} value={fields.prefix} aria-invalid={!!shown('prefix')} onChange={(event) => set('prefix')(event.target.value)} onBlur={leave('prefix')} />
                {shown('prefix') && <FieldError>{shown('prefix')}</FieldError>}
              </Field>
            </div>

            <Field data-invalid={!!shown('url')}>
              <FieldLabel htmlFor="sub-url">订阅地址</FieldLabel>
              <Input id="sub-url" className="font-mono" placeholder="https://example.com/sing-box.json" value={fields.url} aria-invalid={!!shown('url')} onChange={(event) => set('url')(event.target.value)} onBlur={leave('url')} />
              {shown('url') && <FieldError>{shown('url')}</FieldError>}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field data-invalid={!!shown('hours')}>
                <FieldLabel htmlFor="sub-hours">更新间隔</FieldLabel>
                <InputGroup>
                  <InputGroupInput id="sub-hours" placeholder="24" value={fields.hours} aria-invalid={!!shown('hours')} onChange={(event) => set('hours')(event.target.value)} onBlur={leave('hours')} />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>小时</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                {shown('hours') ? <FieldError>{shown('hours')}</FieldError> : <FieldDescription>留空则只手动更新。</FieldDescription>}
              </Field>
              <Field>
                <FieldLabel htmlFor="sub-agent">User-Agent</FieldLabel>
                <Input id="sub-agent" placeholder="sing-box/1.14 Hako/0.1" value={fields.agent} onChange={(event) => set('agent')(event.target.value)} />
              </Field>
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
