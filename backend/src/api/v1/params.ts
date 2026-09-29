import { z } from 'zod';

/**
 * L'identifiant d'un chemin `/v1/.../{id}`, ou undefined s'il n'est pas un
 * UUID : la ressource est alors introuvable, sans requete en base.
 */
export function pathId(valeur: unknown): string | undefined {
  return typeof valeur === 'string' && z.uuid().safeParse(valeur).success ? valeur : undefined;
}
