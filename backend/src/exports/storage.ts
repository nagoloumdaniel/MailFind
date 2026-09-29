import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getEnvironment } from '../config/env.js';

/**
 * Ou vivent les exports volumineux pendant leurs sept jours (F-1104) :
 * Cloudflare R2 en production, la memoire dans les tests.
 */
export interface ExportStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | undefined>;
  remove(key: string): Promise<void>;
}

export function createMemoryStorage(): ExportStorage & { readonly keys: () => string[] } {
  const objets = new Map<string, Buffer>();
  return {
    put: (key, body) => {
      objets.set(key, body);
      return Promise.resolve();
    },
    get: (key) => Promise.resolve(objets.get(key)),
    remove: (key) => {
      objets.delete(key);
      return Promise.resolve();
    },
    keys: () => [...objets.keys()],
  };
}

/** R2, ou rien si ses variables ne sont pas renseignees : l'export volumineux le dira. */
export function createR2Storage(): ExportStorage | undefined {
  const {
    R2_ENDPOINT: endpoint,
    R2_BUCKET: bucket,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
  } = getEnvironment();
  if (endpoint === '' || bucket === '' || accessKeyId === '' || secretAccessKey === '') {
    return undefined;
  }

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return {
    put: async (key, body, contentType) => {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    get: async (key) => {
      try {
        const objet = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const octets = await objet.Body?.transformToByteArray();
        return octets === undefined ? undefined : Buffer.from(octets);
      } catch (error) {
        if (error instanceof Error && error.name === 'NoSuchKey') return undefined;
        throw error;
      }
    },
    remove: async (key) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
