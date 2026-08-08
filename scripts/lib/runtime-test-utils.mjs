/**
 * Runtime/E2E 测试共享基础设施（最小集）。
 *
 * - sleep / waitFor：等待原语
 * - makeTestDataDir：统一测试数据目录 %TEMP%\agenttips-tests\<name>-<uuid>
 *   每个 run 唯一，绝不与正式 %APPDATA%\com.agenttips.app 共享 SQLite
 * - makeLogDir：临时日志目录
 * - killProcessTree：按根 PID 结束整个进程树
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

/**
 * 检测电脑原生（内置）显示器：WMI WmiMonitorConnectionParams 中
 * VideoOutputTechnology 为 11（UDI embedded）或 0x80000000（internal）的显示器。
 * 返回 { device, left, top, right, bottom }（逻辑坐标）或 null。
 */
export function detectNativeDisplayInfo() {
  // 1. WMI：PNP -> 技术类型（只输出内置屏）
  const wmi = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorConnectionParams -ErrorAction SilentlyContinue | ForEach-Object { $p = ($_.InstanceName -split '\\\\')[1]; $t = [uint32]$_.VideoOutputTechnology; if ($t -eq 11 -or $t -eq 2147483648) { Write-Output ($p + '=' + $t) } }",
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  if (wmi.status !== 0) return null;
  const nativePnp = (wmi.stdout ?? "").split(/\r?\n/).map((l) => l.trim())[0]?.split("=")[0];
  if (!nativePnp) return null;

  // 2. Python：DISPLAYn -> 显示器 PNP + 物理位置；逻辑矩形按左坐标排序匹配
  const code = `
import ctypes, ctypes.wintypes as w, json, os
u = ctypes.windll.user32
native_pnp = os.environ.get('AGENTTIPS_NATIVE_PNP', '')

class DISPLAY_DEVICE(ctypes.Structure):
    _fields_ = [("cb", w.DWORD),
                ("DeviceName", ctypes.c_wchar * 32),
                ("DeviceString", ctypes.c_wchar * 128),
                ("StateFlags", w.DWORD),
                ("DeviceID", ctypes.c_wchar * 128),
                ("DeviceKey", ctypes.c_wchar * 128)]

class DEVMODE(ctypes.Structure):
    _fields_ = [("dmDeviceName", ctypes.c_wchar * 32),
                ("dmSpecVersion", w.WORD), ("dmDriverVersion", w.WORD), ("dmSize", w.WORD), ("dmDriverExtra", w.WORD),
                ("dmFields", w.DWORD),
                ("dmPosition", w.POINT),
                ("dmDisplayOrientation", w.DWORD), ("dmDisplayFixedOutput", w.DWORD),
                ("dmColor", ctypes.c_short), ("dmDuplex", ctypes.c_short), ("dmYResolution", ctypes.c_short),
                ("dmTTOption", ctypes.c_short), ("dmCollate", ctypes.c_short),
                ("dmFormName", ctypes.c_wchar * 32), ("dmLogPixels", w.WORD),
                ("dmBitsPerPel", w.DWORD), ("dmPelsWidth", w.DWORD), ("dmPelsHeight", w.DWORD),
                ("dmDisplayFlags", w.DWORD), ("dmDisplayFrequency", w.DWORD),
                ("dmICMMethod", w.DWORD), ("dmICMIntent", w.DWORD), ("dmMediaType", w.DWORD),
                ("dmDitherType", w.DWORD), ("dmReserved1", w.DWORD), ("dmReserved2", w.DWORD),
                ("dmPanningWidth", w.DWORD), ("dmPanningHeight", w.DWORD)]

def enum_devices(base=None):
    out = []
    i = 0
    while True:
        dd = DISPLAY_DEVICE()
        dd.cb = ctypes.sizeof(DISPLAY_DEVICE)
        if not u.EnumDisplayDevicesW(base, i, ctypes.byref(dd), 0):
            break
        out.append((dd.DeviceName, dd.DeviceID, dd.StateFlags))
        i += 1
    return out

devices = []
for name, devid, flags in enum_devices(None):
    if not (flags & 1):
        continue
    pnp = None
    for mname, mdevid, mflags in enum_devices(name):
        pnp = (mdevid.split('\\\\'))[1]
    dm = DEVMODE()
    dm.dmSize = ctypes.sizeof(DEVMODE)
    phys_x = 0
    if u.EnumDisplaySettingsW(name, 0xFFFFFFFF, ctypes.byref(dm)):
        phys_x = dm.dmPosition.x
    devices.append((name, pnp, phys_x))

class MONITORINFO(ctypes.Structure):
    _fields_ = [("cbSize", w.DWORD), ("rcMonitor", w.RECT), ("rcWork", w.RECT), ("dwFlags", w.DWORD)]
rects = []
def enum_cb(hmon, hdc, lprc, lparam):
    info = MONITORINFO()
    info.cbSize = ctypes.sizeof(MONITORINFO)
    if u.GetMonitorInfoW(hmon, ctypes.byref(info)):
        r = info.rcMonitor
        rects.append((r.left, r.top, r.right, r.bottom))
    return True
u.EnumDisplayMonitors(0, 0, ctypes.WINFUNCTYPE(ctypes.c_bool, w.HMONITOR, w.HDC, ctypes.POINTER(w.RECT), w.LPARAM)(enum_cb), 0)

devices.sort(key=lambda d: d[2])
rects.sort(key=lambda r: r[0])
for (name, pnp, _px), rect in zip(devices, rects):
    if pnp == native_pnp:
        print(json.dumps({"device": name, "rect": list(rect)}))
        raise SystemExit
`;
  const py = spawnSync("python", ["-X", "utf8", "-c", code], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, AGENTTIPS_NATIVE_PNP: nativePnp },
  });
  if (py.status !== 0) return null;
  const line = (py.stdout ?? "").split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("{"));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line);
    const [left, top, right, bottom] = parsed.rect;
    return { device: parsed.device, left, top, right, bottom };
  } catch {
    return null;
  }
}

