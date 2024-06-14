const ref = require('ref-napi');
const ffi = require('ffi-napi');
const StructType = require('ref-struct-di')(ref);
const types = ref.types;

const voidPtr = ref.refType(ref.types.void);
const stringPtr = ref.refType(ref.types.CString);
const intPtr = ref.refType('int');

const HWND = ref.types.long;
const LPARAM = voidPtr;
const WPARAM = voidPtr;
const DWORD = ref.types.ulong;

const WindowCompositionAttributeData = StructType({
  Attribute: ref.types.uint32,
  Data: voidPtr,
  DataSize: ref.types.ulong,
});

const WinPoint = StructType({
  x: 'long',
  y: 'long',
});

const WinBOOL = ref.types.int;

const Msg = StructType({
  hwnd: HWND,
  message: ref.types.uint,
  wParam: WPARAM,
  lParam: LPARAM,
  dword: DWORD,
  pt: WinPoint,
  lPrivate: DWORD,
});

const user32 = ffi.Library('user32.dll', {
  EnumWindows: ['bool', [voidPtr, 'int32']],
  GetWindowTextA: ['long', ['long', stringPtr, 'long']],
  GetWindowTextW: ['long', ['long', stringPtr, 'long']],
  SetWindowCompositionAttribute: [
    ref.types.int,
    ['long', ref.refType(WindowCompositionAttributeData)],
  ],
  SetWindowsHookExA: [intPtr, ['int', voidPtr, intPtr, 'int']],
  CallNextHookEx: [intPtr, ['int', intPtr, intPtr]],
  UnhookWindowsHookEx: ['bool', [intPtr]],
  GetMessageA: [
    ref.types.int,
    [ref.refType(Msg), HWND, ref.types.uint, ref.types.uint],
  ],
  SetWinEventHook: [
    voidPtr,
    [DWORD, DWORD, voidPtr, voidPtr, DWORD, DWORD, DWORD],
  ],
});
const dwmapi = ffi.Library('dwmapi.dll', {
  DwmSetWindowAttribute: [voidPtr, [HWND, DWORD, voidPtr, DWORD]],
  DwmGetWindowAttribute: [voidPtr, [HWND, DWORD, voidPtr, DWORD]],
});

const WCA_USEDARKMODECOLORS = 26;
const DWM_WINDOW_CORNER_PREFERENCE = 33;
const DWMWCP_DONOTROUND = 1;

function getWindows() {
  if (process.arch != 'x64') {
    throw new Error('Must use x64');
  }

  const windows = [];

  windowProc = ffi.Callback('bool', ['long', 'int32'], (hwnd, lParam) => {
    let buf, name, ret;
    buf = Buffer.alloc(255);
    ret = user32.GetWindowTextW(hwnd, buf, 255);
    // name = ref.readCString(buf, 0);
    name = readUtf16CString(buf);
    windows.push({ name, hwnd });
    return true;
  });

  user32.EnumWindows(windowProc, 0);

  return windows;
}

function readUtf16CString(buf) {
  let nullIndex = buf.indexOf('\0\0');
  if (nullIndex % 2 === 1) {
    nullIndex++;
  }
  return buf.toString('utf16le', 0, nullIndex !== -1 ? nullIndex : undefined);
}

function getWindowName(hwnd) {
  buf = Buffer.alloc(255);
  ret = user32.GetWindowTextW(hwnd, buf, 255);
  return readUtf16CString(buf);
}

function setWindowDarkmode(hwnd) {
  const dataBuf = Buffer.alloc(32);
  ref.types.long.set(dataBuf, 0, 1); // dark mode on
  const param = new WindowCompositionAttributeData({
    Attribute: WCA_USEDARKMODECOLORS,
    Data: dataBuf.ref(),
    DataSize: dataBuf.length,
  });

  user32.SetWindowCompositionAttribute(hwnd, param.ref());
}

