import { queryOptions } from '@tanstack/react-query'

import { call } from '@/lib/ubus'

// the profiles, each a UCI package hako_<name> made from the template, and
// the one in use, through luci.hako

export type ProfileEntry = { name: string; title: string }

export const profilesQuery = queryOptions({
  queryKey: ['hako', 'profiles'],
  queryFn: () => call<{ profile: string; profiles: ProfileEntry[] }>('luci.hako', 'profiles'),
})

type Reply = { result: boolean; error?: string; output?: string; reloaded?: boolean; name?: string }

const ERRORS: Record<string, string> = {
  invalid_title: '配置名不能为空',
  exists: '已有同名的配置',
  write_failed: '无法写入配置',
  not_found: '找不到这个配置',
  in_use: '不能删除正在使用的配置',
  generate_failed: '无法生成这个配置',
  check_failed: '这个配置没有通过 sing-box 检查',
}

function failure(reply: Reply) {
  const text = (reply.error && ERRORS[reply.error]) || reply.error || '操作失败'
  return new Error(reply.output ? `${text}：${reply.output}` : text)
}

export async function createProfile(title: string) {
  const reply = await call<Reply>('luci.hako', 'profile_create', { title: title.trim() })
  if (!reply.result) throw failure(reply)
  return reply.name!
}

export async function deleteProfile(name: string) {
  const reply = await call<Reply>('luci.hako', 'profile_delete', { name })
  if (!reply.result) throw failure(reply)
}

// switches to a profile once its config passes the check; a running service
// is reloaded with it
export async function switchProfile(name: string) {
  const reply = await call<Reply>('luci.hako', 'profile_use', { name })
  if (!reply.result) throw failure(reply)
  return !!reply.reloaded
}

// the config a profile makes, with what the generator skipped
export async function viewProfile(name: string) {
  const reply = await call<{ content?: string; warnings?: string; error?: string }>('luci.hako', 'profile_view', { name })
  if (!reply.content) throw failure({ result: false, error: reply.error, output: reply.warnings })
  let content = reply.content
  try {
    content = JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    // shown as it is
  }
  return { content, warnings: reply.warnings ?? '' }
}
