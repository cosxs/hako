import type { ReactNode } from 'react'

import { Field, FieldContent, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { ChoiceGroup } from '@/lib/rules'
import { cn } from '@/lib/utils'

// the pieces the rule dialogs are made of, as the node dialog lays them out:
// sections of rows on a muted card, each row its label and then its control;
// the small dialogs put the label above the field, as the subscription one

export function FieldSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-0.5 text-[13px] font-semibold">{title}</h3>
      <div className="divide-y rounded-lg bg-muted px-3.5">{children}</div>
    </section>
  )
}

export function FieldRow({ label, htmlFor, children, wide }: { label: string; htmlFor?: string; children: ReactNode; wide?: boolean }) {
  return (
    <Field orientation="horizontal" className="items-center gap-4 py-2.5 has-[>[data-slot=field-content]]:items-center">
      <FieldContent className="min-w-0 gap-0.5">
        <FieldLabel htmlFor={htmlFor} className="font-normal">
          {label}
        </FieldLabel>
      </FieldContent>
      <div className={cn('shrink-0', wide ? 'w-2/3' : 'w-[56%]')}>{children}</div>
    </Field>
  )
}

// a field with its label above it, in a small dialog
export function StackedField({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <Field>
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
    </Field>
  )
}

export function SwitchRow({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <Field orientation="horizontal" className="items-center gap-4 py-2.5 has-[>[data-slot=field-content]]:items-center">
      <FieldContent className="min-w-0 gap-0.5">
        <FieldLabel htmlFor={id} className="font-normal">
          {label}
        </FieldLabel>
      </FieldContent>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </Field>
  )
}

// the outbound of a rule: DIRECT and REJECT first, then the nodes, the
// groups and the subscriptions
export function OutboundSelect({
  id,
  choices,
  value,
  invalid,
  onChange,
}: {
  id: string
  choices: ChoiceGroup[]
  value: string
  invalid?: boolean
  onChange: (value: string) => void
}) {
  const items = Object.fromEntries(choices.flatMap((group) => group.items))
  return (
    <Select items={items} value={value in items ? value : null} onValueChange={(next) => onChange(String(next ?? ''))}>
      <SelectTrigger id={id} aria-invalid={invalid} className="w-full bg-background">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {choices.map((group, index) => (
          <SelectGroup key={group.title || index}>
            {index > 0 && <SelectSeparator />}
            {group.title && <SelectLabel>{group.title}</SelectLabel>}
            {group.items.map(([item, text]) => (
              <SelectItem key={item} value={item}>
                {text}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
