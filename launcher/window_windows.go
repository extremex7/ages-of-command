//go:build windows

package main

import (
	"log"
	"syscall"
	"unsafe"

	"github.com/jchv/go-webview2"
)

// nativeWindow shows the game in a window of its own using WebView2, the Edge web engine built
// into Windows 10 and 11. It blocks until the window is closed and returns false, without
// showing anything, when WebView2 is not installed (the caller then falls back to a browser).
func nativeWindow(url, profile, iconPath string) bool {
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath:  profile,
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title: "Ages of Command", Width: 1366, Height: 800, Center: true, IconId: 1,
		},
	})
	if w == nil {
		log.Printf("WebView2 is not available")
		return false
	}
	defer w.Destroy()
	w.SetSize(960, 600, webview2.HintMin)
	hwnd := uintptr(w.Window())
	ws := &winState{}
	setWindowControl(func(mode string, width, height int) {
		w.Dispatch(func() { ws.apply(hwnd, mode, width, height) })
	}, func() { w.Dispatch(w.Terminate) })
	defer setWindowControl(nil, nil)
	w.Navigate(url)
	log.Printf("opened a WebView2 window")
	w.Run()
	return true
}

var (
	user32            = syscall.NewLazyDLL("user32.dll")
	pGetWindowLongPtr = user32.NewProc("GetWindowLongPtrW")
	pSetWindowLongPtr = user32.NewProc("SetWindowLongPtrW")
	pGetWindowRect    = user32.NewProc("GetWindowRect")
	pSetWindowPos     = user32.NewProc("SetWindowPos")
	pShowWindow       = user32.NewProc("ShowWindow")
	pMonitorFromWin   = user32.NewProc("MonitorFromWindow")
	pGetMonitorInfo   = user32.NewProc("GetMonitorInfoW")
	pAdjustWindowRect = user32.NewProc("AdjustWindowRect")
	pIsZoomed         = user32.NewProc("IsZoomed")
)

const (
	gwlStyle         = ^uintptr(15) // -16
	wsOverlappedWin  = 0x00CF0000
	swpNoZOrder      = 0x0004
	swpNoOwnerZOrder = 0x0200
	swpFrameChanged  = 0x0020
	swMaximize       = 3
	swRestore        = 9
	monitorNearest   = 2
)

type rect struct{ Left, Top, Right, Bottom int32 }

type monitorInfo struct {
	Size          uint32
	Monitor, Work rect
	Flags         uint32
}

// winState remembers the window's frame and place while it is full screen.
type winState struct {
	full      bool
	style     uintptr
	saved     rect
	maximized bool
}

func monitorOf(hwnd uintptr) monitorInfo {
	mi := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
	m, _, _ := pMonitorFromWin.Call(hwnd, monitorNearest)
	pGetMonitorInfo.Call(m, uintptr(unsafe.Pointer(&mi)))
	return mi
}

// apply runs on the window's thread (through Dispatch).
func (ws *winState) apply(hwnd uintptr, mode string, width, height int) {
	if mode == "fullscreen" {
		if ws.full {
			return
		}
		ws.style, _, _ = pGetWindowLongPtr.Call(hwnd, gwlStyle)
		z, _, _ := pIsZoomed.Call(hwnd)
		ws.maximized = z != 0
		if ws.maximized {
			pShowWindow.Call(hwnd, swRestore)
		}
		pGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&ws.saved)))
		pSetWindowLongPtr.Call(hwnd, gwlStyle, ws.style&^wsOverlappedWin)
		r := monitorOf(hwnd).Monitor
		pSetWindowPos.Call(hwnd, 0, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top),
			swpNoOwnerZOrder|swpFrameChanged)
		ws.full = true
		return
	}
	if ws.full { // back to a framed window where it was
		pSetWindowLongPtr.Call(hwnd, gwlStyle, ws.style|wsOverlappedWin)
		r := ws.saved
		pSetWindowPos.Call(hwnd, 0, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top),
			swpNoZOrder|swpNoOwnerZOrder|swpFrameChanged)
		ws.full = false
	}
	if mode == "maximized" {
		pShowWindow.Call(hwnd, swMaximize)
		return
	}
	pShowWindow.Call(hwnd, swRestore)
	if width > 0 && height > 0 {
		// the size asked for is the game area; add the frame and centre it on the work area
		r := rect{0, 0, int32(width), int32(height)}
		style, _, _ := pGetWindowLongPtr.Call(hwnd, gwlStyle)
		pAdjustWindowRect.Call(uintptr(unsafe.Pointer(&r)), style, 0)
		w, h := r.Right-r.Left, r.Bottom-r.Top
		wa := monitorOf(hwnd).Work
		if aw := wa.Right - wa.Left; w > aw {
			w = aw
		}
		if ah := wa.Bottom - wa.Top; h > ah {
			h = ah
		}
		x, y := wa.Left+(wa.Right-wa.Left-w)/2, wa.Top+(wa.Bottom-wa.Top-h)/2
		pSetWindowPos.Call(hwnd, 0, uintptr(x), uintptr(y), uintptr(w), uintptr(h), swpNoZOrder|swpNoOwnerZOrder)
	}
}
