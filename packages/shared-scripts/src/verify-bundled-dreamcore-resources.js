const fs = require('fs');
const path = require('path');

const REQUIRED_ACP_TOOL_SLUGS = ['codex-acp', 'claude-agent-acp'];

/**
 * Manifest contract versions this verifier understands.
 *
 * v1 = agent CLIs bundled as npm packages (`acpTools`).
 * v2 = agent CLIs bundled as prepared native binaries (`clis`), which is what
 * `cmd_prepare_managed_resources` emits today. Both stay supported so a bundle
 * prepared by an older backend still verifies.
 */
const SUPPORTED_SCHEMA_VERSIONS = new Set([1, 2]);

/** Agent CLIs a v2 bundle must contain. Mirrors REQUIRED_ACP_TOOL_SLUGS. */
const REQUIRED_MANAGED_CLI_NAMES = ['claude', 'codex'];

function backendBinaryName(platform) {
  return platform === 'win32' ? 'dreamcore.exe' : 'dreamcore';
}

function normalize(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function bundledPath(runtimeKey, ...parts) {
  return normalize(path.join('bundled-dreamcore', runtimeKey, ...parts));
}

function isFile(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function isDirectory(dirPath) {
  return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
}

function addFailure(failures, missing, checked, failure) {
  if (failure.path) checked.push(failure.path);
  failures.push(failure);
  if (failure.path) {
    missing.push(
      failure.reason === 'missing_file' || failure.reason === 'missing_directory'
        ? failure.path
        : `${failure.path}<${failure.reason}>`
    );
  }
}

function requireRelativePath(baseDir, runtimeKey, parts, checked, missing, failures) {
  const relativePath = bundledPath(runtimeKey, ...parts);
  checked.push(relativePath);

  if (!isFile(path.join(baseDir, ...parts))) {
    const failure = { component: 'dreamcore', reason: 'missing_file', path: relativePath };
    failures.push(failure);
    missing.push(relativePath);
  }
}

function requireRelativeDirectory(baseDir, runtimeKey, parts, checked, missing, failures) {
  const relativePath = bundledPath(runtimeKey, ...parts);
  checked.push(relativePath);

  const fullPath = path.join(baseDir, ...parts);
  if (!isDirectory(fullPath)) {
    const failure = { component: 'managed-resources', reason: 'missing_directory', path: relativePath };
    failures.push(failure);
    missing.push(relativePath);
  }
}

function readManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

function verifyBundleManifest(baseDir, runtimeKey, electronPlatformName, targetArch, checked, missing, failures) {
  const parts = ['manifest.json'];
  const relativePath = bundledPath(runtimeKey, ...parts);
  const manifestPath = path.join(baseDir, ...parts);
  checked.push(relativePath);

  if (!isFile(manifestPath)) {
    missing.push(relativePath);
    failures.push({ component: 'bundle-manifest', reason: 'missing_file', path: relativePath });
    return;
  }

  const manifest = readManifest(manifestPath);
  if (!manifest) {
    missing.push(`${relativePath}<invalid-json>`);
    failures.push({ component: 'bundle-manifest', reason: 'invalid_json', path: relativePath });
    return;
  }

  if (manifest.platform !== electronPlatformName) {
    missing.push(`${relativePath}<platform:${electronPlatformName}>`);
    failures.push({ component: 'bundle-manifest', reason: 'runtime_key_mismatch', path: relativePath });
  }

  if (manifest.arch !== targetArch) {
    missing.push(`${relativePath}<arch:${targetArch}>`);
    failures.push({ component: 'bundle-manifest', reason: 'runtime_key_mismatch', path: relativePath });
  }
}

function readManagedResourcesContract(manifestPath) {
  try {
    return { contract: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
  } catch (error) {
    return { error };
  }
}

function validateContractRelativePath(value) {
  if (typeof value !== 'string') return false;
  if (!value || value.includes('\\') || path.isAbsolute(value)) return false;
  return value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function joinContractPath(root, relativePath) {
  return path.join(root, ...relativePath.split('/'));
}

function contractBundledPath(runtimeKey, ...parts) {
  return bundledPath(runtimeKey, 'managed-resources', ...parts);
}

function addSchemaFailure(failures, missing, component, reason, path) {
  addFailure(failures, missing, [], { component, reason, path });
}

function stringField(value) {
  return typeof value === 'string' && value.length > 0;
}

function stringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

function validateContractPathField(value, component, pathLabel, failures) {
  if (!validateContractRelativePath(value)) {
    failures.push({
      component,
      reason: 'invalid_contract_path',
      detail: pathLabel,
    });
    return false;
  }
  return true;
}

function verifyManagedResourcesContract(baseDir, runtimeKey, checked, missing, failures) {
  const managedRoot = path.join(baseDir, 'managed-resources');
  const relativePath = contractBundledPath(runtimeKey, 'manifest.json');
  const manifestPath = path.join(managedRoot, 'manifest.json');
  checked.push(relativePath);

  if (!isFile(manifestPath)) {
    addFailure(failures, missing, [], {
      component: 'managed-resources',
      reason: 'missing_file',
      path: relativePath,
    });
    return;
  }

  const { contract, error } = readManagedResourcesContract(manifestPath);
  if (error) {
    addFailure(failures, missing, [], {
      component: 'managed-resources',
      reason: 'invalid_json',
      path: relativePath,
    });
    return;
  }

  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    addSchemaFailure(failures, missing, 'managed-resources', 'invalid_schema', relativePath);
    return;
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.has(contract.schemaVersion)) {
    addSchemaFailure(
      failures,
      missing,
      'managed-resources',
      typeof contract.schemaVersion === 'number' ? 'unsupported_schema_version' : 'invalid_schema',
      relativePath
    );
    return;
  }
  if (contract.runtimeKey !== runtimeKey) {
    addSchemaFailure(failures, missing, 'managed-resources', 'runtime_key_mismatch', relativePath);
    return;
  }
  if (!contract.node || typeof contract.node !== 'object' || Array.isArray(contract.node)) {
    addSchemaFailure(failures, missing, 'managed-resources', 'invalid_schema', relativePath);
    return;
  }

  // `acpTools` is the ACP wrapper layer this fork actually spawns sessions
  // through; v2 adds `clis` (upstream's prepared native binaries) alongside it.
  //
  // The two are NOT interchangeable, and assuming they were is exactly how
  // 2.1.51 shipped broken: when v2 support was added to unblock packaging, the
  // native CLIs were treated as the v1 wrappers' replacement, so this verifier
  // stopped checking `acp/` — and the backend had already stopped emitting it.
  // Every fresh install of that build failed to start Claude and Codex. A v2
  // bundle must carry BOTH, so both are required here.
  const requiredAgentFields = contract.schemaVersion === 1 ? [contract.acpTools] : [contract.acpTools, contract.clis];
  if (!requiredAgentFields.every((field) => Array.isArray(field))) {
    addSchemaFailure(failures, missing, 'managed-resources', 'invalid_schema', relativePath);
    return;
  }

  verifyManagedNodeFromContract(managedRoot, runtimeKey, contract, checked, missing, failures);
  verifyManagedAcpToolsFromContract(managedRoot, runtimeKey, contract, checked, missing, failures);
  if (contract.schemaVersion !== 1) {
    verifyManagedClisFromContract(managedRoot, runtimeKey, contract, checked, missing, failures);
  }
}

function verifyManagedNodeFromContract(baseDir, runtimeKey, contract, checked, missing, failures) {
  const node = contract.node;
  const manifestPath = contractBundledPath(runtimeKey, 'manifest.json');
  if (!stringField(node.version) || !stringField(node.root) || !stringField(node.executable)) {
    addSchemaFailure(failures, missing, 'managed-node', 'invalid_schema', manifestPath);
    return;
  }
  if (
    !validateContractPathField(node.root, 'managed-node', 'node.root', failures) ||
    !validateContractPathField(node.executable, 'managed-node', 'node.executable', failures)
  ) {
    return;
  }

  const executablePath = joinContractPath(joinContractPath(baseDir, node.root), node.executable);
  const relativePath = contractBundledPath(runtimeKey, node.root, node.executable);
  checked.push(relativePath);
  if (!isFile(executablePath)) {
    missing.push(relativePath);
    failures.push({
      component: 'managed-node',
      reason: 'missing_file',
      version: node.version,
      runtimeKey,
      path: relativePath,
    });
  }
}

function verifyManagedAcpToolsFromContract(baseDir, runtimeKey, contract, checked, missing, failures) {
  const seen = new Set();
  const validTools = [];
  const manifestPath = contractBundledPath(runtimeKey, 'manifest.json');

  for (const tool of contract.acpTools) {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool) || !stringField(tool.slug)) {
      addSchemaFailure(failures, missing, 'managed-resources', 'invalid_schema', manifestPath);
      continue;
    }
    if (seen.has(tool.slug)) {
      failures.push({
        component: tool.slug,
        reason: 'duplicate_tool_slug',
      });
      continue;
    }
    seen.add(tool.slug);
    validTools.push(tool);
  }

  for (const requiredSlug of REQUIRED_ACP_TOOL_SLUGS) {
    if (!seen.has(requiredSlug)) {
      failures.push({
        component: requiredSlug,
        reason: 'missing_required_tool',
      });
    }
  }

  for (const tool of validTools) {
    verifyManagedAcpToolFromContract(baseDir, runtimeKey, tool, checked, missing, failures);
  }
}

/**
 * Validate the v2 `clis` array: prepared native agent CLIs.
 *
 * Same contract as the v1 acpTools pass — every declared CLI must actually be
 * on disk — but the v2 entries are plain binaries, so there is no npm manifest,
 * entrypoint or PATH entry to cross-check.
 */
function verifyManagedClisFromContract(baseDir, runtimeKey, contract, checked, missing, failures) {
  const seen = new Set();
  const validClis = [];
  const manifestPath = contractBundledPath(runtimeKey, 'manifest.json');

  for (const cli of contract.clis) {
    if (!cli || typeof cli !== 'object' || Array.isArray(cli) || !stringField(cli.name)) {
      addSchemaFailure(failures, missing, 'managed-resources', 'invalid_schema', manifestPath);
      continue;
    }
    if (seen.has(cli.name)) {
      failures.push({ component: cli.name, reason: 'duplicate_cli_name' });
      continue;
    }
    seen.add(cli.name);
    validClis.push(cli);
  }

  for (const requiredName of REQUIRED_MANAGED_CLI_NAMES) {
    if (!seen.has(requiredName)) {
      failures.push({ component: requiredName, reason: 'missing_required_cli' });
    }
  }

  for (const cli of validClis) {
    verifyManagedCliFromContract(baseDir, runtimeKey, cli, checked, missing, failures);
  }
}

function verifyManagedCliFromContract(baseDir, runtimeKey, cli, checked, missing, failures) {
  const manifestPath = contractBundledPath(runtimeKey, 'manifest.json');
  if (['version', 'root', 'platformDirectory', 'executable'].some((field) => !stringField(cli[field]))) {
    addSchemaFailure(failures, missing, cli.name, 'invalid_schema', manifestPath);
    return;
  }
  // Both lists are optional in the contract; absent means "nothing extra".
  const requiredFiles = cli.requiredFiles === undefined ? [] : cli.requiredFiles;
  const requiredDirectories = cli.requiredDirectories === undefined ? [] : cli.requiredDirectories;
  if (!stringArray(requiredFiles) || !stringArray(requiredDirectories)) {
    addSchemaFailure(failures, missing, cli.name, 'invalid_schema', manifestPath);
    return;
  }
  if (cli.platformDirectory !== runtimeKey) {
    addSchemaFailure(failures, missing, cli.name, 'runtime_key_mismatch', manifestPath);
    return;
  }

  const pathFields = [
    ['root', cli.root],
    ['executable', cli.executable],
    ...requiredFiles.map((entry, index) => [`requiredFiles[${index}]`, entry]),
    ...requiredDirectories.map((entry, index) => [`requiredDirectories[${index}]`, entry]),
  ];
  if (pathFields.some(([field, value]) => !validateContractPathField(value, cli.name, field, failures))) {
    return;
  }

  // The shared file/directory assertions report through `slug`; give them the
  // CLI's name so a v2 failure reads the same way a v1 one does.
  const component = { slug: cli.name, version: cli.version, packageName: undefined };
  requireContractFile(baseDir, runtimeKey, component, cli.root, cli.executable, checked, missing, failures);
  for (const requiredFile of requiredFiles) {
    requireContractFile(baseDir, runtimeKey, component, cli.root, requiredFile, checked, missing, failures);
  }
  for (const requiredDirectory of requiredDirectories) {
    requireContractDirectory(baseDir, runtimeKey, component, cli.root, requiredDirectory, checked, missing, failures);
  }
}

function verifyManagedAcpToolFromContract(baseDir, runtimeKey, tool, checked, missing, failures) {
  const manifestPath = contractBundledPath(runtimeKey, 'manifest.json');
  const requiredStringFields = [
    'version',
    'packageName',
    'root',
    'platformDirectory',
    'manifest',
    'entrypoint',
    'platformExecutable',
  ];
  if (requiredStringFields.some((field) => !stringField(tool[field]))) {
    addSchemaFailure(failures, missing, tool.slug, 'invalid_schema', manifestPath);
    return;
  }
  if (!stringArray(tool.pathEntries) || !stringArray(tool.requiredFiles) || !stringArray(tool.requiredDirectories)) {
    addSchemaFailure(failures, missing, tool.slug, 'invalid_schema', manifestPath);
    return;
  }
  if (tool.platformDirectory !== runtimeKey) {
    addSchemaFailure(failures, missing, tool.slug, 'runtime_key_mismatch', manifestPath);
    return;
  }

  const pathFields = [
    ['root', tool.root],
    ['manifest', tool.manifest],
    ['entrypoint', tool.entrypoint],
    ['platformExecutable', tool.platformExecutable],
    ...tool.pathEntries.map((entry, index) => [`pathEntries[${index}]`, entry]),
    ...tool.requiredFiles.map((entry, index) => [`requiredFiles[${index}]`, entry]),
    ...tool.requiredDirectories.map((entry, index) => [`requiredDirectories[${index}]`, entry]),
  ];
  if (pathFields.some(([field, value]) => !validateContractPathField(value, tool.slug, field, failures))) {
    return;
  }

  const toolRoot = joinContractPath(baseDir, tool.root);
  const localManifestRelative = contractBundledPath(runtimeKey, tool.root, tool.manifest);
  const localManifestPath = joinContractPath(toolRoot, tool.manifest);
  checked.push(localManifestRelative);
  if (!isFile(localManifestPath)) {
    missing.push(localManifestRelative);
    failures.push({
      component: tool.slug,
      reason: 'missing_file',
      version: tool.version,
      packageName: tool.packageName,
      runtimeKey,
      path: localManifestRelative,
    });
    return;
  }

  const localManifest = readManifest(localManifestPath);
  if (!localManifest) {
    missing.push(`${localManifestRelative}<invalid_json>`);
    failures.push({
      component: tool.slug,
      reason: 'invalid_json',
      version: tool.version,
      packageName: tool.packageName,
      runtimeKey,
      path: localManifestRelative,
    });
    return;
  }
  if (localManifest.entrypoint !== tool.entrypoint) {
    missing.push(`${localManifestRelative}<manifest_entrypoint_mismatch>`);
    failures.push({
      component: tool.slug,
      reason: 'manifest_entrypoint_mismatch',
      version: tool.version,
      packageName: tool.packageName,
      runtimeKey,
      path: localManifestRelative,
    });
  }
  const localPathEntries = Array.isArray(localManifest.path_entries) ? localManifest.path_entries : [];
  if (JSON.stringify(localPathEntries) !== JSON.stringify(tool.pathEntries)) {
    missing.push(`${localManifestRelative}<manifest_path_entries_mismatch>`);
    failures.push({
      component: tool.slug,
      reason: 'manifest_path_entries_mismatch',
      version: tool.version,
      packageName: tool.packageName,
      runtimeKey,
      path: localManifestRelative,
    });
  }

  requireContractFile(baseDir, runtimeKey, tool, tool.root, tool.entrypoint, checked, missing, failures);
  for (const requiredFile of tool.requiredFiles) {
    requireContractFile(baseDir, runtimeKey, tool, tool.root, requiredFile, checked, missing, failures);
  }
  for (const requiredDirectory of tool.requiredDirectories) {
    requireContractDirectory(baseDir, runtimeKey, tool, tool.root, requiredDirectory, checked, missing, failures);
  }
  requireContractFile(baseDir, runtimeKey, tool, tool.root, tool.platformExecutable, checked, missing, failures);
}

function requireContractFile(baseDir, runtimeKey, tool, root, relativePath, checked, missing, failures) {
  const bundledRelative = contractBundledPath(runtimeKey, root, relativePath);
  checked.push(bundledRelative);
  if (!isFile(joinContractPath(joinContractPath(baseDir, root), relativePath))) {
    missing.push(bundledRelative);
    failures.push({
      component: tool.slug,
      reason: 'missing_file',
      version: tool.version,
      packageName: tool.packageName,
      runtimeKey,
      path: bundledRelative,
    });
  }
}

function requireContractDirectory(baseDir, runtimeKey, tool, root, relativePath, checked, missing, failures) {
  const bundledRelative = contractBundledPath(runtimeKey, root, relativePath);
  checked.push(bundledRelative);
  if (!isDirectory(joinContractPath(joinContractPath(baseDir, root), relativePath))) {
    missing.push(bundledRelative);
    failures.push({
      component: tool.slug,
      reason: 'missing_directory',
      version: tool.version,
      packageName: tool.packageName,
      runtimeKey,
      path: bundledRelative,
    });
  }
}

function verifyBundledDreamcoreResources({ resourcesDir, electronPlatformName, targetArch }) {
  const runtimeKey = `${electronPlatformName}-${targetArch}`;
  const baseDir = path.join(resourcesDir, 'bundled-dreamcore', runtimeKey);
  const checked = [];
  const missing = [];
  const failures = [];

  requireRelativePath(baseDir, runtimeKey, [backendBinaryName(electronPlatformName)], checked, missing, failures);
  verifyBundleManifest(baseDir, runtimeKey, electronPlatformName, targetArch, checked, missing, failures);
  requireRelativeDirectory(baseDir, runtimeKey, ['managed-resources'], checked, missing, failures);
  verifyManagedResourcesContract(baseDir, runtimeKey, checked, missing, failures);
  if (failures.length > 0 && missing.length === 0) {
    missing.push(`${contractBundledPath(runtimeKey, 'manifest.json')}<contract_failure>`);
  }

  return { runtimeKey, checked, missing, failures };
}

module.exports = {
  verifyBundledDreamcoreResources,
};
