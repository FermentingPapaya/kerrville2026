const { GarminConnect } = require('garmin-connect');

function sportName(activity) {
  const raw = activity?.activityType?.typeKey || activity?.activityTypeDTO?.typeKey || activity?.sport || '';
  const s = String(raw).toLowerCase();
  if (s.includes('run')) return 'Run';
  if (s.includes('bike') || s.includes('cycling') || s.includes('cycl')) return 'Bike';
  if (s.includes('swim')) return 'Swim';
  if (s.includes('strength')) return 'Strength';
  return 'Other';
}

function rounded(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return Number(n.toFixed(digits));
}

function normalizeActivity(a) {
  const sport = sportName(a);
  const meters = a.distance ?? a.distanceMeters ?? a.summaryDTO?.distance;
  let distance = '';
  if (Number.isFinite(Number(meters))) {
    distance = sport === 'Swim'
      ? rounded(Number(meters) * 1.09361, 0)
      : rounded(Number(meters) / 1609.344, 2);
  }
  const seconds = a.duration ?? a.elapsedDuration ?? a.movingDuration ?? a.summaryDTO?.duration;
  const start = a.startTimeLocal || a.startTimeGMT || a.beginTimestamp || a.summaryDTO?.startTimeLocal || '';
  return {
    garminId: a.activityId || a.activityUUID || a.uuid || '',
    name: a.activityName || a.name || `Garmin ${sport.toLowerCase()}`,
    sport,
    date: start ? String(start).slice(0, 10) : '',
    duration: Number.isFinite(Number(seconds)) ? Math.round(Number(seconds) / 60) : '',
    distance,
    avgHR: rounded(a.averageHR ?? a.averageHr ?? a.avgHR ?? a.summaryDTO?.averageHR, 0),
    maxHR: rounded(a.maxHR ?? a.maxHr ?? a.summaryDTO?.maxHR, 0),
    calories: rounded(a.calories ?? a.summaryDTO?.calories, 0),
    avgPower: rounded(a.avgPower ?? a.averagePower ?? a.summaryDTO?.avgPower, 0),
    trainingEffect: rounded(a.aerobicTrainingEffect ?? a.trainingEffect ?? a.summaryDTO?.aerobicTrainingEffect, 1),
    source: 'Garmin Connect'
  };
}

exports.handler = async function () {
  try {
    const username = process.env.GARMIN_USERNAME || process.env.GARMIN_EMAIL;
    const password = process.env.GARMIN_PASSWORD || process.env.GARMIN_PWD;
    if (!username || !password) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Missing GARMIN_USERNAME and GARMIN_PASSWORD environment variables in Netlify.' }) };
    }

    const client = new GarminConnect();
    await client.login(username, password);

    const raw = await client.getActivities(0, 10);
    const activities = Array.isArray(raw) ? raw.map(normalizeActivity).filter(x => x.date) : [];

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ activities })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: err?.message || 'Garmin sync failed.' })
    };
  }
};
