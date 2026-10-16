import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import type { ReadStream, WriteStream } from 'node:tty';
import test from 'node:test';
import { readHiddenPassword, promptPasswordReset } from './password-prompt.js';
import { openDatabase } from './database.js';
import { getAdministrator } from './auth.js';
import { hashPassword, verifyPassword } from './passwords.js';

function terminal() {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(mode: boolean) {
      this.isRaw = mode;
      return this;
    },
  });
  const output = Object.assign(new PassThrough(), { isTTY: true });
  let written = '';
  output.on('data', (chunk: Buffer) => {
    written += chunk.toString();
  });
  return {
    input,
    output,
    written: () => written,
    prompt: (label: string) =>
      readHiddenPassword(
        label,
        input as unknown as ReadStream,
        output as unknown as WriteStream,
      ),
  };
}
test('hidden terminal prompt never echoes secrets and restores terminal state', async () => {
  const { input, prompt, written } = terminal();
  const pending = prompt('Password: ');
  assert.equal(input.isRaw, true);
  input.emit('keypress', 'secret🙂', {});
  input.emit('keypress', undefined, { name: 'backspace' });
  input.emit('keypress', undefined, { name: 'return' });
  assert.equal(await pending, 'secret');
  assert.equal(input.isRaw, false);
  assert.equal(written(), 'Password: \n');
  assert.equal(input.listenerCount('keypress'), 0);
});
test('terminal cancellation restores state and rejects without returning credentials', async () => {
  const { input, prompt } = terminal();
  const pending = prompt('Password: ');
  input.emit('keypress', 'hidden', {});
  input.emit('keypress', undefined, { ctrl: true, name: 'c' });
  await assert.rejects(pending, /cancelled/);
  assert.equal(input.isRaw, false);
  assert.equal(input.listenerCount('keypress'), 0);
});
test('reset mismatch and cancellation do not change credentials; success replaces password', async () => {
  const database = openDatabase(':memory:');
  try {
    await assert.rejects(
      promptPasswordReset(database, async () => 'unused'),
      /No administrator/,
    );
    const original = await hashPassword('original passphrase');
    database
      .prepare('INSERT INTO administrator VALUES (1, ?, ?, 0)')
      .run('admin', original);
    let count = 0;
    await assert.rejects(
      promptPasswordReset(database, async () =>
        ++count === 1 ? 'replacement passphrase' : 'different passphrase',
      ),
      /do not match/,
    );
    assert.equal(getAdministrator(database)?.password_hash, original);
    await assert.rejects(
      promptPasswordReset(database, async () => {
        throw new Error('cancelled');
      }),
      /cancelled/,
    );
    assert.equal(getAdministrator(database)?.password_hash, original);
    await promptPasswordReset(database, async () => 'replacement passphrase');
    assert.ok(
      await verifyPassword(
        'replacement passphrase',
        getAdministrator(database)?.password_hash,
      ),
    );
    assert.equal(
      await verifyPassword(
        'original passphrase',
        getAdministrator(database)?.password_hash,
      ),
      false,
    );
  } finally {
    database.close();
  }
});
