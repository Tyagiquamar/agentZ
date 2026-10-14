// Command claude-poc-upstream restores the existing manual-test MCP endpoint.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type echoInput struct {
	Message string `json:"message" jsonschema:"Text to echo"`
}

func main() {
	addr := flag.String("addr", ":19320", "Listen address")
	cert := flag.String("cert", "", "Existing manual-test TLS certificate")
	key := flag.String("key", "", "Existing manual-test TLS private key")
	flag.Parse()
	if *cert == "" || *key == "" || os.Getenv("POC_MCP_BEARER") == "" {
		slog.Error("cert, key and POC_MCP_BEARER are required")
		os.Exit(1)
	}
	server := mcp.NewServer(&mcp.Implementation{Name: "agentz-claude-poc", Version: "0.1.0"}, nil)
	mcp.AddTool(server, &mcp.Tool{Name: "echo", Description: "Echo text to verify AgentZ MCP delegation"},
		func(_ context.Context, _ *mcp.CallToolRequest, input echoInput) (*mcp.CallToolResult, any, error) {
			return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "AgentZ MCP: " + input.Message}}}, nil, nil
		})
	mcp.AddTool(server, &mcp.Tool{Name: "private_echo", Description: "Second tool for permission-denial testing"},
		func(_ context.Context, _ *mcp.CallToolRequest, input echoInput) (*mcp.CallToolResult, any, error) {
			return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: input.Message}}}, nil, nil
		})
	server.AddPrompt(&mcp.Prompt{Name: "poc_greeting", Description: "PoC delegated prompt"},
		func(context.Context, *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
			return &mcp.GetPromptResult{Messages: []*mcp.PromptMessage{{Role: "user", Content: &mcp.TextContent{Text: "Verify AgentZ delegated prompt access."}}}}, nil
		})
	server.AddResource(&mcp.Resource{URI: "agentz-poc://status", Name: "poc_status", MIMEType: "text/plain"},
		func(_ context.Context, request *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
			return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: request.Params.URI, MIMEType: "text/plain", Text: "AgentZ delegated resource is available."}}}, nil
		})
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, nil)
	mux := http.NewServeMux()
	for _, path := range []string{"/org/mcp", "/a/mcp", "/b/mcp", "/foreign/mcp"} {
		mux.Handle(path, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer "+os.Getenv("POC_MCP_BEARER") {
				http.Error(w, "invalid upstream credential", http.StatusUnauthorized)
				return
			}
			handler.ServeHTTP(w, r)
		}))
	}
	httpServer := &http.Server{Addr: *addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			slog.Error("stop MCP upstream", "error", err)
		}
	}()
	fmt.Println("PoC MCP upstream listening on", *addr)
	if err := httpServer.ListenAndServeTLS(*cert, *key); err != nil && err != http.ErrServerClosed {
		slog.Error("serve MCP upstream", "error", err)
		os.Exit(1)
	}
}
