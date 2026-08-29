/**
 * Smoke test：providerConfig → pi-ai providers dict + 动态 cordis.yml。
 * 验证 anthropic-messages / openai-completions / 自定义端点能构建出
 * llm-pi-ai 需要的 profile 形状，且 env 注入表与 dict 的 apiKeyEnv 对齐。
 *
 * 用法：I:\node-v22.23.2-win-x64\node.exe --import tsx smoke-providers.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  catalog, findModel, piAiProviders, providerKeyEnvs, providerKeyEnv, routeFor,
  syncProviderConfig, PROVIDER_ROUTE, DEFAULT_MODEL,
} from "../src/dsh.js";
import { resolveRuntimePaths, writeRuntimeConfig } from "../src/runtime.js";

let failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}`, detail ?? "");
  }
}

// ── 模拟前端 providerConfig（用户网页上的 anthropic messages 配置） ──
const configs = [
  {
    id: "deepseek", name: "DeepSeek", kind: "builtin",
    models: [
      { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash", contextWindow: 1048576, maxTokens: 262144 },
    ],
  },
  {
    id: "anthropic", name: "Anthropic", kind: "builtin",
    baseURL: "https://api.anthropic.com/v1",
    protocol: "anthropic-messages",
    apiKey: "sk-ant-test-123",
    models: [
      { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", contextWindow: 200000, maxTokens: 64000 },
      { id: "claude-opus-4-5", name: "Claude Opus 4.5" },
    ],
  },
  {
    id: "openai", name: "OpenAI", kind: "builtin",
    protocol: "openai-completions",
    apiKey: "sk-openai-test",
    models: [{ id: "gpt-4o", name: "GPT-4o" }],
  },
  {
    id: "acme-gateway", name: "Acme Gateway", kind: "custom",
    baseURL: "https://gateway.acme.example/v1",
    protocol: "anthropic-messages",
    apiKey: "acme-key",
    models: [{ id: "acme-large", name: "Acme Large", contextWindow: 65536, maxTokens: 4096 }],
  },
];

syncProviderConfig(configs);

console.log("— routeFor —");
check("deepseek → deepseek-official", routeFor("deepseek") === PROVIDER_ROUTE);
check("anthropic → anthropic", routeFor("anthropic") === "anthropic");
check("custom → 原样", routeFor("acme-gateway") === "acme-gateway");

console.log("— catalog —");
const models = catalog();
check("内置 deepseek-v4-flash 在目录", models.some((m) => m.provider === "deepseek" && m.id === "deepseek-v4-flash"));
check("claude-sonnet-4-5 在目录（provider=anthropic）", models.some((m) => m.provider === "anthropic" && m.id === "claude-sonnet-4-5"));
check("acme-large 在目录", models.some((m) => m.provider === "acme-gateway" && m.id === "acme-large"));
const sonnet = findModel("anthropic", "claude-sonnet-4-5");
check("findModel(anthropic, claude-sonnet-4-5) 命中", sonnet !== undefined);
check("claude 模型 route=anthropic", sonnet?.route === "anthropic");
check("claude 模型 protocol=anthropic-messages", sonnet?.protocol === "anthropic-messages");
const dsf = findModel("deepseek", "deepseek-v4-flash");
check("deepseek 模型 route=deepseek-official", dsf?.route === PROVIDER_ROUTE);

console.log("— piAiProviders dict —");
const dict = piAiProviders();
check("dict 不含 deepseek（走 llm-deepseek）", !("deepseek" in dict));
check("dict 含 anthropic", "anthropic" in dict);
const anthro = dict["anthropic"] as Record<string, unknown>;
check("anthropic.api = anthropic-messages", anthro.api === "anthropic-messages");
check("anthropic.baseURL 保留", anthro.baseURL === "https://api.anthropic.com/v1");
check("anthropic.apiKeyEnv 指向注入 env", anthro.apiKeyEnv === providerKeyEnv("anthropic"));
const anthroModels = anthro.models as { id: string; contextWindow?: number }[];
check("anthropic.models 含 claude-sonnet-4-5 + contextWindow", anthroModels.some((m) => m.id === "claude-sonnet-4-5" && m.contextWindow === 200000));
check("anthropic.models 含 claude-opus-4-5（未显式容量）", anthroModels.some((m) => m.id === "claude-opus-4-5" && m.contextWindow === undefined));
const acme = dict["acme-gateway"] as Record<string, unknown>;
check("自定义 route 声明 api + baseURL", acme.api === "anthropic-messages" && acme.baseURL === "https://gateway.acme.example/v1");
check("自定义 route displayName", acme.displayName === "Acme Gateway");

console.log("— providerKeyEnvs（apiKeyEnv 与注入表对齐） —");
const keyEnvs = providerKeyEnvs();
check("DSH_PROVIDER_KEY_ANTHROPIC 已注入", keyEnvs[providerKeyEnv("anthropic")] === "sk-ant-test-123");
check("DSH_PROVIDER_KEY_ACME_GATEWAY 已注入", keyEnvs[providerKeyEnv("acme-gateway")] === "acme-key");
const keysMatch = Object.entries(dict).every(([id, p]) => (p as { apiKeyEnv?: string }).apiKeyEnv === undefined || keyEnvs[(p as { apiKeyEnv: string }).apiKeyEnv] !== undefined);
check("每个 dict 路由的 apiKeyEnv 都有注入 env", keysMatch);
const envJson = JSON.parse(JSON.stringify({ DSH_LLM_PROVIDERS: JSON.stringify(dict) }));
check("DSH_LLM_PROVIDERS 可 JSON 往返（!!js 能解析）", typeof envJson.DSH_LLM_PROVIDERS === "string" && envJson.DSH_LLM_PROVIDERS.length > 0);

console.log("— 动态 cordis.yml 生成 —");
const paths = resolveRuntimePaths();
const generated = writeRuntimeConfig(paths);
check("生成文件存在", existsSync(generated));
const yaml = readFileSync(generated, "utf8");
check("含 llm-pi-ai 条目", yaml.includes("llm-pi-ai"));
check("含 !!js providers 注入", yaml.includes("DSH_LLM_PROVIDERS"));
check("保留 llm-deepseek 条目", yaml.includes("llm-deepseek"));
check("保留模板其余插件（sessions）", yaml.includes("sessions"));
if (process.env.DSH_CORDIS_CONFIG && existsSync(process.env.DSH_CORDIS_CONFIG)) {
  check("DSH_CORDIS_CONFIG 指向生成文件", process.env.DSH_CORDIS_CONFIG === generated);
}

console.log("— 协议对齐 —");
const supported = ["openai-completions", "openai-responses", "anthropic-messages"];
for (const cfg of configs) {
  if (cfg.protocol) check(`${cfg.id}.protocol 是 llm-pi-ai 支持的协议`, supported.includes(cfg.protocol!));
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
