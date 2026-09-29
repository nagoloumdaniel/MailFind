import { useEffect, useId, useRef, useState } from 'react';
import { formatPoints, readBreakdown, SCORE_CRITERION_LABELS, scoreTone } from '../lib/score';

const TONS = {
  high: 'border-accent bg-accent/10 text-accent-strong',
  medium: 'border-caution/60 text-caution',
  low: 'border-line-strong text-text-soft',
} as const;

/** Largeur du detail, en pixels : il ne doit pas deborder de l'ecran. */
const LARGEUR = 288;
/** Hauteur d'un detail de cinq lignes environ, pour choisir de l'ouvrir en haut ou en bas. */
const HAUTEUR_MIN = 240;

/**
 * Le score et, au survol ou au focus, son calcul critere par critere (6.9).
 * Le detail est celui que le serveur a enregistre : ses lignes font le score,
 * et un detail qui ne tombe pas juste est signale plutot que maquille.
 *
 * Le detail est en position fixe : le tableau defile horizontalement sur un
 * petit ecran, et son conteneur couperait une bulle positionnee dedans.
 */
export function ScoreBadge({ score, breakdown }: { score: number | null; breakdown: unknown }) {
  const id = useId();
  const bouton = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<
    { top?: number; bottom?: number; left: number } | undefined
  >(undefined);

  // La position est calculee a l'ouverture : au defilement, la bulle se ferme
  // plutot que de rester en place a cote d'une autre ligne.
  useEffect(() => {
    if (position === undefined) return;
    const fermer = () => {
      setPosition(undefined);
    };
    const touche = (event: KeyboardEvent) => {
      if (event.key === 'Escape') fermer();
    };
    window.addEventListener('scroll', fermer, true);
    window.addEventListener('resize', fermer);
    window.addEventListener('keydown', touche);
    return () => {
      window.removeEventListener('scroll', fermer, true);
      window.removeEventListener('resize', fermer);
      window.removeEventListener('keydown', touche);
    };
  }, [position]);

  if (score === null) {
    return <span className="text-xs text-text-faint">en attente</span>;
  }
  const detail = readBreakdown(breakdown, score);

  function ouvrir() {
    const rect = bouton.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const left = Math.max(8, Math.min(rect.right - LARGEUR, window.innerWidth - LARGEUR - 8));
    // Pas la place en dessous : la bulle s'ouvre au-dessus du score.
    if (window.innerHeight - rect.bottom < HAUTEUR_MIN) {
      setPosition({ bottom: window.innerHeight - rect.top + 4, left });
    } else {
      setPosition({ top: rect.bottom + 4, left });
    }
  }

  function fermer() {
    setPosition(undefined);
  }

  // Le conteneur relatif garde la bulle fermee, positionnee en absolu par
  // `sr-only`, dans le tableau : sinon elle deborderait de la page.
  return (
    <span className="relative inline-block">
      <button
        ref={bouton}
        type="button"
        aria-describedby={id}
        aria-expanded={position !== undefined}
        onMouseEnter={ouvrir}
        onMouseLeave={fermer}
        onFocus={ouvrir}
        onBlur={fermer}
        onClick={() => {
          if (position === undefined) ouvrir();
          else fermer();
        }}
        className={`inline-flex min-w-10 justify-center rounded-sm border px-1.5 py-0.5 text-xs font-semibold ${TONS[scoreTone(score)]}`}
        data-numeric
      >
        {score}
        <span className="sr-only"> sur 100</span>
      </button>
      <span
        id={id}
        role="tooltip"
        style={
          position === undefined
            ? undefined
            : {
                ...(position.top === undefined ? {} : { top: position.top }),
                ...(position.bottom === undefined ? {} : { bottom: position.bottom }),
                left: position.left,
                width: LARGEUR,
              }
        }
        // Fermee, la bulle reste lisible par un lecteur d'ecran mais sort de la
        // mise en page : en position fixe, elle agrandirait la page.
        className={
          position === undefined
            ? 'sr-only'
            : 'fixed z-20 block rounded-md border border-line bg-surface p-3 text-left text-xs text-text shadow-lg'
        }
      >
        <span className="block font-semibold">Calcul du score</span>
        {detail === undefined || detail.lines.length === 0 ? (
          <span className="mt-1 block text-text-soft">Aucun critere ne s&apos;applique.</span>
        ) : (
          <span className="mt-2 block space-y-1">
            {detail.lines.map((ligne, index) => (
              <span
                key={`${ligne.criterion}-${String(index)}`}
                className="flex justify-between gap-3"
              >
                <span className="text-text-soft">{SCORE_CRITERION_LABELS[ligne.criterion]}</span>
                <span className="font-mono" data-numeric>
                  {formatPoints(ligne.points)}
                </span>
              </span>
            ))}
          </span>
        )}
        <span className="mt-2 flex justify-between gap-3 border-t border-line pt-2 font-semibold">
          <span>Score</span>
          <span className="font-mono" data-numeric>
            {score} / 100
          </span>
        </span>
        {detail !== undefined && !detail.complete && (
          <span className="mt-2 block text-caution">
            Le detail enregistre ne correspond pas au score : recalcul a la prochaine verification.
          </span>
        )}
      </span>
    </span>
  );
}
