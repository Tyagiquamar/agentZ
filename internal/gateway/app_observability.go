package gateway

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	ctrlclient "sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/accuknox/agentz/internal/authorization"
	"github.com/accuknox/agentz/internal/gateway/apiutil"
	gatewaydb "github.com/accuknox/agentz/internal/gateway/db"
	gatewayapi "github.com/accuknox/agentz/internal/gateway/openapi"
	agentzv1alpha1 "github.com/accuknox/agentz/pkg/apis/agentz/v1alpha1"
)

type appObservabilityRequest struct {
	resourceAccess
	app  gatewayapi.LensApp
	apps []gatewayapi.LensApp
}

type appTracePageCursor struct {
	StartedAt time.Time `json:"started_at"`
	TraceID   string    `json:"trace_id"`
}

func (s *Service) appObservability(w http.ResponseWriter, r *http.Request, clientID string) (appObservabilityRequest, bool) {
	claims, apiErr := externalWorkspaceClaims(r.Context())
	if apiErr != nil {
		apiutil.WriteError(w, r, apiErr)
		return appObservabilityRequest{}, false
	}
	if claims.WorkspaceID == "" {
		apiutil.WriteError(w, r, resourceForbidden(errors.New("app telemetry requires a selected Workspace")))
		return appObservabilityRequest{}, false
	}
	access, apiErr := s.resolveResourceAccess(r.Context(), resourceAccessRequest{
		resource: "Observability", workspaceID: claims.WorkspaceID,
		operation: authorization.OperationReadObservability,
	})
	if apiErr != nil {
		apiutil.WriteError(w, r, apiErr)
		return appObservabilityRequest{}, false
	}
	req := appObservabilityRequest{resourceAccess: access, apps: []gatewayapi.LensApp{}}
	if clientID != "" {
		row, err := s.queries.GatewayGetLensApp(r.Context(), gatewaydb.GatewayGetLensAppParams{
			OrganizationID: claims.OrganizationID, WorkspaceID: claims.WorkspaceID, ClientID: clientID,
		})
		if err != nil {
			apiutil.WriteError(w, r, mapGatewayStoreError("get app telemetry", err))
			return req, false
		}
		req.app = gatewayapi.LensApp{ClientId: row.ClientID, Name: row.Name}
		return req, true
	}
	rows, err := s.queries.GatewayListLensApps(r.Context(), gatewaydb.GatewayListLensAppsParams{
		OrganizationID: claims.OrganizationID, WorkspaceID: claims.WorkspaceID,
	})
	if err != nil {
		apiutil.WriteInternalError(w, r, err)
		return req, false
	}
	for _, row := range rows {
		req.apps = append(req.apps, gatewayapi.LensApp{ClientId: row.ClientID, Name: row.Name})
	}
	return req, true
}

// ListLensApps lists apps with approved selections or telemetry in the active Workspace.
func (s *Service) ListLensApps(w http.ResponseWriter, r *http.Request) {
	req, ok := s.appObservability(w, r, "")
	if !ok {
		return
	}
	apiutil.WriteJSON(w, http.StatusOK, gatewayapi.ListLensAppsResponse{Apps: req.apps})
}

