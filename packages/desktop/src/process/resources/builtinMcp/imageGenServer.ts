/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in MCP server for media generation (images and video).
 *
 * This is a thin shell: it owns the tool surface and nothing else. Every call
 * is forwarded over TCP to the main-process media job service, which owns
 * provider credentials, the catalog dispatch, and the job lifecycle.
 *
 * Why the work does not happen here: a video task runs for minutes, while this
 * subprocess only lives as long as the MCP client keeps it. Running generation
 * in the main process lets a job outlive the tool call that started it — the
 * asset still lands in the workspace, and the agent can collect it later by id
 * via `one_media_job_status`. See architecture doc §4.4 / decision D2.
 *
 * The script filename and server name are deliberately unchanged so already
 * installed configurations keep being recognized as the built-in server.
 *
 * TCP protocol: 4-byte big-endian length header + UTF-8 JSON body. The main
 * process may send several `progress` frames before the final `result` frame.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as net from 'node:net';

import { BUILTIN_IMAGE_GEN_NAME } from './constants';

const PORT = parseInt(process.env.MEDIA_MCP_PORT || '0', 10);

/**
 * Where generated files should go when the caller does not say.
 *
 * `process.cwd()` is the wrong answer: this server is spawned as a child of the
 * backend without a `current_dir`, so it inherits the app's directory, not the
 * session's — output then lands in the app data folder while the conversation
 * panel tells the user it is in the conversation's own folder. Worse, the
 * conversation matches media result cards by workspace, so a file written
 * elsewhere also loses its thumbnail, its open-folder/regenerate actions and
 * its cost line.
 *
 * The backend knows the session workspace and passes it here (see the Rust
 * `media_workspace` module); `process.cwd()` stays as a last resort for
 * anything that spawns this server without it.
 */
/// The trusted workspace root, and the ONLY source of it.
///
/// Both values come from the backend, never from the model: the env var is set
/// per conversation when the media MCP is spawned, and the cwd fallback is the
/// agent process's own working directory.
///
/// ⚠️ Do not reintroduce a `workspace_dir` tool parameter. Upstream #3906
/// removed exactly that from the image tool because an adversarial model could
/// point it anywhere and read/write outside the workspace; this fork had the
/// same parameter on BOTH the image and the video tool, and both are now gone.
/// `resolveSafePath` in `imageGenCore.ts` enforces the boundary underneath —
/// but that only holds while the root itself is trustworthy.
const sessionWorkspaceDir = (): string => process.env.DREAM_MEDIA_WORKSPACE_DIR?.trim() || process.cwd();

/**
 * Which conversation this server was spawned for, when the backend told us.
 *
 * Carried through to the job so a company can trace a media charge back to
 * where it happened. Without it, an agent-initiated generation — the common
 * case — lands in the usage ledger attached to nothing, because a stdio
 * subprocess has no other way to know. Absent for anything that spawns this
 * server outside a conversation, which the job engine treats as "no
 * attribution" rather than an error.
 */
const sessionConversationId = (): string | undefined => process.env.DREAM_MEDIA_CONVERSATION_ID?.trim() || undefined;

type AssetView = { filePath: string; relativePath: string; mimeType: string; kind: string };

export type JobView = {
  jobId: string;
  kind: string;
  status: string;
  model?: string;
  progress?: { stage?: string; percent?: number; taskId?: string; message?: string };
  assets?: AssetView[];
  error?: string;
  droppedParams?: string[];
  /** The model's own text reply when the job produced no assets — see jobView.ts. */
  resultText?: string;
};

type ResultFrame = {
  type: 'result';
  success: boolean;
  job?: JobView;
  jobs?: JobView[];
  error?: string;
};

/**
 * Send one request and resolve with the final `result` frame, ignoring any
 * `progress` frames that arrive first. No socket timeout: the main process owns
 * the real deadline, and a video job legitimately runs for minutes.
 */
