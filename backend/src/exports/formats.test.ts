import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { meilleures, type ExportData, type ExportEmail } from './data.js';
import {
  campaignMailerAccepts,
  campaignMailerCsv,
  csvCompanies,
  csvEmails,
  EMAIL_COLUMNS,
  jsonExport,
  neutralize,
  xlsxExport,
} from './formats.js';
import type { ExportRequest } from './request.js';

const MAINTENANT = new Date('2026-09-29T08:00:00Z');

function adresse(partiel: Partial<ExportEmail> & { address: string }): ExportEmail {
  return {
    id: partiel.address,
    contactName: null,
    salutation: null,
    type: 'recruitment',
    origin: 'found',
    status: 'valid',
    score: 85,
    tags: [],
    verificationReason: 'Boite confirmee par hunter.',
    verifiedAt: MAINTENANT,
    createdAt: MAINTENANT,
    sources: [
      {
        kind: 'website',
        url: 'https://acme.fr/carrieres',
        provider: null,
        method: 'mailto',
        excerpt: null,
        discoveredAt: MAINTENANT.toISOString(),
      },
    ],
    ...partiel,
  };
}

const DONNEES: ExportData = {
  companies: [
    {
      id: 'k1',
      name: 'Acme; "Industrie"',
      domain: 'acme.fr',
      websiteUrl: 'https://acme.fr/',
      careersUrl: null,
      siren: '552100554',
      city: 'Lyon',
      country: null,
      industry: null,
      tags: ['salon'],
      notes: '=HYPERLINK("http://x")',
      emails: [
        adresse({ address: 'recrutement@acme.fr' }),
        adresse({ address: 'rh@acme.fr', type: 'hr', status: 'accept_all', score: 40 }),
        adresse({ address: 'contact@acme.fr', type: 'generic', contactName: 'Julie Martin' }),
      ],
    },
    {
      id: 'k2',
      name: 'Beta',
      domain: null,
      websiteUrl: null,
      careersUrl: null,
      siren: null,
      city: null,
      country: null,
      industry: null,
      tags: [],
      notes: null,
      emails: [
        adresse({ address: 'recrutement@acme.fr' }),
        adresse({ address: 'jose@société.fr' }),
      ],
    },
  ],
};

const REQUETE: ExportRequest = {
  format: 'csv_emails',
  scope: { kind: 'library' },
  statuses: 'valid_accept_all',
  bestOnly: false,
  separator: ';',
};

describe('neutralize (S-07)', () => {
  it('fait lire comme du texte une valeur qui commence comme une formule', () => {
    for (const valeur of ['=1+1', '+33 4', '-2', '@SUM(A1)', '\tx']) {
      expect(neutralize(valeur).startsWith("'"), valeur).toBe(true);
    }
    expect(neutralize('rh@acme.fr')).toBe('rh@acme.fr');
  });
});

describe('csvEmails (annexe B)', () => {
  it('ecrit les colonnes de l annexe B, dans l ordre, avec la marque UTF-8', () => {
    const csv = csvEmails(DONNEES, ';');
    expect(csv.startsWith('﻿')).toBe(true);
    const lignes = csv.slice(1).trimEnd().split('\r\n');
    expect(lignes[0]).toBe(EMAIL_COLUMNS.join(';'));
    expect(lignes).toHaveLength(6);
  });

  it('protege le separateur, les guillemets et les formules', () => {
    const csv = csvEmails(DONNEES, ';');
    expect(csv).toContain('"Acme; ""Industrie"""');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    // Avec la virgule, le nom ne contient plus le separateur, mais ses guillemets restent proteges.
    expect(csvEmails(DONNEES, ',')).toContain('"Acme; ""Industrie"""');
  });

  it('garde la source de chaque adresse (A4)', () => {
    const lignes = csvEmails(DONNEES, ';').slice(1).trimEnd().split('\r\n').slice(1);
    for (const ligne of lignes) expect(ligne).toContain(';website;https://acme.fr/carrieres;');
  });
});