// ListAppTraces lists scoped app traces without requiring a runtime session.
func (s *Service) ListAppTraces(w http.ResponseWriter, r *http.Request, clientID string, params gatewayapi.ListAppTracesParams) {
	req, ok := s.appObservability(w, r, clientID)
	if !ok {
		return
	}
	limit, ok := validLimit(w, r, params.Limit)
	if !ok {
		return
	}
	cursor, set, ok := decodeCursorPageToken[appTracePageCursor](w, r, params.PageToken)
	if !ok {
		return
	}
	if set && (cursor.StartedAt.IsZero() || cursor.TraceID == "") {
		writeInvalidPageToken(w, r, errBadRequest)
		return
	}
	traceID, ok := decodeOptionalTraceCursor(w, r, cursor.TraceID, set)
	if !ok {
		return
	}
	after, before := time.Unix(0, 0).UTC(), time.Date(9999, 12, 31, 23, 59, 59, 0, time.UTC)
	if params.StartedAfter != nil {
		after = params.StartedAfter.UTC()
	}
	if params.StartedBefore != nil {
		before = params.StartedBefore.UTC()
	}
	if after.After(before) {
		apiutil.WriteError(w, r, apiutil.NewError(http.StatusBadRequest, "invalid_request", "started_after must not exceed started_before", errBadRequest))
		return
	}
	rows, err := s.queries.GatewayListAppTraces(r.Context(), gatewaydb.GatewayListAppTracesParams{
		OrganizationID: req.claims.OrganizationID, WorkspaceID: req.workspaceID, ClientID: clientID,
		StartedAfter: after, StartedBefore: before, PageSize: int32(limit + 1),
		CursorSet: set, CursorStartedAt: cursor.StartedAt, CursorTraceID: traceID,
	})
	if err != nil {
		apiutil.WriteInternalError(w, r, err)
		return
	}
	items := make([]gatewayapi.AppTrace, 0, limit)
	var next string
	for index, row := range rows {
		if index == limit {
			last := rows[index-1]
			next = encodeCursorPageToken(appTracePageCursor{
				StartedAt: last.StartedAt,
				TraceID:   hex.EncodeToString(last.TraceID),
			})
			break
		}
		item := gatewayapi.AppTrace{
			TraceId: hex.EncodeToString(row.TraceID), RootSpanId: hex.EncodeToString(row.RootSpanID),
			StartedAt: row.StartedAt, EndedAt: row.EndedAt, UpdatedAt: row.UpdatedAt,
			DurationNs: row.DurationNs, DurationMs: float64(row.DurationNs) / float64(time.Millisecond),
			SpanCount: row.SpanCount, ErrorCount: row.ErrorCount, ToolCount: row.ToolCount,
			ModelCount: row.ModelCount, StatusCode: row.StatusCode,
		}
		if row.InputTokensKnown.Bool {
			item.InputTokens = &row.InputTokens
		}
		if row.OutputTokensKnown.Bool {
			item.OutputTokens = &row.OutputTokens
		}
		if row.CachedInputTokensKnown.Bool {
			item.CachedInputTokens = &row.CachedInputTokens
		}
		if row.CachedWriteTokensKnown.Bool {
			item.CachedWriteTokens = &row.CachedWriteTokens
		}
		if row.CostUsdKnown.Bool {
			item.CostUsd = &row.CostUsd
		}
		items = append(items, item)
	}
	apiutil.WriteJSON(w, http.StatusOK, gatewayapi.ListAppTracesResponse{Traces: items, NextPageToken: next})
}

// GetAppTraceChart aggregates the complete requested range independently of pagination.
func (s *Service) GetAppTraceChart(w http.ResponseWriter, r *http.Request, clientID string, params gatewayapi.GetAppTraceChartParams) {
	req, ok := s.appObservability(w, r, clientID)
	if !ok {
		return
	}
	after, before := time.Unix(0, 0).UTC(), time.Date(9999, 12, 31, 23, 59, 59, 0, time.UTC)
	if params.StartedAfter != nil {
		after = params.StartedAfter.UTC()
	}
	if params.StartedBefore != nil {
		before = params.StartedBefore.UTC()
	}
	if after.After(before) {
		apiutil.WriteError(w, r, apiutil.NewError(http.StatusBadRequest, "invalid_request", "started_after must not exceed started_before", errBadRequest))
		return
	}
	rows, err := s.queries.GatewayGetAppTraceChart(r.Context(), gatewaydb.GatewayGetAppTraceChartParams{
		OrganizationID: req.claims.OrganizationID, WorkspaceID: req.workspaceID, ClientID: clientID,
		StartedAfter: after, StartedBefore: before,
	})
	if err != nil {
		apiutil.WriteInternalError(w, r, err)
		return
	}
	points := make([]gatewayapi.AppTraceChartPoint, 0, len(rows))
	for _, row := range rows {
		points = append(points, gatewayapi.AppTraceChartPoint{Time: row.Time, Count: row.Count})
	}
	apiutil.WriteJSON(w, http.StatusOK, gatewayapi.AppTraceChartResponse{Points: points})
}

