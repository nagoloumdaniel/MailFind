import { useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { FileDrop } from '../components/FileDrop';
import {
  describeRow,
  FIELD_LABELS,
  freeColumns,
  KNOWN_FIELDS,
  mappingCanIdentify,
  suggestMapping,
  type KnownField,
  type Mapping,
} from '../lib/column-mapping';
import { readCsvFile, type CsvProblem, type ParsedCsv } from '../lib/csv';

/** Etape 3 du parcours : les dix premieres lignes, telles qu'elles seront traitees. */
const PREVIEW_ROWS = 10;

/** Le separateur se dit, il ne se montre pas : « , » ne se lit pas a l'ecran. */
function nomDuSeparateur(delimiter: string): string {
  if (delimiter === ';') return 'point-virgule';
  if (delimiter === '\t') return 'tabulation';
  if (delimiter === ',') return 'virgule';
  return `« ${delimiter} »`;
}

export function ImportPage() {
  const [fichier, setFichier] = useState<File | undefined>(undefined);
  const [lecture, setLecture] = useState(false);
  const [csv, setCsv] = useState<ParsedCsv | undefined>(undefined);
  const [probleme, setProbleme] = useState<CsvProblem | undefined>(undefined);
  const [mapping, setMapping] = useState<Mapping>([]);

  async function deposer(choisi: File) {
    setLecture(true);
    setProbleme(undefined);
    setCsv(undefined);
    setFichier(choisi);

    const resultat = await readCsvFile(choisi);
    if (resultat.ok) {
      setCsv(resultat.data);
      setMapping(suggestMapping(resultat.data.headers));
    } else {
      setProbleme(resultat.problem);
    }
    setLecture(false);
  }

  function changerColonne(index: number, champ: KnownField | null) {
    setMapping((actuel) =>
      actuel.map((existant, position) => {
        if (position === index) return champ;
        // Un champ ne peut etre porte que par une colonne : le donner a une
        // nouvelle le retire a l'ancienne, plutot que de laisser l'ecran
        // afficher deux fois la meme chose.
        if (champ !== null && existant === champ) return null;
        return existant;
      }),
    );
  }

  const apercu = useMemo(() => {
    if (csv === undefined) return [];
    return csv.rows
      .slice(0, PREVIEW_ROWS)
      .map((row, index) => describeRow(csv.headers, mapping, row, index + 2));
  }, [csv, mapping]);

  const rejetees = apercu.filter((ligne) => ligne.rejection !== undefined).length;
  const identifiable = mappingCanIdentify(mapping);
  const libres = csv === undefined ? [] : freeColumns(csv.headers, mapping);

  function recommencer() {
    setFichier(undefined);
    setCsv(undefined);
    setProbleme(undefined);
    setMapping([]);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Importer des entreprises</h1>
      <p className="mt-2 max-w-[70ch] text-sm text-text-soft">
        Un fichier, une entreprise par ligne. Un nom, un domaine, un site ou une page carrieres
        suffit : MailFind se charge de retrouver le reste.
      </p>

      {csv === undefined && (
        <div className="mt-8 max-w-[70ch]">
          <FileDrop onFile={(choisi) => void deposer(choisi)} disabled={lecture} />

          {lecture && (
            <p className="mt-4 text-sm text-text-soft" role="status">
              Lecture de {fichier?.name}
            </p>
          )}

          {probleme !== undefined && (
            <div
              role="alert"
              className="mt-4 rounded-sm border border-negative/40 bg-negative/5 px-3 py-2.5 text-sm"
            >
              <p className="font-medium text-negative">{fichier?.name}</p>
              <p className="mt-0.5 text-text-soft">{probleme.message}</p>
            </div>
          )}
        </div>
      )}

      {csv !== undefined && (
        <div className="mt-8 space-y-10">
          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold">Colonnes</h2>
              <p className="text-xs text-text-faint">
                {fichier?.name}, {csv.rows.length.toLocaleString('fr-FR')} lignes, lu en{' '}
                {csv.encoding === 'utf-8' ? 'UTF-8' : 'Windows-1252'}, separateur{' '}
                {nomDuSeparateur(csv.delimiter)}
              </p>
            </div>

            <p className="mt-2 max-w-[70ch] text-sm text-text-soft">
              Chaque colonne a ete rapprochee d&apos;un champ connu. Corrigez ce qui ne va pas. Les
              colonnes laissees sur « Attribut libre » sont conservees telles quelles et rendues a
              l&apos;export.
            </p>

            <div className="mt-4 overflow-hidden rounded-md border border-line bg-surface">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-raised text-xs text-text-faint">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left font-medium">
                      Colonne du fichier
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium">
                      Premiere valeur
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium">
                      Champ MailFind
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {csv.headers.map((header, index) => (
                    <tr
                      key={`${header}-${String(index)}`}
                      className="border-b border-line last:border-b-0"
                    >
                      <td className="px-4 py-2 font-medium">{header || <em>sans titre</em>}</td>
                      <td className="px-4 py-2 font-mono text-xs text-text-soft">
                        {csv.rows[0]?.[index] ?? ''}
                      </td>
                      <td className="px-4 py-2">
                        <label className="sr-only" htmlFor={`colonne-${String(index)}`}>
                          Champ pour la colonne {header}
                        </label>
                        <select
                          id={`colonne-${String(index)}`}
                          value={mapping[index] ?? ''}
                          onChange={(event) => {
                            changerColonne(
                              index,
                              event.target.value === '' ? null : (event.target.value as KnownField),
                            );
                          }}
                          className="w-56 rounded-sm border border-line-strong bg-surface px-2 py-1 text-sm"
                        >
                          <option value="">Attribut libre</option>
                          {KNOWN_FIELDS.map((champ) => (
                            <option key={champ} value={champ}>
                              {FIELD_LABELS[champ]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!identifiable && (
              <p
                role="alert"
                className="mt-3 rounded-sm border border-negative/40 bg-negative/5 px-3 py-2 text-sm text-negative"
              >
                Aucune colonne n&apos;identifie une entreprise. Designez au moins un nom
                d&apos;entreprise, un domaine, un site ou une page carrieres.
              </p>
            )}

            {libres.length > 0 && (
              <p className="mt-3 text-xs text-text-faint">
                Gardees comme attributs libres : {libres.join(', ')}.
              </p>
            )}
          </section>

          <section>
            <h2 className="text-base font-semibold">Apercu</h2>
            <p className="mt-2 max-w-[70ch] text-sm text-text-soft">
              Les {Math.min(PREVIEW_ROWS, csv.rows.length)} premieres lignes, telles qu&apos;elles
              seront traitees.{' '}
              {rejetees > 0 &&
                `${String(rejetees)} d'entre elles seront ecartees, leur motif est indique.`}
            </p>

            <div className="mt-4 overflow-x-auto rounded-md border border-line bg-surface">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-raised text-xs text-text-faint">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Ligne
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Entreprise
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Domaine ou site
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Ville
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Etat
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {apercu.map((ligne) => (
                    <tr key={ligne.line} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-2 text-xs text-text-faint" data-numeric>
                        {ligne.line}
                      </td>
                      <td className="px-3 py-2">{ligne.values.company_name ?? ''}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {ligne.values.domain ??
                          ligne.values.website_url ??
                          ligne.values.careers_url ??
                          ''}
                      </td>
                      <td className="px-3 py-2">{ligne.values.city ?? ''}</td>
                      <td className="px-3 py-2 text-xs">
                        {ligne.rejection === undefined ? (
                          <span className="text-text-soft">a traiter</span>
                        ) : (
                          <span className="text-negative">{ligne.rejection}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
            <Button tone="primary" disabled>
              Continuer
            </Button>
            <Button onClick={recommencer}>Choisir un autre fichier</Button>
            <p className="text-xs text-text-faint">
              Le reglage de l&apos;import et son lancement arrivent avec le prochain lot.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
