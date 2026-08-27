import type { SpeechToTextConfig } from '@/common/types/provider/speech';
import type { IMcpServer, TProviderWithModel } from '@/common/config/storage';

export type GoogleClientSetting = {
  proxy?: string;
};

export type ImageGenerationModelSetting = TProviderWithModel & {
  switch?: boolean;
};

export type ClientBusinessSettingMap = {
  'google.config': GoogleClientSetting;
  'mcp.config': IMcpServer[] | undefined;
  'tools.imageGenerationModel': ImageGenerationModelSetting | undefined;
  'tools.videoGenerationModel': ImageGenerationModelSetting | undefined;
  /**
   * Advanced: user-supplied media catalog entries (JSON). Lets gateway users
   * reach models the built-in catalog does not know, without waiting for a
   * release. Parsed and validated by `common/media/catalog/overrides.ts`.
   */
  'tools.mediaCatalogOverrides': string | undefined;
  /**
   * Whether to show what a generation costs.
   *
   * Off unless asked for. Price is a minority interest — the figure most people
   * want from a running conversation is how much context is left, how many
   * tokens went where, and how much of it was served from cache — and an
   * unwanted number sitting next to the send button is one more thing to read
   * before every message. Anyone who does care turns it on next to the unit
   * price they had to enter for it to be exact anyway.
   *
   * `undefined` means never configured, which reads as off.
   */
  'tools.showMediaCost': boolean | undefined;
  'tools.speechToText': SpeechToTextConfig | undefined;
  'acp.promptTimeout': number | undefined;
  'acp.agentIdleTimeout': number | undefined;
  /**
   * Preview size ceiling for text-like files, **in whole megabytes**.
   *
   * Stored in MB rather than bytes because that is the unit the settings field
   * presents; the byte conversion belongs to the one place that compares against a
   * file size (`resolvePreviewPayload`). Keeping the stored unit and the displayed
   * unit identical means a value read back from storage never has to be
   * reinterpreted.
   *
   * `undefined` means "never configured" and falls back to the built-in default —
   * distinct from any number the user could enter.
   */
  'preview.textSizeLimitMb': number | undefined;
};

export type ClientBusinessSettingKey = keyof ClientBusinessSettingMap;
