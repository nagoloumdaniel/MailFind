/**
 * Lecture du document OpenAPI de l'API publique pour la page de
 * documentation. Seul ce que la page affiche est type : le document complet
 * reste la reference, telechargeable tel quel.
 */

export interface JsonSchema {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  $ref?: string;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  minimum?: number;
  maximum?: number;
  default?: unknown;
}

export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  description?: string;
  schema: JsonSchema;
}

export interface OpenApiOperation {
  operationId: string;
  tags: string[];
  summary: string;
  description?: string;
  'x-scope'?: string;
  parameters: OpenApiParameter[];
  requestBody?: { content: Record<string, { schema: JsonSchema }> };
  responses: Record<
    string,
    { description: string; content?: Record<string, { schema: JsonSchema }> }
  >;
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string }[];
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { schemas: Record<string, JsonSchema> };
}

export interface DocumentedOperation extends OpenApiOperation {
  method: string;
  path: string;
}

/** Le nom d'un schema reference : `#/components/schemas/Email` donne `Email`. */
export function refName(ref: string): string {
  return ref.split('/').at(-1) ?? ref;
}

/** Le type d'un schema, dit en une ligne : `string (uuid)`, `Email[]`, `"a" | "b"`, `integer | null`. */
export function typeLabel(schema: JsonSchema): string {
  if (schema.$ref !== undefined) return refName(schema.$ref);
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum !== undefined) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  const variantes = schema.anyOf ?? schema.oneOf;
  if (variantes !== undefined) return variantes.map(typeLabel).join(' | ');
  if (schema.type === 'array')
    return `${schema.items === undefined ? 'unknown' : typeLabel(schema.items)}[]`;
  const type = Array.isArray(schema.type) ? schema.type.join(' | ') : (schema.type ?? 'unknown');
  return schema.format === undefined ? type : `${type} (${schema.format})`;
}

/** Les operations, groupees par etiquette, dans l'ordre du document. */
export function groupOperations(document: OpenApiDocument): [string, DocumentedOperation[]][] {
  const groupes = new Map<string, DocumentedOperation[]>();
  for (const [path, operations] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      const tag = operation.tags[0] ?? 'Autres';
      groupes.set(tag, [...(groupes.get(tag) ?? []), { ...operation, method, path }]);
    }
  }
  return [...groupes.entries()];
}
