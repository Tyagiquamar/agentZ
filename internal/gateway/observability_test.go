package gateway

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	agentzv1alpha1 "github.com/accuknox/agentz/pkg/apis/agentz/v1alpha1"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"

	gatewaydb "github.com/accuknox/agentz/internal/gateway/db"
	gatewayapi "github.com/accuknox/agentz/internal/gateway/openapi"
	listersv1alpha1 "github.com/accuknox/agentz/pkg/controller/listers/agentz/v1alpha1"
)

type mcpPrivacyQueries struct {
	*sandboxQueries
	graphSessions []string
}

type mcpPrivacyCase struct {
	name          string
	workspaceType gatewaydb.WorkspaceType
	query         string
	status        int
	tool          string
}

func (q *mcpPrivacyQueries) GatewayListAgentRelationships(context.Context, gatewaydb.GatewayListAgentRelationshipsParams) ([]gatewaydb.GatewayListAgentRelationshipsRow, error) {
	return []gatewaydb.GatewayListAgentRelationshipsRow{{
		AgentName: "agent", OwnerUserID: "other-user",
		Capability: gatewaydb.NullAgentShareCapability{
			AgentShareCapability: gatewaydb.AgentShareCapabilityUseShared, Valid: true,
		},
	}}, nil
}

func (q *mcpPrivacyQueries) GatewayAgentExists(context.Context, gatewaydb.GatewayAgentExistsParams) (bool, error) {
	return true, nil
}

func (q *mcpPrivacyQueries) GatewayResolveCodingSession(_ context.Context, arg gatewaydb.GatewayResolveCodingSessionParams) (gatewaydb.GatewayResolveCodingSessionRow, error) {
	if arg.OwnerID == testUserID && arg.SessionID == "owned-session" {
		return gatewaydb.GatewayResolveCodingSessionRow{}, nil
	}
	return gatewaydb.GatewayResolveCodingSessionRow{}, pgx.ErrNoRows
}

func (q *mcpPrivacyQueries) GatewayGetMCPGraph(_ context.Context, arg gatewaydb.GatewayGetMCPGraphParams) ([]gatewaydb.GatewayGetMCPGraphRow, error) {
	q.graphSessions = append(q.graphSessions, arg.SessionID)
	tool := "other-users-private-tool"
	if arg.SessionID == "owned-session" {
		tool = "owned-tool"
	}
	return []gatewaydb.GatewayGetMCPGraphRow{{
		AgentName: "agent", McpConnectionName: "mcp", ToolName: tool,
		SuccessCount: 3, AvgLatencyMs: 42, LastCalledAt: time.Now(),
	}}, nil
}

func TestMCPGraphCodingPrivacy(t *testing.T) {
	upstream := httptest.NewServer(http.NotFoundHandler())
	defer upstream.Close()
	cases := []mcpPrivacyCase{
		{
			name:          "coding without owned conversations",
			workspaceType: gatewaydb.WorkspaceTypeCoding,
			status:        http.StatusForbidden,
		},
		{
			name:          "coding empty session",
			workspaceType: gatewaydb.WorkspaceTypeCoding,
			query:         "&session_id=",
			status:        http.StatusForbidden,
		},
		{
			name:          "coding whitespace session",
			workspaceType: gatewaydb.WorkspaceTypeCoding,
			query:         "&session_id=%20",
			status:        http.StatusForbidden,
		},
		{
			name:          "coding another users session",
			workspaceType: gatewaydb.WorkspaceTypeCoding,
			query:         "&session_id=private-session",
			status:        http.StatusNotFound,
		},
		{
			name:          "coding owned session",
			workspaceType: gatewaydb.WorkspaceTypeCoding,
			query:         "&session_id=owned-session",
			status:        http.StatusOK,
			tool:          "owned-tool",
		},
		{
			name:          "shared workspace aggregate",
			workspaceType: gatewaydb.WorkspaceTypeGeneral,
			status:        http.StatusOK,
			tool:          "other-users-private-tool",
		},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			permissions := make([]gatewaydb.GatewayResolvePermissionsRow, 0, 2)
			grants := map[gatewaydb.PermissionResource]gatewaydb.PermissionAction{
				gatewaydb.PermissionResourceAgent:         gatewaydb.PermissionActionUseShared,
				gatewaydb.PermissionResourceObservability: gatewaydb.PermissionActionRead,
			}
			for resource, action := range grants {
				permissions = append(permissions, gatewaydb.GatewayResolvePermissionsRow{
					Active:      true,
					WorkspaceID: pgtype.Text{String: testWorkspaceID, Valid: true},
					Resource:    gatewaydb.NullPermissionResource{PermissionResource: resource, Valid: true},
					Action:      gatewaydb.NullPermissionAction{PermissionAction: action, Valid: true},
				})
			}
			queries := &mcpPrivacyQueries{sandboxQueries: &sandboxQueries{
				permissions: permissions,
				workspace: gatewaydb.Workspace{
					ID: testWorkspaceID, OrganizationID: testOrganizationID, Namespace: testWorkspaceNS,
					State: gatewaydb.WorkspaceStateReady, Type: tt.workspaceType,
				},
			}}
			svc := sandboxTestService(t, queries)
			index := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
			agent := &agentzv1alpha1.Agent{
				ObjectMeta: metav1.ObjectMeta{Name: "agent", Namespace: testWorkspaceNS},
			}
			if err := index.Add(agent); err != nil {
				t.Fatal(err)
			}
			svc.resolver = &resolver{
				targetOverride: upstream.URL, agents: listersv1alpha1.NewAgentLister(index),
				mcpConnections: listersv1alpha1.NewMCPConnectionLister(
					cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc}),
				),
			}
			svc.outboundHTTP = upstream.Client()
			router := chi.NewRouter()
			gatewayapi.HandlerWithOptions(svc, gatewayapi.ChiServerOptions{
				BaseRouter: router, Middlewares: []gatewayapi.MiddlewareFunc{sandboxTestAuth},
			})
			req := httptest.NewRequest(http.MethodGet, "/api/lens/agent/mcp/graph?from=2026-10-01&to=2026-10-16"+tt.query, nil)
			req.Header.Set("X-AgentZ-Workspace-ID", testWorkspaceID)
			res := httptest.NewRecorder()
			router.ServeHTTP(res, req)
			if res.Code != tt.status {
				t.Fatalf("status=%d want=%d body=%s", res.Code, tt.status, res.Body.String())
			}
			if tt.status != http.StatusOK {
				if len(queries.graphSessions) != 0 || strings.Contains(res.Body.String(), "private-tool") {
					t.Fatal("unauthorized request read private MCP activity")
				}
				return
			}
			if !strings.Contains(res.Body.String(), tt.tool) {
				t.Fatalf("missing authorized MCP tool: %s", res.Body.String())
			}
			scoped := len(queries.graphSessions) == 1 && queries.graphSessions[0] == "owned-session"
			if tt.workspaceType == gatewaydb.WorkspaceTypeCoding && !scoped {
				t.Fatal("coding activity was not scoped to owned conversation")
			}
		})
	}
}
