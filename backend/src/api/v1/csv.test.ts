import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.js';

describe('parseCsv (RFC 4180)', () => {
  it('lit un CSV a virgules, avec guillemets, guillemets echappes et CRLF', () => {
    const texte = 'company_name,notes\r\n"Acme, SA","Il a dit ""bonjour"""\r\nGlobex,\r\n';
    expect(parseCsv(texte)).toEqual([
      ['company_name', 'notes'],
      ['Acme, SA', 'Il a dit "bonjour"'],
      ['Globex', ''],
    ]);
  });

  it('reconnait le point-virgule des tableurs francais, et un retour a la ligne dans un champ', () => {
    const texte = 'company_name;city\nBoulangerie Martin;"Lyon\n3e"\n';
    expect(parseCsv(texte)).toEqual([
      ['company_name', 'city'],
      ['Boulangerie Martin', 'Lyon\n3e'],
    ]);
  });

  it('retire la marque d ordre d octets et ignore les lignes vides', () => {
    expect(parseCsv('﻿domain\n\nalan.com\n\n')).toEqual([['domain'], ['alan.com']]);
  });

  it('ne se laisse pas tromper par un separateur entre guillemets dans l en-tete', () => {
    expect(parseCsv('"a;b",c\n1,2')).toEqual([
      ['a;b', 'c'],
      ['1', '2'],
    ]);
  });
});
