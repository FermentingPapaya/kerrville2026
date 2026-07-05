# Kerrville 2026 Training Companion

This is Erin's Netlify/GitHub training companion for Kerrville 70.3.

## What is included

- Planned 70.3 training calendar through race day
- Day navigation and weekly view
- Garmin Connect sync through a Netlify Function
- Garmin `.fit` upload fallback
- RPE, legs, energy, cycle phase, fueling, and notes
- Strength logging
- Weekly dashboard
- Coach export
- CSV and JSON backup

## Files that matter

- `index.html`: the app UI and local browser storage
- `netlify/functions/sync-garmin.js`: server-side Garmin sync
- `scripts/get-garmin-tokens.js`: one-time token generator for Garmin MFA/rate-limit issues
- `package.json`: dependencies and scripts
- `netlify.toml`: Netlify configuration

## Netlify settings

Netlify should deploy from GitHub.

Use these settings:

- Build command: `npm install`
- Publish directory: `.`
- Functions directory: `netlify/functions`

## Required Netlify environment variables

Set these in Netlify under Project configuration -> Environment variables:

- `GARMIN_USERNAME`: your Garmin Connect login email
- `GARMIN_PASSWORD`: your Garmin Connect password

## Strongly recommended Garmin token variables

Garmin often rate-limits repeated username/password logins. If you see a 429 error, generate tokens and add:

- `GARMIN_OAUTH1`
- `GARMIN_OAUTH2`

When these token variables exist, the function uses them first and avoids logging in repeatedly.

## Generate Garmin OAuth tokens

Use GitHub Codespaces from your repo.

1. Open the GitHub repo.
2. Click Code.
3. Click Codespaces.
4. Create a codespace.
5. In the terminal, run:

```text
npm install
npm run garmin:tokens
```

6. Enter your Garmin email and password.
7. If Garmin emails a code, enter the fresh code.
8. Copy the printed `GARMIN_OAUTH1` JSON value into Netlify.
9. Copy the printed `GARMIN_OAUTH2` JSON value into Netlify.
10. Redeploy Netlify.

Tokens usually last about 90 days. Re-run the script when they expire.

## Testing Garmin sync

After redeploying, test:

```text
https://kerrville2026.netlify.app/.netlify/functions/sync-garmin
```

Expected success response:

```json
{
  "ok": true,
  "activities": []
}
```

The `activities` array should contain recent Garmin activities if Garmin authentication succeeds.

## Important rate-limit rule

If Garmin returns `429 Too Many Requests`, stop testing. Wait several hours, ideally 24 hours, then generate OAuth tokens once and use those going forward.

## Verified before delivery

The JavaScript was syntax-checked with:

```text
node --check netlify/functions/sync-garmin.js
node --check scripts/get-garmin-tokens.js
node --check extracted-index-script.js
```

The Netlify function was also required successfully in Node. Live Garmin authentication cannot be fully tested without the user's Garmin credentials and without Garmin lifting the current 429 rate limit.
