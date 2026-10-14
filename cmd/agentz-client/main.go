// Command agentz-client builds the desktop AgentZ launcher as the agentz binary.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/urfave/cli/v3"

	"github.com/accuknox/agentz/internal/launcher"
)

var version = "dev"

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM)
	defer cancel()
	// The foreground agent handles Ctrl+C itself, including turn cancellation.
	interrupts := make(chan os.Signal, 1)
	signal.Notify(interrupts, os.Interrupt)
	defer signal.Stop(interrupts)
	command := &cli.Command{
		Name: "agentz", Version: version,
		Usage: "Launch coding agents with AgentZ identity and governed inference",
		Flags: []cli.Flag{&cli.StringFlag{Name: "config", Usage: "AgentZ configuration file"}},
		Commands: []*cli.Command{
			{
				Name: "launch", Usage: "Launch Claude or Codex with native flags",
				SkipFlagParsing: true, Action: launcher.Run,
			},
			{
				Name:            "login",
				Usage:           "Start a fresh native Codex gateway login",
				SkipFlagParsing: true,
				Action:          launcher.Run,
			},
			{
				Name: "relay", Usage: "Manage the local AgentZ relay",
				Commands: []*cli.Command{
					{Name: "serve", Hidden: true, Action: launcher.Run},
					{Name: "status", Action: launcher.Run},
					{Name: "stop", Action: launcher.Run},
				},
			},
		},
	}
	if err := command.Run(ctx, os.Args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		code := 1
		var exit cli.ExitCoder
		if errors.As(err, &exit) {
			code = exit.ExitCode()
		}
		os.Exit(code)
	}
}
