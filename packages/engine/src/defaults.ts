import {
	type CliClientOptions,
	createClientRegistry,
	type ProviderConfigMap,
} from '@claushaas/clients';
import { AgentExecutor } from './executors/agent.js';
import { ArtifactExecutor } from './executors/artifact.js';
import { ConditionExecutor } from './executors/condition.js';
import { ExecExecutor, type ExecExecutorOptions } from './executors/exec.js';
import { ExecutorRegistry } from './executors/index.js';
import { ManualExecutor } from './executors/manual.js';
import {
	NotifyExecutor,
	type NotifyExecutorOptions,
} from './executors/notify.js';

export interface CreateDefaultExecutorRegistryOptions {
	exec?: ExecExecutorOptions;
	notify?: NotifyExecutorOptions;
	providerConfigs?: ProviderConfigMap;
}

export function createDefaultExecutorRegistry(
	options: CreateDefaultExecutorRegistryOptions = {},
): ExecutorRegistry {
	const clientRegistry = createClientRegistry(options.providerConfigs);

	return new ExecutorRegistry([
		new AgentExecutor({
			resolveClient(provider) {
				return clientRegistry.get(provider);
			},
		}),
		new ArtifactExecutor(),
		new ConditionExecutor(),
		new ExecExecutor(options.exec),
		new ManualExecutor(),
		new NotifyExecutor({
			...options.notify,
			openclaw: options.providerConfigs?.openclaw as
				| CliClientOptions
				| undefined,
		}),
	]);
}
