import { describe, expect, it } from 'vitest';
import { groupOperations, refName, typeLabel, type OpenApiDocument } from './openapi';

describe('typeLabel', () => {
  it('dit un type en une ligne', () => {
    expect(typeLabel({ type: 'string', format: 'uuid' })).toBe('string (uuid)');
    expect(typeLabel({ type: 'array', items: { $ref: '#/components/schemas/Email' } })).toBe(
      'Email[]',
    );
    expect(typeLabel({ enum: ['valid', 'accept_all'] })).toBe('"valid" | "accept_all"');
    expect(typeLabel({ anyOf: [{ type: 'integer' }, { type: 'null' }] })).toBe('integer | null');
    expect(typeLabel({ const: true })).toBe('true');
    expect(refName('#/components/schemas/Problem')).toBe('Problem');
  });
});

describe('groupOperations', () => {
  it('range les operations par etiquette, dans l ordre du document', () => {
    const operation = (tag: string) => ({
      operationId: tag,
      tags: [tag],
      summary: tag,
      parameters: [],
      responses: {},
    });
    const document = {
      paths: {
        '/imports': { post: operation('Imports') },
        '/companies': { get: operation('Entreprises'), post: operation('Entreprises') },
      },
    } as unknown as OpenApiDocument;
    expect(
      groupOperations(document).map(([tag, ops]) => [tag, ops.map((o) => `${o.method} ${o.path}`)]),
    ).toEqual([
      ['Imports', ['post /imports']],
      ['Entreprises', ['get /companies', 'post /companies']],
    ]);
  });
});
