const { execFileSync, spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');

const publisher = '上海言绪科技有限公司';
const thumbprint = '443850A50773F798BFA6436AC8EA12C1C09BF825';

function checkConfiguration() {
  for (const name of ['SSLTRUS_SIGNTOOL', 'SSLTRUS_ACCESS_KEY', 'SSLTRUS_ACCESS_SECRET', 'SSLTRUS_CERT_CODE']) {
    if (!process.env[name]?.trim()) {
      throw new Error(`Windows release signing requires ${name}`);
    }
  }
  if (process.platform !== 'win32' || !existsSync(process.env.SSLTRUS_SIGNTOOL)) {
    throw new Error('Windows release signing requires the sslTrus CLI on a Windows host');
  }
}

function verify(file) {
  execFileSync(
    'pwsh.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$ErrorActionPreference = 'Stop'
$sig = Get-AuthenticodeSignature -LiteralPath $env:ONE_SIGNED_FILE
if ($sig.Status -ne 'Valid' -or
    $sig.SignerCertificate.Thumbprint -ne $env:ONE_SIGNING_THUMBPRINT -or
    -not $sig.TimeStamperCertificate) {
  throw "Authenticode verification failed for $env:ONE_SIGNED_FILE (status: $($sig.Status)). Expected the release certificate and a timestamp."
}
Write-Host "Verified Windows signature and timestamp: $env:ONE_SIGNED_FILE"`,
    ],
    {
      env: { ...process.env, ONE_SIGNED_FILE: file, ONE_SIGNING_THUMBPRINT: thumbprint },
      stdio: 'inherit',
    }
  );
}

async function sign({ path, hash }) {
  checkConfiguration();
  if (hash !== 'sha256') {
    throw new Error(`Unexpected Windows signing hash: ${hash}`);
  }
  const result = spawnSync(
    process.env.SSLTRUS_SIGNTOOL,
    ['sign', '--cert-code', process.env.SSLTRUS_CERT_CODE, '--file', path, '--override=true'],
    {
      env: {
        ...process.env,
        ACCESS_KEY: process.env.SSLTRUS_ACCESS_KEY,
        ACCESS_SECRET: process.env.SSLTRUS_ACCESS_SECRET,
      },
      timeout: 180_000,
      windowsHide: true,
    }
  );
  if (result.error || result.status !== 0) {
    throw new Error(`sslTrus signing failed for ${path} (${result.error?.code ?? result.status ?? result.signal})`);
  }
  verify(path);
}

module.exports = { sign, verify, publisher, checkConfiguration };
