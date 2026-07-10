import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectRequestCoordinator } from '../projectRequests';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('deduplicates an in-flight project read and promotes it to primary', async () => {
  const coordinator = new ProjectRequestCoordinator<string[]>();
  const pending = deferred<string[]>();
  const commits: Array<{ value: string[]; primary: boolean }> = [];
  let loads = 0;
  const load = () => { loads += 1; return pending.promise; };
  const commit = (value: string[], primary: boolean) => commits.push({ value, primary });

  const first = coordinator.request('/repo', false, load, commit);
  const second = coordinator.request('/repo', true, load, commit);
  assert.equal(first, second);
  assert.equal(loads, 0, 'loading starts on a microtask so callers can deduplicate first');

  pending.resolve(['session']);
  await Promise.all([first, second]);
  assert.equal(loads, 1);
  assert.deepEqual(commits, [{ value: ['session'], primary: true }]);
});

test('a late response from the previous primary project cannot commit', async () => {
  const coordinator = new ProjectRequestCoordinator<string>();
  const projectA = deferred<string>();
  const projectB = deferred<string>();
  const commits: string[] = [];
  let signalA: AbortSignal | undefined;

  const requestA = coordinator.request('/a', true, (signal) => {
    signalA = signal;
    return projectA.promise;
  }, (value) => commits.push(value));
  await Promise.resolve();
  const requestB = coordinator.request('/b', true, () => projectB.promise, (value) => commits.push(value));
  assert.equal(signalA?.aborted, true);

  projectB.resolve('B');
  projectA.resolve('A');
  await Promise.all([requestA, requestB]);
  assert.deepEqual(commits, ['B']);
});

test('dispose aborts pending reads and suppresses their commits', async () => {
  const coordinator = new ProjectRequestCoordinator<string>();
  const pending = deferred<string>();
  const commits: string[] = [];
  let signal: AbortSignal | undefined;
  const request = coordinator.request('/repo', false, (nextSignal) => {
    signal = nextSignal;
    return pending.promise;
  }, (value) => commits.push(value));
  await Promise.resolve();

  coordinator.dispose();
  assert.equal(signal?.aborted, true);
  pending.resolve('late');
  await request;
  assert.deepEqual(commits, []);
});
