import { openDatabase } from './database.js';
import { promptPasswordReset } from './password-prompt.js';

try {
  if (process.argv.length > 2)
    throw new Error(
      'This command accepts no arguments. Enter the password at the hidden prompt.',
    );
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('Password reset requires an interactive terminal.');
  const database = openDatabase(process.env.DATABASE_PATH);
  try {
    await promptPasswordReset(database);
    console.log(
      'Administrator password updated. All sessions have been revoked.',
    );
  } finally {
    database.close();
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Password reset failed.',
  );
  process.exitCode = 1;
}
