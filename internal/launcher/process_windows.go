package launcher

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

func startRelay(child *exec.Cmd) error {
	// Detach from the console so closing it does not terminate the relay.
	child.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: windows.DETACHED_PROCESS | windows.CREATE_NEW_PROCESS_GROUP,
	}
	return child.Start()
}
