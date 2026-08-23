#!/usr/bin/env node

/**
 * Exchange the company credential token + sign key for short-lived COS
 * credentials.
 *
 * Replaces the previous scheme where a long-lived Tencent Cloud SecretId /
 * SecretKey pair was stored directly in GitHub secrets (and in
 * ~/.aws/credentials for local uploads). Now nothing durable is stored: a
 * Token ("凭据 Key") plus a SignKey ("签名密钥") are used to sign a request to
 * the credential-alloc service, which hands back an ak/sk (and, for STS-style
 * responses, a session token) that expires on its own.
 *
 * Signing contract (from the credential service docs):
 *   payload = `token=${token}&Timestamp=${unix_seconds}`
 *   hmac-sha256 / hmac-sha1 → hex(hmac(signKey, payload))
 *   md5                     → hex(md5(payload + signKey))
 * The algorithm is whatever the credential service's web console is
 * configured with — set COS_ALLOC_SIGN_ALGO if it is not the hmac-sha256
 * default.
 *
 * Request : POST {url}  {"token":…, "Timestamp":…, "sign":…}
 * Response: {"code":0,"data":{"ak":…,"sk":…,"expire_at":…}}
 *
 * Required env (never hardcode these — CI secrets / local shell only):
 *   COS_ALLOC_URL       full alloc endpoint, e.g. https://<host>/api/honeypot/oapi/qcloud/alloc
 *   COS_ALLOC_TOKEN     凭据 Key
 *   COS_ALLOC_SIGN_KEY  签名密钥
 * Optional:
 *   COS_ALLOC_SIGN_ALGO hmac-sha256 (default) | hmac-sha1 | md5
 *
 * Usage:
 *   node scripts/fetch-cos-credentials.js                  # JSON to stdout (secrets included — do not log)
 *   node scripts/fetch-cos-credentials.js --format github  # append to $GITHUB_ENV + ::add-mask::
 *   eval "$(node scripts/fetch-cos-credentials.js --format sh)"    # bash / Git Bash
 *   node scripts/fetch-cos-credentials.js --format ps1 | iex       # PowerShell
 */

const crypto = require('crypto');
const fs = require('fs');

const FORMATS = ['json', 'github', 'sh', 'ps1'];
const ALGOS = ['hmac-sha256', 'hmac-sha1', 'md5'];
const REQUEST_TIMEOUT_MS = 20_000;
// Below this much remaining lifetime an upload of a few-hundred-MB installer
// is at real risk of dying mid-flight, so say so instead of failing opaquely.
const SHORT_LIFETIME_WARN_SECONDS = 15 * 60;

