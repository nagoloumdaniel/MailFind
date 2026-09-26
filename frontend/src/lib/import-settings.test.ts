import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  EMAIL_TYPES,
  parseTags,
  settingsProblem,
  toggle,
} from './import-settings';

describe('parseTags', () => {
  it('lit des etiquettes separees par des virgules ou des points-virgules', () => {
    expect(parseTags('Salon 2026, Lyon; tech')).toEqual(['salon 2026', 'lyon', 'tech']);
  });

  it('retire les vides et les doublons, sans tenir compte de la casse', () => {
    expect(parseTags(' , Lyon,, lyon ;')).toEqual(['lyon']);
    expect(parseTags('')).toEqual([]);
  });
});

describe('settingsProblem', () => {
  it('laisse passer les reglages par defaut', () => {
    expect(settingsProblem(defaultSettings())).toBeUndefined();
  });

  it('exige au moins un type d adresse', () => {
    expect(settingsProblem({ ...defaultSettings(), emailTypes: [] })).toMatch(/au moins un type/);
  });

  it('accepte de refuser tous les fournisseurs payants', () => {
    expect(settingsProblem({ ...defaultSettings(), providers: [] })).toBeUndefined();
  });

  it('borne les etiquettes comme le serveur', () => {
    const trop = Array.from({ length: 21 }, (_, i) => `e${String(i)}`);
    expect(settingsProblem({ ...defaultSettings(), tags: trop })).toMatch(/20 etiquettes/);
    expect(settingsProblem({ ...defaultSettings(), tags: ['x'.repeat(51)] })).toMatch(/50/);
  });
});

describe('toggle', () => {
  it('ajoute puis retire, en gardant l ordre de reference', () => {
    const avec = toggle(['hr'], 'recruitment', EMAIL_TYPES);
    expect(avec).toEqual(['recruitment', 'hr']);
    expect(toggle(avec, 'hr', EMAIL_TYPES)).toEqual(['recruitment']);
  });
});
