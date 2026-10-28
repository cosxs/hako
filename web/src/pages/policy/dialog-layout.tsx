import type { ReactNode } from 'react'

import { Field, FieldContent, FieldLabel } from '@/components/ui/field'
import { cn } from '@/lib/utils'

// the sections and rows of the dialogs of groups and subscriptions, as those
// of the node dialog

// a section: a title over its rows
export function Section({ title, invalid, children }: { title: string; invalid?: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-0.5 text-[13px] font-semibold">{title}</h3>
      <div className={cn('divide-y overflow-hidden rounded-lg bg-muted px-3.5', invalid && 'ring-3 ring-destructive/20 outline outline-destructive')}>{children}</div>
    </section>
  )
}

// a row of a section: the label on the left, the control on the right
export function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <Field orientation="horizontal" className="items-center gap-4 py-2.5 has-[>[data-slot=field-content]]:items-center">
      <FieldContent className="min-w-0 gap-0.5">
        <FieldLabel htmlFor={htmlFor} className="truncate font-normal">
          {label}
        </FieldLabel>
      </FieldContent>
      {children}
    </Field>
  )
}
