// the dialogs that edit, with the form, zod and the sortable list they take,
// loaded apart from the page: when the page is idle, or on opening one

export const loaders = {
  node: () => import('@/pages/policy/node-dialog'),
  group: () => import('@/pages/policy/group-dialog'),
  subscription: () => import('@/pages/policy/subscription-dialog'),
}

// fetches them ahead, so a dialog opens at once
export function preloadDialogs() {
  const load = () => Object.values(loaders).forEach((loader) => loader().catch(() => {}))
  if ('requestIdleCallback' in window) window.requestIdleCallback(load)
  else setTimeout(load, 1000)
}