function sendTcpRequest(request: unknown): Promise<ResultFrame> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: PORT }, () => {
      const body = Buffer.from(JSON.stringify(request), 'utf-8');
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length, 0);
      socket.write(Buffer.concat([header, body]));
    });
    socket.setTimeout(0);

    let buffer = Buffer.alloc(0);
    let settled = false;

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const bodyLen = buffer.readUInt32BE(0);
        if (buffer.length < 4 + bodyLen) break;
        const jsonStr = buffer.subarray(4, 4 + bodyLen).toString('utf-8');
        buffer = buffer.subarray(4 + bodyLen);
        let frame: { type?: string };
        try {
          frame = JSON.parse(jsonStr);
        } catch {
          continue;
        }
        if (frame.type === 'result') {
          settled = true;
          resolve(frame as ResultFrame);
          socket.end();
          return;
        }
        // progress frames: keep the connection warm, nothing to report back
        // through the MCP tool result (which can only be returned once).
      }
    });

    socket.on('end', () => {
      if (!settled) reject(new Error('media service closed the connection before returning a result'));
    });
    socket.on('error', (err: Error) => {
      if (!settled) reject(new Error(`cannot reach the media generation service: ${err.message}`));
    });
  });
}

function requirePort(): string | null {
  if (PORT) return null;
  // Deliberately no fallback to the old in-process path: silently degrading to
  // a different execution path is how "works on my machine" bugs are born.
  return 'Error: the media generation service is not available (MEDIA_MCP_PORT is unset). Restart the app; if it persists, re-enable the image generation tool in Settings > Tools.';
}

/**
 * The text an agent actually receives. Exported for tests: this string is the
 * whole agent-facing contract, and the bug it now covers was invisible from
 * every other layer — the job carried the information, this function dropped it.
 */
export function renderJob(job: JobView | undefined, fallback: string): string {
  if (!job) return fallback;
  const lines: string[] = [];
  if (job.assets?.length) {
    for (const asset of job.assets) {
      lines.push(`Generated ${asset.kind} saved to: ${asset.filePath}`);
    }
  } else if (job.resultText) {
    // No assets does not mean no response: a model that actually supports
    // vision can answer an "Analyze image: ..." prompt with pure text. Without
    // this branch the frame collapsed to a bare "(job xxx, status done)" and
    // the agent — having asked for an analysis and received nothing — had
    // nothing to relay but its own guess.
    lines.push(job.resultText);
  }
  lines.push(`(job ${job.jobId}, status ${job.status})`);
  if (job.error) lines.push(`Error: ${job.error}`);
  // Say what was NOT honoured. Without this the frame reads as an unqualified
  // success: an agent that asked for `n: 4` and received one image has to infer
  // the clip from the asset count, and observed behaviour is that it invents an
  // explanation and tells the user the request succeeded as asked.
  if (job.droppedParams?.length) {
    lines.push(
      `Note: this model does not support ${job.droppedParams.join(', ')}; ` +
        `${job.droppedParams.length > 1 ? 'those were' : 'that was'} ignored and the result above is what was actually produced. ` +
        `Do not retry with the same parameter(s) — say what you got.`
    );
  }
  return lines.join('\n');
}

