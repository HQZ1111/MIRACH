// _hud_revert_bounds.mjs - set_bounds(Rect) 在 tauri 2.11 的 WebviewWindow 上不存在；
// hermes 自己也是 setResizable 来回切（hud-ipc.ts:240-272），所以回到原实现，只保留报错。
import fs from "node:fs";
const p = "src-tauri/src/lib.rs";
let t = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const from = `    let win = app
        .get_webview_window(HUD_LABEL)
        .ok_or_else(|| "HUD 窗口不存在".to_string())?;
    // 一次 set_bounds（位置+尺寸），不要 set_resizable 来回切：透明窗上那串会闪，
    // 个别时序下还会因为 WM_SIZE 竞态不重绘；原子设置更稳。
    let rect = tauri::Rect {
        position: tauri::Position::Logical(tauri::LogicalPosition::new(x, y)),
        size: tauri::Size::Logical(tauri::LogicalSize::new(
            width.max(HUD_MIN_WIDTH),
            height.max(HUD_MIN_HEIGHT),
        )),
    };
    win.set_bounds(rect)
        .map_err(|e| format!("设置 HUD 位置/尺寸失败: {e}"))
}`;
const to = `    let win = app
        .get_webview_window(HUD_LABEL)
        .ok_or_else(|| "HUD 窗口不存在".to_string())?;
    // hermes 同款（hud-ipc.ts:240-272）：禁用 resizable 的透明无边框窗上，
    // set_position/set_size 需要临时打开 resizable 才生效，改完再关回去。
    let _ = win.set_resizable(true);
    win.set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e| format!("设置 HUD 位置失败: {e}"))?;
    win.set_size(tauri::LogicalSize::new(
        width.max(HUD_MIN_WIDTH),
        height.max(HUD_MIN_HEIGHT),
    ))
    .map_err(|e| format!("设置 HUD 尺寸失败: {e}"))?;
    let _ = win.set_resizable(false);
    Ok(())
}`;
if (!t.includes(from)) {
  console.log("anchor missing");
  process.exit(1);
}
t = t.replace(from, to);
fs.writeFileSync(p, t.replace(/\n/g, "\r\n"), "utf8");
console.log("bounds reverted to resizable-toggle");