/** 将匹配的顶层窗口移动到电脑原生（内置）屏幕居中；检测失败时回退到“鼠标不在的那块屏”。 */
export function moveWindowsToNativeDisplay({ titles = [], className = null } = {}) {
  const native = detectNativeDisplayInfo();
  if (!native) {
    return moveWindowsAwayFromCursor({ titles, className });
  }
  const titleList = titles.map((t) => JSON.stringify(t)).join(",");
  const classExpr = className ? JSON.stringify(className) : "None";
  const code = `
import ctypes, ctypes.wintypes as w
u = ctypes.windll.user32
titles = [${titleList}]
class_name = ${classExpr}
left, top, right, bottom = ${native.left}, ${native.top}, ${native.right}, ${native.bottom}
sw, sh = right - left, bottom - top
moved = 0

def match(hwnd):
    if class_name:
        buf = ctypes.create_unicode_buffer(256)
        u.GetClassNameW(hwnd, buf, 256)
        if buf.value == class_name:
            return True
    if titles:
        length = u.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(length + 1)
        u.GetWindowTextW(hwnd, buf, length + 1)
        if buf.value in titles:
            return True
    return False

def enum_win(hwnd, lparam):
    global moved
    if not u.IsWindowVisible(hwnd):
        return True
    if not match(hwnd):
        return True
    r = w.RECT()
    u.GetWindowRect(hwnd, ctypes.byref(r))
    ww, wh = r.right - r.left, r.bottom - r.top
    if ww <= 0 or wh <= 0:
        return True
    x = left + max(0, (sw - ww) // 2)
    y = top + max(0, (sh - wh) // 2)
    u.MoveWindow(hwnd, x, y, ww, wh, True)
    moved += 1
    return True

u.EnumWindows(ctypes.WINFUNCTYPE(ctypes.c_bool, w.HWND, w.LPARAM)(enum_win), 0)
print(moved)
`;
  const result = spawnSync("python", ["-X", "utf8", "-c", code], {
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.status !== 0) throw new Error(`moveWindowsToNativeDisplay failed: ${result.stderr}`);
  return Number(result.stdout.trim() || 0);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(
  predicate,
  { timeout = 60_000, interval = 250, label = "condition" } = {},
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return true;
    } catch {
      /* retry */
    }
    await sleep(interval);
  }
  throw new Error(`wait timeout: ${label}`);
}

/** 每个测试 run 使用唯一数据目录，两个测试脚本绝不会共享同一 SQLite 文件。 */
export function makeTestDataDir(testName) {
  const base = join(tmpdir(), "agenttips-tests");
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, `${testName}-${randomUUID()}-`));
}

export function makeLogDir(testName) {
  return mkdtempSync(join(tmpdir(), `agenttips-${testName}-logs-`));
}

