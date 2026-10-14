//go:build darwin || linux

package launcher

import (
	"os/exec"
	"syscall"
)

func startRelay(child *exec.Cmd) error {
	// A new session keeps the relay alive when the launching terminal closes.
	child.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := child.Start(); err != nil {
		return err
	}
	return child.Process.Release()
}
