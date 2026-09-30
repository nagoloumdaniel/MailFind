import { z } from 'zod';

/**
 * Ce que l'API publique rend, decrit une seule fois. Le document OpenAPI en
 * est tire, et les tests de contrat valident les vraies reponses avec ces
 * memes schemas (A8) : si le code s'ecarte du document, un test echoue.
 *
 * Objets stricts : un champ ajoute a une reponse sans etre documente est un
 * ecart, pas un detail.
 */

const date = z.iso.datetime({ offset: true });
const texteOuNul = z.string().nullable();

export const EMAIL_STATUSES = [
  'valid',
  'accept_all',
  'risky',
  'unknown',
  'invalid',
  'disposable',
  'suppressed',
  'unverified',
] as const;
export const EMAIL_TYPE_VALUES = [
  'recruitment',
  'hr',
  'generic',
  'sales',
  'press',
  'support',
  'personal',
  'unknown',
] as const;
export const EMAIL_ORIGINS = ['found', 'provider', 'deduced', 'imported', 'manual'] as const;

export const problemSchema = z
  .strictObject({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.string().describe('Code stable, en anglais : celui que lit un programme.'),
    detail: z.string().optional(),
    requestId: z.string().optional(),
  })
  .meta({ id: 'Problem', description: 'Erreur au format RFC 9457 (application/problem+json).' });

export const sourceSchema = z
  .strictObject({
    kind: z.enum(['website', 'provider', 'import', 'deduction', 'manual']),
    url: texteOuNul,
    provider: texteOuNul,
    discovered_at: date,
  })
  .meta({ id: 'Source', description: "D'ou vient une adresse : toute adresse en a au moins une." });

export const emailSchema = z
  .strictObject({
    id: z.uuid(),
    company_id: z.uuid(),
    address: z.string(),
    contact_name: texteOuNul,
    type: z.enum(EMAIL_TYPE_VALUES),
    origin: z.enum(EMAIL_ORIGINS),
    status: z
      .enum(EMAIL_STATUSES)
      .describe(
        'Un statut, jamais une promesse : accept_all, unknown et unverified ne sont pas verifies.',
      ),
    score: z.number().int().min(0).max(100).nullable(),
    verified_at: date.nullable(),
    excluded: z.boolean().describe('Hors des exports et des envois.'),
    tags: z.array(z.string()),
    created_at: date,
    sources: z.array(sourceSchema),
  })
  .meta({ id: 'Email' });

export const emailWithCompanySchema = emailSchema
  .extend({ company_name: z.string(), company_domain: texteOuNul })
  .meta({ id: 'EmailWithCompany' });

export const companySchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string(),
    legal_name: texteOuNul,
    domain: texteOuNul,
    domain_status: z.enum(['unknown', 'provided', 'confirmed', 'to_confirm']),
    website_url: texteOuNul,
    careers_url: texteOuNul,
    contact_form_url: texteOuNul,
    siren: texteOuNul,
    city: texteOuNul,
    country: texteOuNul,
    industry: texteOuNul,
    tags: z.array(z.string()),
    crawl_status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']),
    created_at: date,
  })
  .meta({ id: 'Company' });

export const companyListItemSchema = companySchema
  .extend({ emails_count: z.number().int() })
  .meta({ id: 'CompanyListItem' });

export const companyWithEmailsSchema = companySchema
  .extend({ emails: z.array(emailSchema) })
  .meta({ id: 'CompanyWithEmails' });

export const importSchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string(),
    status: z.enum(['pending', 'planning', 'running', 'cancelled', 'completed', 'failed']),
    total_rows: z.number().int(),
    processed_rows: z.number().int(),
    accepted_rows: z.number().int(),
    duplicate_rows: z.number().int(),
    rejected_rows: z.number().int(),
    error: texteOuNul,
    created_at: date,
    completed_at: date.nullable(),
  })
  .meta({ id: 'Import' });

const etapeSchema = z.strictObject({
  pending: z.number().int(),
  running: z.number().int(),
  done: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
});

export const progressSchema = z
  .strictObject({
    companies: z.number().int(),
    steps: z.strictObject({
      identify: etapeSchema,
      crawl: etapeSchema,
      enrich: etapeSchema,
      verify: etapeSchema,
    }),
    emails: z.number().int(),
    emails_by_status: z.record(z.string(), z.number().int()),
  })
  .meta({ id: 'ImportProgress' });

