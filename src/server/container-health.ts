// Keep the container probe dependency-free and independent of its bind address.
try {
  const response = await fetch(
    `http://127.0.0.1:${process.env.PORT ?? '3000'}/api/health`,
    { signal: AbortSignal.timeout(3000) },
  );
  const body = (await response.json()) as { status?: unknown };
  if (!response.ok || body.status !== 'ok') process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