describe('csvCompanies', () => {
  it('une ligne par entreprise, la meilleure adresse puis celles de chaque type', () => {
    const lignes = csvCompanies(DONNEES, ',').slice(1).trimEnd().split('\r\n');
    expect(lignes[0]?.endsWith('best_email,recruitment_emails,hr_emails,generic_emails')).toBe(
      true,
    );
    expect(lignes[1]).toContain(
      ',recrutement@acme.fr,recrutement@acme.fr,rh@acme.fr,contact@acme.fr',
    );
    expect(lignes).toHaveLength(3);
  });
});

describe('campaignMailerCsv', () => {
  it('ecrit les quatre colonnes que Campaign Mailer reconnait, une adresse une fois', () => {
    const { content, skipped, rows } = campaignMailerCsv(DONNEES);
    const lignes = content.slice(1).trimEnd().split('\r\n');
    expect(lignes).toEqual([
      'email,contact_name,company_name,salutation',
      'recrutement@acme.fr,,"Acme; ""Industrie""","Madame, Monsieur"',
      'rh@acme.fr,,"Acme; ""Industrie""","Madame, Monsieur"',
      'contact@acme.fr,Julie Martin,"Acme; ""Industrie""",',
    ]);
    // L'adresse en double est ecrite une fois ; celle que Campaign Mailer refuserait est comptee.
    expect({ skipped, rows }).toEqual({ skipped: 1, rows: 3 });
  });

  it('applique la regle d adresse de Campaign Mailer', () => {
    expect(campaignMailerAccepts('Recrutement@Acme.fr')).toBe(true);
    for (const refusee of [
      'jose@société.fr',
      'a@localhost',
      'a..b@acme.fr',
      'a@-acme.fr',
      'a@acme.123',
    ]) {
      expect(campaignMailerAccepts(refusee), refusee).toBe(false);
    }
  });
});

describe('jsonExport', () => {
  it('imbrique les adresses dans les entreprises, les sources et la verification dans les adresses', () => {
    const lu = JSON.parse(jsonExport(DONNEES, REQUETE, MAINTENANT)) as {
      companies: { emails: { verification: { status: string }; sources: unknown[] }[] }[];
    };
    expect(lu.companies).toHaveLength(2);
    expect(lu.companies[0]?.emails[1]?.verification.status).toBe('accept_all');
    expect(lu.companies[0]?.emails[0]?.sources).toHaveLength(1);
  });
});

describe('xlsxExport', () => {
  it('produit quatre onglets, en-tetes figes et filtres actifs', async () => {
    const tampon = await xlsxExport(DONNEES, REQUETE, MAINTENANT);
    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(tampon as unknown as Parameters<typeof classeur.xlsx.load>[0]);
    expect(classeur.worksheets.map((f) => f.name)).toEqual([
      'Entreprises',
      'Adresses',
      'Sources',
      'Synthese',
    ]);
    const adresses = classeur.getWorksheet('Adresses');
    expect(adresses?.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(adresses?.autoFilter).toBeDefined();
    expect(adresses?.rowCount).toBe(6);
    // Une valeur hostile reste du texte, jamais une formule.
    const notes = classeur.getWorksheet('Entreprises')?.getRow(2).getCell(12);
    expect(notes?.type).toBe(ExcelJS.ValueType.String);
  });
});

describe('meilleures (F-1103)', () => {
  it('garde une adresse par type : valide d abord, puis le meilleur score', () => {
    const retenues = meilleures([
      adresse({ address: 'a@acme.fr', status: 'accept_all', score: 90 }),
      adresse({ address: 'b@acme.fr', status: 'valid', score: 60 }),
      adresse({ address: 'c@acme.fr', type: 'hr', status: 'valid', score: 50 }),
      adresse({ address: 'd@acme.fr', type: 'hr', status: 'valid', score: 70 }),
    ]);
    expect(retenues.map((e) => e.address)).toEqual(['b@acme.fr', 'd@acme.fr']);
  });
});
