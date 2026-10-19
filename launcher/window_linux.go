//go:build linux && cgo

package main

/*
#cgo LDFLAGS: -ldl
#include <dlfcn.h>
#include <stddef.h>
#include <stdlib.h>

// GTK 3 and WebKitGTK are loaded at run time, so the program still starts (and falls back to a
// browser) on systems without them, and the build needs no development headers.
typedef void *(*fn_ptr)();
static void *sym(const char *name) { return dlsym(RTLD_DEFAULT, name); }

// Window mode changes come from the HTTP server's goroutines; g_idle_add runs them on the GTK
// thread. Modes: 0 windowed, 1 maximised, 2 full screen.
static void *aoc_win;
static int aoc_mode, aoc_w, aoc_h;
static int aoc_apply(void *unused) {
	void (*fs)(void *) = (void (*)(void *))sym("gtk_window_fullscreen");
	void (*unfs)(void *) = (void (*)(void *))sym("gtk_window_unfullscreen");
	void (*max)(void *) = (void (*)(void *))sym("gtk_window_maximize");
	void (*unmax)(void *) = (void (*)(void *))sym("gtk_window_unmaximize");
	void (*resize)(void *, int, int) = (void (*)(void *, int, int))sym("gtk_window_resize");
	if (!aoc_win) return 0;
	if (aoc_mode == 2) { fs(aoc_win); return 0; }
	unfs(aoc_win);
	if (aoc_mode == 1) { max(aoc_win); return 0; }
	unmax(aoc_win);
	if (aoc_w > 0 && aoc_h > 0) resize(aoc_win, aoc_w, aoc_h);
	return 0;
}
static void aoc_set_window(int mode, int w, int h) {
	unsigned (*idle_add)(int (*)(void *), void *) = (unsigned (*)(int (*)(void *), void *))sym("g_idle_add");
	if (!aoc_win || !idle_add) return;
	aoc_mode = mode; aoc_w = w; aoc_h = h;
	idle_add(aoc_apply, NULL);
}

static int aoc_window(const char *url, const char *title, const char *icon) {
	if (!dlopen("libgtk-3.so.0", RTLD_NOW | RTLD_GLOBAL)) return 0;
	if (!dlopen("libwebkit2gtk-4.1.so.0", RTLD_NOW | RTLD_GLOBAL) &&
	    !dlopen("libwebkit2gtk-4.0.so.37", RTLD_NOW | RTLD_GLOBAL)) return 0;
	int (*gtk_init_check)(int *, char ***) = (int (*)(int *, char ***))sym("gtk_init_check");
	void *(*gtk_window_new)(int) = (void *(*)(int))sym("gtk_window_new");
	void (*set_title)(void *, const char *) = (void (*)(void *, const char *))sym("gtk_window_set_title");
	void (*set_size)(void *, int, int) = (void (*)(void *, int, int))sym("gtk_window_set_default_size");
	int (*set_icon)(void *, const char *, void *) = (int (*)(void *, const char *, void *))sym("gtk_window_set_icon_from_file");
	void *(*web_view_new)(void) = (void *(*)(void))sym("webkit_web_view_new");
	void (*container_add)(void *, void *) = (void (*)(void *, void *))sym("gtk_container_add");
	unsigned long (*connect)(void *, const char *, void *, void *, void *, int) =
		(unsigned long (*)(void *, const char *, void *, void *, void *, int))sym("g_signal_connect_data");
	void (*load_uri)(void *, const char *) = (void (*)(void *, const char *))sym("webkit_web_view_load_uri");
	void (*show_all)(void *) = (void (*)(void *))sym("gtk_widget_show_all");
	void (*grab_focus)(void *) = (void (*)(void *))sym("gtk_widget_grab_focus");
	void (*gtk_main)(void) = (void (*)(void))sym("gtk_main");
	void *gtk_main_quit = sym("gtk_main_quit");
	if (!gtk_init_check || !gtk_window_new || !web_view_new || !connect || !load_uri || !gtk_main || !gtk_main_quit) return 0;
	if (!gtk_init_check(NULL, NULL)) return 0; // no display
	void *win = gtk_window_new(0);
	set_title(win, title);
	set_size(win, 1366, 800);
	if (icon && icon[0]) set_icon(win, icon, NULL);
	void *view = web_view_new();
	container_add(win, view);
	connect(win, "destroy", gtk_main_quit, NULL, NULL, 0);
	load_uri(view, url);
	show_all(win);
	grab_focus(view);
	aoc_win = win;
	gtk_main();
	aoc_win = NULL;
	return 1;
}
*/
import "C"

import (
	"log"
	"unsafe"
)

// nativeWindow shows the game in a GTK window with WebKitGTK, blocking until it is closed.
// Returns false, without showing anything, when GTK, WebKitGTK or a display is missing.
func nativeWindow(url, profile, iconPath string) bool {
	cu, ct, ci := C.CString(url), C.CString("Ages of Command"), C.CString(iconPath)
	defer C.free(unsafe.Pointer(cu))
	defer C.free(unsafe.Pointer(ct))
	defer C.free(unsafe.Pointer(ci))
	setWindowControl(func(mode string, width, height int) {
		m := map[string]C.int{"windowed": 0, "maximized": 1, "fullscreen": 2}[mode]
		C.aoc_set_window(m, C.int(width), C.int(height))
	})
	defer setWindowControl(nil)
	log.Printf("opening a WebKitGTK window")
	if C.aoc_window(cu, ct, ci) == 0 {
		setWindowControl(nil)
		log.Printf("GTK or WebKitGTK is not available")
		return false
	}
	return true
}
