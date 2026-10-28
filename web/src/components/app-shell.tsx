import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useLocation } from '@tanstack/react-router'

import { Badge } from '@/components/reui/badge'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { modeName, statusQuery } from '@/lib/hako'
import { PAGES } from '@/lib/nav'

// the service at the foot of the sidebar: whether it runs, its mode and profile
function ServiceStatus() {
  const { data } = useQuery(statusQuery)
  if (!data) return null

  return (
    <div className="flex flex-col items-start gap-1 px-2">
      {data.running ? <Badge variant="success-light">运行中</Badge> : <Badge variant="outline">未运行</Badge>}
      <span className="text-xs text-muted-foreground">
        {[data.clash_api && modeName(data.clash_api.mode), data.profile_title].filter(Boolean).join(' · ')}
      </span>
    </div>
  )
}

export function AppShell() {
  const { pathname } = useLocation()
  const page = PAGES.find((item) => pathname.startsWith(item.path))

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="px-2 py-1.5 text-base font-semibold">Hako</div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {PAGES.map((item) => (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton isActive={item === page} render={<Link to={item.path} />}>
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <ServiceStatus />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="flex h-12 items-center gap-2 px-4 md:hidden">
          <SidebarTrigger />
        </header>
        <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-6 p-4 md:p-6">
          {page && <h1 className="text-2xl font-semibold">{page.label}</h1>}
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
