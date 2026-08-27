/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * The media MCP's tool result is the only thing an agent ever sees of a
 * generation. Anything the job knows but this string omits, the agent has to
 * infer — and observed behaviour when it infers is that it fills the gap with a
 * confident guess and passes that to the user.
 *
 * Live example this file pins: a request for `n: 4` against a model whose
 * catalog entry declares `maxN: 1` produced one image. The clip was recorded on
 * the job, but the rendered text said only "Generated image saved to: …", so the
 * agent reasoned "it says n=4 but seems to have returned one image … it likely
 * contains the 4-panel sequence" and told the user "✅ 4 images generated".
 */

import { describe, expect, it } from 'vitest';
import { renderJob, type JobView } from '@/process/resources/builtinMcp/imageGenServer';

const doneJob = (overrides: Partial<JobView> = {}): JobView => ({
  jobId: 'mj-test-1',
  kind: 'image',
  status: 'done',
  assets: [{ filePath: 'D:/ws/img-1.jpg', relativePath: 'img-1.jpg', mimeType: 'image/jpeg', kind: 'image' }],
  ...overrides,
});

describe('renderJob', () => {
  it('reports the asset paths and job id a successful run produced', () => {
    const text = renderJob(doneJob(), 'fallback');

    expect(text).toContain('Generated image saved to: D:/ws/img-1.jpg');
    expect(text).toContain('(job mj-test-1, status done)');
  });

  it('says which parameters the model ignored', () => {
    const text = renderJob(doneJob({ droppedParams: ['n'] }), 'fallback');

    expect(text).toContain('does not support n');
    expect(text).toMatch(/ignored/i);
  });

  /** Retrying the same unsupported parameter just burns the user's money. */
  it('tells the agent not to retry the ignored parameter', () => {
    const text = renderJob(doneJob({ droppedParams: ['n'] }), 'fallback');

    expect(text).toMatch(/do not retry/i);
  });

  it('lists every ignored parameter, not just the first', () => {
    const text = renderJob(doneJob({ droppedParams: ['n', 'quality'] }), 'fallback');

    expect(text).toContain('n, quality');
    expect(text).toContain('those were');
  });

  /**
   * A clean run must not gain a caveat — a note that appears when nothing was
   * clipped would train the agent to ignore the note entirely.
   */
  it('stays silent when everything the caller asked for was honoured', () => {
    for (const job of [doneJob(), doneJob({ droppedParams: [] })]) {
      expect(renderJob(job, 'fallback')).not.toMatch(/does not support|ignored/i);
    }
  });

  it('still surfaces an error alongside a clip note', () => {
    const text = renderJob(doneJob({ status: 'failed', error: 'upstream rejected', droppedParams: ['seed'] }), 'x');

    expect(text).toContain('Error: upstream rejected');
    expect(text).toContain('does not support seed');
  });

  it('falls back when there is no job at all', () => {
    expect(renderJob(undefined, 'image generated.')).toBe('image generated.');
  });

  /**
   * Regression guard: Form B is a chat completion under the hood, so a model
   * that genuinely supports vision can answer "Analyze image: ..." with pure
   * text and no picture. Before `resultText` existed, a 0-asset success job
   * rendered as a bare "(job xxx, status done)" — the agent asked for an
   * analysis, got back nothing it could read, and had to fabricate one.
   */
  it('surfaces the model text reply when the job produced no assets', () => {
    const text = renderJob(doneJob({ assets: [], resultText: 'This is a PowerShell terminal screenshot.' }), 'x');

    expect(text).toContain('This is a PowerShell terminal screenshot.');
    expect(text).toContain('(job mj-test-1, status done)');
  });

  it('does not print the text reply when assets were produced', () => {
    const text = renderJob(doneJob({ resultText: 'Image generated successfully.' }), 'x');

    expect(text).not.toContain('Image generated successfully.');
    expect(text).toContain('Generated image saved to: D:/ws/img-1.jpg');
  });

  /**
   * Regression guard for a cross-language leak. Every line this function emits
   * is English machine text, and a model reads a long English frame as evidence
   * about which language the conversation is in: a Chinese prompt produced a
   * correct image and an English write-up. The instruction below is the only
   * thing that tells the model the frame is not a language cue.
   */
  describe('language instruction', () => {
    const LANG = 'Reply to the user in the language they wrote in';

    it('tells the model to answer in the user language when assets came back', () => {
      expect(renderJob(doneJob(), 'x')).toContain(LANG);
    });

    it('tells the model the same for a text-only reply', () => {
      const text = renderJob(doneJob({ assets: [], resultText: 'A terminal screenshot.' }), 'x');

      expect(text).toContain(LANG);
    });

    it('stays quiet on a job that produced nothing to write up', () => {
      const text = renderJob(doneJob({ assets: [], status: 'failed', error: 'upstream 500' }), 'x');

      expect(text).toContain('Error: upstream 500');
      expect(text).not.toContain(LANG);
    });

    it('comes last, after the dropped-parameter note', () => {
      const lines = renderJob(doneJob({ droppedParams: ['n'] }), 'x').split('\n');

      expect(lines[lines.length - 1]).toContain(LANG);
      expect(lines.some((line) => line.includes('does not support n'))).toBe(true);
    });
  });
});
