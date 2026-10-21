//go:build !windows && !(linux && cgo)

package main

// nativeWindow is not available on this platform (macOS, or Linux built without cgo): the
// launcher uses a browser window instead.
func nativeWindow(url, profile, iconPath string, o winOpts) bool { return false }
