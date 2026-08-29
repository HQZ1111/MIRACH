/**
 * 全局终端实例 id 分配器
 *
 * 终端 id 在 Rust 侧是 pty 会话的唯一键（open_terminal 对同 id 会先关再开），
 * 因此跨面板（主终端 / 右侧栏终端 / 成员对话终端 / 新增标签）必须全局唯一，
 * 否则两个面板共用同一 id 会互相打断对方的 pty。
 */

const used = new Set<string>();

/** 分配一个当前未占用的终端 id（形如 Powershell01、Powershell02 …）。
 *  从 01 起取最小空闲号：关闭后释放的号会被复用，命名保持从小到大连续，
 *  不会出现序号一路攀升（07 开头）或跳号（07→09）的情况。 */
export function allocateTerminalId(prefix = "Powershell"): string {
  for (let n = 1; ; n += 1) {
    const id = `${prefix}${String(n).padStart(2, "0")}`;
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
}

/** 标签关闭后释放 id，允许后续复用 */
export function releaseTerminalId(id: string): void {
  used.delete(id);
}
