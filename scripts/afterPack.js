const { Arch } = require('builder-util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  normalizeArch,
  rebuildSingleModule,
  verifyModuleBinary,
  getModulesToRebuild,
} = require('./rebuildNativeModules');
const {
  verifyBundledDreamcoreResources,
} = require('../packages/shared-scripts/src/verify-bundled-dreamcore-resources');

/**
 * afterPack hook for electron-builder
 * Rebuilds native modules for cross-architecture builds
 */

function resolveResourcesDir(electronPlatformName, appOutDir, packager) {
  if (electronPlatformName !== 'darwin') return path.join(appOutDir, 'resources');

  const appName = packager?.appInfo?.productFilename || 'onework';
  return path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
}

function verifyBundledResources(resourcesDir, electronPlatformName, targetArch) {
  const result = verifyBundledDreamcoreResources({
    resourcesDir,
    electronPlatformName,
    targetArch,
  });

  if (result.missing.length > 0) {
    console.error(`   Missing bundled resources: ${result.missing.join(', ')}`);
    throw new Error(`Packaged app is missing required bundled resource(s): ${result.missing.join(', ')}`);
  }

  console.log(`   ✓ Bundled resources verified for ${result.runtimeKey} (${result.checked.length} checks)`);
}

/**
 * Locale pruning itself is electron-builder's `electronLanguages` (see
 * electron-builder.yml): it runs during framework preparation, before signing,
 * and handles both locales/*.pak and the macOS .lproj set — which a hand-rolled
 * afterPack pass cannot do without risking the notarized framework.
 *
 * What it does NOT do is fail. When nothing matches it logs a warning and skips
 * cleanup, and its matcher compares the WANTED string against the FILE's
 * language, so a too-loose entry ("en") silently deletes the more specific file
 * ("en-US.pak"). Losing the fallback locale is invisible until some user
 * right-clicks, so assert it is still there.
 */
function assertFallbackLocaleSurvived(appOutDir, electronPlatformName, packager) {
  if (electronPlatformName === 'darwin') {
    const appName = packager?.appInfo?.productFilename || 'onework';
    const frameworkResources = path.join(
      appOutDir,
      `${appName}.app`,
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
      'Versions',
      'A',
      'Resources'
    );
    if (!fs.existsSync(frameworkResources)) return;
    if (!fs.existsSync(path.join(frameworkResources, 'en.lproj'))) {
      throw new Error(
        `electronLanguages removed en.lproj from ${frameworkResources} - Chromium has no locale to fall back to`
      );
    }
    console.log('   [locales] en.lproj present');
    return;
  }

  const localesDir = path.join(appOutDir, 'locales');
  if (!fs.existsSync(localesDir)) return;
  if (!fs.existsSync(path.join(localesDir, 'en-US.pak'))) {
    throw new Error(`electronLanguages removed en-US.pak from ${localesDir} - Chromium has no locale to fall back to`);
  }
  const kept = fs.readdirSync(localesDir).filter((f) => f.endsWith('.pak'));
  console.log(`   [locales] ${kept.length} pak(s) kept: ${kept.join(', ')}`);
}

/**
 * better-sqlite3 leaves its whole MSVC compile tree in the packaged app: the
 * .iobj/.ipdb link artifacts, a static sqlite3.lib, build/Release/obj (holding a
 * 9 MB sqlite3.c) and the amalgamation source under deps/. Only
 * build/Release/better_sqlite3.node is ever loaded.
 *
 * This deliberately runs AFTER the native rebuild rather than as an
 * electron-builder `files:` exclusion: when prebuild-install has no prebuilt
 * matching this Electron ABI, node-gyp compiles from src/ + deps/, so excluding
 * them at pack time would turn a working fallback into a packaging failure.
 *
 * `bindings` resolves the addon at exactly build/Release/better_sqlite3.node.
 * If that path is lost the driver throws "Could not locate the bindings file"
 * and the app opens with an empty session list. The data itself is safe in
 * userData, but to the user it reads as lost history - hence the hard assert.
 */
// MSVC leaves .iobj/.ipdb/.pdb/.lib/.exp; GCC/Clang leave .a and stray .o. Both
// sets are listed so this prunes on every platform, not just the one it was
// written on.
const BETTER_SQLITE3_LINK_ARTIFACTS = new Set(['.iobj', '.ipdb', '.pdb', '.lib', '.exp', '.map', '.a', '.o']);

function directorySize(target) {
  let total = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) total += fs.statSync(child).size;
    }
  };
  walk(target);
  return total;
}

