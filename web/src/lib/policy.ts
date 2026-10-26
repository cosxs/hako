import { queryOptions } from '@tanstack/react-query'

import { getConfig, getSection, type UciSection } from '@/lib/uci'
import { call } from '@/lib/ubus'

// what the policy page shows: the groups and nodes of the profile in use, its
// subscriptions, and the outbounds of the running sing-box

export const GROUP_TYPES: Record<string, string> = {
  selector: '手动选择',
  urltest: '自动测速',
}

// the node types the generator supports
export const NODE_TYPES: Record<string, string> = {
  shadowsocks: 'Shadowsocks',
  vmess: 'VMess',
  vless: 'VLESS',
  trojan: 'Trojan',
  hysteria2: 'Hysteria2',
  tuic: 'TUIC',
  anytls: 'AnyTLS',
  naive: 'NaiveProxy',
  snell: 'Snell',
  ssh: 'SSH',
  socks: 'SOCKS',
  http: 'HTTP',
  direct: 'Direct',
}

export function isGroup(section: UciSection) {
  return typeof section.type === 'string' && section.type in GROUP_TYPES
}

export function label(section: UciSection) {
  return (section.tag as string) || section['.name']
}

export type Profile = {
  // the UCI package of the profile in use
  config: string
  // the outbound mode chosen, as main.mode or else the default of the clash API
  mode: string
  outbounds: UciSection[]
  // the group the Global mode sends everything to, by section name
  globalGroup: string | null
}

export const profileQuery = queryOptions({
  queryKey: ['hako', 'profile'],
  queryFn: async (): Promise<Profile> => {
    const main = await getSection('hako', 'main')
    const clashApi = await getSection('hako', 'clash_api').catch(() => null)
    const config = `hako_${main.profile || 'default'}`
    const sections = await getConfig(config)
    const outbounds = sections.filter((section) => section['.type'] === 'outbound')

    // the outbound of the route rule of the Global mode
    const rule = sections.find((section) => section['.type'] === 'route_rule' && String(section.clash_mode ?? '').toLowerCase() === 'global')
    const ref = rule?.outbound as string | undefined
    const global = ref ? (outbounds.find((section) => section['.name'] === ref) ?? outbounds.find((section) => section.tag === ref)) : undefined

    return {
      config,
      mode: String(main.mode ?? clashApi?.default_mode ?? ''),
      outbounds,
      globalGroup: global?.['.name'] ?? null,
    }
  },
})

export type SubscriptionNode = {
  // the name the node has in sing-box, with the prefix of its subscription
  tag: string
  // the name in the download
  name?: string
  type: string
  server?: string
  server_port?: number
}

export type Subscription = {
  name: string
  tag: string
  type: string
  prefix?: string
  url?: string
  update_interval?: string
  user_agent?: string
  last_update: number | null
  last_error?: string
  enabled: boolean
  downloaded: boolean
  nodes: SubscriptionNode[]
}

export const subscriptionsQuery = queryOptions({
  queryKey: ['hako', 'subscriptions'],
  queryFn: async () => (await call<{ subscriptions?: Subscription[] }>('luci.hako', 'subscriptions')).subscriptions ?? [],
})

// the outbounds of the running sing-box, from its clash API
export type Runtime =
  | { available: false; reason: string }
  | {
      available: true
      names: string[]
      groups: Record<string, { type: string; now: string; all: string[] }>
      delays: Record<string, number>
    }

export const runtimeQuery = queryOptions({
  queryKey: ['hako', 'outbounds'],
  queryFn: () => call<Runtime>('luci.hako', 'outbounds'),
  refetchInterval: 5000,
})

export async function selectOutbound(group: string, outbound: string) {
  const result = await call<{ result: boolean }>('luci.hako', 'select', { group, outbound })
  if (!result.result) throw new Error(`无法切换 ${group} 的出站`)
}

