import { describe, expect, it } from 'vitest';
import { EMAIL_STATUS_LABELS } from './imports';
import { extractAddresses, resultsToCsv } from './one-off';

describe('extractAddresses', () => {
  it('trouve les adresses d un texte colle, sans les noms qui les entourent', () => {
    expect(
      extractAddresses(
        'Jean Dupont <jean@acme.fr>, rh@acme.fr; "contact@acme.fr"\nmailto:jobs@acme.fr.',
      ),
    ).toEqual(['jean@acme.fr', 'rh@acme.fr', 'contact@acme.fr', 'jobs@acme.fr']);
  });

  it('garde une adresse mal formee pour la signaler, et retire les doublons', () => {
    expect(extractAddresses('a@@b rh@acme.fr RH@ACME.FR')).toEqual(['a@@b', 'rh@acme.fr']);
  });

  it('ignore ce qui n a pas d arobase', () => {
    expect(extractAddresses('Entreprise;Ville\nAcme;Lyon')).toEqual([]);
  });
});

describe('resultsToCsv', () => {
  it('ecrit un CSV lisible par Excel, et neutralise une formule', () => {
    const csv = resultsToCsv(
      [
        {
          input: 'rh@acme.fr',
          address: 'rh@acme.fr',
          status: 'unverified',
          reason: 'Controles "locaux" passes',
          type: 'hr',
          webmail: false,
        },
        {
          input: '=HYPERLINK(1)',
          address: null,
          status: 'invalid',
          reason: 'Syntaxe',
          type: 'unknown',
          webmail: false,
        },
      ],
      EMAIL_STATUS_LABELS,
    );
    expect(csv.startsWith(`${String.fromCharCode(0xfeff)}"adresse";"statut"`)).toBe(true);
    expect(csv).toContain(
      '"rh@acme.fr";"unverified";"Non verifiee";"Controles ""locaux"" passes";"hr"',
    );
    expect(csv).toContain(`"'=HYPERLINK(1)";"invalid"`);
  });
});
