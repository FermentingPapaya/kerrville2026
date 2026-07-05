# Kerrville 2026 Training Companion

Static Netlify app with local training log, calendar, Garmin .FIT upload, and a Netlify Function for Garmin Connect sync.

## Netlify environment variables

Set these in Netlify Site configuration > Environment variables:

- GARMIN_USERNAME
- GARMIN_PASSWORD

Garmin sync uses the unofficial `garmin-connect` npm package. If Garmin blocks login because of MFA or security checks, use the .FIT upload fallback while we adjust the authentication approach.
