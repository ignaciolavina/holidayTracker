import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

const alertVariants = cva('relative flex gap-3 rounded-lg border p-3 text-sm', {
  variants: {
    variant: {
      default: 'bg-background text-foreground',
      info: 'border-primary/40 bg-primary/10 text-foreground',
      warning: 'border-orange-500/60 bg-warning text-warning-foreground',
      destructive: 'border-destructive/60 bg-destructive/10 text-destructive',
    },
  },
  defaultVariants: { variant: 'default' },
});
const icons = { default: Info, info: Info, warning: AlertTriangle, destructive: OctagonAlert };

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>, VariantProps<typeof alertVariants> {
  title?: React.ReactNode;
}
/** El icono acompaña siempre al color (SPEC-19: el color nunca es la única señal). */
export function Alert({ className, variant, title, children, ...props }: AlertProps) {
  const Icon = icons[variant ?? 'default'];
  return (
    <div role={variant === 'destructive' || variant === 'warning' ? 'alert' : 'status'} className={cn(alertVariants({ variant }), className)} {...props}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold leading-tight">{title}</p>}
        <div className={cn(title && 'mt-1')}>{children}</div>
      </div>
    </div>
  );
}
