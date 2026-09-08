# 同步手册 —— 新机器首装 / 日常同步 / 为什么不能直接复制文件夹

> 适用：把自己的 mirach 工作区同步到公司电脑或任何新机器。
> 一句话：**走 git，不走文件夹复制**。

## 1. 这套东西是四层，不是"一个文件夹"

```
第 1 层  父仓库（mirach-harness）
         Gitee HANQINGZHOU/mirach-harness
         = 官方 dsh 完整源码树（树级压缩同步，本地提交很少）+ 你的同步提交
         ⚠️ 只进不出：upstream = github deepseek-ai/deepseek-harness
├─ 第 2 层  mirach 子仓库（git submodule，apps/mirach）
│          Gitee HANQINGZHOU/mirach + GitHub HQZ1111/MIRACH
│          = 全部 mirach 应用代码 + patches/0001-*.patch（对官方 sdk/server 的唯一补丁）
├─ 第 3 层  npm 全局引擎
│          @deepseek-ai/dsh@alpha（运行时引擎，与仓库无关，独立更新）
└─ 第 4 层  机器本地产物（不进 git，每台机器必须重建）
           ├─ lib/ 构建产物（npm run build:lib 生成）
           ├─ node_modules 里的 NTFS junction（link_workspace.mjs 生成，绝对路径指向本仓库）
           └─ ~/.mirach（会话 / 凭据 / 插件 / profiles —— 纯本机状态）
```

## 2. 为什么不能"直接复制文件夹 / 直接下载最新 dsh 替换"

1. **官方 dsh 仓库里没有 mirach**——下载 deepseek-ai/deepseek-harness 只有官方树，你的 70+ 个提交全在子仓库里
2. **junction 是绝对路径**，复制到别的盘符/机器即失效，必须用脚本重建
3. **lib 产物不进 git**，换机器必须重新 `npm run build:lib`（官方包源码 → lib 需要 tsc，内存要给足）
4. **~/.mirach 是本机状态**（会话、凭据、已装插件），不在任何仓库里——换机不迁移
5. **子模块指针**：父仓库钉死 apps/mirach 的提交号，直接覆盖文件夹会打破 submodule 状态

## 3. 新机器首装（一次）

```bat
:: 1) 父仓库（gitee，国内直连）
git clone https://gitee.com/HANQINGZHOU/mirach-harness.git
cd mirach-harness

:: 2) 子模块（.gitmodules 写的是 github SSH 地址，公司电脑没你的 SSH key 会失败——
::    先覆盖成 gitee 再 init）
git config submodule.apps/mirach.url https://gitee.com/HANQINGZHOU/mirach.git
git submodule update --init

:: 3) 依赖 + lib 构建产物（官方包 lib/ 必须本机重建）
npm install
npm run build:lib

:: 4) junction 链接（官方包 → 各 node_modules）
node apps/mirach\scripts\link_workspace.mjs

:: 5) 运行时引擎（独立于仓库）
npm i -g @deepseek-ai/dsh@alpha

:: 6) 起应用
cd apps\mirach
pnpm tauri dev
```

验证：右工具栏网关点绿（sidecar 就绪）→ 发消息有流式回复 → 设置→关于→引擎 显示版本。

## 4. 日常同步（每次拉更新）

```bat
cd mirach-harness
git pull                          :: 父仓库
cd apps\mirach && git pull && cd ..\..   :: 子仓库（pull 后若指针变了父仓库也要 pull）
npm run build:lib                 :: 官方源码变了才需要；mirach-only 改动可跳过
```

- 引擎更新与仓库无关，单独走：`npm i -g @deepseek-ai/dsh@alpha`（或应用内 设置→关于→引擎 一键更新）
- `apps/mirach/scripts/check-dsh-lib-fresh.mjs`（`npm run check:lib`）会核对 lib 产物与官方源码的新旧，vite 启动时也会拦截陈旧产物——报 stale 就跑一次 `build:lib`

## 5. 引擎更新通道（唯一）

- `npm i -g @deepseek-ai/dsh@alpha` + 重启应用
- 不存在 vendor clone / mirach-patches 分支 / bat 脚本等替代通道（旧 `更新dsh核心.bat` 已删除）
- 对官方代码的唯一本地定制是父仓库 `patches/0001-feat-sdk-server-userQuestions-session-fork-remote-Mi.patch`，随树级同步维护，不需要手工 rebase
