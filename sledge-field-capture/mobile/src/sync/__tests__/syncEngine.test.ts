import { backoffDelay, DEFAULT_BACKOFF } from '../backoff';
import { SyncError } from '../errors';
import { SyncEngine, type SyncEngineOptions } from '../syncEngine';

import { FakeTransport, makeAttachment, makeReport, MemoryStore } from './fakes';

function setup(store: MemoryStore, overrides: Partial<SyncEngineOptions> = {}) {
  const transport = new FakeTransport();
  let online = true;
  let clock = 1_000_000;
  const timers: { fn: () => void; ms: number }[] = [];
  const engine = new SyncEngine({
    store,
    transport,
    isOnline: () => online,
    now: () => clock,
    random: () => 0.5, // no jitter
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      const i = timers.indexOf(t as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
    ...overrides,
  });
  return {
    engine,
    transport,
    timers,
    setOnline: (v: boolean) => (online = v),
    advance: (ms: number) => (clock += ms),
  };
}

describe('SyncEngine', () => {
  it('uploads attachments before the report and marks it synced', async () => {
    const report = makeReport();
    report.attachments = [makeAttachment(report.id), makeAttachment(report.id, { kind: 'audio' })];
    const store = new MemoryStore([report]);
    const { engine, transport } = setup(store);

    const result = await engine.requestSync('manual');

    expect(result).toEqual({ synced: 1, failed: 0, skippedOffline: false });
    expect(transport.attachmentCalls).toEqual(report.attachments.map((a) => a.id));
    expect(transport.reportCalls).toEqual([report.id]);
    expect(store.get(report.id).syncStatus).toBe('synced');
    expect(store.events.map((e) => e.type)).toEqual([
      'sync_started',
      'attachment_uploaded',
      'attachment_uploaded',
      'synced',
    ]);
  });

  it('does nothing while offline and leaves reports pending', async () => {
    const report = makeReport();
    const store = new MemoryStore([report]);
    const { engine, transport, setOnline } = setup(store);
    setOnline(false);

    const result = await engine.requestSync('created');

    expect(result.skippedOffline).toBe(true);
    expect(transport.reportCalls).toHaveLength(0);
    expect(store.get(report.id).syncStatus).toBe('pending');
  });

  it('marks retryable failures as error and schedules a backoff retry', async () => {
    const report = makeReport();
    const store = new MemoryStore([report]);
    const { engine, transport, timers } = setup(store);
    transport.onReport = () => {
      throw new SyncError('Server unavailable (503)', 'server', 503);
    };

    await engine.requestSync('manual');

    const saved = store.get(report.id);
    expect(saved.syncStatus).toBe('error');
    expect(saved.errorRetryable).toBe(true);
    expect(saved.attempts).toBe(1);
    expect(saved.nextAttemptAt).toBe(1_000_000 + DEFAULT_BACKOFF.baseMs);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(DEFAULT_BACKOFF.baseMs);
  });

  it('retries automatically when the backoff timer fires', async () => {
    const report = makeReport();
    const store = new MemoryStore([report]);
    const { engine, transport, timers, advance } = setup(store);
    let fail = true;
    transport.onReport = () => {
      if (fail) throw new SyncError('Server unavailable (503)', 'server', 503);
      return { deliveryCount: 1 };
    };

    await engine.requestSync('manual');
    fail = false;
    advance(DEFAULT_BACKOFF.baseMs);
    timers[0]?.fn();
    await engine.requestSync('backoff'); // joins the in-flight run started by the timer

    expect(store.get(report.id).syncStatus).toBe('synced');
    expect(store.get(report.id).attempts).toBe(0);
  });

  it('does not auto-retry permanent (4xx) failures', async () => {
    const report = makeReport();
    const store = new MemoryStore([report]);
    const { engine, transport, timers } = setup(store);
    transport.onReport = () => {
      throw new SyncError('Server rejected the report (422)', 'client', 422);
    };

    await engine.requestSync('manual');
    await engine.handleReconnect();

    expect(store.get(report.id).errorRetryable).toBe(false);
    expect(store.get(report.id).nextAttemptAt).toBeNull();
    expect(transport.reportCalls).toHaveLength(1);
    expect(timers).toHaveLength(0);
  });

  it('retries failed reports immediately on reconnect, without waiting for backoff', async () => {
    const report = makeReport();
    const store = new MemoryStore([report]);
    const { engine, transport, setOnline } = setup(store);
    transport.onReport = () => {
      throw new SyncError('Network unavailable', 'network');
    };
    await engine.requestSync('manual');
    expect(store.get(report.id).syncStatus).toBe('error');

    setOnline(true);
    transport.onReport = () => ({ deliveryCount: 2 });
    await engine.handleReconnect();

    expect(store.get(report.id).syncStatus).toBe('synced');
    expect(store.get(report.id).deliveryCount).toBe(2);
  });

  it('skips attachments the server already acknowledged when retrying', async () => {
    const report = makeReport();
    const [a1, a2] = [makeAttachment(report.id), makeAttachment(report.id)];
    report.attachments = [a1, a2];
    const store = new MemoryStore([report]);
    const { engine, transport } = setup(store);
    transport.onAttachment = (_r, att) => {
      if (att?.id === a2.id && transport.attachmentCalls.length === 2) throw new SyncError('Request timed out', 'timeout');
    };

    await engine.requestSync('manual');
    expect(store.get(report.id).attachments.map((a) => a.uploaded)).toEqual([true, false]);

    await engine.handleReconnect();

    expect(transport.attachmentCalls).toEqual([a1.id, a2.id, a2.id]);
    expect(store.get(report.id).syncStatus).toBe('synced');
  });

  it('re-sends all attachments after a 409 conflict', async () => {
    const report = makeReport();
    report.attachments = [makeAttachment(report.id)];
    const store = new MemoryStore([report]);
    const { engine, transport } = setup(store);
    let first = true;
    transport.onReport = () => {
      if (first) {
        first = false;
        throw new SyncError('Server is missing attachments (409)', 'conflict', 409);
      }
      return { deliveryCount: 1 };
    };

    await engine.requestSync('manual');
    expect(store.get(report.id).attachments[0]?.uploaded).toBe(false);
    await engine.handleReconnect();

    expect(transport.attachmentCalls).toHaveLength(2);
    expect(store.get(report.id).syncStatus).toBe('synced');
  });

  it('stops the batch on a connectivity failure so other reports keep their attempts', async () => {
    const reports = [makeReport(), makeReport(), makeReport()];
    const store = new MemoryStore(reports);
    const { engine, transport } = setup(store);
    transport.onReport = () => {
      throw new SyncError('Network unavailable', 'network');
    };

    await engine.requestSync('manual');

    expect(transport.reportCalls).toEqual([reports[0]?.id]);
    expect(store.get(reports[1]!.id).syncStatus).toBe('pending');
    expect(store.get(reports[2]!.id).syncStatus).toBe('pending');
  });

  it('continues the batch after a non-connectivity failure', async () => {
    const [bad, good] = [makeReport(), makeReport()];
    const store = new MemoryStore([bad, good]);
    const { engine, transport } = setup(store);
    transport.onReport = (r) => {
      if (r.id === bad.id) throw new SyncError('Server rejected the report (422)', 'client', 422);
      return { deliveryCount: 1 };
    };

    const result = await engine.requestSync('manual');

    expect(result).toEqual({ synced: 1, failed: 1, skippedOffline: false });
    expect(store.get(good.id).syncStatus).toBe('synced');
  });

  it('coalesces concurrent triggers into a single upload per report', async () => {
    const report = makeReport();
    const store = new MemoryStore([report]);
    const { engine, transport } = setup(store);
    let release!: () => void;
    transport.onReport = () =>
      new Promise((resolve) => {
        release = () => resolve({ deliveryCount: 1 });
      });

    const runs = [engine.requestSync('created'), engine.requestSync('reconnect'), engine.requestSync('manual')];
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all(runs);

    expect(transport.reportCalls).toEqual([report.id]);
  });

  it('picks up reports created while a run is in flight', async () => {
    const first = makeReport();
    const store = new MemoryStore([first]);
    const { engine, transport } = setup(store);
    const late = makeReport();
    transport.onReport = (r) => {
      if (r.id === first.id) store.reports.set(late.id, structuredClone(late));
      return { deliveryCount: 1 };
    };

    const run = engine.requestSync('manual');
    void engine.requestSync('created');
    await run;

    expect(transport.reportCalls).toEqual([first.id, late.id]);
  });

  it('recovers reports stuck in syncing after a crash', async () => {
    const report = makeReport({ syncStatus: 'syncing' });
    const store = new MemoryStore([report]);
    const { engine } = setup(store);

    await engine.start();

    expect(store.get(report.id).syncStatus).toBe('synced');
  });

  it('treats unknown thrown errors as retryable network failures', async () => {
    const report = makeReport();
    const store = new MemoryStore([report]);
    const { engine, transport } = setup(store);
    transport.onReport = () => {
      throw new TypeError('Network request failed');
    };

    await engine.requestSync('manual');

    expect(store.get(report.id).errorRetryable).toBe(true);
    expect(store.get(report.id).lastError).toMatch(/Network unavailable/);
  });
});

describe('backoffDelay', () => {
  const noJitter = () => 0.5;

  it('doubles each attempt and caps at the max', () => {
    expect(backoffDelay(1, DEFAULT_BACKOFF, noJitter)).toBe(5_000);
    expect(backoffDelay(2, DEFAULT_BACKOFF, noJitter)).toBe(10_000);
    expect(backoffDelay(3, DEFAULT_BACKOFF, noJitter)).toBe(20_000);
    expect(backoffDelay(20, DEFAULT_BACKOFF, noJitter)).toBe(DEFAULT_BACKOFF.maxMs);
  });

  it('applies jitter within ±20%', () => {
    expect(backoffDelay(1, DEFAULT_BACKOFF, () => 0)).toBe(4_000);
    expect(backoffDelay(1, DEFAULT_BACKOFF, () => 1)).toBe(6_000);
  });
});
