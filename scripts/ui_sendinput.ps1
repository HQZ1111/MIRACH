# Click at screen coordinates using SendInput (reliable input injection).
param(
  [int]$X = 890,
  [int]$Y = 900
)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public struct INPUT { public uint type; public InputUnion U; }
[StructLayout(LayoutKind.Explicit)]
public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; }
public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
public class Win32SendInput {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  public struct POINT { public int x; public int y; }
  public const uint INPUT_MOUSE = 0;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_MOVE = 0x0001;
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(400);
    INPUT[] down = new INPUT[1];
    down[0].type = INPUT_MOUSE;
    down[0].U.mi.dx = 0; down[0].U.mi.dy = 0; down[0].U.mi.mouseData = 0;
    down[0].U.mi.dwFlags = MOUSEEVENTF_LEFTDOWN; down[0].U.mi.time = 0; down[0].U.mi.dwExtraInfo = IntPtr.Zero;
    SendInput(1, down, Marshal.SizeOf(typeof(INPUT)));
    System.Threading.Thread.Sleep(100);
    INPUT[] up = new INPUT[1];
    up[0].type = INPUT_MOUSE;
    up[0].U.mi.dx = 0; up[0].U.mi.dy = 0; up[0].U.mi.mouseData = 0;
    up[0].U.mi.dwFlags = MOUSEEVENTF_LEFTUP; up[0].U.mi.time = 0; up[0].U.mi.dwExtraInfo = IntPtr.Zero;
    SendInput(1, up, Marshal.SizeOf(typeof(INPUT)));
  }
}
'@
$p = Get-Process my-hermes-rs | Select-Object -First 1
if (-not $p) { Write-Output "NO_PROCESS"; exit 1 }
$hwnd = $p.MainWindowHandle
[Win32SendInput]::ShowWindow($hwnd, 9) | Out-Null
for ($i = 0; $i -lt 10; $i++) {
  [Win32SendInput]::SetForegroundWindow($hwnd) | Out-Null
  Start-Sleep -Milliseconds 300
  if ([Win32SendInput]::GetForegroundWindow() -eq $hwnd) { break }
}
if ([Win32SendInput]::GetForegroundWindow() -ne $hwnd) { Write-Output "NOT_FOREGROUND"; exit 2 }
[Win32SendInput]::Click($X, $Y)
$pos = New-Object Win32SendInput+POINT
[Win32SendInput]::GetCursorPos([ref]$pos) | Out-Null
Write-Output ("CLICKED " + $X + "," + $Y + " CURSOR=" + $pos.x + "," + $pos.y)
