// _hud_patch3.mjs - apply exact-anchor edits (loud errors + set_bounds(Rect))
import fs from "node:fs";
const p = "src-tauri/src/lib.rs";
let t = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
let n = 0;

const edits = [
  // 1) hud_close: 窗口不存在时明确报错
  [
    `async fn hud_close(app: tauri::AppHandle) -> Result<(), String> {
    eprintln!("[hud] close requested");
    if let Some(win) = app.get_webview_window(HUD_LABEL) {
        let _ = win.close();
    }
    Ok(())
}`,
    `async fn hud_close(app: tauri::AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window(HUD_LABEL)
        .ok_or_else(|| "HUD 窗口不存在（可能已经关闭）".to_string())?;
    win.close().map_err(|e| format!("关闭 HUD 失败: {e}"))
}`,
  ],
  // 2) hud_set_bounds: 一次 set_bounds(Rect)，去掉 set_resizable 来回切
  [
    `    if let Some(win) = app.get_webview_window(HUD_LABEL) {
        let _ = win.set_resizable(true);
        let _ = win.set_position(tauri::LogicalPosition::new(x, y));
        let _ = win.set_size(tauri::LogicalSize::new(
            width.max(HUD_MIN_WIDTH),
            height.max(HUD_MIN_HEIGHT),
        ));
        let _ = win.set_resizable(false);
    }
    Ok(())
}`,
    `    let win = app
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
}`,
  ],
  // 3) hud_begin_move / hud_set_ignore_mouse: 缺失时明确报错
  [
    `async fn hud_begin_move(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(HUD_LABEL) {
        let _ = win.start_dragging();
    }
    Ok(())
}`,
    `async fn hud_begin_move(app: tauri::AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window(HUD_LABEL)
        .ok_or_else(|| "HUD 窗口不存在".to_string())?;
    win.start_dragging().map_err(|e| format!("拖动 HUD 失败: {e}"))
}`,
  ],
  [
    `async fn hud_set_ignore_mouse(app: tauri::AppHandle, ignore: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(HUD_LABEL) {
        let _ = win.set_ignore_cursor_events(ignore);
    }
    Ok(())
}`,
    `async fn hud_set_ignore_mouse(app: tauri::AppHandle, ignore: bool) -> Result<(), String> {
    let win = app
        .get_webview_window(HUD_LABEL)
        .ok_or_else(|| "HUD 窗口不存在".to_string())?;
    win.set_ignore_cursor_events(ignore)
        .map_err(|e| format!("切换 HUD 穿透失败: {e}"))
}`,
  ],
];

for (const [from, to] of edits) {
  if (!t.includes(from)) {
    console.log("MISS:", from.split("\n")[0]);
    continue;
  }
  t = t.replace(from, to);
  n += 1;
}

// 4) hud_open: 建窗后若拿不到 OS 句柄 → 明确报错（前端才会提示，而不是"点了没反应"）
const guardAnchor = `    // 透明窗口必须显式把 WebView 背景设透明（主窗同样处理，否则透明处发黑）`;
if (t.includes(guardAnchor)) {
  t = t.replace(
    guardAnchor,
    `    // 失败可见化：窗口对象建出来了但拿不到 OS 句柄时明确报错
    if hud.hwnd().is_err() {
        let msg = "HUD 窗口创建失败：没有得到系统窗口句柄（webview 未就绪），请重试或重启应用";
        eprintln!("[hud] {msg}");
        return Err(msg.to_string());
    }
${guardAnchor}`,
  );
  n += 1;
} else {
  console.log("MISS: hud_open guard anchor");
}

fs.writeFileSync(p, t.replace(/\n/g, "\r\n"), "utf8");
console.log(`applied ${n}/5 edits`);
