import { useEffect, useState } from 'react';
import {
  ALL_EMAIL_TYPE_LABELS,
  EMAIL_STATUS_LABELS,
  fetchImportEmails,
  ORIGIN_LABELS,
  type EmailStatus,
  type ImportEmail,
} from '../lib/imports';
import { ScoreBadge } from './ScoreBadge';
import { TableSkeleton } from './Skeleton';

/**
 * Seul `valid` porte la couleur de l'accent : un autre statut n'est jamais
 * presente comme verifie (regle du depot).
 */
const TONS_STATUT: Record<EmailStatus, string> = {
  valid: 'text-accent',
  accept_all: 'text-caution',
  risky: 'text-caution',
  unknown: 'text-text-soft',
  invalid: 'text-negative',
  disposable: 'text-negative',
  suppressed: 'text-negative',
  unverified: 'text-text-soft',
};

/** Une URL de page n'est un lien que si elle est en http ou https (S-06). */
function lienSur(url: string | null): string | undefined {
  if (url === null) return undefined;
  try {
    const lue = new URL(url);
    return lue.protocol === 'http:' || lue.protocol === 'https:' ? lue.toString() : undefined;
  } catch {
    return undefined;
  }
}

function Source({ source }: { source: ImportEmail['source'] }) {
  if (source === null) return <span className="text-text-faint">aucune</span>;
  const lien = lienSur(source.url);
  if (source.kind === 'website' && lien !== undefined) {
    return (
      <a
        href={lien}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="break-all text-accent underline"
      >
        {new URL(lien).pathname === '/' ? new URL(lien).hostname : new URL(lien).pathname}
      </a>
    );
  }
  if (source.kind === 'provider') return <span>{source.provider ?? 'fournisseur'}</span>;
  if (source.kind === 'deduction') return <span>regle de deduction</span>;
  return <span>{source.kind}</span>;
}

/**
 * Les adresses d'un import, avec leur statut, leur score et sa raison. La
 * liste suit l'ordre des exports : par entreprise, recrutement d'abord, puis
 * par score.
 */
export function ImportEmails({ importId, version }: { importId: string; version: string }) {
  const [etat, setEtat] = useState<
    { emails: ImportEmail[]; truncated: boolean } | 'erreur' | undefined
  >(undefined);

  useEffect(() => {
    let actif = true;
    fetchImportEmails(importId)
      .then((resultat) => {
        if (actif) setEtat(resultat);
      })
      .catch(() => {
        if (actif) setEtat('erreur');
      });
    return () => {
      actif = false;
    };
  }, [importId, version]);

  if (etat === undefined) {
    return (
      <section className="mt-10" aria-label="Adresses">
        <h2 className="text-base font-semibold">Adresses</h2>
        <div className="mt-4">
          <TableSkeleton rows={3} />
        </div>
      </section>
    );
  }
  if (etat === 'erreur') {
    return (
      <section className="mt-10">
        <h2 className="text-base font-semibold">Adresses</h2>
        <p className="mt-2 text-sm text-caution">La liste des adresses n&apos;a pas pu etre lue.</p>
      </section>
    );
  }
  if (etat.emails.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="text-base font-semibold">Adresses</h2>
      <p className="mt-1 max-w-[70ch] text-sm text-text-soft">
        Chaque adresse garde sa source et son statut. Survolez ou selectionnez un score pour voir
        son calcul, critere par critere. Seul le statut « Valide » dit qu&apos;une boite a ete
        confirmee.
      </p>
      <div className="mt-4 overflow-x-auto rounded-md border border-line bg-surface">
        {/* Une largeur minimale : sur un telephone, le tableau defile plutot que d'ecraser ses colonnes. */}
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="border-b border-line bg-raised text-xs text-text-faint">
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-medium">
                Entreprise
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium">
                Adresse
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium">
                Type
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium">
                Statut
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium">
                Source
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Score
              </th>
            </tr>
          </thead>
          <tbody>
            {etat.emails.map((email) => (
              <tr key={email.id} className="border-b border-line align-top last:border-b-0">
                <td className="px-4 py-2 text-text-soft">{email.companyName}</td>
                <td className="px-4 py-2">
                  <span className="font-mono">{email.address}</span>
                  <span className="block text-xs text-text-faint">
                    {ORIGIN_LABELS[email.origin]}
                    {email.origin === 'deduced' && email.status !== 'valid' && ', non confirmee'}
                  </span>
                </td>
                <td className="px-4 py-2">{ALL_EMAIL_TYPE_LABELS[email.type] ?? email.type}</td>
                <td className="px-4 py-2">
                  <span className={TONS_STATUT[email.status]}>
                    {EMAIL_STATUS_LABELS[email.status]}
                  </span>
                  {email.verificationReason !== null && (
                    <span className="block text-xs text-text-faint">
                      {email.verificationReason}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs">
                  <Source source={email.source} />
                </td>
                <td className="px-4 py-2 text-right">
                  <ScoreBadge score={email.score} breakdown={email.scoreBreakdown} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {etat.truncated && (
        <p className="mt-2 text-xs text-text-faint">
          Les {etat.emails.length.toLocaleString('fr-FR')} premieres adresses. La liste complete
          viendra avec la page Contacts.
        </p>
      )}
    </section>
  );
}
