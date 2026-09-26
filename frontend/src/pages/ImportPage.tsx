import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/Button';
import { FileDrop } from '../components/FileDrop';
import { ImportSettingsForm } from '../components/ImportSettingsForm';
import { ApiError } from '../lib/api';
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
import { defaultSettings, settingsProblem, type ImportSettings } from '../lib/import-settings';
import { createImport } from '../lib/imports';

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
  const [reglages, setReglages] = useState<ImportSettings>(defaultSettings);
  const [envoi, setEnvoi] = useState(false);
  const [refus, setRefus] = useState<string | undefined>(undefined);
  const navigate = useNavigate();

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

  // Sur tout le fichier, pas seulement l'apercu : le bouton de lancement dit
  // combien de lignes partent vraiment. Cinq mille lignes se decrivent en
  // quelques millisecondes.
  const ecarteesAuTotal = useMemo(() => {
    if (csv === undefined) return 0;
    return csv.rows.filter(
      (row, index) => describeRow(csv.headers, mapping, row, index + 2).rejection !== undefined,
    ).length;
  }, [csv, mapping]);
  const identifiable = mappingCanIdentify(mapping);
  const libres = csv === undefined ? [] : freeColumns(csv.headers, mapping);

  function recommencer() {
    setFichier(undefined);
    setCsv(undefined);
    setProbleme(undefined);
    setMapping([]);
    setRefus(undefined);
  }

  const obstacle = !identifiable
    ? "Designez d'abord une colonne qui identifie l'entreprise."
    : settingsProblem(reglages);
  const aTraiter = csv === undefined ? 0 : csv.rows.length - ecarteesAuTotal;

  async function lancer() {
    if (csv === undefined || fichier === undefined || obstacle !== undefined) return;
    setEnvoi(true);
    setRefus(undefined);
    try {
      const cree = await createImport({
        filename: fichier.name,
        headers: csv.headers,
        mapping,
        rows: csv.rows,
        settings: reglages,
      });
      await navigate(`/imports/${cree.id}`);
    } catch (error) {
      setRefus(
        error instanceof ApiError
          ? (error.detail ?? error.title)
          : "L'import n'a pas pu etre envoye. Verifiez la connexion et reessayez.",
      );
      setEnvoi(false);
    }
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

            {/* Defilement horizontal et non coupure : sur un telephone, la
                colonne des champs depasse l'ecran, et coupee elle devenait
                impossible a atteindre. `relative` retient aussi les libelles
                reserves aux lecteurs d'ecran, qui sinon elargissaient la page. */}
            <div className="relative mt-4 overflow-x-auto rounded-md border border-line bg-surface">
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
                          className="w-44 rounded-sm border border-line-strong bg-surface px-2 py-1 text-sm sm:w-56"
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

          <section>
            <h2 className="text-base font-semibold">Parametres</h2>
            <p className="mt-2 mb-5 max-w-[70ch] text-sm text-text-soft">
              Ils s&apos;appliquent a toutes les entreprises de ce fichier et ne changent plus une
              fois l&apos;import lance.
            </p>
            <ImportSettingsForm value={reglages} onChange={setReglages} />
          </section>

          <div className="border-t border-line pt-6">
            {refus !== undefined && (
              <p
                role="alert"
                className="mb-4 rounded-sm border border-negative/40 bg-negative/5 px-3 py-2 text-sm text-negative"
              >
                {refus}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                tone="primary"
                disabled={obstacle !== undefined || aTraiter === 0 || envoi}
                onClick={() => void lancer()}
              >
                {envoi ? 'Envoi en cours' : "Lancer l'import"}
              </Button>
              <Button onClick={recommencer} disabled={envoi}>
                Choisir un autre fichier
              </Button>
              <p className="text-xs text-text-soft" aria-live="polite">
                {obstacle ??
                  `${aTraiter.toLocaleString('fr-FR')} lignes a traiter${
                    ecarteesAuTotal > 0
                      ? `, ${ecarteesAuTotal.toLocaleString('fr-FR')} ecartees avec leur motif`
                      : ''
                  }. Le traitement continue si vous quittez la page.`}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
