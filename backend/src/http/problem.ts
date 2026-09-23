/**
 * Erreurs d'API au format « problem details » de la RFC 9457, choisi des
 * maintenant parce que l'API publique l'exigera (F-1304) et qu'avoir deux
 * formats d'erreur dans le meme service coute plus cher que d'en avoir un.
 *
 * Le `code` est en anglais et stable : c'est lui que lit un programme. Le
 * `title` et le `detail` sont en francais : c'est ce que lit une personne.
 */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail?: string;
  readonly requestId?: string;
}

interface AppErrorOptions {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  // `| undefined` explicite : exactOptionalPropertyTypes refuse qu'on passe
  // undefined a une propriete simplement optionnelle.
  readonly detail?: string | undefined;
}

/** Erreur attendue, que l'API sait traduire en reponse. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string | undefined;

  constructor(options: AppErrorOptions) {
    super(options.detail ?? options.title);
    this.name = 'AppError';
    this.status = options.status;
    this.code = options.code;
    this.title = options.title;
    this.detail = options.detail;
  }

  static notFound(detail?: string): AppError {
    return new AppError({
      status: 404,
      code: 'not_found',
      title: 'Ressource introuvable',
      detail,
    });
  }

  static badRequest(code: string, title: string, detail?: string): AppError {
    return new AppError({ status: 400, code, title, detail });
  }
}

export function toProblem(error: AppError, requestId: string | undefined): Problem {
  return {
    type: 'about:blank',
    title: error.title,
    status: error.status,
    code: error.code,
    ...(error.detail === undefined ? {} : { detail: error.detail }),
    ...(requestId === undefined ? {} : { requestId }),
  };
}
