//go:build darwin || linux

package launcher

import (
	"os/exec"
	"syscall"
)

func startRelay(child *exec.Cmd) error {
	// A new session keeps the relay alive when the launching terminal closes.
	child.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	return child.Start()
}
