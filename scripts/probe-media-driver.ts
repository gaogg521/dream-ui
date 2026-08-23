/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Probe a Form C media driver against the REAL vendor endpoint.
 *
 * The drivers describe each vendor's submit/poll wire format. Unit tests only
 * prove the polling skeleton; they cannot catch a wrong field name or path.
 * This script closes that gap: it drives the actual driver code against the
 * actual API with a real key, and prints every step so a mismatch is obvious.
 *
 * Run it whenever a driver is added or a vendor changes its API.
 *
 * Usage:
 *   bunx tsx scripts/probe-media-driver.ts --driver dashscope-task --key sk-xxx \
 *     --model wanx2.1-t2i-turbo --kind image --prompt "a red panda"
 *
 *   bunx tsx scripts/probe-media-driver.ts --driver ark-task --key xxx \
 *     --model doubao-seedance-1-0-pro-250528 --kind video --prompt "a cat walking"
 *
 * Costs real money — each run submits one generation task.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getTaskDriver } from '../packages/desktop/src/common/media/adapters/taskDrivers';
import { resolveMediaModelSpec } from '../packages/desktop/src/common/media/catalog';
import type { MediaKind } from '../packages/desktop/src/common/media/types';

type Args = Record<string, string>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    args[argv[i].slice(2)] = argv[i + 1] ?? 'true';
    i++;
  }
  return args;
}

const DEFAULT_BASE_URL: Record<string, string> = {
  'dashscope-task': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'ark-task': 'https://ark.cn-beijing.volces.com/api/v3',
};

function usage(): never {
  console.log(`
Probe a Form C media driver against the real vendor API.

Required:
  --driver   dashscope-task | ark-task
  --key      the vendor api key
  --model    model id, e.g. wanx2.1-t2i-turbo | doubao-seedance-1-0-pro-250528

Optional:
  --kind     image | video            (default: image)
  --prompt   text prompt              (default: "a red panda sitting on a rock")
  --base-url override the API root
  --size     e.g. 1024x1024           (image)
  --duration seconds                  (video)
  --timeout  seconds to poll before giving up (default: 300)

⚠️  Each run submits a real, billable generation task.
`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const driverId = args.driver;
  const apiKey = args.key;
  const model = args.model;
  if (!driverId || !apiKey || !model) usage();

  const kind: MediaKind = args.kind === 'video' ? 'video' : 'image';
  const prompt = args.prompt || 'a red panda sitting on a rock';
  const baseUrl = args['base-url'] || DEFAULT_BASE_URL[driverId];
  const timeoutMs = (Number(args.timeout) || 300) * 1000;

  const driver = getTaskDriver(driverId);
  if (!driver) {
    console.error(`✗ no driver registered for "${driverId}"`);
    process.exit(1);
  }

  // Resolve a real catalog spec so the probe exercises the same parameter
  // declarations the product uses.
  const spec = resolveMediaModelSpec(kind, { platform: 'openai', base_url: baseUrl, name: 'probe' }, model);
  if (!spec) {
    console.error(`✗ no catalog entry matched ${kind}/"${model}" — add one before probing.`);
    process.exit(1);
  }
  console.log(`• catalog entry : ${spec.id} (form ${spec.form}, endpointStyle ${spec.endpointStyle})`);
  console.log(`• endpoint root : ${baseUrl}`);

  const params: Record<string, unknown> = {};
  if (args.size) params.size = args.size;
  else if (kind === 'image' && spec.defaults?.size) params.size = spec.defaults.size;
  if (args.duration) params.durationSeconds = Number(args.duration);
  else if (kind === 'video' && spec.defaults?.durationSeconds) params.durationSeconds = spec.defaults.durationSeconds;
  if (kind === 'video' && spec.defaults?.resolution) params.resolution = spec.defaults.resolution;

  const ctx = { kind, model, baseUrl, apiKey, spec } as never;

  console.log(`\n▸ submitting…`);
  const started = Date.now();
  let taskId: string;
  try {
    const submitted = await driver.submit({ ...(ctx as object), prompt, params, inputs: [] } as never);
    taskId = submitted.taskId;
    console.log(`✓ accepted, task id: ${taskId}`);
  } catch (error) {
    console.error(`✗ SUBMIT FAILED — this is a wire-format mismatch to fix in the driver:`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  console.log(`\n▸ polling (timeout ${timeoutMs / 1000}s)…`);
  const deadline = Date.now() + timeoutMs;
  let interval = spec.polling?.intervalMs ?? 3000;

  for (;;) {
    if (Date.now() > deadline) {
      console.error(`✗ timed out after ${Math.round((Date.now() - started) / 1000)}s (task ${taskId} may still run)`);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));

    let result;
    try {
      result = await driver.poll(ctx, taskId);
    } catch (error) {
      console.error(`✗ POLL FAILED — wire-format mismatch in the poll path:`);
      console.error(`  ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }

    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(`  [${elapsed}s] ${result.state}`);

    if (result.state === 'failed') {
      console.error(`✗ vendor reported failure: ${result.error}`);
      process.exit(1);
    }
    if (result.state === 'succeeded') {
      const outDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'media-probe-'));
      console.log(`\n✓ succeeded in ${elapsed}s, ${result.items.length} item(s)`);
      for (let i = 0; i < result.items.length; i++) {
        const item = result.items[i];
        const target = path.join(outDir, `out-${i}${kind === 'video' ? '.mp4' : '.png'}`);
        if (item.url) {
          const response = await fetch(item.url);
          await fs.promises.writeFile(target, Buffer.from(await response.arrayBuffer()));
        } else if (item.b64) {
          await fs.promises.writeFile(target, Buffer.from(item.b64, 'base64'));
        }
        const { size } = await fs.promises.stat(target);
        console.log(`  saved ${target} (${(size / 1024).toFixed(1)} KB)`);
      }
      console.log(`\n✓ DRIVER "${driverId}" VERIFIED end to end against the real API.`);
      return;
    }

    interval = Math.min(15000, Math.round(interval * 1.35));
  }
}

main().catch((error) => {
  console.error('probe crashed:', error);
  process.exit(1);
});
