/**
 * Squelette de chargement. Il reprend la forme de ce qui arrive, pour que la
 * page ne saute pas quand le contenu se pose.
 *
 * Le battement est tres doux, et `prefers-reduced-motion` l'arrete depuis la
 * feuille de base.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-sm bg-line ${className}`} aria-hidden="true" />;
}

/** Le squelette d'un tableau, lignes et colonnes comprises. */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex gap-4 border-b border-line bg-raised px-4 py-2.5">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-16" />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex gap-4 border-b border-line px-4 py-3 last:border-b-0">
          <Skeleton className="h-3.5 w-52" />
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3.5 w-12" />
        </div>
      ))}
      <span className="sr-only">Chargement</span>
    </div>
  );
}
