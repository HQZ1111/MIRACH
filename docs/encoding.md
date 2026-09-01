# 文件编码规范（防止 PowerShell 乱码）

## 规则（必须遵守）

1. **所有源码文件 = UTF-8（无 BOM）**，行尾统一 LF（或仓库既有风格）。
2. **禁止用 Windows PowerShell 的 `Get-Content` / `Set-Content` 读写仓库文件**，
   无论是修复还是替换——PowerShell 5.1 默认按系统 ANSI(GBK) 解码 UTF-8 文件，
   `Set-Content -Encoding UTF8` 写回会产生不可逆乱码（含 U+FFFD 信息丢失）。
3. **修改文件只允许以下方式**：
   - 编辑器/IDE（VS Code：右下角编码必须显示 UTF-8；保存保持 UTF-8）
   - `node` 脚本（`writeFileSync(path, text, "utf8")`）
   - `git apply` / `git checkout` / 前端项目工具链（vite/tsc 不改写源码）
4. **批处理（.cmd/.bat）本身也要 UTF-8**（`-Encoding` 同规则）；任何脚本若必须写
   文件，一律用 `node` 实现。

## 乱码修复工具

`scripts/fix-encoding.js`：全仓扫描含 GBK 误读特征的源码并尝试无损逆转
（`node scripts/fix-encoding.js --check` 只报告）。

**注意**：历史提交中已存在的乱码注释如果含 U+FFFD（替换符），**不可逆转**，
只能手工重写（依据模块语义还原注释文本）。

## 经验（2026-09-02 记录）

- 症状：中文注释/字符串变成 `鈥? / 鏄? / 鏈` 一类；或整段变成不可读字符。
- 出现位置：被 PowerShell `Set-Content` 写过的文件（通常伴随替换操作）。
- 排查：`node` 级扫描（`findstr` 按 GBK 匹配 UTF-8 会全仓误报，不可用）。
- 根治：只在 IDE / node 里改文件；发现乱码立即 `git checkout -- <file>`
  回滚，避免把手改的乱码提交进历史。

## 2026-09-02 已修复

- `src/dsh-kernel/boot.ts`、`src/dsh-kernel/dsh-bridge.ts`、
  `src/lib/api/index.ts`：头部注释乱码（历史遗留、含 U+FFFD 不可逆转）→ 按语义
  手工重写为正常中文。
