# Harvest AI — Frontend

Next.js client for Harvest AI, a store-neutral, conversational nutrition coach
and meal planner. Deploys to Vercel and talks to the Harvest API over HTTPS.

The API it depends on lives in the `harvest-backend` repository.

## What it provides

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

`NEXT_PUBLIC_*` values are embedded in the browser bundle and are readable by
anyone using the site. Never put a database URL, provider key, or any other
secret in one.

The user's provider API key is entered in the UI, held in `sessionStorage` for
the tab, and sent per request as the `x-provider-api-key` header. It is never
written to a Vercel environment variable and never persisted by the backend.

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

3. Deploy.
4. Add the resulting Vercel URL to the backend's `FRONTEND_ORIGIN` secret, or
   the API will reject the browser's requests via CORS. Include preview domains
   only if they should be able to call the backend.

## Verification

```bash
npm run typecheck
npm run build
```

## Security notes

- The identity mechanism is an anonymous UUID stored in the browser. It suits a
  private deployment, not a public multi-user launch.
- Because the provider key can live in `sessionStorage` for the tab, frontend
  XSS protections remain important.
- Nutrition and coaching figures rendered here are screening estimates produced
  by the backend, not medical advice.

## License

MIT — see [LICENSE](LICENSE).
