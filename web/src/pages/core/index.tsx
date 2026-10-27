import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { profileQuery } from '@/lib/policy'
import { DnsTab } from '@/pages/core/dns'
import { ExperimentalTab, LogTab, NtpTab } from '@/pages/core/forms'
import { HttpClientsTab, ServicesTab } from '@/pages/core/services'

const TABS = { log: '日志', dns: 'DNS', ntp: 'NTP', http: 'HTTP 客户端', api: 'API', experimental: '实验性' }
type Tab = keyof typeof TABS

// the core settings of the profile in use, a tab for each object of the
// sing-box config the router uses, its settings shown at once
export function CorePage() {
  const profileResult = useQuery(profileQuery)
  const profile = profileResult.data
  const error = profileResult.error?.message
  const [tab, setTab] = useState<Tab>('log')

  // once for each failure, not again at each refetch failing as well
  useEffect(() => {
    if (error) toast.error(`读取配置失败：${error}`, { id: 'core-error' })
  }, [error])

  return (
    <div className="flex flex-col gap-5">
      <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)}>
        <TabsList className="max-w-full flex-wrap">
          {(Object.keys(TABS) as Tab[]).map((key) => (
            <TabsTrigger key={key} value={key}>
              {TABS[key]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === 'experimental' ? (
        <ExperimentalTab profile={profile} />
      ) : !profile ? (
        <div className="flex w-full max-w-[720px] flex-col gap-6">
          <Skeleton className="h-36 w-full rounded-lg" />
        </div>
      ) : tab === 'log' ? (
        <LogTab profile={profile} />
      ) : tab === 'dns' ? (
        <DnsTab profile={profile} />
      ) : tab === 'ntp' ? (
        <NtpTab profile={profile} />
      ) : tab === 'http' ? (
        <HttpClientsTab profile={profile} />
      ) : (
        <ServicesTab profile={profile} />
      )}
    </div>
  )
}
