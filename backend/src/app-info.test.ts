import { describe, expect, it } from 'vitest';
import { APP_NAME, APP_VERSION, describeApp } from './app-info.js';

describe('describeApp', () => {
  it('reunit le nom et la version', () => {
    expect(describeApp()).toBe(`${APP_NAME} ${APP_VERSION}`);
  });

  it('expose une version au format semantique', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
