import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="max-w-[60ch]">
      <h1 className="text-2xl font-bold" style={{ fontStretch: '115%' }}>
        Cette page n&apos;existe pas
      </h1>
      <p className="mt-2 text-sm text-text-soft">
        Le lien est peut-etre ancien, ou l&apos;adresse comporte une faute.
      </p>
      <p className="mt-6 text-sm">
        <Link to="/" className="text-focus underline underline-offset-2">
          Retour au tableau de bord
        </Link>
      </p>
    </div>
  );
}
