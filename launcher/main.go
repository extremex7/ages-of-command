// Ages of Command desktop launcher: a small native program (no runtime to install) that serves
// the game's files from the folder next to it, keeps settings and saves as files in the player's
// data folder, and opens the game in its own window (Edge, Chrome, Chromium or Brave in app
// mode, else the default browser). It exits when the game window is closed.
//
// Build: see launcher/README.md (tools/build_desktop.sh builds every platform and the installer).
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

var version = "dev" // set at build time with -ldflags "-X main.version=..."

const appID = "ages-of-command"
const basePort = 47110 // fixed, so the game's address (and anything the browser keeps for it) stays the same

type server struct {
	gameDir  string
	storeDir string
	mu       sync.Mutex
	lastPing time.Time
	pinged   bool
}

func main() {
	port := flag.Int("port", basePort, "port to serve on (127.0.0.1 only)")
	noWindow := flag.Bool("no-window", false, "only serve; open http://127.0.0.1:<port>/ yourself")
	dataFlag := flag.String("data", "", "folder for settings, saves and logs (default: the user's config folder)")
	flag.Parse()

	// Saves go to -data, else a "userdata" folder next to the program (portable copies), else the
	// user's config folder. The browser profile is a cache and goes to the cache folder by default.
	dataDir, browserDir := *dataFlag, ""
	if dataDir == "" {
		if exe, err := os.Executable(); err == nil {
			if st, err := os.Stat(filepath.Join(filepath.Dir(exe), "userdata")); err == nil && st.IsDir() {
				dataDir = filepath.Join(filepath.Dir(exe), "userdata")
			}
		}
	}
	if dataDir == "" {
		base, err := os.UserConfigDir()
		if err != nil {
			base = "."
		}
		dataDir = filepath.Join(base, "AgesOfCommand")
		if cache, err := os.UserCacheDir(); err == nil {
			browserDir = filepath.Join(cache, "AgesOfCommand", "browser")
		}
	}
	if browserDir == "" {
		browserDir = filepath.Join(dataDir, "browser")
	}
	storeDir := filepath.Join(dataDir, "store")
	if err := os.MkdirAll(storeDir, 0o755); err != nil {
		fatal("Cannot create the data folder %s: %v", dataDir, err)
	}
	if f, err := os.OpenFile(filepath.Join(dataDir, "launcher.log"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644); err == nil {
		log.SetOutput(io.MultiWriter(f, os.Stderr))
	}
	log.Printf("Ages of Command launcher %s (%s/%s)", version, runtime.GOOS, runtime.GOARCH)

	gameDir, err := findGame()
	if err != nil {
		fatal("%v", err)
	}
	log.Printf("game files: %s; data: %s; browser profile: %s", gameDir, dataDir, browserDir)

	s := &server{gameDir: gameDir, storeDir: storeDir}
	ln, url, running := listen(*port)
	if running != "" {
		// already running: just open another window onto it
		log.Printf("already running at %s", running)
		if !*noWindow {
			openWindow(running, browserDir)
		}
		return
	}
	if ln == nil {
		fatal("Could not open a local port between %d and %d.", *port, *port+9)
	}
	log.Printf("serving at %s", url)
	go func() {
		if err := http.Serve(ln, s.routes(ln.Addr().(*net.TCPAddr).Port)); err != nil {
			fatal("Server stopped: %v", err)
		}
	}()
	if *noWindow {
		fmt.Printf("Ages of Command running at %s (Ctrl+C to stop)\n", url)
		select {}
	}
	done := make(chan string, 2)
	go func() {
		if proc := openWindow(url, browserDir); proc != nil {
			proc.Wait()
			// Some browsers hand the window to an already-running process and exit at once, so
			// only quit if the page has also stopped pinging; otherwise the watchdog decides.
			time.Sleep(12 * time.Second)
			s.mu.Lock()
			pinged, last := s.pinged, s.lastPing
			s.mu.Unlock()
			if pinged && time.Since(last) > 11*time.Second {
				done <- "window closed"
			}
		}
	}()
	go s.watchdog(done)
	log.Printf("exiting: %s", <-done)
}

// findGame locates index.html: in ./game next to the program (installed layout), next to the
// program, or in a parent folder (running from a source checkout).
func findGame() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if r, err := filepath.EvalSymlinks(exe); err == nil {
		exe = r
	}
	dir := filepath.Dir(exe)
	cands := []string{filepath.Join(dir, "game"), dir}
	for d := dir; ; d = filepath.Dir(d) {
		cands = append(cands, d)
		if filepath.Dir(d) == d {
			break
		}
	}
	if wd, err := os.Getwd(); err == nil {
		cands = append(cands, wd)
	}
	for _, c := range cands {
		if st, err := os.Stat(filepath.Join(c, "index.html")); err == nil && !st.IsDir() {
			if _, err := os.Stat(filepath.Join(c, "data", "map", "world.json")); err == nil {
				return c, nil
			}
		}
	}
	return "", errors.New("The game files were not found. Reinstall Ages of Command, or keep the 'game' folder next to the program.")
}

// listen takes the first free port from `port`; if one of them already runs this game, returns its address instead.
func listen(port int) (net.Listener, string, string) {
	for p := port; p < port+10; p++ {
		addr := fmt.Sprintf("127.0.0.1:%d", p)
		ln, err := net.Listen("tcp", addr)
		if err == nil {
			return ln, "http://" + addr + "/", ""
		}
		c := http.Client{Timeout: time.Second}
		if r, err := c.Get("http://" + addr + "/api/info"); err == nil {
			var info map[string]string
			json.NewDecoder(r.Body).Decode(&info)
			r.Body.Close()
			if info["app"] == appID {
				return nil, "", "http://" + addr + "/"
			}
		}
	}
	return nil, "", ""
}

