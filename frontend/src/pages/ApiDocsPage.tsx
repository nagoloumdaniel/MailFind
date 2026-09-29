import { useEffect, useState } from 'react';
import { apiFetch, apiUrl } from '../lib/api';
import {
  groupOperations,
  refName,
  typeLabel,
  type JsonSchema,
  type OpenApiDocument,
  type OpenApiParameter,
} from '../lib/openapi';

/**
 * Documentation de l'API publique (F-1301), lue dans le document OpenAPI que
 * sert l'API elle-meme : la page ne peut pas decrire autre chose que ce que
 * l'API fait, et le document reste telechargeable pour un outil.
 */

function Type({ schema }: { schema: JsonSchema }) {
  const libelle = typeLabel(schema);
  const cible = schema.$ref ?? (schema.type === 'array' ? schema.items?.$ref : undefined);
  return cible === undefined ? (
    <span className="font-mono text-xs text-text-soft">{libelle}</span>
  ) : (
    <a href={`#schema-${refName(cible)}`} className="font-mono text-xs text-accent underline">
      {libelle}
    </a>
  );
}

function Proprietes({ schema }: { schema: JsonSchema }) {
  const proprietes = Object.entries(schema.properties ?? {});
  if (proprietes.length === 0) return <Type schema={schema} />;
  const requis = new Set(schema.required ?? []);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-text-faint">
          <tr>
            <th className="py-1 pr-4 font-medium">Champ</th>
            <th className="py-1 pr-4 font-medium">Type</th>
            <th className="py-1 font-medium">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {proprietes.map(([nom, sous]) => (
            <tr key={nom} className="align-top">
              <td className="py-1.5 pr-4 font-mono text-xs">
                {nom}
                {requis.has(nom) && <span className="text-negative"> *</span>}
              </td>
              <td className="py-1.5 pr-4">
                <Type schema={sous} />
              </td>
              <td className="py-1.5 text-text-soft">{sous.description ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Parametres({ parametres }: { parametres: OpenApiParameter[] }) {
  if (parametres.length === 0) return null;
  return (
    <div className="mt-3">
      <h4 className="text-xs font-semibold text-text-faint">Parametres</h4>
      <ul className="mt-1 space-y-1 text-sm">
        {parametres.map((p) => (
          <li key={`${p.in}-${p.name}`}>
            <span className="font-mono text-xs">{p.name}</span>
            {p.required && <span className="text-negative"> *</span>}{' '}
            <span className="text-xs text-text-faint">({p.in})</span> <Type schema={p.schema} />
            {p.description !== undefined && (
              <span className="text-text-soft"> : {p.description}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ApiDocsPage() {
  const [document, setDocument] = useState<OpenApiDocument | undefined>(undefined);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    let actif = true;
    apiFetch<OpenApiDocument>('/v1/openapi.json')
      .then((d) => {
        if (actif) setDocument(d);
      })
      .catch(() => {
        if (actif) setErreur(true);
      });
    return () => {
      actif = false;
    };
  }, []);

  if (erreur) {
    return (
      <p role="alert" className="text-sm text-negative">
        Le document de l&apos;API n&apos;a pas pu etre charge.
      </p>
    );
  }
  if (document === undefined) return <p className="text-sm text-text-faint">Chargement</p>;

  const groupes = groupOperations(document);
  return (
    <div className="max-w-[80ch]">
      <h1 className="text-2xl font-bold">{document.info.title}</h1>
      <p className="mt-2 text-sm text-text-soft">
        Version {document.info.version}, serveur{' '}
        <span className="font-mono">{document.servers[0]?.url ?? ''}</span>.{' '}
        <a href={apiUrl('/v1/openapi.json')} className="text-accent underline">
          Telecharger le document OpenAPI 3.1
        </a>
        .
      </p>

      <section className="mt-6 border-t border-line pt-4 text-sm">
        <h2 className="text-base font-semibold">L&apos;essentiel</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-text-soft">
          <li>
            Chaque requete porte <span className="font-mono">Authorization: Bearer mf_...</span>,
            une cle creee dans la page Compte. Chaque operation dit la portee qu&apos;elle demande.
          </li>
          <li>
            60 requetes par minute et par cle. Les en-tetes{' '}
            <span className="font-mono">RateLimit-*</span> disent ce qui reste ; au-dela, une
            reponse 429 et <span className="font-mono">Retry-After</span>.
          </li>
          <li>
            Sur les creations, <span className="font-mono">Idempotency-Key</span> rejoue la premiere
            reponse pendant 24 heures : renvoyer une requete ne cree rien deux fois.
          </li>
          <li>
            Les listes se parcourent par curseur : <span className="font-mono">limit</span>, puis{' '}
            <span className="font-mono">cursor</span> avec la valeur de{' '}
            <span className="font-mono">next_cursor</span>, nulle sur la derniere page.
          </li>
          <li>
            Les erreurs suivent la RFC 9457, avec un <span className="font-mono">code</span> stable.
          </li>
          <li>
            Un statut d&apos;adresse est un constat, jamais une promesse :{' '}
            <span className="font-mono">accept_all</span>,{' '}
            <span className="font-mono">unknown</span> et{' '}
            <span className="font-mono">unverified</span> ne sont pas verifies.
          </li>
        </ul>
        <nav aria-label="Sections de la documentation" className="mt-4 flex flex-wrap gap-3">
          {groupes.map(([tag]) => (
            <a key={tag} href={`#groupe-${tag}`} className="text-accent underline">
              {tag}
            </a>
          ))}
          <a href="#schemas" className="text-accent underline">
            Schemas
          </a>
        </nav>
      </section>

      {groupes.map(([tag, operations]) => (
        <section key={tag} id={`groupe-${tag}`} className="mt-8 border-t border-line pt-4">
          <h2 className="text-lg font-semibold">{tag}</h2>
          {operations.map((op) => {
            const corps = op.requestBody?.content['application/json']?.schema;
            return (
              <article key={op.operationId} id={op.operationId} className="mt-6">
                <h3 className="flex flex-wrap items-baseline gap-2">
                  <span className="rounded-sm border border-line-strong px-1.5 font-mono text-xs uppercase">
                    {op.method}
                  </span>
                  <span className="font-mono text-sm">{op.path}</span>
                </h3>
                <p className="mt-1 text-sm font-medium">{op.summary}</p>
                {op.description !== undefined && (
                  <p className="mt-1 text-sm text-text-soft">{op.description}</p>
                )}
                <p className="mt-1 text-xs text-text-faint">
                  Portee : <span className="font-mono">{op['x-scope'] ?? 'toute cle active'}</span>
                </p>
                <Parametres parametres={op.parameters} />
                {corps !== undefined && (
                  <div className="mt-3">
                    <h4 className="text-xs font-semibold text-text-faint">Corps</h4>
                    <Proprietes schema={corps} />
                  </div>
                )}
                <div className="mt-3">
                  <h4 className="text-xs font-semibold text-text-faint">Reponses</h4>
                  <ul className="mt-1 space-y-1 text-sm">
                    {Object.entries(op.responses).map(([statut, reponse]) => {
                      const schema = Object.values(reponse.content ?? {})[0]?.schema;
                      return (
                        <li key={statut}>
                          <span className="font-mono text-xs">{statut}</span>{' '}
                          <span className="text-text-soft">{reponse.description}</span>
                          {schema !== undefined && (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-xs text-text-faint">
                                Contenu
                              </summary>
                              <div className="mt-1">
                                <Proprietes schema={schema} />
                              </div>
                            </details>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </article>
            );
          })}
        </section>
      ))}

      <section id="schemas" className="mt-8 border-t border-line pt-4">
        <h2 className="text-lg font-semibold">Schemas</h2>
        {Object.entries(document.components.schemas).map(([nom, schema]) => (
          <article key={nom} id={`schema-${nom}`} className="mt-5">
            <h3 className="font-mono text-sm font-semibold">{nom}</h3>
            {schema.description !== undefined && (
              <p className="mt-1 text-sm text-text-soft">{schema.description}</p>
            )}
            <div className="mt-1">
              <Proprietes schema={schema} />
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