// ListAppSpans lists operation metadata within the authenticated app and Workspace.
func (s *Service) ListAppSpans(w http.ResponseWriter, r *http.Request, clientID string, traceID gatewayapi.TraceID, params gatewayapi.ListAppSpansParams) {
	req, ok := s.appObservability(w, r, clientID)
	if !ok {
		return
	}
	limit, ok := validLimit(w, r, params.Limit)
	if !ok {
		return
	}
	trace, ok := validTraceID(w, r, traceID)
	if !ok {
		return
	}
	cursor, set, ok := decodeSpanPageToken(w, r, params.PageToken)
	if !ok {
		return
	}
	rows, err := s.queries.GatewayListAppSpans(r.Context(), gatewaydb.GatewayListAppSpansParams{
		OrganizationID: req.claims.OrganizationID, WorkspaceID: req.workspaceID, ClientID: clientID,
		TraceID: trace, CursorSet: set, CursorStartTime: cursor.StartTime, CursorID: cursor.ID, PageSize: int32(limit + 1),
	})
	if err != nil {
		apiutil.WriteInternalError(w, r, err)
		return
	}
	spans := make([]gatewayapi.AppSpan, 0, limit)
	var next string
	for index, row := range rows {
		if index == limit {
			last := rows[index-1].ObserverAppOperation
			next = encodeCursorPageToken(spanPageCursor{StartTime: last.StartTime, ID: last.ID})
			break
		}
		spans = append(spans, appSpan(row.ObserverAppOperation))
	}
	apiutil.WriteJSON(w, http.StatusOK, gatewayapi.ListAppSpansResponse{Spans: spans, NextPageToken: next})
}

// GetAppOperation retrieves one operation and its payload using the complete viewer scope.
func (s *Service) GetAppOperation(w http.ResponseWriter, r *http.Request, clientID string, operationID int64) {
	req, ok := s.appObservability(w, r, clientID)
	if !ok {
		return
	}
	row, err := s.queries.GatewayGetAppOperation(r.Context(), gatewaydb.GatewayGetAppOperationParams{
		OrganizationID: req.claims.OrganizationID, WorkspaceID: req.workspaceID, ClientID: clientID, OperationID: operationID,
	})
	if err != nil {
		apiutil.WriteError(w, r, mapGatewayStoreError("get app operation", err))
		return
	}
	op, payload := row.ObserverAppOperation, row.ObserverAppOperationPayload
	result := gatewayapi.AppOperationResponse{Span: appSpan(op)}
	for target, raw := range map[*string][]byte{
		&result.ResourceAttributes:     op.ResourceAttributes,
		&result.SpanAttributes:         op.SpanAttributes,
		&result.Payload.InputMessages:  payload.InputMessages,
		&result.Payload.OutputMessages: payload.OutputMessages,
		&result.Payload.ToolArguments:  payload.ToolArguments,
		&result.Payload.ToolResult:     payload.ToolResult,
		&result.ToolError:              payload.ToolError,
	} {
		var formatted bytes.Buffer
		if err := json.Indent(&formatted, raw, "", "  "); err != nil {
			apiutil.WriteInternalError(w, r, err)
			return
		}
		*target = formatted.String()
	}
	apiutil.WriteJSON(w, http.StatusOK, result)
}

