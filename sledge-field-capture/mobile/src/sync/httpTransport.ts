import { File } from 'expo-file-system';

import type { AppSettings } from '@/domain/settings';
import type { Attachment, ReportWithAttachments } from '@/domain/types';

import { SyncError, syncErrorFromStatus, toSyncError } from './errors';
import type { SyncTransport } from './syncEngine';

const REPORT_TIMEOUT_MS = 20_000;
const ATTACHMENT_TIMEOUT_MS = 90_000;

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new SyncError('Request timed out', 'timeout');
    throw toSyncError(error);
  } finally {
    clearTimeout(timer);
  }
}

function serverMessage(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === 'string' ? parsed.message : undefined;
  } catch {
    return undefined;
  }
}

export function createHttpTransport(getSettings: () => AppSettings): SyncTransport {
  const config = () => {
    const settings = getSettings();
    if (!settings.apiUrl) throw new SyncError('No server URL configured (see Settings)', 'config');
    const headers: Record<string, string> = {};
    if (settings.simulateFailure) headers['x-simulate-failure'] = '1';
    if (settings.simulatedLatencyMs > 0) headers['x-simulate-delay'] = String(settings.simulatedLatencyMs);
    return { baseUrl: settings.apiUrl, headers };
  };

  return {
    async uploadAttachment(report: ReportWithAttachments, attachment: Attachment) {
      const { baseUrl, headers } = config();
      const file = new File(attachment.localUri);
      if (!file.exists) {
        throw new SyncError(`The ${attachment.kind} file is missing from this device`, 'local');
      }

      const url = `${baseUrl}/v1/reports/${report.id}/attachments/${attachment.id}`;
      const result = await withTimeout(ATTACHMENT_TIMEOUT_MS, (signal) =>
        file.upload(url, {
          httpMethod: 'PUT',
          mimeType: attachment.mimeType,
          headers: {
            ...headers,
            'content-type': attachment.mimeType,
            'x-attachment-kind': attachment.kind,
            ...(attachment.durationMs ? { 'x-duration-ms': String(attachment.durationMs) } : {}),
          },
          signal,
        }),
      );
      if (result.status < 200 || result.status >= 300) {
        throw syncErrorFromStatus(result.status, serverMessage(result.body));
      }
    },

    async upsertReport(report: ReportWithAttachments) {
      const { baseUrl, headers } = config();
      const body = JSON.stringify({
        title: report.title,
        description: report.description,
        category: report.category,
        severity: report.severity,
        latitude: report.latitude,
        longitude: report.longitude,
        locationAccuracy: report.locationAccuracy,
        capturedAt: new Date(report.createdAt).toISOString(),
        attachments: report.attachments.map((a) => ({ id: a.id, kind: a.kind })),
      });

      const response = await withTimeout(REPORT_TIMEOUT_MS, (signal) =>
        fetch(`${baseUrl}/v1/reports/${report.id}`, {
          method: 'PUT',
          headers: { ...headers, 'content-type': 'application/json' },
          body,
          signal,
        }),
      );
      const text = await response.text();
      if (!response.ok) throw syncErrorFromStatus(response.status, serverMessage(text));

      try {
        const json = JSON.parse(text) as { deliveryCount?: number };
        return { deliveryCount: json.deliveryCount ?? 1 };
      } catch {
        return { deliveryCount: 1 };
      }
    },
  };
}