func (s *server) routes(port int) http.Handler {
	mux := http.NewServeMux()
	files := http.FileServer(http.Dir(s.gameDir))
	mux.HandleFunc("/api/info", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"app": appID, "version": version, "dataDir": filepath.Dir(s.storeDir)})
	})
	mux.HandleFunc("/api/ping", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		s.lastPing, s.pinged = time.Now(), true
		s.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/api/store", s.storeAll)
	mux.HandleFunc("/api/store/", s.storeOne)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/build/") || strings.HasPrefix(r.URL.Path, "/.git") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})
	// only this machine, only by the game's own address (guards against DNS rebinding)
	allowed := map[string]bool{fmt.Sprintf("127.0.0.1:%d", port): true, fmt.Sprintf("localhost:%d", port): true}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !allowed[r.Host] {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

// Stored files: one per key (settings, slot list, each save), named by the key with anything
// outside [A-Za-z0-9._-] escaped, so a key can never leave the store folder.
func keyFile(key string) (string, bool) {
	if key == "" || len(key) > 200 {
		return "", false
	}
	var b strings.Builder
	for _, c := range []byte(key) {
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_' || (c == '.' && b.Len() > 0) {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "~%02x", c)
		}
	}
	return b.String() + ".dat", true
}

func fileKey(name string) (string, bool) {
	if !strings.HasSuffix(name, ".dat") {
		return "", false
	}
	name = strings.TrimSuffix(name, ".dat")
	var b strings.Builder
	for i := 0; i < len(name); i++ {
		if name[i] == '~' && i+2 < len(name) {
			var v byte
			if _, err := fmt.Sscanf(name[i+1:i+3], "%02x", &v); err != nil {
				return "", false
			}
			b.WriteByte(v)
			i += 2
		} else {
			b.WriteByte(name[i])
		}
	}
	return b.String(), true
}

func (s *server) storeAll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method", http.StatusMethodNotAllowed)
		return
	}
	entries, _ := os.ReadDir(s.storeDir)
	out := map[string]string{}
	names := []string{}
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	for _, n := range names {
		k, ok := fileKey(n)
		if !ok {
			continue
		}
		if b, err := os.ReadFile(filepath.Join(s.storeDir, n)); err == nil {
			out[k] = string(b)
		}
	}
	writeJSON(w, out)
}

func (s *server) storeOne(w http.ResponseWriter, r *http.Request) {
	name, ok := keyFile(strings.TrimPrefix(r.URL.Path, "/api/store/"))
	if !ok {
		http.Error(w, "bad key", http.StatusBadRequest)
		return
	}
	path := filepath.Join(s.storeDir, name)
	switch r.Method {
	case http.MethodPut:
		body, err := io.ReadAll(io.LimitReader(r.Body, 256<<20))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		tmp := path + ".tmp"
		if err := os.WriteFile(tmp, body, 0o644); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := os.Rename(tmp, path); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	case http.MethodDelete:
		os.Remove(path)
		w.WriteHeader(http.StatusNoContent)
	case http.MethodGet:
		http.ServeFile(w, r, path)
	default:
		http.Error(w, "method", http.StatusMethodNotAllowed)
	}
}

// The page pings every 5 s. Once it has, a minute of silence means the game was closed (this also
// covers the default-browser fallback, where the window cannot be watched). If the page never
// loads within 3 minutes, give up.
func (s *server) watchdog(done chan<- string) {
	start := time.Now()
	for range time.Tick(5 * time.Second) {
		s.mu.Lock()
		pinged, last := s.pinged, s.lastPing
		s.mu.Unlock()
		if pinged && time.Since(last) > 60*time.Second {
			done <- "no ping for a minute"
			return
		}
		if !pinged && time.Since(start) > 3*time.Minute {
			done <- "the game never loaded"
			return
		}
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(v)
}

// openWindow starts a Chromium-family browser in app mode with its own profile (so the game gets
// a plain window and its own storage), returning the process to wait on; or opens the default
// browser and returns nil.
func openWindow(url, profile string) *exec.Cmd {
	if b := findBrowser(); b != "" {
		args := []string{"--app=" + url, "--user-data-dir=" + profile, "--no-first-run",
			"--no-default-browser-check", "--disable-features=Translate", "--window-size=1366,800"}
		cmd := exec.Command(b, args...)
		if err := cmd.Start(); err == nil {
			log.Printf("opened %s", b)
			return cmd
		}
		log.Printf("could not start %s", b)
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		// keep serving: the player can still open the address by hand
		log.Printf("could not open a browser: %v", err)
		go showError(fmt.Sprintf("Could not open a web browser. Open %s in your web browser to play.", url))
		return nil
	}
	log.Printf("opened the default browser")
	return nil
}

func findBrowser() string {
	var cands []string
	switch runtime.GOOS {
	case "windows":
		for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
			root := os.Getenv(env)
			if root == "" {
				continue
			}
			cands = append(cands,
				filepath.Join(root, `Microsoft\Edge\Application\msedge.exe`),
				filepath.Join(root, `Google\Chrome\Application\chrome.exe`),
				filepath.Join(root, `BraveSoftware\Brave-Browser\Application\brave.exe`),
				filepath.Join(root, `Chromium\Application\chrome.exe`))
		}
	case "darwin":
		cands = []string{"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"}
	default:
		for _, n := range []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave-browser"} {
			if p, err := exec.LookPath(n); err == nil {
				cands = append(cands, p)
			}
		}
	}
	for _, c := range cands {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

func fatal(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	log.Print(msg)
	showError(msg)
	os.Exit(1)
}
