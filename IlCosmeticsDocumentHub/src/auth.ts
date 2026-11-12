import {
  AccountInfo,
  InteractionRequiredAuthError,
  PublicClientApplication,
} from '@azure/msal-browser';
import { config } from './config';

export const msal = new PublicClientApplication({
  auth: {
    clientId: config.clientId,
    authority: config.authority,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: { cacheLocation: 'sessionStorage' },
});

let ready: Promise<AccountInfo | null> | null = null;

/** Initialises MSAL, completes a pending redirect, returns the signed-in account (or null). */
export function initAuth(): Promise<AccountInfo | null> {
  if (!ready) {
    ready = (async () => {
      await msal.initialize();
      const result = await msal.handleRedirectPromise();
      const account = result?.account ?? msal.getAllAccounts()[0] ?? null;
      if (account) msal.setActiveAccount(account);
      return account;
    })();
  }
  return ready;
}

export function login(): Promise<void> {
  return msal.loginRedirect({ scopes: config.scopes });
}

export function logout(): Promise<void> {
  return msal.logoutRedirect();
}

export function currentAccount(): AccountInfo | null {
  return msal.getActiveAccount();
}

/** Email of the signed-in user: email claim, then preferred_username, then username (UPN/alias mismatches). */
export function currentEmail(): string {
  const a = currentAccount();
  if (!a) return '';
  const claims = (a.idTokenClaims ?? {}) as Record<string, unknown>;
  const email = (claims.email as string) || (claims.preferred_username as string) || a.username;
  return (email || '').toLowerCase();
}

export async function getToken(): Promise<string> {
  const account = currentAccount();
  if (!account) throw new Error('Non connecté');
  try {
    const r = await msal.acquireTokenSilent({ scopes: config.scopes, account });
    return r.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      await msal.acquireTokenRedirect({ scopes: config.scopes, account });
    }
    throw e;
  }
}

/** A Graph token cannot be used to call our own API: request an API-audience token. */
export async function getAiApiToken(): Promise<string> {
  if (!config.aiApiScope) throw new Error('VITE_AI_API_SCOPE manquant : configurez le scope Entra de l’API.');
  const account = currentAccount();
  if (!account) throw new Error('Session Entra requise.');
  try {
    const r = await msal.acquireTokenSilent({ scopes: [config.aiApiScope], account });
    return r.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      await msal.acquireTokenRedirect({ scopes: [config.aiApiScope], account });
    }
    throw e;
  }
}
