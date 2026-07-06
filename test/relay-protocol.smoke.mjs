/**
 * Standalone smoke test for @kaitox/relay-protocol: exercises only the
 * package's public exports (HttpRelayClient + base64 helpers) against an
 * in-process relay, the way a third-party integration would.
 *
 * Lives at the repo root (not inside the package) so relay-protocol never
 * grows a devDependency back onto @kaitox/relay.
 *
 * Usage: npm run test:protocol (builds first).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must be set before importing the relay — config reads env on each call.
const home = await mkdtemp(join(tmpdir(), 'kaitox-ptest-'));
process.env.KAITOX_HOME = home;
process.env.KAITOX_RELAY_PORT = '8790';

const { startRelay } = await import('@kaitox/relay');
const { HttpRelayClient, bytesToBase64, base64ToBytes } = await import('@kaitox/relay-protocol');

const BASE = 'http://127.0.0.1:8790';
let pass = 0,
  fail = 0;
const check = (n, c, extra = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '✅' : '❌'} ${n} ${extra}`);
};

const bytes = Uint8Array.from([137, 80, 78, 71, 0, 255, 1, 2]);

const handle = await startRelay();
try {
  const client = new HttpRelayClient(BASE);

  // base64 round-trip (both directions of the wire encoding).
  const back = base64ToBytes(bytesToBase64(bytes));
  check('base64 round-trip', back.length === bytes.length && back.every((b, i) => b === bytes[i]));

  // health
  const health = await client.health();
  check('health ok', health.ok === true && typeof health.version === 'string');

  // postDraft (third-party kind/source pass through untouched)
  const { id } = await client.postDraft({
    kind: 'my-feature',
    title: 'protocol smoke',
    markdown: 'hello ![i](a.bin)',
    mode: 'rich',
    source: 'my-service',
    assets: [{ key: 'img-0', src: 'a.bin', fileName: 'a.bin', mime: 'application/octet-stream', bytes }],
  });
  check('postDraft returns id', typeof id === 'string' && id.length > 0);

  // listDrafts
  const listed = (await client.listDrafts()).find((d) => d.id === id);
  check('listDrafts contains draft', !!listed);
  check('kind passes through', listed?.kind === 'my-feature');
  check('source passes through', listed?.source === 'my-service');

  // getDraft
  const draft = await client.getDraft(id);
  check('getDraft returns bundle', draft.markdown === 'hello ![i](a.bin)' && draft.status === 'pending');

  // getAsset
  const got = await client.getAsset(id, 'a.bin');
  check('getAsset bytes round-trip', got.length === bytes.length && got.every((b, i) => b === bytes[i]));

  // ack
  await client.ack(id, { status: 'done', restId: 'R_1' });
  const done = await client.getDraft(id);
  check('ack persists status + restId', done.status === 'done' && done.restId === 'R_1');

  // deleteDraft
  await client.deleteDraft(id);
  const goneFromList = !(await client.listDrafts()).some((d) => d.id === id);
  check('deleteDraft removes from list', goneFromList);
} finally {
  await handle.close();
  await rm(home, { recursive: true, force: true });
}

console.log(`\n== ${pass} passed, ${fail} failed ==`);
process.exit(fail ? 1 : 0);
