import { readFileSync } from 'node:fs';
import { closePool } from '../db/pool.js';
import { createR2Storage } from '../exports/storage.js';
import { restoreBackup } from '../backup/dump.js';

/**
 * `npm run restore:backup -- backups/2026-10-02.ndjson.gz`
 * `npm run restore:backup -- ./une-sauvegarde.ndjson.gz --fichier`
 *
 * **Efface la base visee** avant de charger. Une restauration partielle
 * melangerait deux etats, ce qui est pire que les deux. C'est pourquoi la
 * commande redemande confirmation quand la base ne porte pas « test » dans
 * son nom : restaurer sur la production est une decision, pas une frappe.
 */

const [cle, ...options] = process.argv.slice(2);
const depuisFichier = options.includes('--fichier');
const confirme = options.includes('--oui');

if (cle === undefined) {
  process.stderr.write('Usage : npm run restore:backup -- <cle R2 | chemin --fichier> [--oui]\n');
  process.exit(2);
}

const base = new URL(process.env.DATABASE_URL ?? 'postgres://inconnue/inconnue').pathname.replace(
  /^\//,
  '',
);
if (!base.includes('test') && !confirme) {
  process.stderr.write(
    `La base « ${base} » n'est pas une base de test, et la restauration l'efface.\n` +
      "Relancez avec --oui si c'est bien ce que vous voulez.\n",
  );
  process.exit(1);
}

try {
  let archive: Buffer;
  if (depuisFichier) {
    archive = readFileSync(cle);
  } else {
    const stockage = createR2Storage();
    if (stockage === undefined) throw new Error('Stockage R2 non configure.');
    const lu = await stockage.get(cle);
    if (lu === undefined) throw new Error(`Sauvegarde introuvable : ${cle}`);
    archive = lu;
  }

  const rapport = await restoreBackup(archive);
  process.stdout.write(`Sauvegarde du ${rapport.createdAt} restauree dans « ${base} ».\n`);
  for (const [table, lignes] of Object.entries(rapport.rows)) {
    process.stdout.write(`  ${table.padEnd(30)} ${String(lignes)}\n`);
  }
} finally {
  await closePool();
}
