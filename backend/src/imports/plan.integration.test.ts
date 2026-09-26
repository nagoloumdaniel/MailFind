import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as companies from '../companies/repository.js';
import { closePool, query } from '../db/pool.js';
import { createUser, resetData } from '../test/integration/db.js';
import type { KnownField } from './fields.js';
import { cancelImport, planImport } from './plan.js';
import { createImport, type PreparedRow } from './repository.js';
import { validateRow } from './validate.js';

// Le vrai module, avec une seule fonction espionnee : c'est ce qui permet de
// couper un import au milieu, exactement la ou une panne le couperait.
vi.mock('../companies/repository.js', async (importOriginal) => {
  const reel = await importOriginal<typeof companies>();
  return { ...reel, findOrCreateCompany: vi.fn(reel.findOrCreateCompany) };
});

const findOrCreate = vi.mocked(companies.findOrCreateCompany);
const { findOrCreateCompany: reelle } = await vi.importActual<typeof companies>(
  '../companies/repository.js',
);

const HEADERS = ['Entreprise', 'Site', 'Ville', 'SIREN'];
const MAPPING: (KnownField | null)[] = ['company_name', 'website_url', 'city', 'siren'];

function siren(numero: number): string {
  return String(100_000_000 + numero);
}

/**
 * Le fichier de la Definition of Done : 500 lignes qui melangent noms,
 * domaines et URL, avec des doublons de chaque sorte. 300 entreprises
 * distinctes doivent en sortir, pas une de plus.
 */
function fichierDeCinqCentsLignes(): string[][] {
  const lignes: string[][] = [];
  // 200 entreprises connues par leur domaine.
  for (let i = 0; i < 200; i += 1)
    lignes.push([`Societe ${i + 100} SAS`, `societe${i}.fr`, '', '']);
  // 100 doublons par domaine, ecrits autrement : URL complete, www, chemin.
  for (let i = 0; i < 100; i += 1) {
    lignes.push(['', `https://www.societe${i}.fr/contact`, '', '']);
  }
  // 50 entreprises connues par leur seul nom et leur ville.
  for (let i = 0; i < 50; i += 1) lignes.push([`Atelier ${i + 100}`, '', 'Lyon', '']);
  // 50 doublons par nom et ville : casse et forme juridique differentes.
  for (let i = 0; i < 50; i += 1) lignes.push([`ATELIER ${i + 100} SARL`, '', 'lyon', '']);
  // 50 entreprises connues par leur SIREN.
  for (let i = 0; i < 50; i += 1) lignes.push([`Groupe ${i + 100}`, '', '', siren(i)]);
  // 30 doublons par SIREN, sous un autre nom.
  for (let i = 0; i < 30; i += 1) lignes.push([`Groupe ${i + 100} Holding`, '', '', siren(i)]);
  // 20 lignes inexploitables : une ville, rien pour identifier une entreprise.
  for (let i = 0; i < 20; i += 1) lignes.push(['', '', 'Paris', '']);
  return lignes;
}

async function importer(userId: string, lignes: string[][]): Promise<string> {
  const preparees: PreparedRow[] = lignes.map((ligne, index) => {
    const verdict = validateRow(HEADERS, MAPPING, ligne);
    const raw: Record<string, string> = {};
    HEADERS.forEach((header, colonne) => {
      const valeur = ligne[colonne];
      if (valeur !== undefined && valeur !== '') raw[header] = valeur;
    });
    return verdict.accepted
      ? { line: index + 2, raw, status: 'accepted', error: undefined }
      : { line: index + 2, raw, status: 'rejected', error: verdict.reason };
  });

  const resume = await createImport({
    userId,
    filename: 'entreprises.csv',
    settings: { columns: { headers: HEADERS, mapping: MAPPING } },
    rows: preparees,
  });
  return resume.id;
}

async function compter(sql: string, valeurs: unknown[]): Promise<number> {
  const result = await query<{ n: number }>(sql, valeurs);
  return result.rows[0]?.n ?? 0;
}

async function etatImport(importId: string) {
  const result = await query<{ status: string; processed_rows: number; total_rows: number }>(
    'select status::text as status, processed_rows, total_rows from imports where id = $1',
    [importId],
  );
  return result.rows[0];
}

let userId: string;

beforeEach(async () => {
  await resetData();
  findOrCreate.mockReset();
  findOrCreate.mockImplementation(reelle);
  userId = await createUser();
});

afterAll(async () => {
  await closePool();
});

