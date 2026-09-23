import type { ReactNode } from 'react';

/**
 * Un ecran vide est une invitation a agir, pas un constat. Il dit ce qui
 * manque, pourquoi, et propose la seule action qui fait avancer.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-line bg-surface px-6 py-12 text-center">
      <p className="font-display text-base font-semibold text-text">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-text-soft">{description}</p>
      {action !== undefined && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
