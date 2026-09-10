/**
 * smoke — 无引擎 / 无网络的纯逻辑冒烟（npm test）
 *
 * 覆盖：消息队列的 drainExcept 语义（abort/clear_queue 不得动在飞条目）、
 * 事件适配器映射（含未映射事件不静默）、插件包名校验（防命令注入回归）。
 * 用法：npm test（node --import tsx tests/smoke.ts）
 */

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageQueue } from "../src/queue.js";
import { createDshAdapter } from "../src/adapter.js";
import { installPlugin, uninstallPlugin, verifyInstalledPlugin } from "../src/plugins.js";

let failures = 0;
let total = 0;

function check(name: string, fn: () => void): void {
  total += 1;
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL  ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function rejects(name: string, fn: () => Promise<unknown>): Promise<void> {
  total += 1;
  try {
    await fn();
    failures += 1;
    console.error(`FAIL  ${name}: 期望拒绝，实际成功`);
  } catch {
    console.log(`  ok  ${name}`);
  }
}

// ── 队列：drainExcept 保留在飞条目 ──────────────────────────────────────────

{
  const q = new MessageQueue({ onUpdate: () => {} });
  q.enqueue({ kind: "prompt", text: "active", cmdId: "c1" });
  q.enqueue({ kind: "prompt", text: "queued", cmdId: "c2" });
  q.enqueue({ kind: "steer", text: "steer text", cmdId: "c3" });
  const drained = q.drainExcept("c1");
  check("drainExcept 保留在飞条目", () => {
    assert.equal(q.length, 1);
    assert.equal(q.peek()?.cmdId, "c1");
    assert.deepEqual(drained.dropped.map((d) => d.cmdId), ["c2"]);
    assert.deepEqual(drained.steering, ["steer text"]);
  });
}

{
  const q = new MessageQueue({ onUpdate: () => {} });
  q.enqueue({ kind: "prompt", text: "a", cmdId: "a" });
  q.enqueue({ kind: "follow_up", text: "b", cmdId: "b" });
  const drained = q.drainExcept(null);
  check("drainExcept(null) 清空全部", () => {
    assert.equal(q.length, 0);
    assert.deepEqual(drained.dropped.map((d) => d.cmdId), ["a"]);
    assert.deepEqual(drained.followUp, ["b"]);
  });
}

// ── 适配器：事件映射 ────────────────────────────────────────────────────────

{
  const events: { type?: string; assistantMessageEvent?: { type?: string; delta?: string } }[] = [];
  const adapter = createDshAdapter({
    emit: (e) => events.push(e as { type?: string }),
    emitQueue: () => {},
    provider: "deepseek",
    model: "m",
  });
  adapter.handle({ type: "turn/start", data: { turn: 1 } });
  adapter.handle({ type: "assistant/chunk", data: { turn: 1, step: 1, chunk: { type: "text-delta", index: 0, text: "hi" } } });
  adapter.handle({ type: "tool/call", data: { callId: "t1", name: "read", arguments: "{}" } });
  adapter.handle({ type: "llm/retry", data: {} });
  const unknown = adapter.handle({ type: "brand/new-event", data: {} });
  check("turn/start → message_start", () => {
    assert.ok(events.some((e) => e.type === "message_start"));
  });
  check("assistant/chunk text-delta → message_update(text_delta)", () => {
    assert.ok(events.some((e) => e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta"));
  });
  check("tool/call → tool_execution_start", () => {
    assert.ok(events.some((e) => e.type === "tool_execution_start"));
  });
  check("llm/retry → status.update", () => {
    assert.ok(events.some((e) => e.type === "status.update"));
  });
  check("未映射事件返回 false（且不抛错）", () => {
    assert.equal(unknown, false);
  });
}

// ── 插件包名校验（防命令注入回归） ──────────────────────────────────────────

await rejects("installPlugin 拒绝 shell 元字符", () => installPlugin("x & calc.exe"));
await rejects("installPlugin 拒绝路径穿越", () => installPlugin("../../evil"));
await rejects("uninstallPlugin 拒绝 shell 元字符", () => uninstallPlugin("dsh-tavern; rm -rf /"));
await rejects("uninstallPlugin 拒绝空名", () => uninstallPlugin("   "));

// ── 插件安装校验（#8 事务化：bundle patch 必须在包目录内存在） ──────────────

{
  const root = mkdtempSync(join(tmpdir(), "mirach-plugin-"));
  const write = (name: string, manifest: unknown, patch?: string): string => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest), "utf8");
    if (patch !== undefined) writeFileSync(join(dir, patch), "[]\n", "utf8");
    return dir;
  };
  const good = write("good", { name: "good", version: "1.0.0", dsh: { bundle: { patch: "cordis.patch.yml" } } }, "cordis.patch.yml");
  const noPatch = write("no-patch", { name: "no-patch", version: "1.0.0" });
  const badPath = write("bad-path", { name: "bad-path", version: "1.0.0", dsh: { bundle: { patch: "../outside.yml" } } });
  const wrongName = write("wrong-name", { name: "other", version: "1.0.0", dsh: { bundle: { patch: "cordis.patch.yml" } } }, "cordis.patch.yml");
  check("verifyInstalledPlugin 接受合法插件", () => {
    const r = verifyInstalledPlugin(good, "good");
    assert.equal(r.version, "1.0.0");
  });
  check("verifyInstalledPlugin 拒绝缺 dsh.bundle.patch", () => {
    assert.throws(() => verifyInstalledPlugin(noPatch, "no-patch"), /dsh\.bundle\.patch/);
  });
  check("verifyInstalledPlugin 拒绝越界 patch 路径", () => {
    assert.throws(() => verifyInstalledPlugin(badPath, "bad-path"), /非法或不存在/);
  });
  check("verifyInstalledPlugin 拒绝 name 不一致", () => {
    assert.throws(() => verifyInstalledPlugin(wrongName, "wrong-name"), /不一致/);
  });
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) process.exit(1);
