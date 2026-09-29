import { describe, expect, it } from 'vitest';
import { filenameFrom } from './exports';

describe('filenameFrom', () => {
  it('lit le nom annonce par le serveur', () => {
    expect(filenameFrom('attachment; filename="mailfind-adresses-2026-09-29.csv"')).toBe(
      'mailfind-adresses-2026-09-29.csv',
    );
  });

  it('prend un nom neutre sans en-tete', () => {
    expect(filenameFrom(null)).toBe('mailfind-export');
  });
});
