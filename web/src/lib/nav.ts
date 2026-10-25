import {
  ActivityIcon,
  CpuIcon,
  FileStackIcon,
  ListFilterIcon,
  RouteIcon,
  ScrollTextIcon,
  SettingsIcon,
  WaypointsIcon,
  type LucideIcon,
} from 'lucide-react'

// the pages in the order of the sidebar; luci names the LuCI page each one
// replaces, still there while the app moves over
export type PagePath = '/activity' | '/takeover' | '/policy' | '/rules' | '/core' | '/profiles' | '/logs' | '/settings'

export type Page = {
  path: PagePath
  label: string
  icon: LucideIcon
  luci: string
}

export const PAGES: Page[] = [
  { path: '/activity', label: '活动', icon: ActivityIcon, luci: 'activity' },
  { path: '/takeover', label: '接管', icon: RouteIcon, luci: 'takeover' },
  { path: '/policy', label: '策略', icon: WaypointsIcon, luci: 'policy' },
  { path: '/rules', label: '规则', icon: ListFilterIcon, luci: 'rules' },
  { path: '/core', label: '内核设置', icon: CpuIcon, luci: 'core' },
  { path: '/profiles', label: '配置文件', icon: FileStackIcon, luci: 'profiles' },
  { path: '/logs', label: '日志', icon: ScrollTextIcon, luci: 'logs' },
  { path: '/settings', label: '设置', icon: SettingsIcon, luci: 'settings' },
]

export function luciUrl(page: Page) {
  return `/cgi-bin/luci/admin/services/hako/${page.luci}`
}
