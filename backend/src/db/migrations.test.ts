import { describe, expect, it } from 'vitest';
import { checksum, collectMigrations, parseMigrationFilename } from './migrations.js';

describe('parseMigrationFilename', () => {
  it('reconnait un nom conforme', () => {
    expect(parseMigrationFilename('0001_users_and_audit_events.up.sql')).toEqual({
      version: 1,
      name: 'users_and_audit_events',
      direction: 'up',
    });
  });

  it('ignore ce qui ne suit pas la convention', () => {
    expect(parseMigrationFilename('notes.sql')).toBeUndefined();
    expect(parseMigrationFilename('1_users.up.sql')).toBeUndefined();
    expect(parseMigrationFilename('0001_Users.up.sql')).toBeUndefined();
    expect(parseMigrationFilename('0001_users.sql')).toBeUndefined();
  });
});

describe('collectMigrations', () => {
  it('apparie montee et retour arriere', () => {
    const migrations = collectMigrations([
      '0001_users.up.sql',
      '0001_users.down.sql',
      'lisez-moi.md',
    ]);

    expect(migrations).toEqual([
      {
        version: 1,
        name: 'users',
        upFile: '0001_users.up.sql',
        downFile: '0001_users.down.sql',
      },
    ]);
  });

  it('trie par numero et non par ordre alphabetique', () => {
    const migrations = collectMigrations([
      '0010_dixieme.up.sql',
      '0010_dixieme.down.sql',
      '0002_deuxieme.up.sql',
      '0002_deuxieme.down.sql',
      '0001_premiere.up.sql',
      '0001_premiere.down.sql',
      ...Array.from({ length: 7 }, (_, index) => {
        const version = String(index + 3).padStart(4, '0');
        return [`${version}_bouchon.up.sql`, `${version}_bouchon.down.sql`];
      }).flat(),
    ]);

    expect(migrations.map((migration) => migration.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it('refuse une migration sans retour arriere', () => {
    expect(() => collectMigrations(['0001_users.up.sql'])).toThrow(/retour arriere/);
  });

  it('refuse deux migrations portant le meme numero', () => {
    expect(() =>
      collectMigrations([
        '0001_users.up.sql',
        '0001_users.down.sql',
        '0001_autre.up.sql',
        '0001_autre.down.sql',
      ]),
    ).toThrow(/meme numero|numero 0001/);
  });

  it('refuse un trou dans la numerotation', () => {
    expect(() =>
      collectMigrations([
        '0001_users.up.sql',
        '0001_users.down.sql',
        '0003_plus_tard.up.sql',
        '0003_plus_tard.down.sql',
      ]),
    ).toThrow(/discontinue/);
  });

  it('refuse un retour arriere qui ne porte pas le meme nom', () => {
    expect(() => collectMigrations(['0001_users.up.sql', '0001_utilisateurs.down.sql'])).toThrow(
      /meme nom/,
    );
  });
});

describe('checksum', () => {
  it('ignore la difference de fin de ligne entre Windows et Linux', () => {
    expect(checksum('select 1;\r\nselect 2;\r\n')).toBe(checksum('select 1;\nselect 2;\n'));
  });

  it('change des que le contenu change', () => {
    expect(checksum('select 1;')).not.toBe(checksum('select 2;'));
  });
});
