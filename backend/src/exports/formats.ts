import ExcelJS from 'exceljs';
import type { ExportCompany, ExportData, ExportEmail, ExportSource } from './data.js';
import type { ExportRequest } from './request.js';

/**
 * Les formats de la section 6.11, en fonctions pures : un jeu de donnees en
 * entree, un fichier en sortie. Rien n'y touche la base.
 */

/** F-1105 : l'indicateur UTF-8 qu'Excel attend pour lire les accents. */
const BOM = '﻿';

/**
 * S-07 : une valeur venue d'une page ou d'un fichier est hostile. Une cellule
 * qui commence comme une formule est precedee d'une apostrophe, que le
 * tableur affiche comme du texte.
 */
export function neutralize(valeur: string): string {
  return /^[=+\-@\t\r]/.test(valeur) ? `'${valeur}` : valeur;
}

function cellule(valeur: string | number | null | undefined, separateur: string): string {
  if (valeur === null || valeur === undefined) return '';
  const texte = typeof valeur === 'number' ? String(valeur) : neutralize(valeur);
  return /["\r\n]/.test(texte) || texte.includes(separateur)
    ? `"${texte.replaceAll('"', '""')}"`
    : texte;
}

function csv(lignes: (string | number | null | undefined)[][], separateur: string): string {
  return `${BOM}${lignes.map((ligne) => ligne.map((v) => cellule(v, separateur)).join(separateur)).join('\r\n')}\r\n`;
}

const date = (d: Date | string | null) =>
  d === null ? null : (typeof d === 'string' ? new Date(d) : d).toISOString();

/** La source qui figure dans les colonnes d'une ligne : la plus verifiable, deja en tete. */
function premiere(email: ExportEmail): ExportSource | undefined {
  return email.sources[0];
}

/** Annexe B, dans l'ordre. */
export const EMAIL_COLUMNS = [
  'company_id',
  'company_name',
  'domain',
  'website_url',
  'careers_url',
  'siren',
  'city',
  'country',
  'industry',
  'company_tags',
  'email',
  'email_type',
  'origin',
  'verification_status',
  'verification_reason',
  'verified_at',
  'score',
  'source_kind',
  'source_url',
  'provider',
  'discovered_at',
  'email_tags',
  'notes',
] as const;

function ligneAdresse(c: ExportCompany, e: ExportEmail): (string | number | null)[] {
  const source = premiere(e);
  return [
    c.id,
    c.name,
    c.domain,
    c.websiteUrl,
    c.careersUrl,
    c.siren,
    c.city,
    c.country,
    c.industry,
    c.tags.join(', '),
    e.address,
    e.type,
    e.origin,
    e.status,
    e.verificationReason,
    date(e.verifiedAt),
    e.score,
    source?.kind ?? null,
    source?.url ?? null,
    source?.provider ?? null,
    source === undefined ? null : date(source.discoveredAt),
    e.tags.join(', '),
    c.notes,
  ];
}

/** CSV « une ligne par adresse » : colonnes de l'entreprise, puis de l'adresse. */
export function csvEmails(data: ExportData, separateur: string): string {
  const lignes: (string | number | null)[][] = [[...EMAIL_COLUMNS]];
  for (const c of data.companies) for (const e of c.emails) lignes.push(ligneAdresse(c, e));
  return csv(lignes, separateur);
}

/**
 * CSV « une ligne par entreprise » : la meilleure adresse, puis celles de
 * chaque type recherche, separees par des points-virgules dans la cellule.
 */
export function csvCompanies(data: ExportData, separateur: string): string {
  const lignes: (string | number | null)[][] = [
    [
      ...EMAIL_COLUMNS.slice(0, 10),
      'best_email',
      'recruitment_emails',
      'hr_emails',
      'generic_emails',
    ],
  ];
  for (const c of data.companies) {
    const deType = (type: string) =>
      c.emails
        .filter((e) => e.type === type)
        .map((e) => e.address)
        .join('; ');
    lignes.push([
      c.id,
      c.name,
      c.domain,
      c.websiteUrl,
      c.careersUrl,
      c.siren,
      c.city,
      c.country,
      c.industry,
      c.tags.join(', '),
      // Les adresses sont deja dans l'ordre de 6.11 : la premiere est la meilleure.
      c.emails[0]?.address ?? null,
      deType('recruitment'),
      deType('hr'),
      deType('generic'),
    ]);
  }
  return csv(lignes, separateur);
}

/**
 * La regle d'adresse de Campaign Mailer (`backend/src/services/contactImport.ts`,
 * `normaliseEmail`), recopiee pour que le fichier s'importe sans une ligne
 * refusee : ASCII, partie locale de 64 caracteres, domaine a au moins deux
 * etiquettes, domaine de premier niveau en lettres.
 */
export function campaignMailerAccepts(adresse: string): boolean {
  const valeur = adresse.trim().toLowerCase();
  if (valeur.length === 0 || valeur.length > 254) return false;
  const parties = valeur.split('@');
  if (parties.length !== 2) return false;
  const [locale = '', domaine = ''] = parties;
  if (locale.length === 0 || locale.length > 64 || domaine.length === 0) return false;
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}$/.test(locale)) return false;
  if (locale.startsWith('.') || locale.endsWith('.') || locale.includes('..')) return false;
  const etiquettes = domaine.split('.');
  if (etiquettes.length < 2) return false;
  const conformes = etiquettes.every(
    (e) =>
      e.length > 0 &&
      e.length <= 63 &&
      /^[a-z0-9-]+$/.test(e) &&
      !e.startsWith('-') &&
      !e.endsWith('-'),
  );
  // Le domaine de premier niveau : des lettres seulement, de 2 a 24.
  return conformes && /^[a-z]{2,24}$/.test(etiquettes.at(-1) ?? '');
}

