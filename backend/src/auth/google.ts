import passport from 'passport';
import { Strategy as GoogleStrategy, type Profile } from 'passport-google-oauth20';
import { getEnvironment } from '../config/env.js';
import { signInWithGoogle, type SignInResult } from '../users/repository.js';

/**
 * Les seules portees demandees (F-101, D-11). Aucune portee Gmail, jamais :
 * MailFind ne lit ni n'envoie de courrier, et ces trois portees ne declenchent
 * pas la procedure de verification de Google.
 */
export const GOOGLE_SCOPES = ['openid', 'email', 'profile'] as const;

export function extractIdentity(profile: Profile): {
  googleId: string;
  email: string;
  name: string | null;
} {
  const email = profile.emails?.[0]?.value;
  if (email === undefined || email === '') {
    // Sans adresse, il n'y a pas de compte possible : c'est la seule chose que
    // MailFind retient de la personne, avec son identifiant Google.
    throw new Error("Google n'a pas fourni d'adresse pour ce compte.");
  }

  return {
    googleId: profile.id,
    email,
    name: profile.displayName === '' ? null : (profile.displayName ?? null),
  };
}

let configured = false;

export function configureGoogleStrategy(
  signIn: (
    identity: ReturnType<typeof extractIdentity>,
  ) => Promise<SignInResult> = signInWithGoogle,
): void {
  if (configured) return;
  const environment = getEnvironment();

  passport.use(
    new GoogleStrategy(
      {
        clientID: environment.GOOGLE_CLIENT_ID,
        clientSecret: environment.GOOGLE_CLIENT_SECRET,
        callbackURL: environment.GOOGLE_CALLBACK_URL,
        scope: [...GOOGLE_SCOPES],
        // Jeton anti-rejeu range dans la session, verifie au retour. Sans lui,
        // un tiers peut faire aboutir une connexion qu'il a initiee dans le
        // navigateur de quelqu'un d'autre.
        state: true,
      },
      (_accessToken, _refreshToken, profile: Profile, done) => {
        void (async () => {
          try {
            const result = await signIn(extractIdentity(profile));
            done(null, result);
          } catch (error) {
            done(error instanceof Error ? error : new Error(String(error)));
          }
        })();
      },
    ),
  );

  configured = true;
}
