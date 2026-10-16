import type { Credentials } from './AuthForm';
import { requestJson } from './http';

export interface AuthSession {
  authenticated: boolean;
  setupRequired: boolean;
  setupEnabled: boolean;
  user: { username: string } | null;
}
export function loadSession(signal?: AbortSignal): Promise<AuthSession> {
  return requestJson('/api/auth/session', { signal });
}
export function signIn(
  credentials: Credentials,
  setup: boolean,
): Promise<{ user: { username: string } }> {
  return requestJson(setup ? '/api/auth/setup' : '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
}
export function signOut(): Promise<void> {
  return requestJson('/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}
export interface AuthState {
  session: AuthSession | null;
  checking: boolean;
  error: string;
  notice: string;
}
export type AuthAction =
  | { type: 'session'; session: AuthSession }
  | { type: 'expired' }
  | { type: 'logout' }
  | { type: 'error'; error: string }
  | { type: 'checking' };
export const initialAuthState: AuthState = {
  session: null,
  checking: true,
  error: '',
  notice: '',
};
export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'session':
      return {
        session: action.session,
        checking: false,
        error: '',
        notice:
          state.session?.authenticated && !action.session.authenticated
            ? 'Your session has expired.'
            : state.notice,
      };
    case 'expired':
    case 'logout':
      return {
        session: {
          authenticated: false,
          setupRequired: false,
          setupEnabled: false,
          user: null,
        },
        checking: false,
        error: '',
        notice: action.type === 'expired' ? 'Your session has expired.' : '',
      };
    case 'error':
      return { ...state, session: null, checking: false, error: action.error };
    case 'checking':
      return { ...state, checking: true, error: '' };
  }
}
