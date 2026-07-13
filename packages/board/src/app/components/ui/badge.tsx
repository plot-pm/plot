import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils.js';

const badgeVariants = cva(
  // No whitespace-nowrap: long sprint/story values must wrap instead of
  // propping the card (and the whole page) open on mobile. overflow-wrap:anywhere
  // collapses an unbroken slug's min-content so grid/flex ancestors can shrink.
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium max-w-full [overflow-wrap:anywhere]',
  {
    variants: {
      variant: {
        neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
        feature: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
        bug: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
        docs: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
        infra: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
        sprint: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
        story: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: ReactNode;
  className?: string;
}

export function Badge({ variant, className, children }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)}>{children}</span>;
}

/** Map a plan type string to a badge variant, falling back to neutral. */
export function typeVariant(type: string): NonNullable<BadgeProps['variant']> {
  switch (type) {
    case 'feature':
    case 'bug':
    case 'docs':
    case 'infra':
      return type;
    default:
      return 'neutral';
  }
}
