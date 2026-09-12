# WeChat Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a production-safe WeChat mobile-login foundation that exchanges a native WeChat authorization code on the server, binds the verified identity to the existing installation account, and exposes a native Expo login entry point without embedding the AppSecret.

**Architecture:** The mobile app obtains a short-lived WeChat authorization code through a native SDK and sends only that code through the existing installation-bearer API. The server exchanges the code with WeChat, stores a unique provider identity, upgrades or rebinds an empty guest installation transactionally, and keeps all existing business routes on the same installation bearer. Account collisions are reported explicitly instead of silently merging data.

**Tech Stack:** Fastify 5, Drizzle ORM/PostgreSQL, Zod contracts, Expo SDK 57, `expo-native-wechat` 0.3.1, Vitest, Jest.

## Global Constraints

- Never expose `WECHAT_APP_SECRET` or provider exchange responses in client bundles or logs.
- Existing anonymous bearer authentication remains the authorization mechanism for all current business routes.
- A verified WeChat identity may be attached to the current user or an empty guest installation may be rebound to its existing registered owner; non-empty account collisions return an explicit conflict.
- The AppID/AppSecret are optional configuration so tests and local development continue to run without external credentials.
- No real provider credential is created or guessed; production exchange remains disabled until the user supplies approved WeChat Open Platform credentials.

---

### Task 1: Add shared WeChat contracts and configuration

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/index.test.ts`
- Modify: `server/src/config/env.ts`
- Test: `server/src/config/env.test.ts`
- Modify: `app/.env.example`

**Interfaces:**
- Produce `WechatAuthRequestSchema` and `WechatAuthResponseSchema` for the mobile API.
- Produce optional server config fields `WECHAT_APP_ID`, `WECHAT_APP_SECRET`, `WECHAT_API_BASE_URL`, and `WECHAT_TIMEOUT_MS`.

- [ ] **Step 1: Write the contract and environment tests**

```ts
expect(WechatAuthRequestSchema.parse({ code: 'code-from-wechat' })).toEqual({
  code: 'code-from-wechat',
});
expect(() => WechatAuthRequestSchema.parse({ code: '' })).toThrow();
expect(loadConfig(baseEnv()).WECHAT_API_BASE_URL).toBe('https://api.weixin.qq.com');
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm test --workspace=@context-reader/contracts -- src/index.test.ts && npm test --workspace=@context-reader/server -- src/config/env.test.ts`

Expected: FAIL because the new schemas and config fields do not exist.

- [ ] **Step 3: Implement the schemas and optional configuration**

```ts
export const WechatAuthRequestSchema = z.object({
  code: z.string().trim().min(1).max(512),
}).strict();

export const WechatAuthResponseSchema = z.object({
  userId: UuidSchema,
  kind: z.literal('registered'),
  remainingFreePractices: z.number().int().nonnegative(),
}).strict();
```

Use empty-safe optional env parsing so the blank values in `.env.example` do not make the server fail at startup. Defaults are `https://api.weixin.qq.com` and `10000` ms.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `npm test --workspace=@context-reader/contracts -- src/index.test.ts && npm test --workspace=@context-reader/server -- src/config/env.test.ts`

Expected: PASS.

---

### Task 2: Persist provider identities and migrate PostgreSQL

**Files:**
- Modify: `server/src/db/schema.ts`
- Create: `server/drizzle/0002_wechat_identities.sql`
- Test: `server/src/db/schema.integration.test.ts`

**Interfaces:**
- Produce `authIdentityProvider` with `wechat` and `authIdentities` containing `userId`, unique provider subject, openid, optional unionid, and timestamps.

- [ ] **Step 1: Add a migration/schema test**

```ts
const [identity] = await db.insert(authIdentities).values({
  userId: user.id,
  provider: 'wechat',
  subject: 'union-id-1',
  openid: 'open-id-1',
}).returning();
expect(identity?.provider).toBe('wechat');
```

- [ ] **Step 2: Run the isolated schema test and verify it fails**

Run: `npm test --workspace=@context-reader/server -- src/db/schema.integration.test.ts`

Expected: FAIL because the table and migration are absent.

- [ ] **Step 3: Add the enum/table and explicit migration**

The migration must create `auth_identity_provider`, `auth_identities`, the provider/subject unique index, and foreign-key cascade to `users`. Never store the WeChat authorization code or AppSecret.

- [ ] **Step 4: Run the isolated schema test and verify it passes**

Run: `npm test --workspace=@context-reader/server -- src/db/schema.integration.test.ts`

Expected: PASS.

---

### Task 3: Implement server-side WeChat code exchange and account binding

**Files:**
- Create: `server/src/modules/auth/wechat-client.ts`
- Create: `server/src/modules/auth/wechat-client.test.ts`
- Modify: `server/src/modules/auth/service.ts`
- Modify: `server/src/core/errors.ts`
- Modify: `server/src/app.ts`
- Modify: `server/scripts/check-client-secrets.ts`

**Interfaces:**
- Produce `WechatClient.exchangeCode(code): Promise<{ openid: string; unionid?: string }>`.
- Produce `loginWithWechat(db, context, code, client, freePracticeLimit): Promise<AuthUser>`.

- [ ] **Step 1: Test provider responses through the public client interface**

Cover valid `openid`, valid `unionid`, provider error payload, malformed payload, non-2xx response, and timeout. Assert that AppSecret and authorization code are not included in thrown public messages.

- [ ] **Step 2: Implement the minimal HTTP client**

