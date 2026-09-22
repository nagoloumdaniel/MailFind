// Ecran d'attente de la Phase 0. Le routeur, le systeme de conception et les
// pages reelles arrivent en Phase 1 : cette page ne sert qu'a prouver que la
// chaine Vite, React, Tailwind et TypeScript est en place.
export function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white p-6 text-center text-slate-900">
      <h1 className="text-2xl font-semibold tracking-tight">MailFind</h1>
      <p className="max-w-md text-sm text-slate-600">
        Socle applicatif en place. L&apos;interface arrive en Phase 1.
      </p>
    </main>
  );
}
