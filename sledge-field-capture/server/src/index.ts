import { Hono } from 'hono';
import { logger } from 'hono/logger';

import { viewerHtml } from './viewer';

type Bindings = {
  DB: D1Database;
  FILES: KVNamespace;
};

type AttachmentKind = 'photo' | 'audio';

const CATEGORIES = ['safety', 'defect', 'progress', 'inspection'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const ATTACHMENT_KINDS: readonly AttachmentKind[] = ['photo', 'audio'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Workers KV caps values at 25 MB; compressed photos and voice notes are far smaller.
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_SIMULATED_DELAY_MS = 5000;

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', logger());

app.get('/', (c) => c.html(viewerHtml));
app.get('/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

/**
 * Developer fault injection for demos and testing. The mobile app's Settings
 * screen exposes both toggles; real clients never send these headers.
 */
app.use('/v1/*', async (c, next) => {
  const delay = Math.min(Number(c.req.header('x-simulate-delay')) || 0, MAX_SIMULATED_DELAY_MS);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

  if (c.req.method !== 'GET' && c.req.header('x-simulate-failure') === '1') {
    return c.json(
      { error: 'simulated_failure', message: 'Simulated server outage (developer toggle)' },
      503,
    );
  }
  await next();
});

/** Idempotent binary upload of a single attachment. Safe to repeat. */
app.put('/v1/reports/:reportId/attachments/:attachmentId', async (c) => {
  const { reportId, attachmentId } = c.req.param();
  if (!UUID_RE.test(reportId) || !UUID_RE.test(attachmentId)) {
    return c.json({ error: 'invalid_id', message: 'Report and attachment ids must be UUIDs' }, 400);
  }

  const kind = c.req.header('x-attachment-kind') as AttachmentKind | undefined;
  if (!kind || !ATTACHMENT_KINDS.includes(kind)) {
    return c.json({ error: 'invalid_kind', message: 'x-attachment-kind must be photo or audio' }, 400);
  }

  const contentType = c.req.header('content-type') ?? 'application/octet-stream';
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) {
    return c.json({ error: 'empty_body', message: 'Attachment body is empty' }, 400);
  }
  if (body.byteLength > MAX_ATTACHMENT_BYTES) {
    return c.json({ error: 'too_large', message: 'Attachment exceeds 15 MB' }, 413);
  }

  const durationHeader = Number(c.req.header('x-duration-ms'));
  const durationMs = Number.isFinite(durationHeader) && durationHeader > 0 ? durationHeader : null;

  await c.env.FILES.put(attachmentId, body, { metadata: { contentType, reportId } });
  await c.env.DB.prepare(
    `INSERT INTO attachments (id, report_id, kind, content_type, size_bytes, duration_ms, uploaded_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (id) DO UPDATE SET
       content_type = excluded.content_type,
       size_bytes   = excluded.size_bytes,
       duration_ms  = excluded.duration_ms,
       uploaded_at  = excluded.uploaded_at`,
  )
    .bind(attachmentId, reportId, kind, contentType, body.byteLength, durationMs, new Date().toISOString())
    .run();

  return c.json({ id: attachmentId, sizeBytes: body.byteLength });
});

/**
 * Idempotent report upsert keyed by the client UUID. The client uploads
 * attachments first, so a report referencing a missing attachment means an
 * earlier upload was lost; 409 tells the client to resend them.
 */
app.put('/v1/reports/:reportId', async (c) => {
  const { reportId } = c.req.param();
  if (!UUID_RE.test(reportId)) {
    return c.json({ error: 'invalid_id', message: 'Report id must be a UUID' }, 400);
  }

  const parsed = parseReport(await c.req.json().catch(() => null));
  if (!parsed.ok) return c.json({ error: 'validation_failed', message: parsed.error }, 422);
  const report = parsed.value;

  if (report.attachmentIds.length > 0) {
    const placeholders = report.attachmentIds.map((_, i) => `?${i + 2}`).join(', ');
    const { results } = await c.env.DB.prepare(
      `SELECT id FROM attachments WHERE report_id = ?1 AND id IN (${placeholders})`,
    )
      .bind(reportId, ...report.attachmentIds)
      .all<{ id: string }>();
    const present = new Set(results.map((r) => r.id));
    const missing = report.attachmentIds.filter((id) => !present.has(id));
    if (missing.length > 0) {
      return c.json({ error: 'attachments_missing', message: 'Some attachments were not received', missing }, 409);
    }
  }

  const now = new Date().toISOString();
  const row = await c.env.DB.prepare(
    `INSERT INTO reports (id, title, description, category, severity, latitude, longitude,
                          location_accuracy, captured_at, received_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
     ON CONFLICT (id) DO UPDATE SET
       title             = excluded.title,
       description       = excluded.description,
       category          = excluded.category,
       severity          = excluded.severity,
       latitude          = excluded.latitude,
       longitude         = excluded.longitude,
       location_accuracy = excluded.location_accuracy,
       updated_at        = excluded.updated_at,
       delivery_count    = reports.delivery_count + 1
     RETURNING received_at, delivery_count`,
  )
    .bind(
      reportId,
      report.title,
      report.description,
      report.category,
      report.severity,
      report.latitude,
      report.longitude,
      report.locationAccuracy,
      report.capturedAt,
      now,
    )
    .first<{ received_at: string; delivery_count: number }>();

  return c.json({ id: reportId, receivedAt: row?.received_at ?? now, deliveryCount: row?.delivery_count ?? 1 });
});

app.get('/v1/reports', async (c) => {
  const [reports, attachments] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM reports ORDER BY received_at DESC LIMIT 100'),
    c.env.DB.prepare(
      `SELECT id, report_id, kind, content_type, size_bytes, duration_ms FROM attachments
       WHERE report_id IN (SELECT id FROM reports ORDER BY received_at DESC LIMIT 100)`,
    ),
  ]);

  const byReport = new Map<string, unknown[]>();
  for (const a of (attachments?.results ?? []) as Record<string, unknown>[]) {
    const list = byReport.get(a.report_id as string) ?? [];
    list.push({ ...a, url: `/files/${a.id as string}` });
    byReport.set(a.report_id as string, list);
  }

  const items = ((reports?.results ?? []) as Record<string, unknown>[]).map((r) => ({
    ...r,
    attachments: byReport.get(r.id as string) ?? [],
  }));
  return c.json({ items });
});

