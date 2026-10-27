import { revalidateLogic, useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { effectToast, untilApplied } from '@/lib/hako'
import { label, type Profile, type Subscription } from '@/lib/policy'
import { domainResolvers, httpClients, outboundChoices, routeValues, saveRoute, type RouteValues } from '@/lib/rules'
import { FieldRow, FieldSection, OutboundSelect, SwitchRow } from '@/pages/rules/form'

// the route of the profile besides its rules and rule sets, as sing-box has
// it: where what matches no rule goes, and what the router needs to route.
// Saved together, as the settings page is
export function RouteSettings({ profile, subscriptions }: { profile: Profile; subscriptions: Subscription[] }) {
  const values = routeValues(profile, subscriptions)
  // a form of the route read, again once it is saved
  return <RouteForm key={JSON.stringify(values)} profile={profile} subscriptions={subscriptions} values={values} />
}

function RouteForm({ profile, subscriptions, values }: { profile: Profile; subscriptions: Subscription[]; values: RouteValues }) {
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: (next: RouteValues) => untilApplied(() => saveRoute(profile, next)),
    onSuccess: ({ effect }) => {
      effectToast('已保存路由设置', effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
    },
    onError: (error: Error) => toast.error(`保存失败：${error.message}`),
  })

  // the empty choice is sing-box's own: the first http client, when there is one
  const clients: Record<string, string> = Object.fromEntries([
    ['', httpClients(profile).length ? '第一个 HTTP 客户端' : '未定义 HTTP 客户端'],
    ...httpClients(profile).map((client) => [client['.name'], label(client)]),
  ])
  const resolvers: Record<string, string> = Object.fromEntries(domainResolvers(profile).map((server) => [server['.name'], label(server)]))
  // one set that is none of them stays a choice
  if (values.domainResolver && !(values.domainResolver in resolvers)) resolvers[values.domainResolver] = values.domainResolver

  const form = useForm({
    defaultValues: values,
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        final: z.string().min(1),
        findNeighbor: z.boolean(),
        leaseFiles: z.string().refine((text) => text.split(/[\s,]+/).every((file) => !file || file.startsWith('/'))),
        httpClient: z.string(),
        domainResolver: z.string(),
      }),
    },
    onSubmit: ({ value }) => save.mutate(value),
  })

  const invalid = (meta: { isTouched: boolean; isValid: boolean }) => meta.isTouched && !meta.isValid

  return (
    <form
      noValidate
      className="flex w-full max-w-[720px] flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        form.handleSubmit()
      }}
    >
      <FieldSection title="路由">
        <form.Field name="final">
          {(field) => (
            <FieldRow label="默认出站" htmlFor="route-final" wide>
              <OutboundSelect
                id="route-final"
                choices={outboundChoices(profile, subscriptions, values.final, false)}
                value={field.state.value}
                invalid={invalid(field.state.meta)}
                onChange={field.handleChange}
              />
            </FieldRow>
          )}
        </form.Field>
        <form.Field name="findNeighbor">
          {(field) => <SwitchRow id="route-find-neighbor" label="邻居解析" checked={field.state.value} onCheckedChange={field.handleChange} />}
        </form.Field>
        <form.Field name="leaseFiles">
          {(field) => (
            <FieldRow label="DHCP 租约文件" htmlFor="route-lease-files" wide>
              <Input
                id="route-lease-files"
                value={field.state.value}
                aria-invalid={invalid(field.state.meta)}
                className="bg-background font-mono text-[13px]"
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </FieldRow>
          )}
        </form.Field>
        <form.Field name="httpClient">
          {(field) => (
            <FieldRow label="默认 HTTP 客户端" htmlFor="route-http-client" wide>
              <Select
                items={clients}
                value={field.state.value in clients ? field.state.value : ''}
                onValueChange={(next) => field.handleChange(String(next ?? ''))}
              >
                <SelectTrigger id="route-http-client" className="w-full bg-background data-placeholder:text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(clients).map(([value, text]) => (
                    <SelectItem key={value} value={value}>
                      {text}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          )}
        </form.Field>
        <form.Field name="domainResolver">
          {(field) => (
            <FieldRow label="默认域名解析服务器" htmlFor="route-domain-resolver" wide>
              <Select items={resolvers} value={field.state.value || null} onValueChange={(next) => field.handleChange(String(next ?? ''))}>
                <SelectTrigger id="route-domain-resolver" className="w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(resolvers).map(([value, text]) => (
                    <SelectItem key={value} value={value}>
                      {text}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
