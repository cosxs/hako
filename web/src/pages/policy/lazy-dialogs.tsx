import { lazy } from 'react'

import { loaders } from '@/pages/policy/dialog-loaders'

export const NodeDialog = lazy(() => loaders.node().then((module) => ({ default: module.NodeDialog })))
export const GroupDialog = lazy(() => loaders.group().then((module) => ({ default: module.GroupDialog })))
export const SubscriptionDialog = lazy(() => loaders.subscription().then((module) => ({ default: module.SubscriptionDialog })))