app.get('/files/:attachmentId', async (c) => {
  const { value, metadata } = await c.env.FILES.getWithMetadata<{ contentType?: string }>(
    c.req.param('attachmentId'),
    'stream',
  );
  if (!value) return c.notFound();
  return new Response(value, {
    headers: {
      'content-type': metadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
});

type ParsedReport = {
  title: string;
  description: string;
  category: string;
  severity: string;
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  capturedAt: string;
  attachmentIds: string[];
};

function parseReport(input: unknown): { ok: true; value: ParsedReport } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Body must be a JSON object' };
  const b = input as Record<string, unknown>;

  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (title.length === 0 || title.length > 120) return { ok: false, error: 'title must be 1–120 characters' };

  const description = typeof b.description === 'string' ? b.description : '';
  if (description.length > 5000) return { ok: false, error: 'description must be ≤ 5000 characters' };

  if (!CATEGORIES.includes(b.category as (typeof CATEGORIES)[number])) {
    return { ok: false, error: `category must be one of ${CATEGORIES.join(', ')}` };
  }
  if (!SEVERITIES.includes(b.severity as (typeof SEVERITIES)[number])) {
    return { ok: false, error: `severity must be one of ${SEVERITIES.join(', ')}` };
  }

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const latitude = num(b.latitude);
  const longitude = num(b.longitude);
  if (latitude !== null && (latitude < -90 || latitude > 90)) return { ok: false, error: 'latitude out of range' };
  if (longitude !== null && (longitude < -180 || longitude > 180)) return { ok: false, error: 'longitude out of range' };

  const capturedAt = typeof b.capturedAt === 'string' ? b.capturedAt : '';
  if (Number.isNaN(Date.parse(capturedAt))) return { ok: false, error: 'capturedAt must be an ISO date' };

  const rawAttachments = Array.isArray(b.attachments) ? b.attachments : [];
  const attachmentIds: string[] = [];
  for (const a of rawAttachments) {
    const id = (a as { id?: unknown })?.id;
    if (typeof id !== 'string' || !UUID_RE.test(id)) return { ok: false, error: 'attachment ids must be UUIDs' };
    attachmentIds.push(id);
  }

  return {
    ok: true,
    value: {
      title,
      description,
      category: b.category as string,
      severity: b.severity as string,
      latitude,
      longitude,
      locationAccuracy: num(b.locationAccuracy),
      capturedAt,
      attachmentIds,
    },
  };
}

export default app;
