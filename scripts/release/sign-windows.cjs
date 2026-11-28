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
  // Get-AuthenticodeSignature's verdict, machine-readable so the decision lives
  // here instead of in a shell string. CI runners carry PowerShell 7 (pwsh);
  // plain Windows hosts only ship 5.1 (powershell.exe) — both expose the same
  // cmdlets this relies on.
  const script = `$ErrorActionPreference = 'Stop'
$sig = Get-AuthenticodeSignature -LiteralPath $env:ONE_SIGNED_FILE
$state = [ordered]@{
  status = [string]$sig.Status
  thumbprint = if ($sig.SignerCertificate) { $sig.SignerCertificate.Thumbprint } else { '' }
  timestamped = [bool]$sig.TimeStamperCertificate
}
Write-Output ('ONE_SIG_VERDICT ' + (ConvertTo-Json -InputObject $state -Compress))`;
  const spawnArgs = ['-NoProfile', '-NonInteractive', '-Command', script];
  const spawnOpts = {
    env: { ...process.env, ONE_SIGNED_FILE: file, ONE_SIGNING_THUMBPRINT: thumbprint },
    encoding: 'utf8',
  };
  let output;
  try {
    output = execFileSync('pwsh.exe', spawnArgs, spawnOpts);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    output = execFileSync('powershell.exe', spawnArgs, spawnOpts);
  }

  const line = output.split(/\r?\n/).find((text) => text.startsWith('ONE_SIG_VERDICT '));
  if (!line) {
    throw new Error(`Authenticode verification produced no verdict for ${file}`);
  }
  const verdict = JSON.parse(line.slice('ONE_SIG_VERDICT '.length));

  // Files this release signed must carry the release certificate and a
  // timestamp — anything else on a freshly built file means the hook lied.
  if (verdict.status === 'Valid' && verdict.thumbprint === thumbprint && verdict.timestamped) {
    console.log(`Verified Windows signature and timestamp: ${file}`);
    return;
  }
  // Vendor binaries ship pre-signed (the bundled Node runtime is signed by the
  // OpenJS Foundation). sslTrus does not replace an existing signature, so the
  // upstream one stays; a valid, timestamped foreign signature is the expected
  // outcome for those files. They can only be pre-signed by their vendor — a
  // file this release built would have no signature at all and still fails.
  if (verdict.status === 'Valid' && verdict.thumbprint !== thumbprint && verdict.timestamped) {
    console.log(
      `Kept upstream signature (pre-signed outside this release, valid + timestamped): ${file} ` +
        `(signer ${verdict.thumbprint})`
    );
    return;
  }
  throw new Error(
    `Authenticode verification failed for ${file} ` +
      `(status: ${verdict.status}, signer: ${verdict.thumbprint || 'none'}, timestamped: ${verdict.timestamped}). ` +
      'Expected the release certificate and a timestamp, or an intact timestamped upstream signature.'
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
