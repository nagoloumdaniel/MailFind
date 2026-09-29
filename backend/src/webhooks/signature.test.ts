import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateWebhookSecret, signWebhook, verifyWebhookSignature } from './signature.js';

const SECRET = 'whsec_essai';
const CORPS = '{"type":"import.completed"}';
const INSTANT = new Date('2026-09-29T12:00:00Z');

describe('signature des webhooks (F-1308)', () => {
  it('signe t et le corps exact par HMAC-SHA256', () => {
    const entete = signWebhook(SECRET, CORPS, INSTANT);
    const t = INSTANT.getTime() / 1000;
    const attendue = createHmac('sha256', SECRET)
      .update(`${String(t)}.${CORPS}`)
      .digest('hex');
    expect(entete).toBe(`t=${String(t)},v1=${attendue}`);
  });

  it('se verifie avec le bon secret et le corps intact, et seulement ainsi', () => {
    const entete = signWebhook(SECRET, CORPS, INSTANT);
    expect(verifyWebhookSignature(SECRET, CORPS, entete, INSTANT)).toBe(true);
    expect(verifyWebhookSignature('whsec_autre', CORPS, entete, INSTANT)).toBe(false);
    expect(verifyWebhookSignature(SECRET, `${CORPS} `, entete, INSTANT)).toBe(false);
    expect(verifyWebhookSignature(SECRET, CORPS, 't=abc,v1=00', INSTANT)).toBe(false);
  });

  it('refuse une signature rejouee au-dela de cinq minutes', () => {
    const entete = signWebhook(SECRET, CORPS, INSTANT);
    const plusTard = new Date(INSTANT.getTime() + 301_000);
    expect(verifyWebhookSignature(SECRET, CORPS, entete, plusTard)).toBe(false);
  });

  it('tire un secret neuf a chaque abonnement', () => {
    expect(generateWebhookSecret()).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});
