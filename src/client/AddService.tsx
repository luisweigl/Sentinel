import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

export interface NewService {
  name: string;
  url: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  enabled: boolean;
}

type Field = 'name' | 'url' | 'interval' | 'timeout';
type Errors = Partial<Record<Field, string>>;
interface ServiceInput {
  name: string;
  url: string;
  interval: string;
  timeout: string;
  enabled: boolean;
}

export function validateNewService(
  input: ServiceInput,
): { valid: true; service: NewService } | { valid: false; errors: Errors } {
  const errors: Errors = {};
  const name = input.name.trim();
  const url = input.url.trim();
  if (!name) errors.name = 'Enter a service name.';
  try {
    if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error();
  } catch {
    errors.url = 'Enter an absolute HTTP or HTTPS URL.';
  }
  for (const field of ['interval', 'timeout'] as const) {
    const seconds = Number(input[field]);
    if (seconds <= 0 || !Number.isSafeInteger(seconds * 1000)) {
      errors[field] =
        'Enter a positive duration in seconds, with up to 3 decimal places.';
    }
  }
  if (Object.keys(errors).length > 0) return { valid: false, errors };
  return {
    valid: true,
    service: {
      name,
      url,
      intervalSeconds: Number(input.interval),
      timeoutSeconds: Number(input.timeout),
      enabled: input.enabled,
    },
  };
}

export function AddService({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (service: NewService) => void | Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = validateNewService({
      name: String(data.get('name') ?? ''),
      url: String(data.get('url') ?? ''),
      interval: String(data.get('interval') ?? ''),
      timeout: String(data.get('timeout') ?? ''),
      enabled: data.get('enabled') === 'on',
    });
    if (!result.valid) {
      setErrors(result.errors);
      const firstField = Object.keys(result.errors)[0];
      const input = form.elements.namedItem(firstField);
      if (input instanceof HTMLInputElement) input.focus();
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      await onSave(result.service);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Unable to save service.',
      );
    } finally {
      setSaving(false);
    }
  }

  function fieldError(field: Field) {
    return (
      errors[field] && (
        <span id={`add-${field}-error`} className="field-error">
          {errors[field]}
        </span>
      )
    );
  }

  return (
    <dialog
      ref={dialog}
      className="add-service-panel"
      aria-labelledby="add-service-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <div className="add-service-heading">
        <h2 id="add-service-title">Add service</h2>
        <button
          type="button"
          disabled={saving}
          onClick={onClose}
          aria-label="Close add service"
        >
          Close
        </button>
      </div>
      <form
        className="add-service-form"
        aria-busy={saving}
        noValidate
        onSubmit={save}
      >
        <label htmlFor="add-name">
          Name
          <input
            id="add-name"
            name="name"
            autoFocus
            required
            disabled={saving}
            autoComplete="off"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'add-name-error' : undefined}
          />
          {fieldError('name')}
        </label>
        <label htmlFor="add-url">
          HTTP / HTTPS URL
          <input
            id="add-url"
            name="url"
            type="url"
            required
            disabled={saving}
            autoComplete="url"
            spellCheck={false}
            aria-invalid={!!errors.url}
            aria-describedby={errors.url ? 'add-url-error' : undefined}
          />
          {fieldError('url')}
        </label>
        <label htmlFor="add-interval">
          Check interval (seconds)
          <input
            id="add-interval"
            name="interval"
            type="number"
            min="0.001"
            step="0.001"
            defaultValue={60}
            required
            disabled={saving}
            aria-invalid={!!errors.interval}
            aria-describedby={
              errors.interval ? 'add-interval-error' : undefined
            }
          />
          {fieldError('interval')}
        </label>
        <label htmlFor="add-timeout">
          Timeout (seconds)
          <input
            id="add-timeout"
            name="timeout"
            type="number"
            min="0.001"
            step="0.001"
            defaultValue={10}
            required
            disabled={saving}
            aria-invalid={!!errors.timeout}
            aria-describedby={errors.timeout ? 'add-timeout-error' : undefined}
          />
          {fieldError('timeout')}
        </label>
        <label className="checkbox-label" htmlFor="add-enabled">
          <input
            id="add-enabled"
            name="enabled"
            type="checkbox"
            defaultChecked
            disabled={saving}
          />
          Monitoring enabled
        </label>
        {saveError && (
          <p role="alert" className="failure-result">
            {saveError}
          </p>
        )}
        <div className="add-service-actions">
          <button type="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save service'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
