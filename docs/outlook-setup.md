# Outlook sign-in (personal outlook.com, prototype)

Two ways in. The student experience is the same either way; nothing ever
enters Coach memory, facts, evidence, or proposals.

## Option A — temporary token, no Entra app (fastest)

1. Open Graph Explorer and sign in with the personal Outlook account.
2. Consent to `Mail.Read` when asked.
3. Copy the access token, open the Emails section in Farq, choose
   "Use a temporary token instead", paste, Save.
4. Pull + ask. Lasts about an hour; paste a fresh token when it expires.

## Option B — Connect button (one server value, then button-only)

One-time server setup (~5 minutes):

1. Go to the Microsoft Entra admin center -> Identity -> Applications ->
   App registrations -> New registration.
2. Name it `Farq local`, supported account types: **personal Microsoft
   accounts only**.
3. No redirect URI is needed (device-code flow, public client).
4. API permissions -> Add -> Microsoft Graph -> Delegated -> `Mail.Read`
   only. Do not add Mail.ReadWrite or Mail.Send.
5. Copy the **Application (client) ID** into the server `.env`:
   `OUTLOOK_CLIENT_ID=<id>` (`OUTLOOK_TENANT=consumers` is the default).
6. Restart the API (`docker compose up --build` or `scripts/dev.ps1`).

Read-only guarantees: the backend only GETs `graph.microsoft.com`,
requests `Mail.Read` + `offline_access` + `openid` + `profile`, keeps
tokens in the server-side `outlook_accounts` table, and answers email
questions on a throwaway `farq:email:*` session so nothing enters Coach
memory, facts, evidence, or proposals.