/** 结束整个进程树（含 pnpm/cargo 子进程）。 */
export function killProcessTree(rootPid) {
  try {
    spawnSync("taskkill", ["/pid", String(rootPid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
}

/**
 * 探测当前 Windows 会话是否支持"合成键盘注入触发全局热键"。
 *
 * 方法：创建隐藏消息窗口 → 注册一个专用热键（依次尝试 Ctrl+F10/F11/F12/F9/F8，
 * 避开已被占用槽位）→ 用 SendInput 合成按下 → 检查 WM_HOTKEY 是否送达 → 注销。
 *
 * 某些环境（远程会话 / 输入法 / 安全软件 / 系统合成输入策略）会过滤合成注入，
 * 导致 WM_HOTKEY 不送达。这是环境限制，不是 AgentTips 产品缺陷；
 * 全局热键真实行为由专用 Windows runtime test 与人工物理按键 smoke 覆盖。
 *
 * 返回 { available, reason? }。runtime 测试在 available=false 时
 * 对依赖合成热键的步骤输出 SKIP WITH REASON 而不是 FAIL。
 */
export function probeSyntheticHotkey() {
  const code = `
import ctypes, ctypes.wintypes as w, time
u = ctypes.windll.user32
WM_HOTKEY = 0x0312
MOD_CONTROL = 0x0002
ERROR_HOTKEY_ALREADY_REGISTERED = 1409
WNDPROC = ctypes.WINFUNCTYPE(ctypes.c_longlong, w.HWND, w.UINT, w.WPARAM, w.LPARAM)
class WNDCLASS(ctypes.Structure):
    _fields_ = [("style", w.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
                ("cbWndExtra", ctypes.c_int), ("hInstance", w.HINSTANCE), ("hIcon", w.HICON),
                ("hCursor", w.HANDLE), ("hbrBackground", w.HBRUSH), ("lpszMenuName", w.LPCWSTR),
                ("lpszClassName", w.LPCWSTR)]
u.DefWindowProcW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]
u.DefWindowProcW.restype = ctypes.c_longlong
received = []
def wndproc(hwnd, msg, wparam, lparam):
    if msg == WM_HOTKEY:
        received.append(1)
        return 0
    return u.DefWindowProcW(hwnd, msg, wparam, lparam)
wc = WNDCLASS()
wc.lpfnWndProc = WNDPROC(wndproc)
wc.lpszClassName = "AgentTipsHotkeyProbe"
wc.hInstance = ctypes.windll.kernel32.GetModuleHandleW(None)
u.RegisterClassW(ctypes.byref(wc))
hwnd = u.CreateWindowExW(0, "AgentTipsHotkeyProbe", "probe", 0, 0, 0, 0, 0, None, None, wc.hInstance, None)
candidates = [0x79, 0x7A, 0x7B, 0x78, 0x77]  # F10, F11, F12, F9, F8
reg = None
for vk in candidates:
    ctypes.set_last_error(0)
    if u.RegisterHotKey(hwnd, 1, MOD_CONTROL, vk):
        reg = vk
        break
    if ctypes.get_last_error() != ERROR_HOTKEY_ALREADY_REGISTERED:
        break
if reg is None:
    print("NO_SLOT")
else:
    class KBD(ctypes.Structure):
        _fields_ = [("wVk", ctypes.c_ushort), ("wScan", ctypes.c_ushort), ("dwFlags", ctypes.c_ulong),
                    ("time", ctypes.c_ulong), ("dwExtraInfo", ctypes.c_void_p)]
    class INP(ctypes.Structure):
        _fields_ = [("type", ctypes.c_ulong), ("ki", KBD)]
    def send(vk, down):
        inp = INP(); inp.type = 1
        inp.ki.wVk = vk; inp.ki.wScan = 0
        inp.ki.dwFlags = 0 if down else 2
        u.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INP))
    send(0x11, 1)
    send(reg, 1)
    send(reg, 0)
    send(0x11, 0)
    deadline = time.time() + 1.5
    msg = w.MSG()
    while time.time() < deadline:
        while u.PeekMessageW(ctypes.byref(msg), None, 0, 0, 1):
            u.TranslateMessage(ctypes.byref(msg))
            u.DispatchMessageW(ctypes.byref(msg))
        time.sleep(0.01)
    print("DELIVERED" if received else "NOT_DELIVERED")
    u.UnregisterHotKey(hwnd, 1)
`;
  const result = spawnSync("python", ["-X", "utf8", "-c", code], {
    encoding: "utf8",
    timeout: 25_000,
  });
  if (result.status !== 0) {
    return {
      available: false,
      reason: `probe python failed: ${(result.stderr ?? "").trim() || "unknown"}`,
    };
  }
  const out = (result.stdout ?? "").trim();
  if (out === "DELIVERED") {
    return { available: true, reason: "synthetic hotkey delivered" };
  }
  if (out === "NOT_DELIVERED") {
    return {
      available: false,
      reason: "synthetic hotkey NOT delivered (session filters injected input)",
    };
  }
  if (out === "NO_SLOT") {
    return { available: false, reason: "no free probe hotkey slot" };
  }
  return { available: false, reason: `unexpected probe output: ${out}` };
}

/**
 * 将指定窗口移动到"鼠标当前不在的那块屏"（避免测试窗口打扰用户正在看的屏幕）。
 * 通过标题列表或类名匹配顶层窗口，MoveWindow 到目标屏居中（保持原尺寸）。
 * 只有一块屏时静默返回 0（不移动）。
 */
export function moveWindowsAwayFromCursor({ titles = [], className = null } = {}) {
  const titleList = titles.map((t) => JSON.stringify(t)).join(",");
  const classExpr = className ? JSON.stringify(className) : "None";
  const code = `
import ctypes, ctypes.wintypes as w, json
u = ctypes.windll.user32
titles = [${titleList}]
class_name = ${classExpr}

class MONITORINFO(ctypes.Structure):
    _fields_ = [("cbSize", w.DWORD), ("rcMonitor", w.RECT), ("rcWork", w.RECT), ("dwFlags", w.DWORD)]

monitors = []
def enum_cb(hmon, hdc, lprc, lparam):
    info = MONITORINFO()
    info.cbSize = ctypes.sizeof(MONITORINFO)
    if u.GetMonitorInfoW(hmon, ctypes.byref(info)):
        monitors.append((info.rcMonitor.left, info.rcMonitor.top, info.rcMonitor.right, info.rcMonitor.bottom, info.dwFlags))
    return True
u.EnumDisplayMonitors(0, 0, ctypes.WINFUNCTYPE(ctypes.c_bool, w.HMONITOR, w.HDC, ctypes.POINTER(w.RECT), w.LPARAM)(enum_cb), 0)

if len(monitors) < 2:
    print(0)
    raise SystemExit

pt = w.POINT()
u.GetCursorPos(ctypes.byref(pt))

def contains(m, x, y):
    return m[0] <= x < m[2] and m[1] <= y < m[3]

# 鼠标所在屏 = 用户正在看的屏；目标是另一块屏
cursor_monitor = next((m for m in monitors if contains(m, pt.x, pt.y)), monitors[0])
target = next((m for m in monitors if m != cursor_monitor), None)
if target is None:
    print(0)
    raise SystemExit

secondary = None
secondary = target

left, top, right, bottom = secondary[0], secondary[1], secondary[2], secondary[3]
sw, sh = right - left, bottom - top
moved = 0

def match(hwnd):
    if class_name:
        buf = ctypes.create_unicode_buffer(256)
        u.GetClassNameW(hwnd, buf, 256)
        if buf.value == class_name:
            return True
    if titles:
        length = u.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(length + 1)
        u.GetWindowTextW(hwnd, buf, length + 1)
        if buf.value in titles:
            return True
    return False

def enum_win(hwnd, lparam):
    global moved
    if not u.IsWindowVisible(hwnd):
        return True
    if not match(hwnd):
        return True
    r = w.RECT()
    u.GetWindowRect(hwnd, ctypes.byref(r))
    ww, wh = r.right - r.left, r.bottom - r.top
    if ww <= 0 or wh <= 0:
        return True
    x = left + max(0, (sw - ww) // 2)
    y = top + max(0, (sh - wh) // 2)
    u.MoveWindow(hwnd, x, y, ww, wh, True)
    moved += 1
    return True

u.EnumWindows(ctypes.WINFUNCTYPE(ctypes.c_bool, w.HWND, w.LPARAM)(enum_win), 0)
print(moved)
`;
  const result = spawnSync("python", ["-X", "utf8", "-c", code], {
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.status !== 0) throw new Error(`moveWindowsAwayFromCursor failed: ${result.stderr}`);
  return Number(result.stdout.trim() || 0);
}

/** 将匹配的顶层窗口最小化（SW_MINIMIZE），减少测试窗口对用户的视觉干扰。 */
export function minimizeWindows({ titles = [], className = null } = {}) {
  const titleList = titles.map((t) => JSON.stringify(t)).join(",");
  const classExpr = className ? JSON.stringify(className) : "None";
  const code = `
import ctypes, ctypes.wintypes as w
u = ctypes.windll.user32
titles = [${titleList}]
class_name = ${classExpr}
minimized = 0

def match(hwnd):
    if class_name:
        buf = ctypes.create_unicode_buffer(256)
        u.GetClassNameW(hwnd, buf, 256)
        if buf.value == class_name:
            return True
    if titles:
        length = u.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(length + 1)
        u.GetWindowTextW(hwnd, buf, length + 1)
        if buf.value in titles:
            return True
    return False

def enum_win(hwnd, lparam):
    global minimized
    if not u.IsWindowVisible(hwnd):
        return True
    if not match(hwnd):
        return True
    if u.IsIconic(hwnd):
        return True
    u.ShowWindow(hwnd, 6)  # SW_MINIMIZE
    minimized += 1
    return True

u.EnumWindows(ctypes.WINFUNCTYPE(ctypes.c_bool, w.HWND, w.LPARAM)(enum_win), 0)
print(minimized)
`;
  const result = spawnSync("python", ["-X", "utf8", "-c", code], {
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.status !== 0) throw new Error(`minimizeWindows failed: ${result.stderr}`);
  return Number(result.stdout.trim() || 0);
}