Call WeChat’s `sns/oauth2/access_token` endpoint with server-side `appid`, `secret`, `code`, and `grant_type=authorization_code`; validate the JSON with Zod; map provider failures to `WECHAT_AUTH_FAILED` and missing configuration to `WECHAT_NOT_CONFIGURED`.

- [ ] **Step 3: Test transactional identity binding**

Cover first login upgrading the current guest, repeated login being idempotent, binding a second WeChat identity to a registered user, rebinding an empty guest installation to an existing registered owner, and rejecting a non-empty guest collision with `AUTH_ACCOUNT_CONFLICT`.

- [ ] **Step 4: Implement the transaction**

Lock the current installation and provider identity, insert/update `auth_identities`, set the user kind to `registered`, and update `installations.userId` only when the guest has no owned content. Existing business data must never be silently discarded.

- [ ] **Step 5: Run focused auth tests**

Run: `npm test --workspace=@context-reader/server -- modules/auth src/app.test.ts`

Expected: PASS.

---

### Task 4: Expose the authenticated route and security configuration

**Files:**
- Modify: `server/src/modules/auth/routes.ts`
- Modify: `server/src/modules/auth/plugin.ts`
- Modify: `server/src/plugins/security.ts`
- Modify: `server/src/modules/auth/auth.integration.test.ts`
- Modify: `app/.env.example`

**Interfaces:**
- Add `POST /v1/auth/wechat` using the existing bearer installation credential and `WechatAuthRequestSchema`.

- [ ] **Step 1: Add the HTTP integration tests**

Inject a fake `WechatClient` into `buildApp` and assert `201`/`200` success responses, malformed request `400`, missing bearer `401`, provider failure, and explicit account conflict. Assert the route is token/IP rate-limited.

- [ ] **Step 2: Register the route with dependency injection**

Extend `AuthRoutesOptions` with an optional client; production uses `createWechatClient(options.config)`, tests pass a fake client. Authenticate the installation before exchanging the code and never put the code in logs.

- [ ] **Step 3: Add sensitive-route rate limiting and redaction**

Include `POST /v1/auth/wechat` in the token-limited set and add `WECHAT_APP_SECRET`/`WECHAT_API_BASE_URL` to server-only secret scanning.

- [ ] **Step 4: Run the auth integration suite**

Run: `npm test --workspace=@context-reader/server -- modules/auth src/app.test.ts`

Expected: PASS.

---

### Task 5: Add Expo client API, native adapter, and login screen

**Files:**
- Modify: `app/package.json`
- Modify: `package-lock.json`
- Create: `app/src/api/wechat.ts`
- Create: `app/src/features/auth/wechat.native.ts`
- Create: `app/src/features/auth/wechat.web.ts`
- Create: `app/src/app/login.tsx`
- Modify: `app/src/app/_layout.tsx`
- Modify: `app/src/app/(tabs)/profile.tsx`
- Create: `app/app.config.ts`
- Modify: `app/.env.example`

**Interfaces:**
- `requestWechatCode(): Promise<string>` obtains a native short-lived code and rejects clearly on web, missing AppID, missing WeChat app, or Expo Go without the native module.
- `loginWithWechat(): Promise<WechatAuthResponse>` sends the code through the existing `apiRequest` bearer flow.

- [ ] **Step 1: Add API/adapter tests**

Mock `expo-native-wechat`, `SecureStore`-backed installation auth, and `fetch`; assert the code is sent only to `/v1/auth/wechat`, the AppID is read from `EXPO_PUBLIC_WECHAT_APP_ID`, web never imports native login, and provider errors become `ApiError`.

- [ ] **Step 2: Install the native module and add config wiring**

Add `expo-native-wechat@0.3.1`; add `EXPO_PUBLIC_WECHAT_APP_ID` and `EXPO_PUBLIC_WECHAT_UNIVERSAL_LINK` to the example env. Dynamic Expo config adds the WeChat scheme/plugin only when an AppID is configured, while preserving the existing app config. Production still needs real bundle/package IDs and an approved Universal Link.

- [ ] **Step 3: Implement the native adapter and API call**

Register the SDK once, check that WeChat is installed, request `snsapi_userinfo`, validate returned state/code, then call the server route. Do not include AppSecret anywhere under `app/`.

- [ ] **Step 4: Add the login route and profile entry point**

Create a compact login screen with a WeChat button, loading/error states, and an explicit message when credentials or a development build are missing. On success, return to the profile screen and refresh the existing user display.

- [ ] **Step 5: Run app checks**

Run: `npm test --workspace=app -- --runInBand && npm run typecheck --workspace=app && npm run check:client-secrets --workspace=@context-reader/server`

Expected: PASS; the client-secret check must not find `WECHAT_APP_SECRET` or any configured server secret in app files.

---

### Task 6: Document credential handoff and verification status

**Files:**
- Modify: `app/.env.example`
- Modify: `server/README.md`
- Modify: `README.md`

- [ ] **Step 1: Document required user-owned setup**

Document that the user must supply an approved WeChat Open Platform mobile AppID/AppSecret, iOS Bundle ID, Android package/signature, and Universal Link; the AppSecret belongs only in the server environment.

- [ ] **Step 2: Document local verification**

Record that automated tests cover the fake provider and that real-device login remains pending until credentials and a custom Expo development build are available.

- [ ] **Step 3: Run the complete verification set**

Run: `npm run typecheck && npm test && npm run lint`

Expected: PASS, with no credential values added to the repository.
