import { ExternalLinkIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { luciUrl, type Page } from '@/lib/nav'

// a page that has not moved to the app yet: its LuCI page does the work
export function PendingPage({ page }: { page: Page }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>还在迁移</CardTitle>
        <CardDescription>「{page.label}」页还没有搬到新界面，暂时请在 LuCI 里操作。</CardDescription>
        <CardAction>
          <Button variant="outline" nativeButton={false} render={<a href={luciUrl(page)} />}>
            <ExternalLinkIcon />
            在 LuCI 中打开
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  )
}
