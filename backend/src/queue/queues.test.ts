import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { importPlanJobId, isFinalFailure } from './queues.js';

describe('isFinalFailure', () => {
  const erreur = new Error('coupure reseau');

  it('laisse BullMQ retenter tant qu il reste des tentatives', () => {
    expect(isFinalFailure({ attemptsMade: 1, opts: { attempts: 3 } }, erreur)).toBe(false);
    expect(isFinalFailure({ attemptsMade: 2, opts: { attempts: 3 } }, erreur)).toBe(false);
  });

  it('abandonne a la derniere tentative', () => {
    expect(isFinalFailure({ attemptsMade: 3, opts: { attempts: 3 } }, erreur)).toBe(true);
  });

  it('abandonne tout de suite sur une erreur que reessayer ne corrigera pas', () => {
    const definitive = new UnrecoverableError('import introuvable');
    expect(isFinalFailure({ attemptsMade: 1, opts: { attempts: 3 } }, definitive)).toBe(true);
  });

  it('considere une tache sans tentatives declarees comme a essai unique', () => {
    expect(isFinalFailure({ attemptsMade: 1, opts: {} }, erreur)).toBe(true);
  });
});

describe('importPlanJobId', () => {
  it('est stable et sans deux-points, que BullMQ refuse', () => {
    const id = importPlanJobId('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b');
    expect(id).toBe(importPlanJobId('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'));
    expect(id).not.toContain(':');
  });
});
