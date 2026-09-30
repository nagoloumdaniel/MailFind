import { describe, expect, it } from 'vitest';
import { looksLikeCampaignMailerToken } from './campaign-mailer';

describe('looksLikeCampaignMailerToken', () => {
  it('reconnait un jeton de Campaign Mailer, espaces autour compris', () => {
    expect(looksLikeCampaignMailerToken(` cm_${'a'.repeat(43)} `)).toBe(true);
    expect(looksLikeCampaignMailerToken(`mf_${'a'.repeat(43)}`)).toBe(false);
    expect(looksLikeCampaignMailerToken('cm_court')).toBe(false);
  });
});
