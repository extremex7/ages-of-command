//go:build windows

package main

import (
	"log"

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
	w.Navigate(url)
	log.Printf("opened a WebView2 window")
	w.Run()
	return true
}