function fail(message) {
  console.error(`fetch-cos-credentials: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  let format = 'json';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--format') {
      format = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--format=')) {
      format = arg.slice('--format='.length);
    } else {
      fail(`unknown argument "${arg}" (expected --format <${FORMATS.join('|')}>)`);
    }
  }
  if (!FORMATS.includes(format)) {
    fail(`unknown --format "${format}" (expected one of: ${FORMATS.join(', ')})`);
  }
  return { format };
}

function sign(payload, signKey, algo) {
  switch (algo) {
    case 'hmac-sha256':
      return crypto.createHmac('sha256', signKey).update(payload).digest('hex');
    case 'hmac-sha1':
      return crypto.createHmac('sha1', signKey).update(payload).digest('hex');
    case 'md5':
      // Deliberately different shape: the digest covers payload + signKey,
      // it is not a keyed HMAC.
      return crypto
        .createHash('md5')
        .update(payload + signKey)
        .digest('hex');
    default:
      return fail(`unsupported COS_ALLOC_SIGN_ALGO "${algo}" (expected one of: ${ALGOS.join(', ')})`);
  }
}

/**
 * The alloc service returns the cloud vendor's own field names. Accept the
 * documented `ak`/`sk` plus the common aliases so a vendor-side rename does
 * not silently produce empty credentials.
 */
function pick(data, keys) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

async function main() {
  const { format } = parseArgs(process.argv.slice(2));

  const url = process.env.COS_ALLOC_URL;
  const token = process.env.COS_ALLOC_TOKEN;
  const signKey = process.env.COS_ALLOC_SIGN_KEY;
  const algo = (process.env.COS_ALLOC_SIGN_ALGO || 'hmac-sha256').toLowerCase();

  const missing = [
    ['COS_ALLOC_URL', url],
    ['COS_ALLOC_TOKEN', token],
    ['COS_ALLOC_SIGN_KEY', signKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    fail(`missing required environment variable(s): ${missing.join(', ')}`);
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `token=${token}&Timestamp=${timestamp}`;
  const signature = sign(payload, signKey, algo);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, Timestamp: timestamp, sign: signature }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // The token is in the request body, not the URL, so echoing the URL is safe.
    fail(`credential request to ${url} failed: ${error.message}`);
  }

  const raw = await response.text();
  if (!response.ok) {
    fail(`credential service returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    fail(`credential service returned non-JSON body: ${raw.slice(0, 500)}`);
  }

  if (body.code !== 0 && body.code !== undefined) {
    // Error bodies carry a message, never credentials — safe to surface.
    // `message` is a fixed category ("云厂商签发失败"); the actionable detail is
    // in `reason`, which names the actual cloud-side fault — e.g.
    // "sub-account has a disabled access key (AKID… is Inactive) on cloud",
    // which tells you to go clear that key rather than retry forever.
    // Dropping it (as this used to) turns a fixable problem into a dead end.
    const detail = body.message || body.msg || raw.slice(0, 500);
    const reason = body.reason ? ` — ${body.reason}` : '';
    fail(`credential service returned code ${body.code}: ${detail}${reason}`);
  }

  const data = body.data || {};
  const accessKeyId = pick(data, ['ak', 'AK', 'secret_id', 'secretId', 'SecretId', 'TmpSecretId']);
  const secretAccessKey = pick(data, ['sk', 'SK', 'secret_key', 'secretKey', 'SecretKey', 'TmpSecretKey']);
  // Present only for STS-style temporary credentials; a plain sub-account
  // ak/sk pair has none, and AWS_SESSION_TOKEN must then stay unset.
  const sessionToken = pick(data, ['session_token', 'sessionToken', 'Token', 'token']);
  const expireAt = data.expire_at ?? data.expireAt ?? data.expiredTime ?? data.ExpiredTime;

  if (!accessKeyId || !secretAccessKey) {
    fail(`credential service response did not contain ak/sk (keys: ${Object.keys(data).join(', ') || 'none'})`);
  }

  if (typeof expireAt === 'number') {
    const remaining = expireAt - Math.floor(Date.now() / 1000);
    if (remaining <= 0) {
      fail(`credential service returned an already-expired credential (expire_at=${expireAt})`);
    }
    if (remaining < SHORT_LIFETIME_WARN_SECONDS) {
      console.error(
        `fetch-cos-credentials: warning — credential expires in ${Math.round(remaining / 60)} min; a large upload may outlive it.`
      );
    }
  }

  emit(format, { accessKeyId, secretAccessKey, sessionToken, expireAt });
}

function emit(format, { accessKeyId, secretAccessKey, sessionToken, expireAt }) {
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify({ accessKeyId, secretAccessKey, sessionToken, expireAt }, null, 2)}\n`);
    return;
  }

  if (format === 'github') {
    const envFile = process.env.GITHUB_ENV;
    if (!envFile) fail('--format github requires $GITHUB_ENV (are you running outside GitHub Actions?)');

    // Mask before writing: anything printed after this point is redacted in
    // the run log even if a later step echoes it by accident.
    for (const secret of [accessKeyId, secretAccessKey, sessionToken]) {
      if (secret) console.log(`::add-mask::${secret}`);
    }

    const lines = [`AWS_ACCESS_KEY_ID=${accessKeyId}`, `AWS_SECRET_ACCESS_KEY=${secretAccessKey}`];
    if (sessionToken) lines.push(`AWS_SESSION_TOKEN=${sessionToken}`);
    fs.appendFileSync(envFile, `${lines.join('\n')}\n`);

    const expiry = typeof expireAt === 'number' ? new Date(expireAt * 1000).toISOString() : 'unknown';
    console.log(
      `Fetched temporary COS credentials (expires: ${expiry}, session token: ${sessionToken ? 'yes' : 'no'})`
    );
    return;
  }

  if (format === 'sh') {
    process.stdout.write(`export AWS_ACCESS_KEY_ID='${accessKeyId}'\n`);
    process.stdout.write(`export AWS_SECRET_ACCESS_KEY='${secretAccessKey}'\n`);
    // Always emit the session-token line so a stale value from an earlier,
    // STS-style fetch cannot leak into this one.
    process.stdout.write(sessionToken ? `export AWS_SESSION_TOKEN='${sessionToken}'\n` : 'unset AWS_SESSION_TOKEN\n');
    return;
  }

  // ps1
  process.stdout.write(`$env:AWS_ACCESS_KEY_ID='${accessKeyId}'\n`);
  process.stdout.write(`$env:AWS_SECRET_ACCESS_KEY='${secretAccessKey}'\n`);
  process.stdout.write(sessionToken ? `$env:AWS_SESSION_TOKEN='${sessionToken}'\n` : '$env:AWS_SESSION_TOKEN=$null\n');
}

main().catch((error) => fail(error.stack || error.message));
