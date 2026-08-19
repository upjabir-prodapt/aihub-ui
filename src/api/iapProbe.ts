/**
 * IAP entitlement probe helper.
 *
 * Each backend service behind the AI Hub ILB (Translation, Sales Agent) is an
 * independently IAP-protected resource. IAP session cookies are scoped per
 * backend-service resource, NOT shared just because they're routed under the
 * same hostname/URL map. That means a user who is already authenticated for
 * the `aihub` resource does not automatically have a session for
 * `translation-be` / `salesagent-be` — the first request to those paths will
 * trigger a fresh IAP -> Entra login redirect.
 *
 * A plain `fetch()` cannot follow that redirect: it lands on
 * `https://auth.cloud.google/authorize?...` which does not return CORS
 * headers, so the browser blocks the response before our code ever sees it.
 *
 * The fix: perform an invisible iframe *navigation* first. Navigations are not
 * subject to CORS, so the iframe can freely follow the IAP -> Entra -> IAP
 * redirect chain. Since the user's Entra/SSO session is normally still active
 * (they just signed in for the hub), this round-trip usually completes
 * silently with no visible prompt, and results in a resource-scoped IAP
 * session cookie being set for that specific backend. Once that's done, the
 * real `fetch()` call succeeds normally.
 */

const IFRAME_TIMEOUT_MS = 6000;

function silentIapWarmup(url: string, timeoutMs = IFRAME_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      iframe.remove();
      resolve();
    };

    const timer = window.setTimeout(finish, timeoutMs);
    iframe.onload = finish;
    iframe.onerror = finish;
    iframe.src = url;
    document.body.appendChild(iframe);
  });
}

export interface EntitlementProbeResult {
  /** True only when the backend explicitly confirmed access (HTTP 200). */
  entitled: boolean;
  /** Verified IAP identity email, when available. */
  email: string | null;
}

/**
 * Probe a service's `/auth/whoami` endpoint for entitlement, transparently
 * handling the first-time per-resource IAP session establishment.
 *
 * Fails closed: any error, timeout, or non-200 response results in
 * `entitled: false` — this function must never silently grant access.
 */
export async function probeEntitlement(whoamiUrl: string): Promise<EntitlementProbeResult> {
  const attempt = async (): Promise<Response> =>
    fetch(whoamiUrl, { credentials: 'include', headers: { accept: 'application/json' } });

  try {
    let res = await attempt();

    // A network-level failure (e.g. CORS-blocked redirect) surfaces as a
    // rejected promise, not a bad status — but if the browser DID get a
    // same-origin response that isn't ok, try the silent warmup once before
    // giving up, in case this is the very first request for this resource.
    if (!res.ok && res.status !== 403) {
      await silentIapWarmup(whoamiUrl);
      res = await attempt();
    }

    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { email?: string; entitled?: boolean };
      return { entitled: data.entitled !== false, email: data.email ?? null };
    }

    return { entitled: false, email: null };
  } catch {
    // fetch() rejected — most likely the CORS-blocked IAP/Entra redirect on
    // a first-ever visit. Warm up the session via invisible navigation, then
    // retry the real fetch once.
    try {
      await silentIapWarmup(whoamiUrl);
      const res = await attempt();
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { email?: string; entitled?: boolean };
        return { entitled: data.entitled !== false, email: data.email ?? null };
      }
      return { entitled: false, email: null };
    } catch {
      // Still failing after warmup — fail closed, never grant access.
      return { entitled: false, email: null };
    }
  }
}
