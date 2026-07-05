const { GarminConnect } = require('garmin-connect');

let cachedClient = null;
let cachedAt = 0;
const CLIENT_TTL_MS = 55 * 60 * 1000;

function json(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) };
}

function sportName(activity) {
  const raw = activity?.activityType?.typeKey || activity?.activityTypeDTO?.typeKey || activity?.sport || activity?.activityType?.key || '';
  const s = String(raw).toLowerCase();
  if (s.includes('run')) return 'Run';
  if (s.includes('bike') || s.includes('cycling') || s.includes('cycl') || s.includes('road_biking') || s.includes('indoor_cycling')) return 'Bike';
  if (s.includes('swim')) return 'Swim';
  if (s.includes('strength')) return 'Strength';
  if (s.includes('walk')) return 'Other';
  return 'Other';
}

function rounded(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return Number(n.toFixed(digits));
}

function getSeconds(a) {
  return a.duration ?? a.elapsedDuration ?? a.movingDuration ?? a.summaryDTO?.duration ?? a.summaryDTO?.movingDuration;
}

function normalizeActivity(a) {
  const sport = sportName(a);
  const meters = a.distance ?? a.distanceMeters ?? a.summaryDTO?.distance;
  let distance = '';
  let distanceUnit = sport === 'Swim' ? 'yd' : 'mi';
  if (Number.isFinite(Number(meters))) {
    distance = sport === 'Swim'
      ? rounded(Number(meters) * 1.09361, 0)
      : rounded(Number(meters) / 1609.344, 2);
  }
  const seconds = getSeconds(a);
  const start = a.startTimeLocal || a.startTimeGMT || a.beginTimestamp || a.summaryDTO?.startTimeLocal || a.summaryDTO?.startTimeGMT || '';
  const id = a.activityId || a.activityUUID || a.uuid || a.summaryDTO?.activityId || '';
  return {
    garminId: id ? String(id) : '',
    name: a.activityName || a.name || `Garmin ${sport.toLowerCase()}`,
    sport,
    date: start ? String(start).slice(0, 10) : '',
    startTime: start || '',
    duration: Number.isFinite(Number(seconds)) ? Math.round(Number(seconds) / 60) : '',
    durationSeconds: Number.isFinite(Number(seconds)) ? Math.round(Number(seconds)) : '',
    distance,
    distanceUnit,
    avgHR: rounded(a.averageHR ?? a.averageHr ?? a.avgHR ?? a.averageHeartRateInBeatsPerMinute ?? a.summaryDTO?.averageHR, 0),
    maxHR: rounded(a.maxHR ?? a.maxHr ?? a.maxHeartRateInBeatsPerMinute ?? a.summaryDTO?.maxHR, 0),
    calories: rounded(a.calories ?? a.summaryDTO?.calories, 0),
    avgPower: rounded(a.avgPower ?? a.averagePower ?? a.averageBikeCadenceInRoundsPerMinute ?? a.summaryDTO?.avgPower, 0),
    maxPower: rounded(a.maxPower ?? a.summaryDTO?.maxPower, 0),
    trainingEffect: rounded(a.aerobicTrainingEffect ?? a.trainingEffect ?? a.summaryDTO?.aerobicTrainingEffect, 1),
    ascent: rounded(a.elevationGain ?? a.totalElevationGain ?? a.summaryDTO?.elevationGain, 0),
    source: 'Garmin Connect'
  };
}

async function getClient() {
  if (cachedClient && Date.now() - cachedAt < CLIENT_TTL_MS) return cachedClient;

  const username = process.env.GARMIN_USERNAME || process.env.GARMIN_EMAIL;
  const password = process.env.GARMIN_PASSWORD || process.env.GARMIN_PWD;
  const rawOauth1 = process.env.GARMIN_OAUTH1;
  const rawOauth2 = process.env.GARMIN_OAUTH2;

  if (!username || !password) {
    throw new Error('Missing GARMIN_USERNAME and GARMIN_PASSWORD in Netlify environment variables.');
  }

  const client = new GarminConnect({ username, password });

  if (rawOauth1 && rawOauth2) {
    try {
      client.loadToken(JSON.parse(rawOauth1), JSON.parse(rawOauth2));
      cachedClient = client;
      cachedAt = Date.now();
      return client;
    } catch (err) {
      console.warn('[Garmin] OAuth token restore failed, falling back to login:', err.message);
    }
  }

  await client.login();
  cachedClient = client;
  cachedAt = Date.now();
  return client;
}

exports.handler = async function (event) {
  try {
    const limitRaw = event.queryStringParameters?.limit || '20';
    const startRaw = event.queryStringParameters?.start || '0';
    const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), 50);
    const start = Math.max(parseInt(startRaw, 10) || 0, 0);
    const client = await getClient();
    const raw = await client.getActivities(start, limit);
    const activities = Array.isArray(raw) ? raw.map(normalizeActivity).filter(x => x.date) : [];
    return json(200, { ok: true, activities, source: process.env.GARMIN_OAUTH1 && process.env.GARMIN_OAUTH2 ? 'oauth_tokens' : 'username_password' });
  } catch (err) {
    const message = err?.message || 'Garmin sync failed.';
    const is429 = message.includes('429') || message.toLowerCase().includes('rate');
    return json(500, {
      ok: false,
      error: message,
      hint: is429
        ? 'Garmin rate-limited login. Stop testing for now. Generate GARMIN_OAUTH1 and GARMIN_OAUTH2 tokens with npm run garmin:tokens, add them to Netlify, then redeploy.'
        : 'Check Garmin credentials/tokens in Netlify environment variables.'
    });
  }
};
