import { ipcBridge } from '@/common';
import type { IProvider } from '@/common/config/storage';

type ModelHealth = NonNullable<IProvider['model_health']>[string];

let healthWrites = Promise.resolve();

export async function probeModelHealth(
  provider: IProvider,
  model: string,
  report: (health: ModelHealth) => void,
  isCurrent: () => boolean,
  unknownError: string
): Promise<void> {
  const startedAt = Date.now();
  let health: ModelHealth;
  try {
    const result = await ipcBridge.acpConversation.checkProviderHealth.invoke({ provider_id: provider.id, model });
    const healthy = result.status === 'healthy';
    health = {
      status: healthy ? 'healthy' : 'unhealthy',
      last_check: Date.now(),
      latency: result.elapsed_ms ?? Date.now() - startedAt,
      error: healthy ? undefined : result.message || unknownError,
    };
  } catch (error) {
    health = {
      status: 'unhealthy',
      last_check: Date.now(),
      latency: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!isCurrent()) return;
  report(health);
  if (provider.managed_by === 'enterprise') return;

  const write = healthWrites.then(async () => {
    if (!isCurrent()) return;
    const providers = await ipcBridge.mode.listProviders.invoke();
    const latest = providers?.find(({ id }) => id === provider.id);
    if (!isCurrent() || !latest || latest.managed_by === 'enterprise' || !latest.models?.includes(model)) return;
    await ipcBridge.mode.updateProvider.invoke({
      id: provider.id,
      model_health: { ...latest.model_health, [model]: health },
    });
  });
  healthWrites = write.catch(() => {});
  await write;
}