func appSpan(row gatewaydb.ObserverAppOperation) gatewayapi.AppSpan {
	span := gatewayapi.AppSpan{
		Id: row.ID, TraceId: hex.EncodeToString(row.TraceID), SpanId: hex.EncodeToString(row.SpanID),
		ParentSpanId: hex.EncodeToString(row.ParentSpanID), StartTime: row.StartTime, EndTime: row.EndTime,
		IngestedAt: row.IngestedAt, DurationNs: row.DurationNs, DurationMs: float64(row.DurationNs) / float64(time.Millisecond),
		Name: row.Name, SpanClass: row.SpanClass, OperationName: row.OperationName, Kind: "SERVER",
		StatusCode: row.StatusCode, ErrorType: row.ErrorType, ErrorMessage: row.ErrorMessage,
		Model: row.Model, ToolName: row.ToolName, SessionId: row.SessionID,
		GrantId: row.GrantID, UserId: row.UserID, ResourceKind: row.ResourceKind,
		ResourceNamespace: row.ResourceNamespace, ResourceName: row.ResourceName, ResourceUid: row.ResourceUid, TargetId: row.TargetID,
	}
	if row.InputTokens.Valid {
		span.InputTokens = &row.InputTokens.Int64
	}
	if row.OutputTokens.Valid {
		span.OutputTokens = &row.OutputTokens.Int64
	}
	if row.ReasoningTokens.Valid {
		span.ReasoningTokens = &row.ReasoningTokens.Int64
	}
	if row.CachedInputTokens.Valid {
		span.CachedInputTokens = &row.CachedInputTokens.Int64
	}
	if row.CachedWriteTokens.Valid {
		span.CachedWriteTokens = &row.CachedWriteTokens.Int64
	}
	if row.CostUsd.Valid {
		span.CostUsd = &row.CostUsd.Float64
	}
	return span
}

// GetAppMCPGraph counts actual native tool executions within the selected Workspace.
func (s *Service) GetAppMCPGraph(w http.ResponseWriter, r *http.Request, clientID string, params gatewayapi.GetAppMCPGraphParams) {
	req, ok := s.appObservability(w, r, clientID)
	if !ok {
		return
	}
	after, before := params.From.UTC(), params.To.Time.UTC().Add(24*time.Hour)
	if !after.Before(before) {
		apiutil.WriteError(w, r, apiutil.NewError(http.StatusBadRequest, "invalid_request", "from must not exceed to", errBadRequest))
		return
	}
	rows, err := s.queries.GatewayGetAppMCPGraph(r.Context(), gatewaydb.GatewayGetAppMCPGraphParams{
		OrganizationID: req.claims.OrganizationID, WorkspaceID: req.workspaceID, ClientID: clientID,
		StartTimeAfter: after, StartTimeBefore: before,
	})
	if err != nil {
		apiutil.WriteInternalError(w, r, err)
		return
	}
	graph := gatewayapi.AppMCPGraphResponse{
		App: req.app, Connections: []gatewayapi.MCPGraphConnection{}, Tools: []gatewayapi.MCPGraphTool{}, Edges: []gatewayapi.MCPGraphEdge{},
	}
	connections := map[string]bool{}
	for _, row := range rows {
		connectionID := "connection:" + row.ResourceUid
		if !connections[connectionID] {
			connection := gatewayapi.MCPGraphConnection{Id: connectionID, Name: row.ResourceName}
			object := &agentzv1alpha1.MCPConnection{}
			err := s.k8sClient.Get(r.Context(), ctrlclient.ObjectKey{Namespace: row.ResourceNamespace, Name: row.ResourceName}, object)
			if err != nil && !apierrors.IsNotFound(err) {
				apiutil.WriteInternalError(w, r, err)
				return
			}
			if err == nil && string(object.UID) == row.ResourceUid {
				connection.ServerUrl = &object.Spec.Endpoint.URL
			}
			graph.Connections = append(graph.Connections, connection)
			graph.Edges = append(graph.Edges, gatewayapi.MCPGraphEdge{
				Source: "app:" + clientID,
				Target: connectionID,
				Kind:   gatewayapi.AppConnection,
			})
			connections[connectionID] = true
		}
		toolID := connectionID + ":tool:" + row.ToolName
		graph.Tools = append(graph.Tools, gatewayapi.MCPGraphTool{
			Id:           toolID,
			ConnectionId: connectionID,
			Name:         row.ToolName,
		})
		graph.Edges = append(graph.Edges, gatewayapi.MCPGraphEdge{
			Source: connectionID, Target: toolID, Kind: gatewayapi.ConnectionTool,
			AvgLatencyMs: &row.AvgLatencyMs, SuccessCount: &row.SuccessCount, FailedCount: &row.FailedCount, LastCalledAt: &row.LastCalledAt,
		})
	}
	apiutil.WriteJSON(w, http.StatusOK, graph)
}