function pruneBetterSqlite3BuildArtifacts(nodeModulesDir) {
  const moduleRoot = path.join(nodeModulesDir, 'better-sqlite3');
  const addon = path.join(moduleRoot, 'build', 'Release', 'better_sqlite3.node');
  if (!fs.existsSync(moduleRoot) || !fs.existsSync(addon)) return 0;

  const addonSizeBefore = fs.statSync(addon).size;
  const releaseDir = path.join(moduleRoot, 'build', 'Release');

  let freed = 0;
  for (const target of [
    // node-gyp names the intermediate dir 'obj' under MSVC and 'obj.target'
    // under make; only one exists per platform and the other is skipped below.
    path.join(releaseDir, 'obj'),
    path.join(releaseDir, 'obj.target'),
    path.join(releaseDir, '.deps'),
    path.join(moduleRoot, 'build', 'deps'),
    path.join(moduleRoot, 'deps'),
    path.join(moduleRoot, 'src'),
  ]) {
    if (!fs.existsSync(target)) continue;
    freed += directorySize(target);
    fs.rmSync(target, { recursive: true, force: true });
  }

  for (const entry of fs.readdirSync(releaseDir)) {
    if (!BETTER_SQLITE3_LINK_ARTIFACTS.has(path.extname(entry))) continue;
    const target = path.join(releaseDir, entry);
    freed += fs.statSync(target).size;
    fs.rmSync(target);
  }

  if (!fs.existsSync(addon) || fs.statSync(addon).size !== addonSizeBefore) {
    throw new Error(`better-sqlite3 pruning damaged ${addon} - the app would start with an unreadable session history`);
  }

  console.log(`   [prune] removed better-sqlite3 compile artifacts, freed ${(freed / 1024 / 1024).toFixed(1)} MB`);
  return freed;
}

/**
 * Size pruning that must run on every exit path, including the one that skips
 * the native rebuild entirely.
 */
function prunePackagedApp(appOutDir, electronPlatformName, resourcesDir, packager) {
  assertFallbackLocaleSurvived(appOutDir, electronPlatformName, packager);
  const freed = pruneBetterSqlite3BuildArtifacts(path.join(resourcesDir, 'app.asar.unpacked', 'node_modules'));
  console.log(`   [prune] total freed: ${(freed / 1024 / 1024).toFixed(1)} MB
`);
}