// tests the members of a group at once: the delays of those that answered
export async function testGroup(group: string) {
  const result = await call<{ result: boolean; error?: string; delays?: Record<string, number> }>('luci.hako', 'delay', { group })
  if (!result.result) throw new Error(result.error ?? `无法测试 ${group} 的延迟`)
  return result.delays ?? {}
}

const SUBSCRIPTION_ERRORS: Record<string, string> = {
  invalid_title: '请填写名称',
  exists: '已有同名的订阅或出站',
  prefix_exists: '另一个订阅的节点已用这个前缀',
  invalid_prefix: '节点名前缀无效',
  invalid_type: '类型无效',
  invalid_url: '请输入 http 或 https 开头的地址',
  invalid_interval: '更新间隔无效',
  invalid_user_agent: 'User-Agent 无效',
  not_found: '订阅不存在',
  download_failed: '下载失败',
  invalid_json: '下载的内容不是 JSON 配置',
  check_failed: 'sing-box 检查失败',
  busy: '另一个更新正在进行，请稍后再试',
  write_failed: '无法保存订阅',
  update_failed: '更新失败',
  generate_failed: '无法生成配置',
}

export class SubscriptionError extends Error {
  code?: string
  // what sing-box or the download said, when there is more to show
  output?: string

  constructor(message: string, code?: string, output?: string) {
    super(message)
    this.code = code
    this.output = output
  }
}

type SubscriptionReply = { result: boolean; error?: string; output?: string; changed?: boolean; reloaded?: boolean }

function subscriptionResult(reply: SubscriptionReply) {
  if (reply.result) return reply

  const code = reply.error ?? ''
  const message = SUBSCRIPTION_ERRORS[code] ?? (code || '保存失败')
  // each line starts with the subscription's internal name, as in
  // "default/sub_1792…: download failed: HTTP error 404"
  const output = (reply.output ?? '').replace(/^\S+: /gm, '').trim()
  // a failed download says why on its one line: that goes in the title
  const reason = /^download failed: (.+)$/.exec(output)?.[1].replace(/^HTTP error (\d+)$/, 'HTTP $1')
  if (reason) throw new SubscriptionError(`${message}：${reason}`, code)
  throw new SubscriptionError(message, code, output || undefined)
}

export type SubscriptionValues = {
  title: string
  type: string
  prefix: string
  url: string
  update_interval: string
  user_agent: string
}

// a new subscription, downloaded first and saved only when that works
export async function addSubscription(values: SubscriptionValues) {
  return subscriptionResult(await call<SubscriptionReply>('luci.hako', 'subscription_add', values))
}

// a subscription changed: downloaded again when its URL or User-Agent changed,
// and left as it was when that fails
export async function editSubscription(name: string, values: SubscriptionValues) {
  return subscriptionResult(await call<SubscriptionReply>('luci.hako', 'subscription_edit', { name, ...values }))
}

// the groups that list it no longer do
export async function deleteSubscription(name: string) {
  return subscriptionResult(await call<SubscriptionReply>('luci.hako', 'subscription_delete', { name }))
}

// downloads a subscription again; changed tells whether its nodes changed
export async function updateSubscription(name: string) {
  const result = await call<{ result: boolean; error?: string; changed?: boolean; reloaded?: boolean }>('luci.hako', 'subscription_update', { name })
  if (!result.result) throw new Error(SUBSCRIPTION_ERRORS[result.error ?? ''] ?? result.error ?? '更新失败')
  return { changed: !!result.changed, reloaded: !!result.reloaded }
}

// a member of a subscription's group as the group shows it: without the
// prefix its subscription gives it
export function shortName(sub: Subscription | undefined, name: string) {
  const prefix = sub ? `${sub.prefix || sub.tag} · ` : null
  return prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name
}

// when a subscription was last updated, as a time ago
export function ago(time: number) {
  const seconds = Math.max(0, Date.now() / 1000 - time)
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  return `${Math.floor(seconds / 86400)} 天前`
}
