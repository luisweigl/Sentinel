import { emitKeypressEvents, type Key } from 'node:readline';
import type { ReadStream, WriteStream } from 'node:tty';
import type { DatabaseSync } from 'node:sqlite';
import { getAdministrator, resetAdministratorPassword } from './auth.js';
import { validPassword } from './passwords.js';

export function readHiddenPassword(
  label: string,
  input: ReadStream = process.stdin,
  output: WriteStream = process.stdout,
): Promise<string> {
  if (!input.isTTY || !output.isTTY)
    return Promise.reject(
      new Error('Password reset requires an interactive terminal.'),
    );
  emitKeypressEvents(input);
  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw;
    const wasFlowing = input.readableFlowing;
    let value = '';
    let finished = false;
    function finish(error?: Error) {
      if (finished) return;
      finished = true;
      input.off('keypress', onKey);
      input.off('end', onEnd);
      input.off('error', onError);
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
        process.off(signal, onCancel);
      input.setRawMode(wasRaw);
      if (!wasFlowing) input.pause();
      output.write('\n');
      error ? reject(error) : resolve(value);
    }
    const onCancel = () => finish(new Error('Password reset cancelled.'));
    const onEnd = () =>
      finish(new Error('Terminal closed. Password reset cancelled.'));
    const onError = (error: Error) => finish(error);
    function onKey(text: string | undefined, key: Key) {
      if (key.ctrl && ['c', 'd'].includes(key.name ?? '')) {
        onCancel();
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish();
        return;
      }
      if (key.name === 'backspace') {
        value = [...value].slice(0, -1).join('');
        return;
      }
      if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) {
        if ([...value, ...text].length > 128) {
          finish(new Error('Password must contain at most 128 characters.'));
          return;
        }
        value += text;
      }
    }
    input.on('keypress', onKey);
    input.once('end', onEnd);
    input.once('error', onError);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
      process.once(signal, onCancel);
    input.setRawMode(true);
    input.resume();
    output.write(label);
  });
}

export async function promptPasswordReset(
  database: DatabaseSync,
  prompt = readHiddenPassword,
): Promise<void> {
  if (!getAdministrator(database))
    throw new Error('No administrator exists. Complete initial setup first.');
  const password = await prompt('New administrator password: ');
  if (!validPassword(password))
    throw new Error('Password must contain 15–128 characters.');
  const confirmation = await prompt('Confirm password: ');
  if (password !== confirmation)
    throw new Error('Passwords do not match. Nothing was changed.');
  await resetAdministratorPassword(database, password);
}
