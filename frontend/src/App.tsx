// Ecran d'attente de la Phase 0. Le routeur, le systeme de conception et les
// pages reelles arrivent en Phase 1 : cette page ne sert qu'a prouver que la
// chaine Vite, React, Tailwind et TypeScript est en place.
//
// Le logo est charge en <img>, donc son currentColor ne suit pas le theme.
// Quand la Phase 1 apportera le theme sombre, il devra devenir un composant
// SVG en ligne.
import logoUrl from './assets/logo.svg';

export function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white p-6 text-center text-slate-900">
      <img src={logoUrl} alt="" width={56} height={56} />
      <h1 className="text-2xl font-semibold tracking-tight">MailFind</h1>
      <p className="max-w-md text-sm text-slate-600">
        Socle applicatif en place. L&apos;interface arrive en Phase 1.
      </p>
    </main>
  );
}
