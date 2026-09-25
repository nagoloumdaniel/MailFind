import { describe, expect, it } from 'vitest';
import { decodeCsv, MAX_ROWS, parseCsvText, readCsvFile } from './csv';

function octets(texte: string): ArrayBuffer {
  return new TextEncoder().encode(texte).buffer;
}

/** Encode en Windows-1252, ou chaque caractere latin tient sur un octet. */
function octets1252(texte: string): ArrayBuffer {
  const table: Record<string, number> = { é: 0xe9, è: 0xe8, à: 0xe0, ç: 0xe7, ô: 0xf4 };
  const sortie = new Uint8Array(texte.length);
  for (let index = 0; index < texte.length; index += 1) {
    const caractere = texte[index] ?? '';
    sortie[index] = table[caractere] ?? caractere.charCodeAt(0);
  }
  return sortie.buffer;
}

describe('decodeCsv', () => {
  it('lit un fichier UTF-8', () => {
    const { text, encoding } = decodeCsv(octets('societe;ville\nDoctolib;Paris'));
    expect(encoding).toBe('utf-8');
    expect(text).toContain('societe');
  });

  it('retire la marque d ordre des octets posee par Excel', () => {
    const { text } = decodeCsv(octets('﻿entreprise,ville'));
    expect(text.startsWith('entreprise')).toBe(true);
  });

  it('se rabat sur Windows-1252 quand l UTF-8 ne passe pas', () => {
    const { text, encoding } = decodeCsv(octets1252('societe\nCafé de la Gare'));
    expect(encoding).toBe('windows-1252');
    expect(text).toContain('Café de la Gare');
  });

  it('garde les accents d un vrai fichier UTF-8', () => {
    const { text, encoding } = decodeCsv(octets('societe\nCafé de la Gare'));
    expect(encoding).toBe('utf-8');
    expect(text).toContain('Café de la Gare');
  });
});

describe('parseCsvText', () => {
  it('devine la virgule', () => {
    const resultat = parseCsvText('entreprise,ville\nDoctolib,Paris');
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.data.delimiter).toBe(',');
    expect(resultat.data.headers).toEqual(['entreprise', 'ville']);
    expect(resultat.data.rows).toEqual([['Doctolib', 'Paris']]);
  });

  it('devine le point-virgule, separateur des tableurs francais', () => {
    const resultat = parseCsvText('entreprise;ville\nDoctolib;Paris');
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.data.delimiter).toBe(';');
  });

  it('devine la tabulation', () => {
    const resultat = parseCsvText('entreprise\tville\nDoctolib\tParis');
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.data.delimiter).toBe('\t');
  });

  it('respecte un separateur place entre guillemets', () => {
    const resultat = parseCsvText('entreprise,notes\n"Durand, Martin et associes",a rappeler');
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.data.rows[0]?.[0]).toBe('Durand, Martin et associes');
  });

  it('respecte un retour a la ligne dans une cellule entre guillemets', () => {
    const resultat = parseCsvText('entreprise,notes\nAcme,"premiere ligne\nseconde ligne"');
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.data.rows).toHaveLength(1);
    expect(resultat.data.rows[0]?.[1]).toContain('seconde ligne');
  });

  it('coupe les espaces autour des valeurs', () => {
    const resultat = parseCsvText('entreprise , ville \n  Doctolib ,  Paris ');
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.data.headers).toEqual(['entreprise', 'ville']);
    expect(resultat.data.rows[0]).toEqual(['Doctolib', 'Paris']);
  });

  it('ecarte les lignes vides de fin de fichier', () => {
    const resultat = parseCsvText('entreprise,ville\nDoctolib,Paris\n\n,\n');
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.data.rows).toHaveLength(1);
  });

  it('refuse un fichier vide', () => {
    const resultat = parseCsvText('   ');
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.problem.code).toBe('file_empty');
  });

  it('refuse un fichier qui n a que son en-tete', () => {
    const resultat = parseCsvText('entreprise,ville');
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.problem.code).toBe('no_rows');
  });

  it('accepte exactement 5 000 lignes', () => {
    const lignes = Array.from({ length: MAX_ROWS }, (_, index) => `Entreprise ${index},Paris`);
    const resultat = parseCsvText(`entreprise,ville\n${lignes.join('\n')}`);
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.data.rows).toHaveLength(MAX_ROWS);
  });

  it('refuse 5 001 lignes, et dit quoi faire (F-201)', () => {
    const lignes = Array.from({ length: MAX_ROWS + 1 }, (_, index) => `Entreprise ${index},Paris`);
    const resultat = parseCsvText(`entreprise,ville\n${lignes.join('\n')}`);
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.problem.code).toBe('too_many_rows');
    expect(resultat.problem.message).toContain('plusieurs fichiers');
  });

  it("lit l'exemple de l'annexe A du cahier des charges", () => {
    const resultat = parseCsvText(
      [
        'entreprise,site,carrieres,ville,etiquettes',
        'Doctolib,doctolib.fr,,Paris,alternance;sante',
        'Entreprise Exemple,https://www.entreprise-exemple.fr,https://www.entreprise-exemple.fr/carrieres,Lyon,alternance',
        'Startup Sans Site,,,Nantes,',
        ',agence-web-exemple.fr,,Bordeaux,prospection',
      ].join('\n'),
    );

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.data.rows).toHaveLength(4);
    // Le point-virgule des etiquettes ne doit pas etre pris pour le separateur
    // du fichier, qui est la virgule.
    expect(resultat.data.delimiter).toBe(',');
    expect(resultat.data.rows[0]?.[4]).toBe('alternance;sante');
    // Quatrieme ligne : sans nom, mais avec un domaine. Elle reste exploitable.
    expect(resultat.data.rows[3]?.[0]).toBe('');
    expect(resultat.data.rows[3]?.[1]).toBe('agence-web-exemple.fr');
  });
});

describe('readCsvFile', () => {
  it('refuse un fichier de plus de 5 Mo sans meme le lire', async () => {
    const gros = new File([new Uint8Array(6 * 1024 * 1024)], 'gros.csv', { type: 'text/csv' });
    const resultat = await readCsvFile(gros);

    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.problem.code).toBe('file_too_large');
    expect(resultat.problem.message).toContain('6.0 Mo');
  });

  it('refuse un fichier de zero octet', async () => {
    const resultat = await readCsvFile(new File([], 'vide.csv'));
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.problem.code).toBe('file_empty');
  });

  it('lit un fichier depose de bout en bout', async () => {
    const fichier = new File(['entreprise;ville\nDoctolib;Paris'], 'entreprises.csv');
    const resultat = await readCsvFile(fichier);

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.data.encoding).toBe('utf-8');
    expect(resultat.data.delimiter).toBe(';');
    expect(resultat.data.rows).toEqual([['Doctolib', 'Paris']]);
  });
});
