import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

export function Avatar({ name, url, className }: { name: string; url?: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" className={cn('h-8 w-8 rounded-full object-cover', className)} />
  ) : (
    <span aria-hidden className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold', className)}>
      {initials(name)}
    </span>
  );
}
