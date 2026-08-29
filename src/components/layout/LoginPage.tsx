/**
 * LoginPage — 登录页（左品牌蓝面板 + 右品牌字/表单）
 *
 * 布局：左侧 #026CFE 蓝色面板（宽 2/3）+ 右侧白色（宽 1/3）。
 * 左侧为启动页图片（上下贴边居中、左右镜像），右侧品牌字置顶
 * MIRACH（100px Heavy）+ HARNESS（66px Regular，颜色 #026CFE），下方表单：
 * - 未设置密码（首次进入）：设置密码 —— 密码 / 确认密码 /「保存」+ 右下角 >> 图标
 *   （>> = 推进下一页）→ 「配置推理提供商」（ProviderConnectPanel）：
 *   我有 API 密钥 / 自定义端点 → >> 直接进入主页
 * - 已设置密码：解锁 —— 密码 /「解锁」
 *
 * 两个使用场景：
 * - 正常启动（StartupGate 复用）：按 $passwordEnabled 切换 设置/解锁 两种模式。
 * - 独立预览（main.tsx `?win=login`）：`preview` 模式下跳过真实密码校验，
 *   用演示数据渲染，方便单独打磨 UI（HMR 即改即看）。
 *
 * 注意：内容层必须显式 w-full（flex 行容器里否则收缩到内容宽，登录页会缩到左边）；
 * 品牌字号 100/66px 适配右面板 1/3 宽，避免溢出。
 */

import { useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import { ChevronsRight, KeyRound, Lock } from "lucide-react";
import qidongyeImg from "@/assets/qidongye.jpg";
import fillerBg from "@/assets/filler-bg0.jpg";
import {
  $passwordEnabled,
  completeFirstRun,
  getObfuscatedPassword,
  isFirstRun,
  setAppPassword,
  unlockApp,
  verifyAppPassword,
} from "@/store/password";
import { WINDOW_DOTS } from "./TopBar";
import { ProviderConnectPanel } from "./ProviderConnectPanel";

/** 忘记密码：把真实密码字符打散，字符间插入随机噪声，生成可逐字辨认的乱码 */
function toGarbled(pw: string): string {
  const noise =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*!?";
  const pad = () => noise[Math.floor(Math.random() * noise.length)];
  let out = "";
  for (let i = 0; i < 3; i++) out += pad(); // 前噪声
  for (const ch of pw) {
    out += ch; // 真实密码字符保持原样
    const n = 1 + Math.floor(Math.random() * 2); // 每字符后 1-2 个噪声
    for (let i = 0; i < n; i++) out += pad();
  }
  for (let i = 0; i < 3; i++) out += pad(); // 后噪声
  return out;
}

interface LoginPageProps {
  /** 独立预览模式：跳过真实密码逻辑，用演示数据渲染（?win=login 用） */
  preview?: boolean;
}

export function LoginPage({ preview = false }: LoginPageProps) {
  const pwEnabled = useStore($passwordEnabled);
  const isSetup = preview || !pwEnabled; // 首次进入（或预览）→ 设置密码；否则 → 解锁
  const [opacity, setOpacity] = useState(1);
  const [busy, setBusy] = useState(false);
  // 模型 API 设置页只在「首次登录流程」出现：锁定/后续启动只有密码页 → 主页
  const [firstRun] = useState(() => preview || isFirstRun());
  // 阶段：password（设置/解锁密码）→ connect（仅首次流程：配置推理提供商）
  const [phase, setPhase] = useState<"password" | "connect">("password");

  // ---- 首次设置密码表单（无账户，仅密码 + 确认密码） ----
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);

  // ---- 解锁表单 ----
  const [unlockPw, setUnlockPw] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // ---- 忘记密码：显示含真实密码的乱码提示 ----
  const [forgotOpen, setForgotOpen] = useState(false);
  const [garbled, setGarbled] = useState<string | null>(null);
  const toggleForgot = () => {
    if (!forgotOpen) {
      const pw = getObfuscatedPassword();
      setGarbled(pw ? toGarbled(pw) : null);
    }
    setForgotOpen((v) => !v);
  };

  const fadeIn = () => setOpacity(1);
  useEffect(fadeIn, []);

  /** 淡出后进入主界面（preview 下不真正进入）；进入即标记首次配置完成 */
  const enter = () => {
    setOpacity(0);
    window.setTimeout(() => {
      if (!preview) {
        completeFirstRun();
        unlockApp();
      }
    }, 380);
  };

  /** 首次进入：设置密码 */
  const handleSetup = async () => {
    if (busy) return;
    if (pw.length < 4) {
      setSetupError("密码至少 4 位");
      return;
    }
    if (pw !== confirm) {
      setSetupError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      if (!preview) {
        await setAppPassword(pw);
      }
      // 模型 API 设置页只在首次登录流程出现；锁定/后续启动直接进主页
      if (firstRun) setPhase("connect");
      else enter();
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : "设置失败");
    } finally {
      setBusy(false);
    }
  };

  /** 解锁：校验密码 */
  const handleUnlock = async () => {
    if (!unlockPw || busy) return;
    setBusy(true);
    const ok = preview || (await verifyAppPassword(unlockPw));
    setBusy(false);
    if (ok) {
      enter();
    } else {
      setUnlockError("密码错误，请重试");
      setUnlockPw("");
    }
  };

  return (
    // 登录页/过渡页 = 壳内全屏状态（zosma/原型方式）：盖住整个界面（含顶栏），主界面背后渲染。
    // 外层撑满容器（软件面板/预览窗口），内层固定在设计尺寸 1580×900 并按容器实际尺寸等比缩放
    <div className="absolute inset-0 z-[95] transition-opacity duration-300" style={{ opacity }}>
      {/* 设计尺寸基准层：MIRACH/AGENT 字号、表单宽、间距全部按 1580×900 固定比例，
          容器放大时 transform: scale 整体等比变大（左右 2/3+1/3 比例也随内容一起缩放）。
          rounded-[40px]：应用内与面板圆角重叠无差异；独立预览（?win=login，无面板包裹）
          时由自身提供 40px 圆角 */}
      {/* 尺寸规则与主界面一致：随容器自由伸缩（不再固定 1580×900 等比缩放），
          保证登录页与主界面长宽始终一致 */}
      <div className="h-full w-full overflow-hidden rounded-[40px]">
        {/* 窗口控制三圆点（位置与主页 TopBar 一致：贴顶右上角；z-96 盖过登录层） */}
        <div className="absolute right-[39px] top-2 z-[96] flex items-center gap-3">
          {WINDOW_DOTS.map((d) => (
            <button
              key={d.title}
              title={d.title}
              onClick={() => void d.action()}
              className="h-3 w-3 rounded-full transition-[transform,filter] hover:scale-125 hover:brightness-110"
              style={{ backgroundColor: d.color }}
            />
          ))}
        </div>
        <div className="flex h-full w-full">
          {/* 左：品牌蓝面板（#026CFE，宽 2/3），背景保持深蓝不变。
              图片正常叠加（无混合模式），上下居中；两侧透出深蓝底。
              data-tauri-drag-region：整块可拖动窗口（纯展示无交互） */}
          <div
            data-tauri-drag-region
            className="relative flex w-2/3 items-center overflow-hidden bg-[#026CFE] px-8"
          >
            <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center">
              <img
                src={qidongyeImg}
                alt=""
                className="mx-auto h-full w-auto -scale-x-100 rounded-3xl object-contain opacity-90"
              />
            </div>
          </div>

          {/* 右：白色面板（宽 1/3）。data-tauri-drag-region：空白处可拖动
              （表单输入/按钮命中自身元素不触发拖动）。水印层 pointer-events-none 不拦。
              结构拆两层：外层 relative（非滚动容器）+ 水印层 inset-0 铺满整个面板
              （上下左右全贴边，不受内层滚动条影响）；
              内层负责滚动（内容超高时 wheel 可滚），品牌字置顶 + 表单。 */}
          <div
            data-tauri-drag-region
            className="relative flex w-1/3 flex-col overflow-hidden bg-white"
          >
            {/* 叠加水印图（filler-bg0，铺满整个右面板：上下左右全贴边，
                透明度 10%，置于最上层盖住文字；object-cover 保持比例裁切铺满） */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-20 overflow-hidden select-none"
            >
              <img
                src={fillerBg}
                alt=""
                className="h-full w-full object-cover opacity-10"
              />
            </div>

            <div className="relative flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto px-6 pt-10">
              {/* 品牌字（MIRACH 120px + HARNESS 80px；适配右面板 1/3 宽） */}
              <h1 className="relative z-10 text-[120px] font-black leading-none tracking-tighter text-[#026CFE]">
                MIRACH
              </h1>
              <h2 className="relative z-10 mt-4 self-end text-[80px] font-normal leading-none tracking-tight text-[#026CFE]">
                HARNESS
              </h2>

              {/* 表单区（flex-1：内容短时撑开让按钮沉底；内容展开变长时按钮被推到下方） */}
              <div className="relative z-10 flex-1">
                {phase === "connect" ? (
                  <ProviderConnectPanel onDone={enter} />
                ) : isSetup ? (
                  <div className="mx-auto mt-24">
                    <p className="text-sm font-medium text-[#303030]">首次进入 · 设置你的密码</p>
                    <div className="mt-4 space-y-3">
                      <Field
                        icon={<Lock className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        value={pw}
                        onChange={(v) => {
                          setPw(v);
                          setSetupError(null);
                        }}
                        placeholder="设置密码（至少 4 位）"
                        type="password"
                        autoFocus
                      />
                      <Field
                        icon={<Lock className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        value={confirm}
                        onChange={(v) => {
                          setConfirm(v);
                          setSetupError(null);
                        }}
                        placeholder="确认密码"
                        type="password"
                        onEnter={() => void handleSetup()}
                      />
                    </div>
                    {setupError && <p className="mt-2 text-xs text-[#EF4444]">{setupError}</p>}
                    <p className="mt-2 text-center text-[11px] text-muted-foreground">不想设置密码？点右下角图标可直接跳过</p>
                    <button
                      onClick={() => void handleSetup()}
                      disabled={busy}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#026CFE] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {busy ? "设置中…" : "保存"}
                    </button>
                    {preview && (
                      <p className="mt-4 text-center text-[11px] text-muted-foreground">
                        预览模式 · 任意输入可直接进入（不写本地存储）
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="mx-auto mt-24">
                    <p className="text-sm font-medium text-[#303030]">输入密码以继续</p>
                    <div className="mt-4">
                      <Field
                        icon={<Lock className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        value={unlockPw}
                        onChange={(v) => {
                          setUnlockPw(v);
                          setUnlockError(null);
                        }}
                        placeholder="输入启动密码…"
                        type="password"
                        autoFocus
                        onEnter={() => void handleUnlock()}
                      />
                    </div>
                    {unlockError && <p className="mt-2 text-xs text-[#EF4444]">{unlockError}</p>}
                    <button
                      onClick={() => void handleUnlock()}
                      disabled={!unlockPw || busy}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#026CFE] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {busy ? "校验中…" : "解锁"}
                    </button>
                  </div>
                )}
              </div>

              {/* 忘记密码乱码提示（解锁模式、点击「忘记密码」后显示；乱码中挑出真实字符即密码） */}
              {!isSetup && phase === "password" && forgotOpen && (
                <div className="relative z-10 mb-3 rounded-lg border border-dashed border-[#026CFE]/30 bg-[#026CFE]/5 px-3 py-2">
                  <p className="text-[11px] font-medium text-[#303030]">
                    密码乱码提示（逐字挑出真实字符，其余为噪声）：
                  </p>
                  <p className="mt-1 break-all font-mono text-sm leading-relaxed text-[#026CFE]">
                    {garbled ??
                      "未找到密码记录：该密码由旧版本创建（未存储找回信息）。请先输入密码解锁，进入设置修改密码后即可启用密码找回。"}
                  </p>
                </div>
              )}

              {/* 右下角：解锁模式 =「忘记密码」；设置/connect 流程 = >> 推进（跟随内容流，不遮挡表单） */}
              <div className="relative z-10 flex justify-end pb-6 pt-6">
                {!isSetup && phase === "password" ? (
                  <button
                    onClick={toggleForgot}
                    title="忘记密码？点击查看乱码提示"
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-[#026CFE] transition-opacity hover:opacity-80"
                  >
                    <KeyRound className="h-3.5 w-3.5" strokeWidth={2} />
                    {forgotOpen ? "收起" : "忘记密码"}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      // 设置密码阶段：>> = 跳过密码设置（不写密码，启动时不再要求解锁）。
                      // 首次流程跳过后仍进模型 API 页；锁定流程（非首次）直接进主页。
                      // 模型页（connect）：>> 直接进入主页；解锁阶段：解锁进入
                      if (phase === "connect") enter();
                      else if (isSetup) {
                        if (firstRun) setPhase("connect");
                        else enter();
                      } else void handleUnlock();
                    }}
                    disabled={busy}
                    title={phase === "connect" ? "直接进入主页" : isSetup ? "跳过密码设置" : "解锁进入"}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-[#026CFE] text-white shadow-lg transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    <ChevronsRight className="h-5 w-5" strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 带图标输入框 */
function Field({
  icon,
  value,
  onChange,
  placeholder,
  type = "text",
  autoFocus,
  onEnter,
}: {
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 transition-colors focus-within:border-[#026CFE]/50">
      {icon}
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.();
        }}
        type={type}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent py-2.5 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
