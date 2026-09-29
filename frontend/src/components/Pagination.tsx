import { PAGE_SIZES, type PageSize } from '../lib/contacts';
import { Button } from './Button';

/** F-1012 : 25, 50 ou 100 lignes par page, avec le nombre total de resultats. */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: PageSize;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (taille: PageSize) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const debut = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const fin = Math.min(total, page * pageSize);

  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p className="text-text-soft" data-numeric aria-live="polite">
        {total === 0
          ? 'Aucun resultat'
          : `${debut.toLocaleString('fr-FR')} a ${fin.toLocaleString('fr-FR')} sur ${total.toLocaleString('fr-FR')}`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-text-soft">
          Lignes par page
          <select
            value={pageSize}
            onChange={(event) => {
              onPageSize(Number(event.target.value) as PageSize);
            }}
            className="rounded-sm border border-line-strong bg-surface px-2 py-1 text-text"
          >
            {PAGE_SIZES.map((taille) => (
              <option key={taille} value={taille}>
                {taille}
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={page <= 1}
          onClick={() => {
            onPage(page - 1);
          }}
          aria-label="Page precedente"
        >
          ‹
        </Button>
        <span className="text-text-soft" data-numeric>
          Page {page.toLocaleString('fr-FR')} sur {pages.toLocaleString('fr-FR')}
        </span>
        <Button
          disabled={page >= pages}
          onClick={() => {
            onPage(page + 1);
          }}
          aria-label="Page suivante"
        >
          ›
        </Button>
      </div>
    </nav>
  );
}
