# Harvest AI — Frontend

Next.js client for Harvest AI, a store-neutral, conversational nutrition coach
and meal planner. Deploys to Vercel and talks to the Harvest API over HTTPS.

The API it depends on lives in the `harvest-backend` repository.

## What it provides

- Google sign-in. The app is gated behind it, and the session persists across
  reloads and devices.
- A unified chat that routes itself — the user never picks a mode or tool.
- A calendar-style week board with click-through recipe details.
- Editable preferences: diet, allergies, dislikes, household size, budget,
  equipment, cooking time, macro targets, body profile, and meal schedule.
- An "On hand" pantry screen and a "To buy" view that groups missing
  ingredients by category, persists checked-off items in the browser, and can
  copy the whole list.
- Macro summaries per day, per daily average, and per plan.
- A dated advance-prep timeline for soaking, marinating, thawing, and
  overnight work.
- Favorite recipes, cooked/rejected feedback, and restorable plan history.
- A streaming planning view showing the current stage, elapsed time,
  provider/model, and a cancel control.

## Environment variables

| Variable | Required | Secret | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | yes | no | Base URL of the Harvest backend, e.g. `https://YOUR_FLY_APP.fly.dev` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | yes | no | OAuth 2.0 Web client ID. Must match the backend's `GOOGLE_CLIENT_ID` exactly. |

`NEXT_PUBLIC_*` values are embedded in the browser bundle and are readable by
anyone using the site. Never put a database URL, provider key, or any other
secret in one.

The user's provider API key is entered in the UI. It can be saved to their
account, in which case the backend encrypts it at rest and the browser keeps no
copy, or used for a single request without saving. A saved key is never sent
back to the browser — the UI shows only its last four characters. Provider keys
never go in a Vercel environment variable.

## Authentication

Sign-in uses Google Identity Services. The button yields a Google ID token,
which is posted to the backend once and exchanged for a Harvest session token
stored in `localStorage` and sent as `Authorization: Bearer`. Any `401` clears
the stored token and returns the user to the sign-in screen.

The client ID must be registered in the Google Cloud console with every origin
the app is served from under **Authorized JavaScript origins** — including
`http://localhost:3000` for development. Google validates the origin, so a
missing entry makes the sign-in button silently fail to render. See the
`harvest-backend` README for the full console walkthrough.

If a browser had been using Harvest anonymously before sign-in existed, its
local id is offered once during sign-in so the existing preferences, pantry, and
plans are carried into the new account rather than stranded.

## Local setup

Requirements: Node.js 20+ and a running Harvest backend.

```bash
npm install
cp .env.example .env.local
```

Point `NEXT_PUBLIC_API_URL` at your backend, then:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Vercel

1. Import this repository into Vercel. The project root is the repository root,
   so no root-directory override is needed.
2. Set the environment variable:

   ```text
   NEXT_PUBLIC_API_URL=https://YOUR_FLY_APP.fly.dev
   ```

3. Add the Google client ID:

   ```text
   NEXT_PUBLIC_GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
   ```

4. Add the Vercel URL to **Authorized JavaScript origins** on that OAuth client
   in the Google Cloud console, or sign-in will not render in production.
5. Deploy.
6. Add the resulting Vercel URL to the backend's `FRONTEND_ORIGIN` secret, or
   the API will reject the browser's requests via CORS. Include preview domains
   only if they should be able to call the backend.

## Verification

```bash
npm run typecheck
npm run build
```

## Security notes

- The session token lives in `localStorage`, readable by injected script, so
  frontend XSS protections remain important. Once a provider key is saved it is
  held only on the server, so it is no longer exposed to browser script.
- Signing out clears both from the browser, but the session token stays
  cryptographically valid on the server until it expires.
- Nutrition and coaching figures rendered here are screening estimates produced
  by the backend, not medical advice.

## License

MIT — see [LICENSE](LICENSE).
