import { useRef, useState } from 'react';

/**
 * Zone de depot du fichier.
 *
 * Le glisser deposer ne suffit pas seul : il n'existe pas au clavier et il est
 * penible sur petit ecran. La zone est donc aussi un bouton, et l'element
 * `input` reste la source de verite, cache mais bien present.
 */
export function FileDrop({
  onFile,
  accept = '.csv,.tsv,text/csv,text/tab-separated-values',
  disabled = false,
}: {
  onFile: (file: File) => void;
  accept?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [survol, setSurvol] = useState(false);

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setSurvol(true);
      }}
      onDragLeave={() => {
        setSurvol(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setSurvol(false);
        if (disabled) return;
        const fichier = event.dataTransfer.files[0];
        if (fichier) onFile(fichier);
      }}
      className={`rounded-md border border-dashed px-6 py-12 text-center transition-colors ${
        survol ? 'border-accent bg-accent/5' : 'border-line bg-surface'
      }`}
    >
      <p className="font-display text-base font-semibold">Deposez votre fichier ici</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-text-soft">
        CSV ou TSV, 5 000 lignes et 5 Mo au plus. Le fichier est lu dans votre navigateur : rien
        n&apos;est envoye tant que vous n&apos;avez pas valide les colonnes.
      </p>

      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="mt-5 inline-flex items-center rounded-sm border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50"
      >
        Choisir un fichier
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(event) => {
          const fichier = event.target.files?.[0];
          if (fichier) onFile(fichier);
          // Remis a zero pour que redeposer le meme fichier declenche bien un
          // nouvel evenement.
          event.target.value = '';
        }}
      />
    </div>
  );
}
