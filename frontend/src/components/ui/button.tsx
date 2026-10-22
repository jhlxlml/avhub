// Adapted from shadcn/ui radix-mira Button (MIT). Local source, no runtime CDN.
// Desktop hit targets are 32/36px instead of Mira's 28px default.
import type {ComponentProps} from 'react';
import {Slot} from '@radix-ui/react-slot';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '../../lib/utils';

export const buttonVariants = cva(
  'mira-button inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent text-xs font-medium select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {variants:{
    variant:{default:'mira-primary',outline:'mira-outline',secondary:'mira-secondary',ghost:'mira-ghost',destructive:'mira-destructive',link:'mira-link'},
    size:{default:'h-8 px-3',sm:'h-7 px-2',lg:'h-9 px-3',icon:'size-8 p-0'},
  },defaultVariants:{variant:'outline',size:'default'}},
);
export function Button({className,variant='outline',size='default',asChild=false,type='button',...props}:ComponentProps<'button'>&VariantProps<typeof buttonVariants>&{asChild?:boolean}) {
  const Comp=asChild?Slot:'button';
  return <Comp data-slot="button" data-variant={variant} data-size={size} type={asChild?undefined:type} className={cn(buttonVariants({variant,size}),className)} {...props}/>;
}
