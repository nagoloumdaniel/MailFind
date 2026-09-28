/**
 * Interface commune des fournisseurs d'enrichissement (F-601).
 *
 * Changer de fournisseur, ou en ajouter un second, ne touche qu'un
 * adaptateur : le pipeline ne connait que cette interface. La recherche
 * nominative et la verification de boite (F-601, niveau 8 de 6.7) viendront
 * s'y ajouter en Phase 5.
 */

export interface ProviderEmail {
  /** Telle que le fournisseur la donne. */
  readonly address: string;
  readonly kind: 'personal' | 'generic';
  /** Confiance annoncee par le fournisseur, de 0 a 100. Ce n'est pas une verification. */
  readonly confidence?: number;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly position?: string;
  /** Pages ou le fournisseur dit l'avoir vue. */
  readonly sourceUrls: readonly string[];
}

export interface DomainSearchResult {
  readonly domain: string;
  /**
   * Format des adresses nominatives observe sur le domaine, par exemple
   * « {first}.{last} ». Seule base admise pour deduire une adresse
   * nominative (F-504).
   */
  readonly pattern?: string;
  readonly emails: readonly ProviderEmail[];
}

export interface EnrichmentProvider {
  readonly name: string;
  domainSearch(domain: string): Promise<DomainSearchResult>;
}

/**
 * Pourquoi un fournisseur n'a pas repondu. Aucune de ces erreurs n'arrete
 * l'import (F-606) : l'etape est notee avec son motif et le repli continue.
 */
export type ProviderErrorKind = 'auth' | 'quota' | 'invalid' | 'refused' | 'unavailable';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
