import { describe, expect, it } from 'vitest';
import { looksLikeCampaignMailerToken, pushIsOver } from './campaign-mailer';

describe('looksLikeCampaignMailerToken', () => {
  it('reconnait un jeton de Campaign Mailer, espaces autour compris', () => {
    expect(looksLikeCampaignMailerToken(` cm_${'a'.repeat(43)} `)).toBe(true);
    expect(looksLikeCampaignMailerToken(`mf_${'a'.repeat(43)}`)).toBe(false);
    expect(looksLikeCampaignMailerToken('cm_court')).toBe(false);
  });
});

describe('pushIsOver', () => {
  it('cesse de suivre un envoi reussi ou echoue, pas un envoi en cours', () => {
    expect(pushIsOver({ status: 'done' })).toBe(true);
    expect(pushIsOver({ status: 'failed' })).toBe(true);
    expect(pushIsOver({ status: 'running' })).toBe(false);
    expect(pushIsOver({ status: 'pending' })).toBe(false);
  });
});
