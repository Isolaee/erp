import { clsx } from 'clsx';

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={clsx('inline-block h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600', className)} />
  );
}
