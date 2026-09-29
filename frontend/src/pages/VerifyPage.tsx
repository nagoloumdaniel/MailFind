import { useMemo, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { ApiError } from '../lib/api';
import { decodeCsv, MAX_FILE_BYTES } from '../lib/csv';
import { EMAIL_STATUS_LABELS, STATUS_TONES, type EmailStatus } from '../lib/imports';
import {
  checkAddresses,
  extractAddresses,
  ONE_OFF_MAX,
  resultsToCsv,
  type OneOffResult,
} from '../lib/one-off';

/** Ordre du resume : ce qui est a ecarter d'abord. */
const ORDRE: EmailStatus[] = ['invalid', 'disposable', 'suppressed', 'risky', 'unverified'];

/**
 * Verification ponctuelle (F-705) : une liste collee ou un CSV d'adresses
 * seules, sans entreprise. Les controles gratuits seulement, et rien n'est
 * enregistre : la page rend un verdict, pas une bibliotheque.
 */
export function VerifyPage() {
  const [saisie, setSaisie] = useState('');
  const [fichier, setFichier] = useState<string | undefined>(undefined);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const [resultats, setResultats] = useState<OneOffResult[] | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);

  const adresses = useMemo(() => extractAddresses(saisie), [saisie]);
  const trop = adresses.length > ONE_OFF_MAX;

  async function lireFichier(file: File) {
    setErreur(undefined);
    if (file.size > MAX_FILE_BYTES) {
      setErreur('Fichier trop lourd : 5 Mo au plus.');
      return;
    }
    const { text } = decodeCsv(await file.arrayBuffer());
    // Les cellules d'un CSV sont separees par des virgules, des points-virgules
    // ou des tabulations : la meme lecture que pour un texte colle.
    setSaisie(text);
    setFichier(file.name);
    setResultats(undefined);
  }

  async function verifier() {
    setEnvoi(true);
    setErreur(undefined);
    try {
      setResultats(await checkAddresses(adresses));
    } catch (error) {
      setErreur(error instanceof ApiError ? error.message : "La verification n'a pas abouti.");
    } finally {
      setEnvoi(false);
    }
  }

  function telecharger() {
    if (resultats === undefined) return;
    const blob = new Blob([resultsToCsv(resultats, EMAIL_STATUS_LABELS)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = 'verification-mailfind.csv';
    lien.click();
    URL.revokeObjectURL(url);
  }

  const comptes = new Map<EmailStatus, number>();
  for (const r of resultats ?? []) comptes.set(r.status, (comptes.get(r.status) ?? 0) + 1);

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold">Verifier des adresses</h1>
      <p className="mt-2 max-w-[70ch] text-sm text-text-soft">
        Collez une liste d&apos;adresses ou choisissez un CSV, {ONE_OFF_MAX.toLocaleString('fr-FR')}{' '}
        adresses au plus. Chacune passe les controles gratuits : syntaxe, existence du domaine,
        serveur de messagerie, domaine jetable, messagerie grand public et votre liste de
        suppression. La boite elle-meme n&apos;est pas interrogee : aucune adresse n&apos;est donc
        dite valide ici, et rien n&apos;est enregistre.
      </p>

      <label className="mt-6 block text-sm">
        <span className="font-medium">Adresses</span>
        <textarea
          value={saisie}
          onChange={(event) => {
            setSaisie(event.target.value);
            setFichier(undefined);
            setResultats(undefined);
          }}
          rows={8}
          placeholder={'recrutement@entreprise.fr\nrh@autre-entreprise.fr'}
          className="mt-1.5 block w-full rounded-sm border border-line-strong bg-surface px-2.5 py-2 font-mono text-sm text-text"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <Button onClick={() => input.current?.click()} disabled={envoi}>
          Choisir un CSV
        </Button>
        <input
          ref={input}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          className="sr-only"
          onChange={(event) => {
            const choisi = event.target.files?.[0];
            if (choisi) void lireFichier(choisi);
            event.target.value = '';
          }}
        />
        {fichier !== undefined && <span className="text-text-faint">{fichier}</span>}
        <span className={trop ? 'text-negative' : 'text-text-soft'} data-numeric>
          {adresses.length.toLocaleString('fr-FR')} adresse{adresses.length > 1 ? 's' : ''} reconnue
          {adresses.length > 1 ? 's' : ''}
          {trop && `, ${ONE_OFF_MAX.toLocaleString('fr-FR')} au plus`}
        </span>
      </div>

      <div className="mt-4">
        <Button
          tone="primary"
          disabled={envoi || adresses.length === 0 || trop}
          onClick={() => void verifier()}
        >
          {envoi ? 'Verification en cours' : 'Verifier'}
        </Button>
      </div>

      {erreur !== undefined && (
        <p role="alert" className="mt-3 text-sm text-negative">
          {erreur}
        </p>
      )}

      {resultats !== undefined && (
        <section className="mt-10" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold">Resultat</h2>
            <Button onClick={telecharger}>Telecharger en CSV</Button>
          </div>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {ORDRE.filter((statut) => (comptes.get(statut) ?? 0) > 0).map((statut) => (
              <div key={statut}>
                <dt className="text-xs text-text-faint">{EMAIL_STATUS_LABELS[statut]}</dt>
                <dd className={`text-lg font-semibold ${STATUS_TONES[statut]}`} data-numeric>
                  {(comptes.get(statut) ?? 0).toLocaleString('fr-FR')}
                </dd>
              </div>
            ))}
          </dl>
          <div className="relative mt-4 overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b border-line bg-raised text-xs text-text-faint">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Adresse
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Statut
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Motif
                  </th>
                </tr>
              </thead>
              <tbody>
                {resultats.map((r) => (
                  <tr key={r.input} className="border-b border-line align-top last:border-b-0">
                    <td className="px-4 py-2 font-mono break-all">{r.address ?? r.input}</td>
                    <td className={`px-4 py-2 ${STATUS_TONES[r.status]}`}>
                      {EMAIL_STATUS_LABELS[r.status]}
                    </td>
                    <td className="px-4 py-2 text-text-soft">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
