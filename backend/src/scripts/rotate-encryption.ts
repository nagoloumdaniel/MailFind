import { closePool } from '../db/pool.js';
import { createConfiguredCipher } from '../pipeline/verify-deps.js';
import { rotateEncryption } from '../security/rotate.js';

/**
 * `npm run rotate:encryption` : la deuxieme etape d'une rotation de cle (S-01,
 * procedure dans docs/security.md). Code de sortie 1 tant qu'un secret reste
 * illisible : retirer l'ancienne cle le perdrait.
 */
const cipher = createConfiguredCipher();
if (cipher === undefined) {
  console.error('ENCRYPTION_KEY est vide : rien a faire tourner.');
  process.exit(1);
}

try {
  const rapport = await rotateEncryption(cipher);
  for (const [table, n] of Object.entries(rapport.rewritten)) {
    process.stdout.write(`${table.padEnd(30)} ${String(n)} valeur(s) reecrite(s)\n`);
  }
  process.stdout.write(
    `cache illisible supprime        ${String(rapport.droppedCache)} entree(s)\n`,
  );

  const illisibles = Object.entries(rapport.unreadable).filter(([, n]) => n > 0);
  if (illisibles.length > 0) {
    for (const [table, n] of illisibles) {
      console.error(`${table} : ${String(n)} secret(s) illisible(s) avec les cles configurees`);
    }
    console.error("Gardez ENCRYPTION_KEY_PREVIOUS : retirer l'ancienne cle perdrait ces secrets.");
    process.exitCode = 1;
  } else {
    process.stdout.write(
      'Tout est chiffre avec la cle courante : ENCRYPTION_KEY_PREVIOUS peut etre videe.\n',
    );
  }
} finally {
  await closePool();
}
