/**
 * EnvSettingsSection — 设置页"环境"分区（环境插件的管理 UI）
 *
 * 环境卡片列表：图标（点击开 IconPicker）/名称/工作区/可见性开关/删除。
 * main 主环境（builtIn）整行锁定 🔒——store 层还会强制回填，双保险。
 * 编辑即时保存（blur/切换时提交），删除需二次确认。
 */

import { useState } from "react";
import { useStore } from "@nanostores/react";
import { cn } from "@/lib/utils";
import { renderEnvIcon, getIconItem } from "@/plugins/icon-library";
import { IconPicker } from "@/components/settings/IconPicker";
import {
  $environments,
  addEnvironment,
  updateEnvironment,
  removeEnvironment,
  setEnvVisible,
  type EnvProfile,
} from "@/store/environments";
import { Plus, Trash2, Lock, Pencil, Check, X } from "lucide-react";

type Draft = { name: string; cwd: string; icon: string };

function toDraft(e: EnvProfile): Draft {
  return { name: e.name, cwd: e.cwd, icon: e.icon ?? "lucide:bot" };
}

export function EnvSettingsSection() {
  const envs = useStore($environments);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", cwd: "", icon: "lucide:bot" });
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const commit = (id: string, d: Draft): void => {
    updateEnvironment(id, { name: d.name, cwd: d.cwd, icon: d.icon });
    setEditing(null);
  };

  const startEdit = (e: EnvProfile): void => {
    if (e.builtIn) return;
    setEditing(e.id);
    setDraft(toDraft(e));
    setConfirmDelete(null);
  };

  return (
    <div className="px-5 py-4">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        每个环境 = 独立工作区 + 独立会话空间（切环境即切引擎工作区）。
        可见性控制左栏入口显隐；主环境（点 Logo 进入）锁定不可改。
      </p>

      {/* 环境卡片列表 */}
      <div className="mt-3 space-y-2">
        {envs.map((e) => {
          const isEditing = editing === e.id;
          const locked = e.builtIn === true;
          return (
            <div key={e.id} className="relative rounded-lg border border-black/10 bg-white">
              <div className="flex items-center gap-3 px-3 py-2.5">
                {/* 图标（点击开选择器；锁定环境不可换） */}
                <div className="relative shrink-0">
                  <button
                    onClick={() => (locked ? undefined : setPickerFor(pickerFor === e.id ? null : e.id))}
                    title={locked ? "主环境图标不可更换" : "点击更换图标"}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 bg-muted text-[#303030]",
                      locked ? "cursor-default opacity-80" : "hover:border-[#6366F1]",
                    )}
                  >
                    {renderEnvIcon(e.icon, "h-4.5 w-4.5")}
                  </button>
                  {pickerFor === e.id && (
                    <div className="absolute left-0 top-10 z-50 w-[280px]">
                      <IconPicker
                        value={e.icon}
                        onSelect={(iconId) => {
                          updateEnvironment(e.id, { icon: iconId });
                          setPickerFor(null);
                        }}
                        onClose={() => setPickerFor(null)}
                      />
                    </div>
                  )}
                </div>

                {/* 名称/工作区（编辑态） */}
                {isEditing ? (
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <input
                      value={draft.name}
                      onChange={(ev) => setDraft((v) => ({ ...v, name: ev.target.value }))}
                      placeholder="环境名称"
                      className="w-full rounded-md border border-border px-2 py-1 text-xs outline-none focus:border-[#6366F1]"
                    />
                    <input
                      value={draft.cwd}
                      onChange={(ev) => setDraft((v) => ({ ...v, cwd: ev.target.value }))}
                      placeholder="工作区路径（如 G:\\Workspaces\\code，可留空）"
                      className="w-full rounded-md border border-border px-2 py-1 font-mono text-xs outline-none focus:border-[#6366F1]"
                    />
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-[#303030]">{e.name}</p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground" title={e.cwd}>
                      {e.cwd || "跟随系统默认"}
                    </p>
                  </div>
                )}

                {/* 可见性开关 */}
                <button
                  onClick={() => setEnvVisible(e.id, !(e.visible !== false))}
                  disabled={locked || isEditing}
                  title={e.visible !== false ? "左栏展示中（点击隐藏）" : "已隐藏（点击展示）"}
                  className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                    e.visible !== false ? "bg-[#10B981]" : "bg-muted-foreground/40",
                    (locked || isEditing) && "cursor-default opacity-50",
                  )}
                  aria-label="可见性开关"
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
                      e.visible !== false ? "left-[18px]" : "left-0.5",
                    )}
                  />
                </button>

                {/* 编辑/删除（main 锁定） */}
                {locked ? (
                  <span title="主环境锁定" className="shrink-0 text-muted-foreground/60">
                    <Lock className="h-3.5 w-3.5" />
                  </span>
                ) : isEditing ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => commit(e.id, draft)}
                      title="保存"
                      className="rounded p-1 text-[#10B981] hover:bg-black/5"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      title="取消"
                      className="rounded p-1 text-muted-foreground hover:bg-black/5"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => startEdit(e)}
                      title="编辑"
                      className="rounded p-1 text-muted-foreground hover:bg-black/5"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {confirmDelete === e.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            removeEnvironment(e.id);
                            setConfirmDelete(null);
                          }}
                          className="rounded bg-[#EF4444] px-1.5 py-0.5 text-[10px] text-white"
                        >
                          确认删除
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="rounded p-1 text-muted-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(e.id)}
                        title="删除"
                        className="rounded p-1 text-muted-foreground hover:bg-black/5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* 行内图标选择器（编辑态） */}
              {isEditing && pickerFor === e.id && (
                <div className="px-3 pb-2">
                  <div className="relative h-56">
                    <IconPicker
                      value={draft.icon}
                      onSelect={(iconId) => setDraft((v) => ({ ...v, icon: iconId }))}
                      onClose={() => setPickerFor(null)}
                    />
                  </div>
                </div>
              )}

              {/* 删除二次确认 */}
              {confirmDelete === e.id && isEditing === null && null}
            </div>
          );
        })}
      </div>

      {/* 添加环境 */}
      <div className="mt-3">
        {adding ? (
          <AddEnvForm
            onCancel={() => setAdding(false)}
            onAdd={(name, cwd, icon) => {
              addEnvironment({ name, cwd, icon, visible: true });
              setAdding(false);
            }}
                      />
        ) : (
          <button
            onClick={() => {
              setAdding(true);
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs text-[#464646] transition-colors hover:border-[#6366F1] hover:text-[#6366F1]"
          >
            <Plus className="h-3.5 w-3.5" /> 添加环境
          </button>
        )}
      </div>
    </div>
  );
}

function AddEnvForm({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, cwd: string, icon: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [icon, setIcon] = useState("lucide:bot");
  const [picking, setPicking] = useState(false);
  const Icon = getIconItem(icon).Icon;

  return (
    <div className="rounded-lg border border-[#6366F1]/30 bg-[#6366F1]/4 p-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPicking((v) => !v)}
          title="选择图标"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-muted hover:border-[#6366F1]"
        >
          <Icon className="h-4.5 w-4.5 text-[#303030]" />
        </button>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="环境名称"
          className="min-w-0 flex-1 rounded-md border border-border px-2 py-1 text-xs outline-none focus:border-[#6366F1]"
        />
      </div>
      <input
        value={cwd}
        onChange={(e) => setCwd(e.target.value)}
        placeholder="工作区路径（可留空 = 跟随系统默认）"
        className="mt-1.5 w-full rounded-md border border-border px-2 py-1 font-mono text-xs outline-none focus:border-[#6366F1]"
      />
      {picking && (
        <div className="relative mt-2 h-56">
          <IconPicker value={icon} onSelect={(id) => { setIcon(id); setPicking(false); }} onClose={() => setPicking(false)} />
        </div>
      )}
      <div className="mt-2.5 flex justify-end gap-1.5">
        <button onClick={onCancel} className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted">
          取消
        </button>
        <button
          onClick={() => name.trim() && onAdd(name.trim(), cwd, icon)}
          className="rounded-md bg-[#017CF3] px-3 py-1 text-xs text-white hover:bg-[#017CF3]/90"
        >
          添加
        </button>
      </div>
    </div>
  );
}
