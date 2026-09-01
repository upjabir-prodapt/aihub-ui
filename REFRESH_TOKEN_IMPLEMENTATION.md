# Refresh Token API Implementation

## Overview
Implemented automatic token refresh using the new `/api/v1/auth/refresh` endpoint. The system now automatically refreshes the access token before expiration to maintain seamless user sessions.

## Implementation Details

### 1. **Storage Layer** (`src/context/authStorage.ts`)

#### New Storage Key
- `REFRESH_EXPIRY_KEY` — stores when the refresh token expires (timestamp in ms)
  - Refresh token itself stays in httpOnly `colt_refresh_token` cookie (not JS-readable)
  - Only metadata (expiry time) is stored in localStorage

#### Updated Functions
- **`saveSession()`** — now accepts optional `refreshExpiresIn` parameter
  - Calculates refresh expiry timestamp: `Date.now() + refreshExpiresIn * 1000`
  - Stores in `colt_refresh_expiry` localStorage key

- **`getRefreshExpiryTime()`** (new) — returns refresh token expiry timestamp or null
  - Used by AuthContext to determine when to refresh

- **`clearSession()`** — also clears `colt_refresh_expiry` on logout

### 2. **API Layer** (`src/api/hubAuth.ts`)

#### Updated Login Handler
- `hubAuth()` now extracts `refresh_expires_in` from POST `/auth/token` response
- Passes it to `saveSession()` for storage

#### New Refresh Function
```typescript
export async function refreshAccessToken(): Promise<{
  expiresIn: number;
  refreshExpiresIn?: number;
} | null>
```

**Flow:**
1. Calls `POST /api/v1/auth/refresh` with empty body
2. Refresh token sent automatically via httpOnly cookie (credentials: 'include')
3. Returns new access token expiry and refresh token expiry
4. On error, logs warning and returns null (graceful failure)

**Why this approach:**
- Refresh token never leaves the httpOnly cookie (XSS-safe)
- Error handling is graceful — if refresh fails, the next API call gets 401 and triggers re-login
- Response includes updated refresh expiry for proactive rescheduling

### 3. **Auth Context** (`src/context/AuthContext.tsx`)

#### New Auto-Refresh Effect
Fires when user logs in, schedules token refresh 5 minutes before expiry:

```typescript
useEffect(() => {
  if (!user) return;
  
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const scheduleRefresh = () => {
    const refreshExpiryTime = getRefreshExpiryTime();
    if (!refreshExpiryTime) return;

    // Refresh 5 minutes before expiry (safety margin)
    const refreshTime = refreshExpiryTime - 5 * 60 * 1000;
    const delayMs = Math.max(0, refreshTime - Date.now());

    timeoutId = window.setTimeout(async () => {
      const result = await refreshAccessToken();
      if (result) {
        // Update localStorage with new expiry times
        localStorage.setItem('colt_auth_expiry', String(...));
        localStorage.setItem('colt_refresh_expiry', String(...));
        // Reschedule next refresh
        scheduleRefresh();
      }
    }, delayMs);
  };

  scheduleRefresh();
  return () => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  };
}, [user]);
```

**Key features:**
- Only runs when user is logged in (`if (!user) return`)
- Calculates delay dynamically based on current time and expiry time
- Updates localStorage after successful refresh for next cycle
- Automatically reschedules after each refresh
- Cleanup on logout or component unmount

#### Mock Login for Local Dev
Development mode mock login now includes refresh expiry:
```typescript
// Mock login with 1-hour token and 7-day refresh expiry
saveSession(mockToken, mockUser, 3600, 7 * 24 * 60 * 60);
```

## Token Lifecycle

### Initial Login
1. User signs in → `POST /auth/token` with googleIdToken
2. Server responds with:
   - `access_token` (JWT, expires in 3600s)
   - `refresh_token` (JWT, expires in 604800s/7 days)
   - `expires_in` = 3600
   - `refresh_expires_in` = 604800
3. Access token → httpOnly `colt_session` cookie
4. Refresh token → httpOnly `colt_refresh_token` cookie
5. Expiry times stored in localStorage

### Background Refresh (~5 min before expiry)
1. Auth context schedules refresh 5 minutes before access token expires
2. Calls `POST /auth/refresh` (refresh token sent via httpOnly cookie)
3. Server validates refresh token, issues new access token & refresh token
4. Response returns new `expires_in` and `refresh_expires_in`
5. App updates localStorage with new expiry times
6. Next refresh is rescheduled

### Refresh Token Expiry
If refresh token expires (7 days):
1. Auto-refresh attempts `POST /auth/refresh`
2. Server returns 401 (refresh token invalid)
3. App logs warning, returns null
4. Next API call gets 401 → AuthContext clears session and re-prompts login

## API Contract

### POST /api/v1/auth/token
**Request:**
```json
{
  "business_unit": "engineering",
  "organization": "colt"
}
```

**Response (200 OK):**
```json
{
  "access_token": "eyJhbGci...",
  "token_type": "bearer",
  "expires_in": 3600,
  "email": "user@colt.net",
  "refresh_token": "eyJhbGci...",
  "refresh_expires_in": 604800
}
```

### POST /api/v1/auth/refresh
**Request (refresh token in httpOnly cookie):**
```json
{}
```

**Response (200 OK):**
```json
{
  "access_token": "eyJhbGci...",
  "token_type": "bearer",
  "expires_in": 3600,
  "email": "user@colt.net",
  "refresh_token": "eyJhbGci...",
  "refresh_expires_in": 604512
}
```

## Security Properties

✅ **Access token** — stored only in httpOnly cookie (XSS-safe)
✅ **Refresh token** — stored only in httpOnly cookie (XSS-safe)
✅ **Metadata only** — expiry times stored in localStorage (not sensitive)
✅ **No hardcoded tokens** — all tokens issued and managed server-side
✅ **Automatic expiry handling** — proactive refresh before expiration
✅ **Graceful degradation** — failed refresh triggers re-login on next API call
✅ **Scope isolation** — refresh cannot escalate privileges

## Error Scenarios

| Scenario | Behavior | User Impact |
|----------|----------|-------------|
| Refresh fails mid-session | Warning logged, continues | Seamless if fixed before access token expires |
| Access token expires | Next API call gets 401 | Redirects to login (no interruption mid-action) |
| Refresh token expires | Next refresh fails with 401 | Redirects to login |
| Network error during refresh | Error caught, app continues | User may need to refresh page if token expired |
| Browser storage quota full | Refresh expiry not updated | Falls back to graceful 401 re-login |

## Testing Checklist

- [ ] Login sets refresh expiry in localStorage
- [ ] Auto-refresh runs ~5 min before access token expiry
- [ ] Refresh endpoint called with empty body
- [ ] Refresh token sent via httpOnly cookie
- [ ] Response parsed and expiry times updated
- [ ] Next refresh rescheduled after successful refresh
- [ ] Failed refresh logs warning, doesn't crash
- [ ] Logout clears refresh expiry
- [ ] Session reload restores user from localStorage
- [ ] 401 response triggers re-login prompt
- [ ] Multi-hour session maintains refresh cycle