export const verifyResultSchema = z
  .strictObject({
    input: z.string(),
    address: texteOuNul,
    status: z.enum(EMAIL_STATUSES),
    reason: z.string(),
    type: z.enum(EMAIL_TYPE_VALUES),
    webmail: z.boolean(),
  })
  .meta({ id: 'VerifyResult' });

export const verificationRunSchema = z
  .strictObject({
    id: z.uuid(),
    status: z.enum(['pending', 'running', 'done', 'failed']),
    total: z.number().int(),
    error: texteOuNul,
    created_at: date,
    completed_at: date.nullable(),
  })
  .meta({ id: 'VerificationRun' });

export const exportSchema = z
  .strictObject({
    id: z.uuid(),
    format: z.string(),
    status: z.enum(['pending', 'running', 'done', 'failed', 'expired']),
    row_count: z.number().int().nullable(),
    filename: texteOuNul,
    error: texteOuNul,
    created_at: date,
    completed_at: date.nullable(),
    expires_at: date.nullable(),
    download_url: texteOuNul.describe('Avec la meme cle, jusqu a expires_at.'),
  })
  .meta({ id: 'Export' });

export const usageSchema = z
  .strictObject({
    period: z.strictObject({ start: date, end: date }),
    meters: z.array(
      z.strictObject({
        provider: z.string(),
        operation: z.string(),
        used: z.number().int(),
        limit: z.number().int(),
        remaining: z.number().int(),
      }),
    ),
  })
  .meta({ id: 'Usage' });

export const WEBHOOK_EVENT_VALUES = [
  'import.completed',
  'import.failed',
  'verification.completed',
  'export.ready',
] as const;

export const webhookSchema = z
  .strictObject({
    id: z.uuid(),
    url: z.string(),
    events: z.array(z.enum(WEBHOOK_EVENT_VALUES)),
    description: texteOuNul,
    secret_prefix: z.string().describe('Le debut du secret, pour le reconnaitre.'),
    created_at: date,
  })
  .meta({ id: 'Webhook' });

export const deliverySchema = z
  .strictObject({
    id: z.uuid(),
    event_id: z.uuid(),
    event_type: z.string(),
    status: z.enum(['pending', 'succeeded', 'failed']),
    attempts: z.number().int(),
    last_status_code: z.number().int().nullable(),
    last_error: texteOuNul,
    created_at: date,
    last_attempt_at: date.nullable(),
    delivered_at: date.nullable(),
  })
  .meta({ id: 'WebhookDelivery' });

export const webhookEventSchema = z
  .strictObject({
    id: z.uuid().describe("Identifiant de l'evenement : a garder pour ignorer un doublon."),
    type: z.enum(WEBHOOK_EVENT_VALUES),
    created_at: date,
    data: z
      .record(z.string(), z.unknown())
      .describe("L'identifiant et le statut de la ressource ; le reste se lit par l'API."),
  })
  .meta({ id: 'WebhookEvent' });

export const campaignMailerPushSchema = z
  .strictObject({
    id: z.uuid(),
    campaign_name: z.string(),
    status: z.enum(['pending', 'running', 'done', 'failed']),
    campaign_id: texteOuNul.describe("L'identifiant du brouillon dans Campaign Mailer."),
    campaign_url: texteOuNul.describe('Le brouillon, dans Campaign Mailer.'),
    batches_total: z.number().int().nullable(),
    batches_done: z.number().int(),
    sent: z.number().int(),
    imported: z.number().int(),
    rejected: z.number().int(),
    skipped: z
      .number()
      .int()
      .describe('Adresses que Campaign Mailer refuserait, laissees de cote.'),
    error: texteOuNul,
    created_at: date,
    completed_at: date.nullable(),
  })
  .meta({ id: 'CampaignMailerPush' });

export const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    data: z.array(item),
    next_cursor: z
      .string()
      .nullable()
      .describe('A repasser dans cursor ; nul sur la derniere page.'),
  });

export const findCachedSchema = z
  .strictObject({
    company: companySchema,
    emails: z.array(emailSchema),
    alternatives: z.strictObject({
      contact_form_url: texteOuNul,
      careers_url: texteOuNul,
      linkedin_url: texteOuNul,
      phone: texteOuNul,
    }),
    cached: z.literal(true),
  })
  .meta({ id: 'FindResult', description: 'Annexe C du cahier des charges.' });

export const findPendingSchema = z
  .strictObject({
    status: z.literal('pending'),
    import_id: z.uuid(),
    company_id: z.uuid().nullable(),
  })
  .meta({ id: 'FindPending' });
