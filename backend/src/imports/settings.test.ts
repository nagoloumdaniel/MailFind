import { describe, expect, it } from 'vitest';
import { importSettingsSchema, readSettingsTags } from './settings.js';

describe('importSettingsSchema', () => {
  it('donne des reglages complets a qui n envoie rien', () => {
    expect(importSettingsSchema.parse({})).toEqual({
      depth: 'standard',
      emailTypes: ['recruitment', 'hr', 'generic'],
      providers: ['brave', 'hunter'],
      tags: [],
    });
  });

  it('garde les choix de l utilisateur, sans doublon', () => {
    const reglages = importSettingsSchema.parse({
      depth: 'deep',
      emailTypes: ['press', 'press', 'sales'],
      providers: [],
      tags: [' Lyon ', 'lyon', 'Salon 2026'],
    });

    expect(reglages).toEqual({
      depth: 'deep',
      emailTypes: ['press', 'sales'],
      providers: [],
      tags: ['lyon', 'salon 2026'],
    });
  });

  it('refuse une profondeur, un type ou un fournisseur inconnus', () => {
    expect(importSettingsSchema.safeParse({ depth: 'total' }).success).toBe(false);
    expect(importSettingsSchema.safeParse({ emailTypes: ['personal'] }).success).toBe(false);
    expect(importSettingsSchema.safeParse({ providers: ['snov'] }).success).toBe(false);
  });

  it('exige au moins un type d adresse recherche', () => {
    expect(importSettingsSchema.safeParse({ emailTypes: [] }).success).toBe(false);
  });

  it('refuse une cle inconnue plutot que de l enregistrer', () => {
    expect(importSettingsSchema.safeParse({ columns: { headers: [] } }).success).toBe(false);
  });

  it('borne le nombre et la longueur des etiquettes', () => {
    expect(
      importSettingsSchema.safeParse({ tags: Array.from({ length: 21 }, (_, i) => `e${i}`) })
        .success,
    ).toBe(false);
    expect(importSettingsSchema.safeParse({ tags: ['x'.repeat(51)] }).success).toBe(false);
  });
});

describe('readSettingsTags', () => {
  it('rend les etiquettes enregistrees', () => {
    expect(readSettingsTags({ tags: ['lyon', 'salon'] })).toEqual(['lyon', 'salon']);
  });

  it('rend une liste vide pour un import sans etiquettes', () => {
    expect(readSettingsTags({})).toEqual([]);
    expect(readSettingsTags(null)).toEqual([]);
    expect(readSettingsTags({ tags: 'lyon' })).toEqual([]);
  });
});