/** La civilite par defaut d'une adresse sans nom de contact, celle de l'exemple de 6.12. */
export const DEFAULT_SALUTATION = 'Madame, Monsieur';

/**
 * CSV Campaign Mailer : les quatre colonnes que son import reconnait d'elles-
 * memes. Une adresse n'y figure qu'une fois (Campaign Mailer refuserait le
 * doublon), et celles qu'il refuserait, ou qui commencent comme une formule,
 * n'y figurent pas : elles sont comptees a part.
 */
export function campaignMailerCsv(data: ExportData): {
  content: string;
  skipped: number;
  rows: number;
} {
  const vues = new Set<string>();
  const lignes: (string | null)[][] = [['email', 'contact_name', 'company_name', 'salutation']];
  let skipped = 0;
  for (const c of data.companies) {
    for (const e of c.emails) {
      const adresse = e.address.trim().toLowerCase();
      if (vues.has(adresse)) continue;
      if (!campaignMailerAccepts(adresse) || neutralize(adresse) !== adresse) {
        skipped += 1;
        continue;
      }
      vues.add(adresse);
      lignes.push([
        adresse,
        e.contactName,
        c.name,
        e.salutation ?? (e.contactName === null ? DEFAULT_SALUTATION : null),
      ]);
    }
  }
  return { content: csv(lignes, ','), skipped, rows: lignes.length - 1 };
}

/** JSON : `companies[]`, chaque entreprise avec `emails[]`, chaque adresse avec `sources[]` et `verification`. */
export function jsonExport(data: ExportData, request: ExportRequest, maintenant: Date): string {
  return JSON.stringify(
    {
      generated_at: maintenant.toISOString(),
      filters: {
        scope: request.scope.kind,
        statuses: request.statuses,
        best_only: request.bestOnly,
      },
      companies: data.companies.map((c) => ({
        id: c.id,
        name: c.name,
        domain: c.domain,
        website_url: c.websiteUrl,
        careers_url: c.careersUrl,
        siren: c.siren,
        city: c.city,
        country: c.country,
        industry: c.industry,
        tags: c.tags,
        notes: c.notes,
        emails: c.emails.map((e) => ({
          address: e.address,
          contact_name: e.contactName,
          salutation: e.salutation,
          type: e.type,
          origin: e.origin,
          score: e.score,
          tags: e.tags,
          verification: {
            status: e.status,
            reason: e.verificationReason,
            verified_at: date(e.verifiedAt),
          },
          sources: e.sources.map((s) => ({
            kind: s.kind,
            url: s.url,
            provider: s.provider,
            method: s.method,
            excerpt: s.excerpt,
            discovered_at: date(s.discoveredAt),
          })),
        })),
      })),
    },
    null,
    2,
  );
}

