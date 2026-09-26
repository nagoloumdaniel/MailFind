import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { validateRow } from '../imports/validate.js';
import type { KnownField } from '../imports/fields.js';
import { createUser, resetData } from '../test/integration/db.js';
import { findOrCreateCompany } from './repository.js';

const HEADERS = ['Entreprise', 'Domaine', 'SIREN', 'Carrieres', 'Ville'];
const MAPPING: KnownField[] = ['company_name', 'domain', 'siren', 'careers_url', 'city'];

function brouillon(valeurs: Partial<Record<KnownField, string>>) {
  const verdict = validateRow(
    HEADERS,
    MAPPING,
    MAPPING.map((champ) => valeurs[champ] ?? ''),
  );
  if (!verdict.accepted) throw new Error(verdict.reason);
  return verdict.draft;
}

interface Ligne {
  id: string;
  domain: string | null;
  siren: string | null;
}

async function entreprises(userId: string): Promise<Ligne[]> {
  const result = await query<Ligne>(
    'select id, domain, siren from companies where user_id = $1 order by created_at',
    [userId],
  );
  return result.rows;
}

let userId: string;

beforeEach(async () => {
  await resetData();
  userId = await createUser();
});

afterAll(async () => {
  await closePool();
});

describe('findOrCreateCompany sur un vrai PostgreSQL', () => {
  it('ne casse pas quand le SIREN apporte appartient deja a une autre entreprise', async () => {
    // Un fichier desordonne, tel qu'on en recoit : la meme societe connue une
    // fois par son domaine, une fois par son SIREN, puis par les deux.
    const parDomaine = await findOrCreateCompany(
      userId,
      brouillon({ company_name: 'Doctolib', domain: 'doctolib.fr' }),
    );
    const parSiren = await findOrCreateCompany(
      userId,
      brouillon({ company_name: 'Doctolib SAS', siren: '794598813' }),
    );

    const lesDeux = await findOrCreateCompany(
      userId,
      brouillon({ company_name: 'Doctolib', domain: 'doctolib.fr', siren: '794598813' }),
    );

    // La ligne rejoint la premiere cle trouvee, le domaine (F-303), et le
    // SIREN reste la ou il est : le deplacer serait deviner laquelle des deux
    // fiches a raison.
    expect(lesDeux).toEqual({ companyId: parDomaine.companyId, created: false });
    expect(await entreprises(userId)).toEqual([
      { id: parDomaine.companyId, domain: 'doctolib.fr', siren: null },
      { id: parSiren.companyId, domain: null, siren: '794598813' },
    ]);
  });

  it('complete quand meme les champs libres de la fiche retrouvee', async () => {
    await findOrCreateCompany(userId, brouillon({ domain: 'exemple.fr' }));
    await findOrCreateCompany(
      userId,
      brouillon({ company_name: 'Exemple Holding', siren: '552100554' }),
    );

    await findOrCreateCompany(
      userId,
      brouillon({ domain: 'exemple.fr', siren: '552100554', city: 'Nantes' }),
    );

    const result = await query<{ city: string | null }>(
      "select city from companies where user_id = $1 and domain = 'exemple.fr'",
      [userId],
    );
    expect(result.rows[0]?.city).toBe('Nantes');
  });

  it('rattache deux lignes reduites a la meme page carrieres', async () => {
    const page = 'https://www.welcometothejungle.com/fr/companies/exemple/jobs';

    const premiere = await findOrCreateCompany(userId, brouillon({ careers_url: page }));
    const seconde = await findOrCreateCompany(userId, brouillon({ careers_url: page }));

    expect(premiere.created).toBe(true);
    expect(seconde).toEqual({ companyId: premiere.companyId, created: false });
    expect(await entreprises(userId)).toHaveLength(1);
  });

  it('dix appels simultanes pour la meme entreprise en creent une seule', async () => {
    const resultats = await Promise.all(
      Array.from({ length: 10 }, () =>
        findOrCreateCompany(userId, brouillon({ company_name: 'Alan', domain: 'alan.com' })),
      ),
    );

    expect(new Set(resultats.map((resultat) => resultat.companyId)).size).toBe(1);
    expect(resultats.filter((resultat) => resultat.created)).toHaveLength(1);
    expect(await entreprises(userId)).toHaveLength(1);
  });
});
