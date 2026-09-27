import { describe, it, expect } from 'vitest';
import { pendingKeys, serialize } from './keyed-queue';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('serialize', () => {
  it('runs tasks for the same key one after another, in order', async () => {
    const log: string[] = [];
    const task = (name: string, ms: number) => async () => { log.push(`${name}:start`); await tick(ms); log.push(`${name}:end`); };
    await Promise.all([serialize('buyer', task('a', 20)), serialize('buyer', task('b', 1))]);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('runs different keys in parallel', async () => {
    const log: string[] = [];
    const task = (name: string, ms: number) => async () => { log.push(`${name}:start`); await tick(ms); log.push(`${name}:end`); };
    await Promise.all([serialize('x', task('x', 20)), serialize('y', task('y', 1))]);
    expect(log.indexOf('y:end')).toBeLessThan(log.indexOf('x:end'));
  });

  it('a failing task rejects for its caller but does not block the next one', async () => {
    const failed = serialize('k', async () => { throw new Error('boom'); });
    const next = serialize('k', async () => {});
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBeUndefined();
  });

  it('forgets a key once its queue drains', async () => {
    await serialize('temp', async () => {});
    await tick(0);
    expect(pendingKeys()).toBe(0);
  });
});
