import { clsx } from 'clsx';

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

const variantClasses: Record<Variant, string> = {
  default:  'bg-gray-100 text-gray-700',
  success:  'bg-green-100 text-green-700',
  warning:  'bg-yellow-100 text-yellow-700',
  danger:   'bg-red-100 text-red-700',
  info:     'bg-blue-100 text-blue-700',
  muted:    'bg-gray-50 text-gray-400',
};

interface Props {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
}

export function Badge({ children, variant = 'default', className }: Props) {
  return (
    <span className={clsx('inline-flex items-center rounded px-2 py-0.5 text-xs font-medium', variantClasses[variant], className)}>
      {children}
    </span>
  );
}
