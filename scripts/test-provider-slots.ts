import assert from 'node:assert/strict';
import { normalizeProvider, ProviderSlotRegistry } from '../src/utils/providerSlots.ts';

assert.equal(normalizeProvider('google-native'), 'GEMINI-NATIVE');
assert.equal(normalizeProvider('vertex_ai'), 'VERTEX');
assert.equal(normalizeProvider('google_flow'), 'GFLOW');

const slots = new ProviderSlotRegistry();
assert.equal(slots.tryAcquire('gflow', 'job-1'), true);
assert.equal(slots.tryAcquire('GOOGLE_FLOW', 'job-2'), true);
assert.equal(slots.tryAcquire('gflow', 'job-3'), false);
assert.deepEqual(slots.currentJobs().sort(), ['job-1', 'job-2']);
assert.equal(slots.release('job-1'), true);
assert.equal(slots.tryAcquire('gflow', 'job-3'), true);
assert.equal(slots.activeCount('gflow'), 2);
assert.equal(slots.maxSlots('gflow'), 2);
assert.deepEqual(slots.currentJobs().sort(), ['job-2', 'job-3']);
assert.equal(slots.providerMaxSlots().GFLOW, 2);
assert.equal(slots.tryAcquire('vidtory-sdk', 'vid-1'), true);
assert.equal(slots.tryAcquire('VIDTORY', 'vid-2'), true);
assert.equal(slots.tryAcquire('vidtory-sdk', 'vid-3'), false);
assert.deepEqual(slots.providerCurrentJobs().GFLOW.sort(), ['job-2', 'job-3']);
assert.deepEqual(slots.providerCurrentJobs()['VIDTORY-SDK'].sort(), ['vid-1', 'vid-2']);
assert.equal(slots.activeCount(), 4, 'full GFlow must not block Vidtory slots');
slots.configure({}, { GFLOW: false, 'VIDTORY-SDK': true, DREAMINA: false });
assert.equal(slots.maxSlots('gflow'), 0);
assert.equal(slots.providerMaxSlots().GFLOW, 0);
assert.equal(slots.tryAcquire('gflow', 'job-disabled'), false);
assert.equal(slots.tryAcquire('dreamina', 'dream-disabled'), false);
assert.equal(slots.tryAcquire('vidtory', 'vid-3'), false, 'enabled provider still honors its occupied slots');
assert.deepEqual(slots.disabledProviders().sort(), ['DREAMINA', 'GFLOW']);

const zeroCapacity = new ProviderSlotRegistry();
zeroCapacity.configure({ GFLOW: 0 });
assert.equal(zeroCapacity.maxSlots('gflow'), 0, 'explicit zero capacity must remain a provider kill-switch');
assert.equal(zeroCapacity.providerMaxSlots().GFLOW, 0);
assert.equal(zeroCapacity.tryAcquire('gflow', 'must-not-run'), false);
console.log('provider slot tests passed');