describe('import.plan sur un vrai PostgreSQL', () => {
  it('500 lignes melangees donnent 300 entreprises, sans aucun doublon (DoD Phase 2)', async () => {
    const importId = await importer(userId, fichierDeCinqCentsLignes());

    const resultat = await planImport(importId, userId);

    expect(resultat.status).toBe('completed');
    expect(resultat.companiesCreated).toBe(300);
    expect(resultat.duplicates).toBe(180);

    expect(
      await compter('select count(*)::int as n from companies where user_id = $1', [userId]),
    ).toBe(300);
    expect(
      await compter(
        `select count(*)::int as n from (
           select domain from companies where user_id = $1 and domain is not null
            group by domain having count(*) > 1) d`,
        [userId],
      ),
    ).toBe(0);

    // Chaque ligne acceptee pointe vers une entreprise, chaque ligne ecartee
    // garde son motif.
    expect(
      await compter(
        `select count(*)::int as n from import_rows
          where import_id = $1 and status in ('accepted', 'duplicate') and company_id is null`,
        [importId],
      ),
    ).toBe(0);
    expect(
      await compter(
        `select count(*)::int as n from import_rows
          where import_id = $1 and status = 'rejected' and error is not null`,
        [importId],
      ),
    ).toBe(20);

    expect(await etatImport(importId)).toEqual({
      status: 'completed',
      processed_rows: 500,
      total_rows: 500,
    });
  });

  it('un import annule garde ce qui a ete traite et ne va pas plus loin (F-205)', async () => {
    const importId = await importer(userId, fichierDeCinqCentsLignes());

    // L'utilisateur annule pendant le deuxieme lot de cent lignes.
    let appels = 0;
    findOrCreate.mockImplementation(async (...args) => {
      appels += 1;
      if (appels === 150) await cancelImport(userId, importId);
      return reelle(...args);
    });

    const resultat = await planImport(importId, userId);

    expect(resultat.status).toBe('cancelled');
    // Le lot en cours se termine, rien apres.
    expect(appels).toBe(200);
    expect(
      await compter('select count(*)::int as n from companies where user_id = $1', [userId]),
    ).toBe(200);
    expect(
      await compter(
        `select count(*)::int as n from import_rows
          where import_id = $1 and status = 'accepted' and company_id is null`,
        [importId],
      ),
    ).toBe(280);
    expect((await etatImport(importId))?.status).toBe('cancelled');
  });

  it('un import interrompu reprend la ou il s etait arrete, sans refaire (F-206)', async () => {
    const importId = await importer(userId, fichierDeCinqCentsLignes());

    // Premier passage : le processus tombe a la 250e entreprise.
    let appels = 0;
    findOrCreate.mockImplementation(async (...args) => {
      appels += 1;
      if (appels === 250) throw new Error('coupure simulee');
      return reelle(...args);
    });
    await expect(planImport(importId, userId)).rejects.toThrow('coupure simulee');
    expect((await etatImport(importId))?.status).toBe('planning');

    // Reprise, comme BullMQ la ferait apres redemarrage.
    findOrCreate.mockClear();
    findOrCreate.mockImplementation(reelle);
    const resultat = await planImport(importId, userId);

    expect(resultat.status).toBe('completed');
    // 480 lignes acceptees, 249 deja rattachees : seules les 231 autres passent.
    expect(findOrCreate).toHaveBeenCalledTimes(231);
    expect(
      await compter('select count(*)::int as n from companies where user_id = $1', [userId]),
    ).toBe(300);
    expect((await etatImport(importId))?.processed_rows).toBe(500);
  });

  it('rejouer un import termine ne change rien', async () => {
    const importId = await importer(userId, fichierDeCinqCentsLignes());
    await planImport(importId, userId);
    findOrCreate.mockClear();

    const resultat = await planImport(importId, userId);

    expect(findOrCreate).not.toHaveBeenCalled();
    expect(resultat.processed).toBe(0);
    expect(
      await compter('select count(*)::int as n from companies where user_id = $1', [userId]),
    ).toBe(300);
  });

  it('un second import du meme fichier rejoint la bibliotheque sans rien creer', async () => {
    const premier = await importer(userId, fichierDeCinqCentsLignes());
    await planImport(premier, userId);

    const second = await importer(userId, fichierDeCinqCentsLignes());
    const resultat = await planImport(second, userId);

    expect(resultat.companiesCreated).toBe(0);
    expect(resultat.duplicates).toBe(480);
    expect(
      await compter('select count(*)::int as n from companies where user_id = $1', [userId]),
    ).toBe(300);
  });
});