/** Une couleur par statut, douce : le texte reste lisible, et la couleur n'est jamais seule a porter le statut. */
const COULEURS: Record<string, string> = {
  valid: 'FFD9F2E6',
  accept_all: 'FFFFF2CC',
  risky: 'FFFCE4D6',
  unknown: 'FFEDEDED',
  unverified: 'FFEDEDED',
};

function feuille(classeur: ExcelJS.Workbook, nom: string, entetes: readonly string[]) {
  const f = classeur.addWorksheet(nom, { views: [{ state: 'frozen', ySplit: 1 }] });
  f.addRow([...entetes]);
  f.getRow(1).font = { bold: true };
  return f;
}

function filtrer(f: ExcelJS.Worksheet, colonnes: number) {
  f.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, f.rowCount), column: colonnes },
  };
  f.columns.forEach((colonne) => {
    colonne.width = 18;
  });
}

/**
 * XLSX en quatre onglets : Entreprises, Adresses, Sources, Synthese. En-tetes
 * figes, filtres actifs, une couleur par statut. Les valeurs sont ecrites
 * comme du texte, jamais comme des formules : le tableur ne les evalue pas.
 */
export async function xlsxExport(
  data: ExportData,
  request: ExportRequest,
  maintenant: Date,
): Promise<Buffer> {
  const classeur = new ExcelJS.Workbook();
  classeur.creator = 'MailFind';
  classeur.created = maintenant;

  const entreprises = feuille(classeur, 'Entreprises', [
    ...EMAIL_COLUMNS.slice(0, 10),
    'emails',
    'notes',
  ]);
  for (const c of data.companies) {
    entreprises.addRow([
      c.id,
      c.name,
      c.domain,
      c.websiteUrl,
      c.careersUrl,
      c.siren,
      c.city,
      c.country,
      c.industry,
      c.tags.join(', '),
      c.emails.length,
      c.notes,
    ]);
  }
  filtrer(entreprises, 12);

  const adresses = feuille(classeur, 'Adresses', EMAIL_COLUMNS);
  const colonneStatut = EMAIL_COLUMNS.indexOf('verification_status') + 1;
  for (const c of data.companies) {
    for (const e of c.emails) {
      const ligne = adresses.addRow(ligneAdresse(c, e));
      const couleur = COULEURS[e.status];
      if (couleur !== undefined) {
        ligne.getCell(colonneStatut).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: couleur },
        };
      }
    }
  }
  filtrer(adresses, EMAIL_COLUMNS.length);

  const sources = feuille(classeur, 'Sources', [
    'email',
    'company_name',
    'source_kind',
    'source_url',
    'provider',
    'method',
    'excerpt',
    'discovered_at',
  ]);
  for (const c of data.companies) {
    for (const e of c.emails) {
      for (const s of e.sources) {
        sources.addRow([
          e.address,
          c.name,
          s.kind,
          s.url,
          s.provider,
          s.method,
          s.excerpt,
          date(s.discoveredAt),
        ]);
      }
    }
  }
  filtrer(sources, 8);

  const synthese = classeur.addWorksheet('Synthese');
  const parStatut = new Map<string, number>();
  const parType = new Map<string, number>();
  for (const c of data.companies) {
    for (const e of c.emails) {
      parStatut.set(e.status, (parStatut.get(e.status) ?? 0) + 1);
      parType.set(e.type, (parType.get(e.type) ?? 0) + 1);
    }
  }
  synthese.addRows([
    ['Genere le', maintenant.toISOString()],
    ['Perimetre', request.scope.kind],
    ['Statuts exportes', request.statuses],
    ['Une adresse par type', request.bestOnly ? 'oui' : 'non'],
    ['Entreprises', data.companies.length],
    ['Adresses', data.companies.reduce((n, c) => n + c.emails.length, 0)],
    [],
    ['Statut', 'Adresses'],
    ...[...parStatut].map(([k, v]) => [k, v]),
    [],
    ['Type', 'Adresses'],
    ...[...parType].map(([k, v]) => [k, v]),
  ]);
  synthese.getColumn(1).width = 24;
  synthese.getColumn(1).font = { bold: true };

  return Buffer.from(await classeur.xlsx.writeBuffer());
}