async function runGeneration(kind: 'image' | 'video', payload: Record<string, unknown>) {
  const portError = requirePort();
  if (portError) {
    return { content: [{ type: 'text' as const, text: portError }], isError: true };
  }

  try {
    const result = await sendTcpRequest({
      op: 'generate',
      kind,
      conversationId: sessionConversationId(),
      ...payload,
    });
    if (!result.success) {
      const detail = result.error || result.job?.error || 'generation failed';
      const jobRef = result.job ? ` (job ${result.job.jobId})` : '';
      return {
        content: [{ type: 'text' as const, text: `Error generating ${kind}: ${detail}${jobRef}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text' as const, text: renderJob(result.job, `${kind} generated.`) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error generating ${kind}: ${message}\n\nIf a job id was already issued, the work may still be running — check with one_media_job_status.`,
        },
      ],
      isError: true,
    };
  }
}

async function main() {
  const server = new McpServer({
    name: BUILTIN_IMAGE_GEN_NAME,
    version: '2.0.0',
  });

  server.tool(
    'aionui_image_generation',
    `The only way to reach an image-generation model. You cannot synthesise image pixels yourself, so any request for a depicted (created or edited) image has to come through here.

Best for:
- Photographic, illustrative or artistic content — concept art, characters, scenery, mood, style
- Editing or re-styling images the user supplied (pass them in image_uris)
- Anything whose value is in how it looks rather than in details being exactly right
- User mentions @filename with image extensions (.jpg, .jpeg, .png, .gif, .webp, .bmp, .tiff, .svg)

This tool ONLY produces new or edited image pixels. It CANNOT read, describe, OCR, or answer questions about an image's existing content — the underlying model has no such capability, and if you send it a prompt like "Analyze image: ..." it will not refuse, it will silently generate a fabricated look-alike image and present it as if it were an analysis. If the user wants you to read, transcribe, summarise, or answer questions about an image they attached, do NOT call this tool: use your own vision on the attached image content directly, or the ViewImage/view_image tool to load a local file into view, then answer in text.

NOT the right tool for charts, diagrams, dashboards, UI mockups, or any image that has to render specific data or text accurately. A generation model approximates: it will invent plausible-looking numbers and misspell labels, and you cannot correct one afterwards. If you are able to produce those by writing code — SVG, HTML/CSS, a plotting library — do that instead; it is exact, reviewable and re-runnable.

The two combine well: generate artwork or a background here, then lay the precise part (labels, figures, captions) over it in code.

IMPORTANT: All prompts must be in English for optimal results.

Input Support:
- Multiple local file paths in array format: ["img1.jpg", "img2.png"]
- Multiple HTTP/HTTPS image URLs in array format
- Text prompts describing what to generate or how to edit the supplied image(s)
- Optional generation parameters (size, count, quality, seed, negative prompt) — support depends on the configured model; unsupported parameters are ignored (never retry just to change them)

Output:
- Saves generated/processed images to workspace with timestamp naming (all images when the model returns several)
- Returns image path(s) and a job id

IMPORTANT: When user provides multiple images to edit/restyle, ALWAYS pass ALL images to the image_uris parameter as an array.`,
    {
      prompt: z
        .string()
        .describe(
          'The text prompt in English that must clearly specify the operation type: "Generate image: [description]" for creating new images, or "Edit image: [modifications]" for editing images passed in image_uris. Never "Analyze image: ..." — this tool cannot analyse or read image content, only create or edit it.'
        ),
      image_uris: z
        .array(z.string())
        .optional()
        .describe(
          'Optional: Array of paths to existing local image files or HTTP/HTTPS URLs to edit/modify. Examples: ["test.jpg", "https://example.com/img.png"]. For single image, use array format: ["test.jpg"].'
        ),
      size: z
        .string()
        .optional()
        .describe(
          'Optional: Output size like "1024x1024" or "1792x1024". Only pass when the user asks for a specific size/orientation.'
        ),
      aspect_ratio: z
        .string()
        .optional()
        .describe('Optional: Aspect ratio like "16:9". Alternative to size for models that take ratios.'),
      n: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe('Optional: Number of images to generate (default 1). Clamped to what the model supports.'),
      quality: z
        .string()
        .optional()
        .describe('Optional: Quality tier such as "standard" | "hd" | "low" | "medium" | "high", model-dependent.'),
      seed: z.number().int().optional().describe('Optional: Reproducibility seed, for models that support it.'),
      negative_prompt: z
        .string()
        .optional()
        .describe('Optional: What the image should NOT contain, for models that support negative prompts.'),
    },
    async ({ prompt, image_uris, size, aspect_ratio, n, quality, seed, negative_prompt }) =>
      runGeneration('image', {
        prompt,
        inputUris: image_uris ?? [],
        workspaceDir: sessionWorkspaceDir(),
        params: {
          size,
          aspectRatio: aspect_ratio,
          n,
          quality,
          seed,
          negativePrompt: negative_prompt,
        },
      })
  );

  server.tool(
    'one_video_generation',
    `The only way to reach a video-generation model. You cannot synthesise video frames yourself.

Best for:
- Live-action-like or artistic motion — scenery, atmosphere, camera moves, creatures, characters
- Animating an image the user supplied (pass it as first_frame_image)
- Anything whose value is in how it looks rather than in details being exactly right

NOT the right tool for explainer videos built from real data, precise typography, exact timing, or anything the user will want revised repeatedly. A generation model gives you a single take you cannot edit or correct. If you are able to build the video by writing code — for example a React/Remotion project rendered locally — that path is exact, revisable and re-renderable; prefer it for those.

The two combine well: generate footage here, then cut it, caption it and lay data over it in code.

IMPORTANT:
- Prompts must be in English for best results.
- Video generation is slow (typically 30 seconds to several minutes). This call blocks until the video is ready; do not retry or start a second job because it feels slow.
- If the call fails with a timeout but reports a job id, the work may still be running — check it with one_media_job_status instead of regenerating.
- Parameter support depends on the configured model; unsupported parameters are ignored.

Output:
- Saves the video to the workspace and returns its path plus a job id.
- You cannot view video content; describe it to the user by path, do not try to read the file.`,
    {
      prompt: z.string().describe('Description of the video to generate, in English.'),
      first_frame_image: z
        .string()
        .optional()
        .describe('Optional: local path or HTTP(S) URL of an image to animate (image-to-video / first frame).'),
      last_frame_image: z
        .string()
        .optional()
        .describe('Optional: local path or URL of the final frame, for models supporting first/last-frame control.'),
      duration_seconds: z.number().int().optional().describe('Optional: clip duration in seconds, model-dependent.'),
      resolution: z.string().optional().describe('Optional: e.g. "720p" or "1080p", model-dependent.'),
      aspect_ratio: z.string().optional().describe('Optional: e.g. "16:9" or "9:16", model-dependent.'),
      camera: z.string().optional().describe('Optional: camera movement preset, model-dependent.'),
      seed: z.number().int().optional().describe('Optional: reproducibility seed, for models that support it.'),
      negative_prompt: z
        .string()
        .optional()
        .describe('Optional: what to avoid in the video, for models that support it.'),
    },
    async ({
      prompt,
      first_frame_image,
      last_frame_image,
      duration_seconds,
      resolution,
      aspect_ratio,
      camera,
      seed,
      negative_prompt,
    }) =>
      runGeneration('video', {
        prompt,
        inputUris: first_frame_image ? [first_frame_image] : [],
        workspaceDir: sessionWorkspaceDir(),
        params: {
          firstFrameImage: first_frame_image,
          lastFrameImage: last_frame_image,
          durationSeconds: duration_seconds,
          resolution,
          aspectRatio: aspect_ratio,
          camera,
          seed,
          negativePrompt: negative_prompt,
        },
      })
  );

  server.tool(
    'one_media_job_status',
    `Check on image/video generation jobs started by this app.

Use this when:
- A generation call timed out or errored but gave you a job id — the job may still be running, and the result will still be saved.
- The user asks whether their image/video is ready.

Do NOT start a new generation just because a previous one seemed slow; check here first.`,
    {
      job_id: z
        .string()
        .optional()
        .describe('Optional: the job id to look up. Omit to list recent jobs and their statuses.'),
    },
    async ({ job_id }) => {
      const portError = requirePort();
      if (portError) {
        return { content: [{ type: 'text' as const, text: portError }], isError: true };
      }
      try {
        const result = await sendTcpRequest({ op: 'status', jobId: job_id });
        if (!result.success) {
          return {
            content: [{ type: 'text' as const, text: `Error: ${result.error || 'lookup failed'}` }],
            isError: true,
          };
        }
        if (result.job) {
          return { content: [{ type: 'text' as const, text: renderJob(result.job, 'no job data') }] };
        }
        const jobs = result.jobs ?? [];
        if (jobs.length === 0) {
          return { content: [{ type: 'text' as const, text: 'No media generation jobs yet.' }] };
        }
        const text = jobs
          .map((job) => `- ${job.jobId} [${job.kind}] ${job.status}${job.error ? ` — ${job.error}` : ''}`)
          .join('\n');
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return {
          content: [
            { type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` },
          ],
          isError: true,
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('[MediaGenMCP] Fatal error:', error);
  process.exit(1);
});