module.exports = async function afterPack(context) {
  const { arch, electronPlatformName, appOutDir, packager } = context;
  const targetArch = normalizeArch(typeof arch === 'string' ? arch : Arch[arch] || process.arch);
  const buildArch = normalizeArch(os.arch());

  console.log(`\n🔧 afterPack hook started`);
  console.log(`   Platform: ${electronPlatformName}, Build arch: ${buildArch}, Target arch: ${targetArch}`);

  const isCrossCompile = buildArch !== targetArch;
  const forceRebuild = process.env.FORCE_NATIVE_REBUILD === 'true';
  const needsSameArchRebuild = electronPlatformName === 'win32'; // 只有 Windows 需要同架构重建以匹配 Electron ABI | Only Windows needs same-arch rebuild to match Electron ABI
  // Linux 使用预编译二进制，避免 GLIBC 版本依赖 | Linux uses prebuilt binaries which are GLIBC-independent

  const resourcesDir = resolveResourcesDir(electronPlatformName, appOutDir, packager);
  console.log(`   Checking resources directory: ${resourcesDir}`);
  if (fs.existsSync(resourcesDir)) {
    const resourcesContents = fs.readdirSync(resourcesDir);
    console.log(`   Contents: ${resourcesContents.join(', ')}`);

    const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');
    if (fs.existsSync(unpackedDir)) {
      const unpackedContents = fs.readdirSync(unpackedDir);
      console.log(`   app.asar.unpacked contents: ${unpackedContents.join(', ')}`);

      const nodeModulesDir = path.join(unpackedDir, 'node_modules');
      if (fs.existsSync(nodeModulesDir)) {
        const modulesContents = fs.readdirSync(nodeModulesDir);
        console.log(`   node_modules contents: ${modulesContents.slice(0, 10).join(', ')}...`);
      } else {
        console.warn(`   ⚠️  node_modules not found in app.asar.unpacked`);
      }
    } else {
      console.warn(`   ⚠️  app.asar.unpacked not found`);
    }

    verifyBundledResources(resourcesDir, electronPlatformName, targetArch);
  } else {
    throw new Error(`resources directory not found: ${resourcesDir}`);
  }

  if (!isCrossCompile && !needsSameArchRebuild && !forceRebuild) {
    console.log(`   ✓ Same architecture, rebuild skipped (set FORCE_NATIVE_REBUILD=true to override)\n`);
    prunePackagedApp(appOutDir, electronPlatformName, resourcesDir, packager);
    return;
  }

  // Note: Previously there was an optimization to skip macOS cross-compilation,
  // but this caused incorrect architecture binaries (arm64) to be included in x64 builds.
  // Now we always rebuild native modules for cross-compilation to ensure correctness.
  // The rebuild process uses prebuild-install first (fast), falling back to source compilation only when needed.

  if (isCrossCompile) {
    console.log(`   ⚠️  Cross-compilation detected (${buildArch} → ${targetArch}), will rebuild native modules`);
    if (electronPlatformName === 'darwin') {
      console.log(`   💡 Using prebuild-install for faster cross-architecture build`);
    }
  } else if (needsSameArchRebuild || forceRebuild) {
    console.log(`   ℹ️  Rebuilding native modules for platform requirements (force=${forceRebuild})`);
  }

  console.log(`\n🔧 Checking native modules (${electronPlatformName}-${targetArch})...`);
  console.log(`   appOutDir: ${appOutDir}`);

  const electronVersion =
    packager?.info?.electronVersion ??
    packager?.config?.electronVersion ??
    require('../package.json').devDependencies?.electron?.replace(/^\D*/, '');

  const nodeModulesDir = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules');

  // Modules that need to be rebuilt for cross-compilation
  // Use platform-specific module list (Windows skips node-pty due to cross-compilation issues)
  const modulesToRebuild = getModulesToRebuild(electronPlatformName);
  console.log(`   Modules to rebuild: ${modulesToRebuild.join(', ')}`);

  // For cross-compilation, clean up build artifacts from the wrong architecture
  // This prevents node-gyp-build from loading incorrect binaries
  if (isCrossCompile) {
    console.log(`\n🧹 Cleaning up wrong-architecture build artifacts...`);
    for (const moduleName of modulesToRebuild) {
      const moduleRoot = path.join(nodeModulesDir, moduleName);
      if (!fs.existsSync(moduleRoot)) continue;

      // Remove build/ directory (contains wrong-arch compiled binaries)
      const buildDir = path.join(moduleRoot, 'build');
      if (fs.existsSync(buildDir)) {
        fs.rmSync(buildDir, { recursive: true, force: true });
        console.log(`   ✓ Removed ${moduleName}/build/`);
      }

      // Remove bin/ directory (might contain wrong-arch binaries)
      const binDir = path.join(moduleRoot, 'bin');
      if (fs.existsSync(binDir)) {
        fs.rmSync(binDir, { recursive: true, force: true });
        console.log(`   ✓ Removed ${moduleName}/bin/`);
      }
    }

    // Also clean up architecture-specific packages that shouldn't be included
    // Remove packages for the opposite architecture of the target
    const wrongArchSuffix = targetArch === 'arm64' ? 'x64' : 'arm64';
    console.log(`\n🧹 Removing ${wrongArchSuffix}-specific optional dependencies (target: ${targetArch})...`);

    if (fs.existsSync(nodeModulesDir)) {
      const allModules = fs.readdirSync(nodeModulesDir);
      for (const module of allModules) {
        const modulePath = path.join(nodeModulesDir, module);

        // Handle scoped packages (e.g., @lydell, @napi-rs)
        if (module.startsWith('@') && fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) {
          const scopedPackages = fs.readdirSync(modulePath);
          for (const pkg of scopedPackages) {
            if (pkg.includes(`-${wrongArchSuffix}`) || pkg.includes(`-${electronPlatformName}-${wrongArchSuffix}`)) {
              const pkgPath = path.join(modulePath, pkg);
              if (fs.existsSync(pkgPath) && fs.statSync(pkgPath).isDirectory()) {
                fs.rmSync(pkgPath, { recursive: true, force: true });
                console.log(`   ✓ Removed ${module}/${pkg}`);
              }
            }
          }
        }
        // Handle regular packages
        else if (
          module.includes(`-${wrongArchSuffix}`) ||
          module.includes(`-${electronPlatformName}-${wrongArchSuffix}`)
        ) {
          if (fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) {
            fs.rmSync(modulePath, { recursive: true, force: true });
            console.log(`   ✓ Removed ${module}`);
          }
        }
      }
    }
  }

  const failedModules = [];

  for (const moduleName of modulesToRebuild) {
    const moduleRoot = path.join(nodeModulesDir, moduleName);

    if (!fs.existsSync(moduleRoot)) {
      console.warn(`   ⚠️  ${moduleName} not found, skipping`);
      continue;
    }

    console.log(`   ✓ Found ${moduleName}, rebuilding for ${targetArch}...`);

    // For Windows, prefer prebuild-install first (faster and more reliable in CI)
    // electron-rebuild can hang on "Searching dependency tree" in some CI environments
    // prebuild-install will fall back to electron-rebuild internally if no prebuilt binary exists
    const forceRebuildFromSource = false; // Always try prebuild-install first

    const success = rebuildSingleModule({
      moduleName,
      moduleRoot,
      platform: electronPlatformName,
      arch: targetArch,
      electronVersion,
      projectRoot: path.resolve(__dirname, '..'),
      buildArch: buildArch, // Pass build architecture for cross-compile detection
      forceRebuild: forceRebuildFromSource, // Always try prebuild-install first, fallback to rebuild
    });

    if (success) {
      console.log(`     ✓ Rebuild completed`);
    } else {
      console.error(`     ✗ Rebuild failed`);
      failedModules.push(moduleName);
      continue;
    }

    const verified = verifyModuleBinary(moduleRoot, moduleName);
    if (verified) {
      console.log(`     ✓ Binary verification passed`);
    } else {
      console.error(`     ✗ Binary verification failed`);
      failedModules.push(moduleName);
    }

    console.log(''); // Empty line between modules
  }

  if (failedModules.length > 0) {
    throw new Error(`Failed to rebuild modules for ${electronPlatformName}-${targetArch}: ${failedModules.join(', ')}`);
  }

  console.log(`✅ All native modules rebuilt successfully for ${targetArch}\n`);

  prunePackagedApp(appOutDir, electronPlatformName, resourcesDir, packager);
};
