import { useRef, useState } from 'react';

export interface Credentials {
  username: string;
  password: string;
  setupToken?: string;
}
export interface AuthFields extends Credentials {
  confirmation: string;
}

export function validateAuth(
  fields: AuthFields,
  setup: boolean,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!fields.username.trim()) errors.username = 'Enter your username.';
  if (!fields.password) errors.password = 'Enter your password.';
  if (setup) {
    if (!/^[a-z0-9_.-]{3,64}$/i.test(fields.username.trim()))
      errors.username =
        'Use 3–64 letters, digits, underscores, periods, or hyphens.';
    if ([...fields.password].length < 15 || [...fields.password].length > 128)
      errors.password = 'Use 15–128 characters.';
    if (!fields.setupToken?.trim())
      errors.setupToken = 'Enter the setup token.';
    if (fields.password !== fields.confirmation)
      errors.confirmation = 'Passwords do not match.';
  }
  return errors;
}

export function AuthForm({
  setup = false,
  setupEnabled = true,
  notice = '',
  onSubmit,
}: {
  setup?: boolean;
  setupEnabled?: boolean;
  notice?: string;
  onSubmit: (credentials: Credentials) => Promise<void>;
}) {
  const [fields, setFields] = useState<AuthFields>({
    username: '',
    password: '',
    setupToken: '',
    confirmation: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const unavailable = setup && !setupEnabled;
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || unavailable) return;
    const next = validateAuth(fields, setup);
    setErrors(next);
    setError('');
    if (Object.keys(next).length) return;
    submitting.current = true;
    setPending(true);
    try {
      await onSubmit({
        username: fields.username.trim().toLowerCase(),
        password: fields.password,
        ...(setup ? { setupToken: fields.setupToken?.trim() } : {}),
      });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to sign in. Please try again.',
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  const inputs: {
    name: keyof AuthFields;
    label: string;
    type: string;
    autoComplete: string;
  }[] = [
    ...(setup
      ? [
          {
            name: 'setupToken' as const,
            label: 'Setup token',
            type: 'password',
            autoComplete: 'off',
          },
        ]
      : []),
    {
      name: 'username',
      label: 'Username',
      type: 'text',
      autoComplete: 'username',
    },
    {
      name: 'password',
      label: 'Password',
      type: 'password',
      autoComplete: setup ? 'new-password' : 'current-password',
    },
    ...(setup
      ? [
          {
            name: 'confirmation' as const,
            label: 'Confirm password',
            type: 'password',
            autoComplete: 'new-password',
          },
        ]
      : []),
  ];
  return (
    <main className="auth-page">
      <section className="auth-box" aria-labelledby="auth-title">
        <span className="brand">
          sentinel
          <span className="brand-mark" aria-hidden="true">
            _
          </span>
        </span>
        <h1 id="auth-title">{setup ? 'Create administrator' : 'Sign in'}</h1>
        <p>
          {setup
            ? 'Set up access to your Sentinel dashboard.'
            : 'Sign in to your Sentinel dashboard.'}
        </p>
        {notice && <p role="status">{notice}</p>}
        {unavailable ? (
          <p role="alert">
            Administrator setup is unavailable. Ask the operator to configure
            the server setup token.
          </p>
        ) : (
          <form
            onSubmit={(event) => void submit(event)}
            noValidate
            aria-busy={pending}
          >
            {inputs.map(({ name, label, type, autoComplete }) => (
              <div className="auth-field" key={name}>
                <label htmlFor={`auth-${name}`}>{label}</label>
                <input
                  id={`auth-${name}`}
                  name={name}
                  type={type}
                  autoComplete={autoComplete}
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  disabled={pending}
                  maxLength={
                    name === 'username' ? 64 : name === 'setupToken' ? 512 : 256
                  }
                  value={fields[name] ?? ''}
                  aria-invalid={!!errors[name]}
                  aria-describedby={
                    [
                      errors[name] ? `auth-${name}-error` : '',
                      setup && name === 'password' ? 'auth-password-help' : '',
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  onChange={(event) =>
                    setFields({ ...fields, [name]: event.target.value })
                  }
                />
                {setup && name === 'password' && (
                  <span id="auth-password-help">
                    Use 15–128 characters. Spaces and passphrases are welcome.
                  </span>
                )}
                {errors[name] && (
                  <span
                    className="field-error"
                    id={`auth-${name}-error`}
                    role="alert"
                  >
                    {errors[name]}
                  </span>
                )}
              </div>
            ))}
            {error && (
              <p className="failure-result" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={pending}>
              {pending
                ? setup
                  ? 'Creating administrator…'
                  : 'Signing in…'
                : setup
                  ? 'Create administrator'
                  : 'Sign in'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
