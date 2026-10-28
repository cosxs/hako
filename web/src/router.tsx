import { useQueryClient } from '@tanstack/react-query'
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
import { hasSession, logout, onSessionExpired } from '@/lib/ubus'
import { LoginPage } from '@/pages/login'
import { PendingPage } from '@/pages/pending'

// a session that is no longer accepted sends the app back to the login
function Root() {
  const router = useRouter()
  const queryClient = useQueryClient()

  useEffect(() => onSessionExpired(() => {
    queryClient.clear()
    router.navigate({ to: '/login', search: { redirect: router.state.location.pathname } })
  }), [router, queryClient])

  return <Outlet />
}

function Login() {
  const router = useRouter()
  const { redirect: to } = loginRoute.useSearch()
  return <LoginPage onLogin={() => router.history.push(to ?? '/')} />
}

function Shell() {
  const router = useRouter()
  const queryClient = useQueryClient()

  const leave = async () => {
    await logout()
    queryClient.clear()
    router.navigate({ to: '/login', search: {} })
  }

  return <AppShell onLogout={leave} />
}

const rootRoute = createRootRoute({ component: Root })

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' ? { redirect: search.redirect } : {},
  beforeLoad: () => {
    if (hasSession()) throw redirect({ to: '/' })
  },
  component: Login,
})

// every other page needs a session
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: ({ location }) => {
    if (!hasSession()) throw redirect({ to: '/login', search: { redirect: location.pathname } })
  },
  component: Shell,
})

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/activity' })
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
  pageRoute('/profiles'),
  pageRoute('/logs'),
  pageRoute('/settings', lazyRouteComponent(() => import('@/pages/settings'), 'SettingsPage')),
] as const

const routeTree = rootRoute.addChildren([loginRoute, appRoute.addChildren([indexRoute, ...pageRoutes])])

// hash routes: the router's web server has no fallback to index.html, so a
// page reloaded at /hako/#/policy still finds the app
export const router = createRouter({ routeTree, history: createHashHistory() })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
