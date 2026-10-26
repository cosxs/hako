import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { Alert, AlertTitle } from '@/components/reui/alert'
import { profileQuery, subscriptionsQuery } from '@/lib/policy'
import { ModeSwitch } from '@/pages/policy/mode-switch'
import { preloadDialogs } from '@/pages/policy/dialog-loaders'
import { PolicyRuntimeProvider } from '@/pages/policy/runtime'
import { GroupsSection, NodesSection, SubscriptionsSection } from '@/pages/policy/sections'

// the outbound mode, then the nodes, groups and subscriptions as tiles; a
// tile opens its menu
export function PolicyPage() {
  const profile = useQuery(profileQuery)
  const subscriptions = useQuery(subscriptionsQuery)
  const error = profile.error ?? subscriptions.error

  // the dialogs come after the page, in the background
  useEffect(preloadDialogs, [])

  return (
    <PolicyRuntimeProvider>
      <ModeSwitch />
      {error && (
        <Alert variant="destructive">
          <AlertTitle>读取配置失败：{error.message}</AlertTitle>
        </Alert>
      )}
      <div className="flex flex-col gap-9">
        <NodesSection profile={profile.data} subscriptions={subscriptions.data} />
        <GroupsSection profile={profile.data} subscriptions={subscriptions.data} />
        <SubscriptionsSection profile={profile.data} subscriptions={subscriptions.data} />
      </div>
    </PolicyRuntimeProvider>
  )
}
