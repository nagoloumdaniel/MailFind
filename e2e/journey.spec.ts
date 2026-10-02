import { expect, test } from '@playwright/test';

/**
 * Le parcours de bout en bout (Phase 9) : connexion, import, suivi, page
 * Contacts, export.
 *
 * Un seul test, en un seul fil, parce que c'est un parcours : chaque etape
 * depend de la precedente, et les decouper en tests independants obligerait a
 * refaire l'import a chaque fois.
 *
 * Les entreprises visitees sont les sites locaux de `backend/src/test/sites`.
 * Rien ne sort de la machine.
 */

/** Trois entreprises, avec leur domaine, comme un fichier bien rempli. */
const CSV = [
  'entreprise,domaine',
  'Boulangerie du Coin,boulangerie.test',
  'Ferme des Trois Chenes,ferme.test',
  'Acme,acme.test',
].join('\n');

test.describe.configure({ mode: 'serial' });

test('de la connexion a l export, en passant par la collecte', async ({ page }) => {
  // --- La porte est fermee
  await page.goto('/');
  await expect(page).toHaveURL(/\/connexion/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('adresses professionnelles');

  // Les deux portes sont la, dont celle de Campaign Mailer (D-26).
  await expect(page.getByRole('link', { name: 'Se connecter avec Google' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Campaign Mailer/ })).toBeVisible();

  // --- Connexion, par la porte du parcours
  await page.goto('/e2e/connexion');
  await expect(page).toHaveURL(/\/$/);

  // --- Import d'un fichier
  await page.goto('/import');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'entreprises.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV, 'utf8'),
  });

  // Les colonnes sont reconnues seules : « entreprise » et « domaine ».
  await expect(page.getByText(/3 lignes a traiter/)).toBeVisible();

  await page.getByRole('button', { name: "Lancer l'import" }).click();

  // --- Suivi, jusqu'a la fin
  await expect(page).toHaveURL(/\/imports\/[0-9a-f-]+/);
  await expect(page.getByText('Termine', { exact: true })).toBeVisible({ timeout: 90_000 });

  // La collecte a trouve des adresses sur les sites locaux.
  await expect(page.getByText(/adresse/i).first()).toBeVisible();

  // --- La bibliotheque les porte, avec leur source
  await page.goto('/contacts');
  const lignes = page.locator('tbody tr');
  await expect(lignes.first()).toBeVisible({ timeout: 30_000 });
  const combien = await lignes.count();
  expect(combien).toBeGreaterThan(0);
  // Une adresse d'un des sites visites, pas une inventee.
  await expect(page.getByText(/@(boulangerie|ferme|acme)\.test/).first()).toBeVisible();

  // --- Export
  await page.goto('/exports');
  await page.getByRole('button', { name: 'Exporter la bibliotheque' }).click();
  // La fenetre demande le format et le perimetre avant de produire le fichier.
  await expect(page.getByText('CSV, une ligne par adresse')).toBeVisible();

  const telechargement = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Exporter', exact: true }).click();
  const fichier = await telechargement;
  expect(fichier.suggestedFilename()).toMatch(/\.csv$/);
});

test('la page de l agent de collecte repond sans compte', async ({ browser }) => {
  // Un contexte neuf : pas de session, comme un webmestre qui arrive.
  const contexte = await browser.newContext();
  const page = await contexte.newPage();

  await page.goto('/robot');

  await expect(page.getByRole('heading', { name: 'MailFindBot' })).toBeVisible();
  // Deux formulaires : exclure un site, et faire effacer une adresse (A9).
  await expect(page.getByLabel('Domaine')).toBeVisible();
  await expect(page.getByRole('button', { name: /Ne plus explorer/ })).toBeVisible();
  await expect(page.getByLabel('Adresse email')).toBeVisible();
  await expect(page.getByRole('button', { name: /Effacer cette adresse/ })).toBeVisible();

  await contexte.close();
});

test('les conditions et la confidentialite se lisent sans compte', async ({ browser }) => {
  const contexte = await browser.newContext();
  const page = await contexte.newPage();

  await page.goto('/conditions-utilisation');
  await expect(page.getByRole('heading', { name: "Conditions d'utilisation" })).toBeVisible();

  await page.goto('/confidentialite');
  await expect(page.getByRole('heading', { name: 'Politique de confidentialite' })).toBeVisible();

  await contexte.close();
});
