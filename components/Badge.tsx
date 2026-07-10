import { cn } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800 border-green-200',
  inactive: 'bg-slate-100 text-slate-600 border-slate-200',
  maintenance: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  completed: 'bg-blue-100 text-blue-800 border-blue-200',
  pending: 'bg-orange-100 text-orange-800 border-orange-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200',
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
