#!/usr/bin/env node
/*
  Generate long-lived Garmin OAuth tokens for Netlify.
  Adapted from cggmx/garmin-health-dashboard's garth-inspired mobile JSON API flow.
  Run: npm run garmin:tokens
*/
const readline = require('readline');
const crypto = require('crypto');
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const OAuth = require('oauth-1.0a');

try {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    });
  }
} catch (_) {}

async function prompt(question, hidden = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (hidden && process.stdin.isTTY && process.stdout.isTTY) {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    return new Promise(resolve => {
      let input = '';
      function onData(ch) {
        ch = ch.toString();
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.off('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(input);
        } else if (ch === '\u0003') {
          process.exit();
        } else if (ch === '\u007f') {
          input = input.slice(0, -1);
        } else {
          input += ch;
        }
      }
      process.stdin.on('data', onData);
      process.stdin.resume();
    });
  }
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

async function loginWithMobileApi(username, password) {
  const SSO = 'https://sso.garmin.com';
  const SERVICE = 'https://mobile.integration.garmin.com/gcm/android';
  const CLIENT = 'GCM_ANDROID_DARK';
  const SSO_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  const BASE_HEADERS = {
    'User-Agent': SSO_UA,
    'Accept': 'application/json, text/html, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  const LOGIN_PARAMS = `clientId=${CLIENT}&locale=en-US&service=${encodeURIComponent(SERVICE)}`;
  const jar = new CookieJar();

  async function req(method, url, { params, body, extraHeaders } = {}) {
    const fullUrl = params ? `${url}?${params}` : url;
    const cookies = await jar.getCookies(fullUrl);
    const cookieHeader = cookies.map(c => `${c.key}=${c.value}`).join('; ');
    const resp = await axios({
      method,
      url: fullUrl,
      data: body,
      headers: { ...BASE_HEADERS, ...(cookieHeader ? { Cookie: cookieHeader } : {}), ...(extraHeaders || {}) },
      validateStatus: s => s < 500,
      maxRedirects: 5,
    });
    const setCookies = resp.headers['set-cookie'] || [];
    for (const c of setCookies) await jar.setCookie(c, fullUrl).catch(() => {});
    return resp;
  }

  await req('GET', `${SSO}/mobile/sso/en/sign-in`, { params: `clientId=${CLIENT}` });
  const loginResp = await req('POST', `${SSO}/mobile/api/login`, {
    params: LOGIN_PARAMS,
    body: JSON.stringify({ username, password, rememberMe: false, captchaToken: '' }),
    extraHeaders: { 'Content-Type': 'application/json' },
  });
  const loginData = loginResp.data;
  const status = loginData?.responseStatus?.type || loginData?.type;

  if (!status) {
    const isRateLimit = loginResp.status === 429 || JSON.stringify(loginData).includes('429');
    if (isRateLimit) {
      throw new Error('Garmin rate limit 429. Wait 24-48 hours, then try once. Do not keep retrying.');
    }
    throw new Error(`Unexpected Garmin login response: ${JSON.stringify(loginData).slice(0, 300)}`);
  }

  if (status === 'MFA_REQUIRED') {
    const method = loginData?.customerMfaInfo?.mfaLastMethodUsed || 'email';
    console.log(`MFA required (${method}). Garmin should send a fresh code now.`);
    const mfaCode = await prompt('Enter Garmin MFA code: ');
    const mfaResp = await req('POST', `${SSO}/mobile/api/mfa/verifyCode`, {
      params: LOGIN_PARAMS,
      body: JSON.stringify({
        mfaMethod: method,
        mfaVerificationCode: mfaCode.trim(),
        rememberMyBrowser: false,
        reconsentList: [],
        mfaSetup: false,
      }),
      extraHeaders: { 'Content-Type': 'application/json' },
    });
    const mfaData = mfaResp.data;
    const mfaStatus = mfaData?.responseStatus?.type || mfaData?.type;
    if (mfaStatus !== 'SUCCESSFUL') throw new Error(`MFA failed: ${mfaStatus || 'unknown'}`);
    return mfaData.serviceTicketId || mfaData.serviceTicketUrl || null;
  }

  if (status !== 'SUCCESSFUL') throw new Error(`Garmin login failed: ${status}`);
  return loginData.serviceTicketId || loginData.serviceTicketUrl || null;
}

async function exchangeTicketForTokens(ticket) {
  const CONNECT_API = 'https://connectapi.garmin.com';
  const MOBILE_UA = 'com.garmin.android.apps.connectmobile';
  const LOGIN_URL = 'https://mobile.integration.garmin.com/gcm/android';

  const consumerResp = await axios.get('https://thegarth.s3.amazonaws.com/oauth_consumer.json');
  const { consumer_key, consumer_secret } = consumerResp.data;
  const oauth = OAuth({
    consumer: { key: consumer_key, secret: consumer_secret },
    signature_method: 'HMAC-SHA1',
    hash_function: (base, key) => crypto.createHmac('sha1', key).update(base).digest('base64'),
  });

  const preAuthUrl = `${CONNECT_API}/oauth-service/oauth/preauthorized`;
  const preAuthParams = { ticket, 'login-url': LOGIN_URL, 'accepts-mfa-tokens': 'true' };
  const fullPreAuthUrl = `${preAuthUrl}?${new URLSearchParams(preAuthParams)}`;
  const preAuthHeader = oauth.toHeader(oauth.authorize({ url: fullPreAuthUrl, method: 'GET' }));
  const preAuthResp = await axios.get(fullPreAuthUrl, { headers: { ...preAuthHeader, 'User-Agent': MOBILE_UA }, validateStatus: () => true });
  if (preAuthResp.status !== 200) throw new Error(`OAuth preauth failed HTTP ${preAuthResp.status}: ${String(preAuthResp.data).slice(0, 300)}`);

  const preAuthData = new URLSearchParams(preAuthResp.data);
  const oauth1Token = {
    oauth_token: preAuthData.get('oauth_token'),
    oauth_token_secret: preAuthData.get('oauth_token_secret'),
    mfa_token: preAuthData.get('mfa_token') || undefined,
  };
  if (!oauth1Token.oauth_token) throw new Error(`OAuth preauth returned no token: ${String(preAuthResp.data).slice(0, 300)}`);

  const exchangeUrl = `${CONNECT_API}/oauth-service/oauth/exchange/user/2.0`;
  const exchangeBodyData = { audience: 'GARMIN_CONNECT_MOBILE_ANDROID_DI' };
  if (oauth1Token.mfa_token) exchangeBodyData.mfa_token = oauth1Token.mfa_token;
  const exchangeHeader = oauth.toHeader(oauth.authorize({ url: exchangeUrl, method: 'POST', data: exchangeBodyData }, { key: oauth1Token.oauth_token, secret: oauth1Token.oauth_token_secret }));
  const exchangeBody = new URLSearchParams(exchangeBodyData);
  const exchangeResp = await axios.post(exchangeUrl, exchangeBody.toString(), {
    headers: { ...exchangeHeader, 'User-Agent': MOBILE_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
  });
  if (exchangeResp.status !== 200) throw new Error(`OAuth exchange failed HTTP ${exchangeResp.status}: ${JSON.stringify(exchangeResp.data).slice(0, 300)}`);
  return { oauth1Token, oauth2Token: exchangeResp.data };
}

async function main() {
  let user = process.env.GARMIN_USERNAME;
  let pass = process.env.GARMIN_PASSWORD;
  if (!user) user = await prompt('Garmin username/email: ');
  if (!pass) pass = await prompt('Garmin password: ', true);
  if (!user || !pass) throw new Error('Username and password are required.');

  console.log(`Logging into Garmin as ${user}...`);
  const serviceTicket = await loginWithMobileApi(user, pass);
  const ticket = serviceTicket ? (String(serviceTicket).match(/ticket=([^&\s"]+)/)?.[1] ?? String(serviceTicket).trim()) : null;
  if (!ticket) throw new Error('No Garmin service ticket was returned.');
  const { oauth1Token, oauth2Token } = await exchangeTicketForTokens(ticket);

  console.log('\nTokens generated. Add these to Netlify as environment variables.');
  console.log('\nGARMIN_OAUTH1');
  console.log(JSON.stringify(oauth1Token));
  console.log('\nGARMIN_OAUTH2');
  console.log(JSON.stringify(oauth2Token));
  console.log('\nKeep GARMIN_USERNAME and GARMIN_PASSWORD set too. After adding both token variables, redeploy Netlify.');
}

main().catch(err => {
  console.error('\nFailed:', err.message || err);
  process.exit(1);
});
