import type { ReactNode } from 'react'

import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { label, type Profile } from '@/lib/policy'
import { CONDITION_GROUPS, CONDITIONS, ruleSets, splitValues } from '@/lib/rules'
import { cn } from '@/lib/utils'
import { FieldRow, StackedField } from '@/pages/rules/form'

// a condition as a dialog edits it: its type, and its values as text, a
// comma between them; a choice is one of its values, a flag has none, and
// rule sets are chosen from those of the profile. In a section of rows, or
// stacked in a small dialog
export function ConditionFields({
  profile,
  id,
  type,
  value,
  invalid,
  stacked,
  // several conditions kept as they are, shown and not changed
  extra,
  onTypeChange,
  onValueChange,
}: {
  profile: Profile
  id: string
  type: string
  value: string
  invalid: boolean
  stacked?: boolean
  extra?: string
  onTypeChange: (type: string) => void
  onValueChange: (value: string) => void
}) {
  const groups = extra ? [...CONDITION_GROUPS, [extra]] : CONDITION_GROUPS
  const items = Object.fromEntries(groups.flat().map((key) => [key, key]))
  const condition = CONDITIONS[type]
  const multiple = type === 'multiple'
  const Wrap = ({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) =>
    stacked ? (
      <StackedField label={label} htmlFor={htmlFor}>
        {children}
      </StackedField>
    ) : (
      <FieldRow label={label} htmlFor={htmlFor}>
        {children}
      </FieldRow>
    )
  const surface = stacked ? '' : 'bg-background'
  const sets: Record<string, string> = Object.fromEntries(ruleSets(profile).map((set) => [set['.name'], label(set)]))
  const chosen = splitValues(type, value)

  return (
    <>
      {Wrap({
        label: '类型',
        htmlFor: `${id}-type`,
        children: (
          <Select items={items} value={type} disabled={multiple} onValueChange={(next) => onTypeChange(String(next))}>
            <SelectTrigger id={`${id}-type`} className={cn('w-full font-mono text-[13px]', surface)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-96">
              {groups.map((group, index) => (
                <SelectGroup key={group[0]}>
                  {index > 0 && <SelectSeparator />}
                  {group.map((key) => (
                    <SelectItem key={key} value={key} className="font-mono text-[13px]">
                      {key}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        ),
      })}
      {multiple
        ? Wrap({
            label: '条件',
            htmlFor: `${id}-value`,
            children: <Input id={`${id}-value`} value={value} disabled className={cn('font-mono text-[13px]', surface)} />,
          })
        : condition?.kind === 'set'
          ? Wrap({
              label: condition.label,
              htmlFor: `${id}-value`,
              children: (
                <Select multiple items={sets} value={chosen} onValueChange={(next) => onValueChange((next as string[]).join(', '))}>
                  <SelectTrigger id={`${id}-value`} aria-invalid={invalid} className={cn('w-full font-mono text-[13px]', surface)}>
                    <SelectValue className="min-w-0 truncate">{(values: string[]) => values.map((name) => sets[name] ?? name).join(', ')}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    {Object.entries(sets).map(([name, text]) => (
                      <SelectItem key={name} value={name} className="font-mono text-[13px]">
                        {text}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ),
            })
          : condition?.kind === 'choice'
            ? Wrap({
                label: condition.label,
                htmlFor: `${id}-value`,
                children: (
                  <Select
                    items={Object.fromEntries(condition.choices!.map((choice) => [choice, choice]))}
                    value={value}
                    onValueChange={(next) => onValueChange(String(next))}
                  >
                    <SelectTrigger id={`${id}-value`} aria-invalid={invalid} className={cn('w-full font-mono text-[13px]', surface)}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {condition.choices!.map((choice) => (
                        <SelectItem key={choice} value={choice} className="font-mono text-[13px]">
                          {choice}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ),
              })
            : condition?.kind === 'flag'
              ? null
              : Wrap({
                  label: condition?.label ?? '值',
                  htmlFor: `${id}-value`,
                  children: (
                    <Input
                      id={`${id}-value`}
                      value={value}
                      aria-invalid={invalid}
                      className={cn('font-mono text-[13px]', surface)}
                      onChange={(event) => onValueChange(event.target.value)}
                    />
                  ),
                })}
    </>
  )
}
