/**
 * Copyright 2026 One Work
 */

/**
 * Linux headless relaunch for `--webui` / `--resetpass`.
 *
 * Why this exists: on a machine with no X11/Wayland session, Chromium picks its
 * Ozone platform *before* any main-process JS runs. `app.commandLine.appendSwitch(
 * 'ozone-platform', 'headless')` from JS is therefore too late — the main script
 * does start (CDP log lines appear), then the platform init fails with
 * "Missing X server or $DISPLAY" and the process dies. Only a real command-line
 * `--ozone-platform=headless` works, so the process re-executes itself with it.
 *
 * Verified on the shipped 3.0.18 deb (Ubuntu 22.04, DISPLAY/WAYLAND_DISPLAY unset):
 * bare `onework --webui` exits, `onework --webui --ozone-platform=headless
 * --disable-gpu` serves the WebUI.
 */

const HEADLESS_ARGS = ['--ozone-platform=headless', '--disable-gpu'] as const;

/** True when the command line already pins an Ozone platform (either spelling). */
function hasOzonePlatformArg(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === '--ozone-platform' || arg.startsWith('--ozone-platform='));
}

/**
 * Whether this launch must re-exec itself headless.
 *
 * Only Linux WebUI / reset-password launches qualify. A command line that already
 * names an Ozone platform is left alone: it is either our own relaunch (so this is
 * what stops an infinite loop) or an operator choosing a platform on purpose.
 */
export function needsHeadlessRelaunch(platform: NodeJS.Platform, argv: readonly string[]): boolean {
  if (platform !== 'linux') return false;
  const headlessMode = argv.includes('--webui') || argv.includes('--resetpass');
  return headlessMode && !hasOzonePlatformArg(argv);
}

/** Arguments for the relaunched process: everything after the executable, plus the headless flags. */
export function buildHeadlessRelaunchArgs(argv: readonly string[]): string[] {
  const extra = HEADLESS_ARGS.filter((flag) => flag === '--ozone-platform=headless' || !argv.includes(flag));
  return [...argv.slice(1), ...extra];
}
