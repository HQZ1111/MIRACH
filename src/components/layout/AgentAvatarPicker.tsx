/**
 * AgentAvatarPicker — hermes avatar-picker 的移植版：形状网格 + 色板 +
 * 上传照片（Generate/Pet 两个 tab 依赖引擎 RPC/宠物系统，暂不移植）。
 * 顶部 BotFace 实时预览当前组合。
 */

import { useRef, useState } from "react";

import { AVATAR_EXTRA_SHAPES, AVATAR_PICKER_SHAPES, BotFace } from "./AgentAvatar";

const SWATCH_COLORS = [
  "#6366F1", "#026CFE", "#06B6D4", "#10B981",
  "#F59E0B", "#F97316", "#EF4444", "#EC4899",
  "#8B5CF6", "#303030",
];

/** 图片压到 256×256 内再转 data URL，控制 localStorage 体积。 */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = raw;
    });
    const scale = Math.min(1, 256 / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return raw; // 解码失败（如 gif）直接用原图 data URL
  }
}

export function AgentAvatarPicker({
  name,
  shape,
  color,
  image,
  onShape,
  onColor,
  onImage,
}: {
  name: string;
  shape: string;
  color: string;
  image: null | string;
  onShape: (shape: string) => void;
  onColor: (color: string) => void;
  onImage: (image: null | string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState<"shape" | "upload">("shape");

  const previewColor = color || "#8b5cf6";

  return (
    <div className="grid justify-items-center gap-2.5">
      {/* 实时预览 */}
      <div className="flex h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40">
        <BotFace color={previewColor} image={image} name={name} shape={shape} size={44} />
      </div>

      {/* 形状 / 上传 切换 */}
      <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-[11px]">
        {(
          [
            ["shape", "形状"],
            ["upload", "照片"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              tab === id
                ? "rounded-md bg-white px-3 py-1 font-medium text-[#303030] shadow-sm"
                : "rounded-md px-3 py-1 text-muted-foreground transition-colors hover:text-[#303030]"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "shape" ? (
        <>
          {/* 形状网格 */}
          <div className="grid grid-cols-8 justify-items-center gap-1">
            {[...AVATAR_PICKER_SHAPES, ...AVATAR_EXTRA_SHAPES].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onShape(s)}
                aria-label={s}
                className={
                  "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors " +
                  (shape === s ? "border-[#026CFE] bg-[#026CFE]/5" : "border-transparent hover:bg-muted")
                }
              >
                <BotFace color={previewColor} name={name} shape={s} size={26} />
              </button>
            ))}
          </div>

          {/* 色板 */}
          <div className="flex flex-wrap justify-center gap-1.5">
            {SWATCH_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onColor(c)}
                aria-label={c}
                className={
                  "h-5 w-5 rounded-full border-2 transition-colors " +
                  (color === c ? "border-[#303030]" : "border-transparent")
                }
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="grid w-full justify-items-center gap-2">
          <input
            ref={fileRef}
            accept="image/*"
            type="file"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) onImage(await fileToAvatarDataUrl(file));
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-md border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:border-[#026CFE]/50 hover:text-[#303030]"
          >
            从设备选择照片（自动压缩到 256px）
          </button>
          {image ? (
            <button
              type="button"
              onClick={() => onImage(null)}
              className="text-[11px] text-red-500 transition-opacity hover:opacity-80"
            >
              移除照片
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
