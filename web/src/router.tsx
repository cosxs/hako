import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
  useRouter,
  type RouteComponent,
} from '@tanstack/react-router'
import { useEffect } from 'react'

import { AppShell } from '@/components/app-shell'
import { PAGES, type PagePath } from '@/lib/nav'
import { hasSession, onSessionExpired, returnPath, toLuci } from '@/lib/ubus'
import { PendingPage } from '@/pages/pending'

// a session that is no longer accepted sends the app to LuCI to log in,
// back to the page it was on after
function Root() {
  const router = useRouter()
  useEffect(() => onSessionExpired(() => toLuci(router.state.location.pathname)), [router])
  return <Outlet />
}

const rootRoute = createRootRoute({ component: Root })

// every page needs the session of LuCI: without one the app goes to LuCI,
// and waits there as it does
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ location }) => {
    if (hasSession()) return
    toLuci(location.pathname)
    await new Promise(() => {})
  },
  component: AppShell,
})

// the page the app was sent to LuCI from, else the first one
const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    const path = returnPath()
    throw redirect({ to: PAGES.find((page) => page.path === path)?.path ?? '/activity' })
  },
})

// a page of the sidebar, by its path, loaded when first shown; those not
// moved yet link to LuCI
function pageRoute<P extends PagePath>(path: P, component?: RouteComponent) {
  const page = PAGES.find((item) => item.path === path)!
  return createRoute({
    getParentRoute: () => appRoute,
    path,
    component: component ?? (() => <PendingPage page={page} />),
  })
}

const pageRoutes = [
  pageRoute('/activity', lazyRouteComponent(() => import('@/pages/activity'), 'ActivityPage')),
  pageRoute('/takeover', lazyRouteComponent(() => import('@/pages/takeover'), 'TakeoverPage')),
  pageRoute('/policy', lazyRouteComponent(() => import('@/pages/policy'), 'PolicyPage')),
  pageRoute('/rules', lazyRouteComponent(() => import('@/pages/rules'), 'RulesPage')),
  pageRoute('/core', lazyRouteComponent(() => import('@/pages/core'), 'CorePage')),
  pageRoute('/profiles', lazyRouteComponent(() => import('@/pages/profiles'), 'ProfilesPage')),
  pageRoute('/logs', lazyRouteComponent(() => import('@/pages/logs'), 'LogsPage')),
  pageRoute('/settings', lazyRouteComponent(() => import('@/pages/settings'), 'SettingsPage')),
] as const

const routeTree = rootRoute.addChildren([appRoute.addChildren([indexRoute, ...pageRoutes])])

// hash routes: the router's web server has no fallback to index.html, so a
// page reloaded at /hako/#/policy still finds the app
export const router = createRouter({ routeTree, history: createHashHistory() })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
