import { cn } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-950/30 text-emerald-400 border-emerald-900/40',
  completed: 'bg-emerald-950/30 text-emerald-400 border-emerald-900/40',
  inactive: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  maintenance: 'bg-amber-950/30 text-amber-400 border-amber-900/40',
  pending: 'bg-amber-950/30 text-amber-400 border-amber-900/40',
  cancelled: 'bg-red-950/30 text-red-400 border-red-900/40',
  offline: 'bg-red-950/30 text-red-400 border-red-900/40',
  stale: 'bg-red-950/30 text-red-400 border-red-900/40',
};

interface BadgeProps {
  status: string;
  className?: string;
}

export function Badge({ status, className }: BadgeProps) {
  const normStatus = status.toLowerCase();
  const colorClass = STATUS_COLORS[normStatus] || 'bg-slate-100 text-slate-600 border-slate-200';

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border',
        colorClass,
        className
      )}
    >
      {status.toUpperCase()}
    </span>
  );
}
export default Badge;
