import type { ModelInfo } from "@/components/zosma/types";

/**
 * Model identity helper.
 *
 * Model ids are NOT unique across providers — the same id (e.g.
 * "deepseek-v4-flash", "glm-4.6") is offered by several providers
 * (opencode-go, zai, crofai, n, …). Selecting/identifying a model by bare id
 * therefore binds the WRONG provider and shows the wrong provider badge. The
 * stable identity is the `provider/id` pair, which this module formats into a
 * single key string used everywhere the UI tracks the "active" model.
 */
export function modelKey(provider: string | undefined, id: string | undefined): string {
	return `${provider ?? ""}/${id ?? ""}`;
}

/** Resolve a `provider/id` key back to its catalog entry, if present. */
export function findModel(
	models: ModelInfo[] | undefined,
	key: string | undefined,
): ModelInfo | undefined {
	if (!models || !key) return undefined;
	return models.find((m) => modelKey(m.provider, m.id) === key);
}
