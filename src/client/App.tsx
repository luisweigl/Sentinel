import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AuthForm, type Credentials } from './AuthForm';
import { Dashboard } from './Dashboard';
import {
  authReducer,
  initialAuthState,
  loadSession,
  signIn,
  signOut,
} from './auth-api';
import { onUnauthorized } from './api';

export function App() {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const revision = useRef(0);
  const sessionRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const authMutation = useRef(false);
  const invalidate = useCallback(() => {
    revision.current++;
    sessionRequest.current?.abort();
  }, []);
  const checkSession = useCallback(async () => {
    if (authMutation.current) return;
    sessionRequest.current?.abort();
    const controller = new AbortController();
    sessionRequest.current = controller;
    const requestRevision = ++revision.current;
    try {
      const session = await loadSession(controller.signal);
      if (mounted.current && revision.current === requestRevision) {
        dispatch({ type: 'session', session });
      }
    } catch (error) {
      if (
        mounted.current &&
        !controller.signal.aborted &&
        revision.current === requestRevision
      ) {
        dispatch({
          type: 'error',
          error:
            error instanceof Error
              ? error.message
              : 'Unable to check your session.',
        });
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = onUnauthorized(() => {
      invalidate();
      dispatch({ type: 'expired' });
    });
    const focus = () => {
      void checkSession();
    };
    window.addEventListener('focus', focus);
    void checkSession();
    return () => {
      mounted.current = false;
      unsubscribe();
      window.removeEventListener('focus', focus);
      invalidate();
    };
  }, [checkSession, invalidate]);

  async function submit(credentials: Credentials) {
    invalidate();
    const current = revision.current;
    authMutation.current = true;
    let result: Awaited<ReturnType<typeof signIn>>;
    try {
      result = await signIn(credentials, state.session?.setupRequired ?? false);
    } finally {
      authMutation.current = false;
    }
    if (!mounted.current || current !== revision.current) return;
    setLogoutError('');
    dispatch({
      type: 'session',
      session: {
        authenticated: true,
        setupRequired: false,
        setupEnabled: false,
        user: result.user,
      },
    });
  }
  async function logout() {
    if (authMutation.current) return;
    invalidate();
    authMutation.current = true;
    setLogoutPending(true);
    setLogoutError('');
    try {
      await signOut();
      if (mounted.current) {
        invalidate();
        dispatch({ type: 'logout' });
      }
    } catch (error) {
      if (mounted.current)
        setLogoutError(
          error instanceof Error ? error.message : 'Unable to sign out.',
        );
    } finally {
      authMutation.current = false;
      if (mounted.current) setLogoutPending(false);
    }
  }
  if (state.checking || state.error)
    return (
      <main className="auth-page">
        <section className="auth-box">
          <span className="brand">
            sentinel
            <span className="brand-mark" aria-hidden="true">
              _
            </span>
          </span>
          {state.error ? (
            <>
              <p role="alert">{state.error}</p>
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: 'checking' });
                  void checkSession();
                }}
              >
                Retry
              </button>
            </>
          ) : (
            <p role="status">Checking your session…</p>
          )}
        </section>
      </main>
    );
  if (state.session?.authenticated && state.session.user)
    return (
      <Dashboard
        username={state.session.user.username}
        onLogout={() => void logout()}
        logoutPending={logoutPending}
        logoutError={logoutError}
      />
    );
  return (
    <AuthForm
      key={state.session?.setupRequired ? 'setup' : 'login'}
      setup={state.session?.setupRequired}
      setupEnabled={state.session?.setupEnabled}
      notice={state.notice}
      onSubmit={submit}
    />
  );
}
