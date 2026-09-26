import { useState } from 'react';
import {
  CRAWL_DEPTHS,
  DEPTH_OPTIONS,
  EMAIL_TYPE_LABELS,
  EMAIL_TYPES,
  parseTags,
  PROVIDER_LABELS,
  PROVIDERS,
  toggle,
  type ImportSettings,
} from '../lib/import-settings';

/**
 * Etape 4 du parcours : ce que MailFind cherche, jusqu'ou, et avec quels
 * fournisseurs payants.
 *
 * Chaque choix dit ce qu'il coute. Un reglage dont on ne voit pas la
 * consequence est un reglage qu'on laisse par defaut sans l'avoir compris.
 */
export function ImportSettingsForm({
  value,
  onChange,
}: {
  value: ImportSettings;
  onChange: (settings: ImportSettings) => void;
}) {
  // La saisie brute reste telle quelle pendant la frappe : la normaliser a
  // chaque touche avalerait la virgule que l'utilisateur vient de taper.
  const [saisie, setSaisie] = useState(value.tags.join(', '));

  return (
    <div className="space-y-8">
      <fieldset>
        <legend className="text-sm font-semibold">Profondeur de collecte</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {CRAWL_DEPTHS.map((profondeur) => {
            const choisie = value.depth === profondeur;
            return (
              <label
                key={profondeur}
                className={`cursor-pointer rounded-md border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${
                  choisie
                    ? 'border-accent bg-accent/5'
                    : 'border-line-strong bg-surface hover:bg-raised'
                }`}
              >
                <input
                  type="radio"
                  name="profondeur"
                  value={profondeur}
                  checked={choisie}
                  onChange={() => {
                    onChange({ ...value, depth: profondeur });
                  }}
                  className="sr-only"
                />
                <span className="font-medium">{DEPTH_OPTIONS[profondeur].label}</span>
                <span className="mt-1 block text-xs text-text-soft">
                  {DEPTH_OPTIONS[profondeur].description}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold">Adresses recherchees</legend>
        <p className="mt-1 text-xs text-text-faint">
          Les autres types trouves en chemin sont gardes, mais ne declenchent aucune recherche
          payante.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          {EMAIL_TYPES.map((type) => (
            <label key={type} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.emailTypes.includes(type)}
                onChange={() => {
                  onChange({ ...value, emailTypes: toggle(value.emailTypes, type, EMAIL_TYPES) });
                }}
                className="mt-0.5 accent-accent"
              />
              <span>
                {EMAIL_TYPE_LABELS[type].label}
                <span className="block font-mono text-xs text-text-faint">
                  {EMAIL_TYPE_LABELS[type].exemples}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold">Fournisseurs autorises</legend>
        <p className="mt-1 max-w-[70ch] text-xs text-text-faint">
          Le site de chaque entreprise est toujours explore : c&apos;est gratuit et c&apos;est la
          source principale. Decocher un fournisseur ne fait que renoncer a ce qu&apos;il aurait pu
          ajouter.
        </p>
        <div className="mt-3 space-y-2">
          {PROVIDERS.map((fournisseur) => (
            <label key={fournisseur} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.providers.includes(fournisseur)}
                onChange={() => {
                  onChange({
                    ...value,
                    providers: toggle(value.providers, fournisseur, PROVIDERS),
                  });
                }}
                className="mt-0.5 accent-accent"
              />
              <span>
                {PROVIDER_LABELS[fournisseur].label}
                <span className="block text-xs text-text-soft">
                  {PROVIDER_LABELS[fournisseur].description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="etiquettes" className="text-sm font-semibold">
          Etiquettes
        </label>
        <p className="mt-1 text-xs text-text-faint">
          Ajoutees a chaque entreprise de cet import, qu&apos;elle soit nouvelle ou deja dans la
          bibliotheque. Separees par des virgules.
        </p>
        <input
          id="etiquettes"
          type="text"
          value={saisie}
          onChange={(event) => {
            setSaisie(event.target.value);
            onChange({ ...value, tags: parseTags(event.target.value) });
          }}
          placeholder="salon 2026, lyon"
          className="mt-2 w-full max-w-md rounded-sm border border-line-strong bg-surface px-2.5 py-1.5 text-sm"
        />
        {value.tags.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Etiquettes appliquees">
            {value.tags.map((etiquette) => (
              <li
                key={etiquette}
                className="rounded-sm border border-line bg-raised px-1.5 py-0.5 text-xs text-text-soft"
              >
                {etiquette}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