function setUnround(hwnd) {
  dwmapi.DwmSetWindowAttribute(
    hwnd,
    DWM_WINDOW_CORNER_PREFERENCE,
    Buffer.from([DWMWCP_DONOTROUND]),
    4
  );
}

function getUnround(hwnd) {
  const buf = Buffer.alloc(1);
  dwmapi.DwmGetWindowAttribute(
    hwnd,
    DWM_WINDOW_CORNER_PREFERENCE,
    buf,
    4
  );
  return buf.at(0) === 1;
}

async function runUnround(hwnd) {
  // setting the attribute does not always work, sometimes we have to try multiple times
  let iters = 0;
  getUnround(hwnd);
  while (!getUnround(hwnd) && iters < 300) {
    console.log('trying to set');
    setUnround(hwnd);
    await new Promise(x => setTimeout(x, 100));
    iters++;
  }
  getUnround(hwnd);
}

function unroundChk(hwnd) {
  const buf = Buffer.alloc(1);
  dwmapi.DwmGetWindowAttribute(
    hwnd,
    DWM_WINDOW_CORNER_PREFERENCE,
    buf,
    4
  );
  console.log(buf.at(0) === 1);
}

if (require.main === module) {
  const actionName = process.argv[2];
  let action = null;

  if (actionName === 'dark') {
    action = setWindowDarkmode;
  } else if (actionName === 'unround') {
    action = runUnround;
  } else if (actionName === 'unround-chk') {
    action = unroundChk;
  } else {
    console.log(`Usage:

To make window titlebar dark:
  node flag dark "part of window title"
To make corners square:
  node flag unround "part of window title"
`);
    return;
  }

  if (process.argv[3] === '-w') {
    const regex = new RegExp(process.argv[4]);
    // const hookProc = ffi.Callback(
    //   intPtr,
    //   ['int', intPtr, intPtr],
    //   (nCode, wParam, lParam) => {
    //     console.log(nCode);
    //     if (nCode == HSHELL_WINDOWCREATED) {
    //       // console.log(wParam);
    //     }
    //     return user32.CallNextHookEx(nCode, wParam, lParam);
    //   }
    // );
    // // 5 = WH_CBT
    // const hook = user32.SetWindowsHookExA(5, hookProc, ref.NULL, 0);
    const proc = ffi.Callback(
      types.void,
      [voidPtr, DWORD, HWND, types.long, types.long, DWORD, DWORD],
      (hook, event, hwnd) => {
        if (regex.test(getWindowName(hwnd))) {
          action(hwnd);
        }
      }
    );
    const EVENT_SYSTEM_FOREGROUND = 0x0003;
    user32.SetWinEventHook(
      EVENT_SYSTEM_FOREGROUND,
      EVENT_SYSTEM_FOREGROUND,
      ref.NULL_POINTER,
      proc,
      0,
      0,
      0
    );

    // start pumpin'
    let bRet;
    const msg = new Msg();
    while ((bRet = user32.GetMessageA(msg.ref(), ref.NULL, 0, 0)) != 0) {
      if (bRet == -1) {
        console.error('GetMessage failed');
        process.exit(1);
      } else {
        TranslateMessage(msg.ref());
        DispatchMessage(msg.ref());
      }
    }
    // user32.UnhookWindowsHookEx(hook);
    // setTimeout(() => {}, 100000);
  } else if (process.argv[3] === '-e') {
    // exact
    const targetWindowName = process.argv[4];
    const win = getWindows().find((x) => x.name === targetWindowName);
    if (!win) {
      console.error('Window not found');
      process.exit(1);
    }
    action(win.hwnd);
  } else {
    // regex
    const regex = new RegExp(process.argv[3]);
    const wins = getWindows().filter((x) => regex.test(x.name));
    wins.forEach((win) => {
      console.log(`applying ${actionName} to window "${win.name}"`);
      action(win.hwnd)
    });
  }
}

// function findHwndFromWindowName(windowName) {
//   const targetWindowName = process.argv[2];
//   const win = getWindows().find((x) => x.name === windowName);
//   return win && win.hwnd;
// }
