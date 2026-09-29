import { useEffect, useRef } from 'react';

/**
 * Un filtre a choix multiples, replie dans un bouton. Un `details` natif : il
 * s'ouvre au clavier et se lit correctement par un lecteur d'ecran sans rien
 * reinventer. Il se referme au clic en dehors et sur Echap.
 */
export function MultiFilter<T extends string>({
  label,
  options,
  labels,
  selected,
  onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  selected: readonly string[];
  onChange: (valeurs: T[]) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const fermer = (event: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) {
        ref.current.open = false;
      }
    };
    const touche = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('mousedown', fermer);
    document.addEventListener('keydown', touche);
    return () => {
      document.removeEventListener('mousedown', fermer);
      document.removeEventListener('keydown', touche);
    };
  }, []);

  const actifs = options.filter((option) => selected.includes(option));

  return (
    <details ref={ref} className="relative">
      <summary
        className={`inline-flex cursor-pointer list-none items-center gap-1.5 rounded-sm border px-3 py-1.5 text-sm ${
          actifs.length > 0
            ? 'border-accent/60 bg-accent/5 text-text'
            : 'border-line-strong bg-surface text-text-soft'
        }`}
      >
        {label}
        {actifs.length > 0 && (
          <span className="rounded-sm bg-accent px-1 text-xs font-semibold text-accent-contrast">
            {actifs.length}
          </span>
        )}
        <span aria-hidden="true" className="text-xs">
          ▾
        </span>
      </summary>
      {/* Sur un telephone, le menu occupe la largeur de l'ecran : ancre sous un
          filtre place a droite, il en sortirait. */}
      <fieldset className="fixed inset-x-4 z-20 mt-1 rounded-md border border-line bg-surface p-2 shadow-lg sm:absolute sm:inset-x-auto sm:left-0 sm:w-60">
        <legend className="sr-only">{label}</legend>
        {options.map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-raised"
          >
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={(event) => {
                const suivants = event.target.checked
                  ? [...actifs, option]
                  : actifs.filter((valeur) => valeur !== option);
                onChange(suivants);
              }}
            />
            {labels[option]}
          </label>
        ))}
        {actifs.length > 0 && (
          <button
            type="button"
            className="mt-1 w-full rounded-sm px-2 py-1.5 text-left text-xs text-accent underline"
            onClick={() => {
              onChange([]);
            }}
          >
            Tout effacer
          </button>
        )}
      </fieldset>
    </details>
  );
}
