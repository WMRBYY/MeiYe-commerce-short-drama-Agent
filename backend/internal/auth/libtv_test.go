package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"yingce/backend/internal/kernel"
)

func TestParseLibTVDetailResponseReturnsPublicErrors(t *testing.T) {
	cases := []struct {
		name       string
		statusCode int
		body       string
		wantStatus int
		wantText   string
	}{
		{name: "token rejected", statusCode: http.StatusOK, body: `{"code":10001,"data":null,"msg":"用户未授权"}`, wantStatus: http.StatusBadGateway, wantText: "Token 无效或已过期"},
		{name: "business error", statusCode: http.StatusOK, body: `{"code":20003,"data":null,"msg":"项目不存在"}`, wantStatus: http.StatusBadGateway, wantText: "项目不存在（code 20003）"},
		{name: "http status", statusCode: http.StatusServiceUnavailable, body: `busy`, wantStatus: http.StatusBadGateway, wantText: "HTTP 503"},
		{name: "non json body", statusCode: http.StatusOK, body: `<html>blocked</html>`, wantStatus: http.StatusBadGateway, wantText: "响应格式无效"},
		{name: "missing data", statusCode: http.StatusOK, body: `{"code":0,"data":null,"msg":"ok"}`, wantStatus: http.StatusBadGateway, wantText: "未返回画布数据"},
		{name: "copy disabled", statusCode: http.StatusOK, body: `{"code":0,"data":{"projectMeta":{"effective":{"canRead":true,"canCopy":false}}}}`, wantStatus: http.StatusForbidden, wantText: "不允许复制"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := parseLibTVDetailResponse("a414ada71bf544299bdc64bc656dda44", tc.statusCode, []byte(tc.body))
			assertLibTVAppError(t, err, tc.wantStatus, tc.wantText)
		})
	}
}

func TestParseLibTVDetailResponseAcceptsCopyableCanvas(t *testing.T) {
	body := `{"code":0,"data":{"projectMeta":{"name":"测试画布","effective":{"canRead":true,"canCopy":true}},"nodeList":[],"connectionList":[]}}`
	detail, err := parseLibTVDetailResponse("a414ada71bf544299bdc64bc656dda44", http.StatusOK, []byte(body))
	if err != nil {
		t.Fatalf("parseLibTVDetailResponse() error = %v", err)
	}
	if detail.ProjectMeta.UUID != "a414ada71bf544299bdc64bc656dda44" || detail.ProjectMeta.Name != "测试画布" {
		t.Fatalf("project meta = %#v", detail.ProjectMeta)
	}
}

type libTVTimeoutError struct{}

func (libTVTimeoutError) Error() string   { return "i/o timeout" }
func (libTVTimeoutError) Timeout() bool   { return true }
func (libTVTimeoutError) Temporary() bool { return true }

func TestLibTVTransportErrorKeepsCauseOutOfMessage(t *testing.T) {
	timeout := &url.Error{Op: "Get", URL: libTVDetailURL, Err: libTVTimeoutError{}}
	assertLibTVAppError(t, libTVTransportError(timeout, "LibTV 请求失败"), http.StatusGatewayTimeout, "超时")

	redirect := &url.Error{Op: "Get", URL: libTVDetailURL, Err: errLibTVRedirect}
	assertLibTVAppError(t, libTVTransportError(redirect, "LibTV 请求失败"), http.StatusBadGateway, "重定向")

	refused := &url.Error{Op: "Get", URL: libTVDetailURL, Err: errors.New("connection refused")}
	err := libTVTransportError(refused, "LibTV 请求失败")
	assertLibTVAppError(t, err, http.StatusBadGateway, "LibTV 请求失败")
	if strings.Contains(err.Error(), "connection refused") || !errors.Is(err, refused) {
		t.Fatalf("transport error must hide the cause in its message but keep it in the chain: %v", err)
	}

	dnsFailure := kernel.NewAppError(http.StatusBadGateway, "外部服务域名解析失败，请检查渠道域名和后端 DNS 配置")
	dnsFailure.Reason = kernel.ReasonUpstreamDNSFailed
	if got := libTVTransportError(&url.Error{Op: "Get", URL: libTVDetailURL, Err: dnsFailure}, "LibTV 请求失败"); got != error(dnsFailure) {
		t.Fatalf("dial-layer AppError must be returned as is, got %v", got)
	}
}

func assertLibTVAppError(t *testing.T, err error, wantStatus int, wantText string) {
	t.Helper()
	var appErr *kernel.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error = %T %v, want *kernel.AppError", err, err)
	}
	if appErr.Status != wantStatus || !strings.Contains(appErr.Message, wantText) {
		t.Fatalf("error = (%d, %q), want (%d, contains %q)", appErr.Status, appErr.Message, wantStatus, wantText)
	}
}

func TestAdaptLibTVDetailSelectsFirstMediaAndReportsPartialImport(t *testing.T) {
	detail := &libTVDetail{}
	detail.ProjectMeta.UUID = "project-uuid"
	detail.ProjectMeta.Name = "测试画布"
	detail.NodeList = []libTVRawNode{
		{
			NodeKey: "image-1",
			Name:    "多图节点",
			Data:    `{"type":"image","url":["https://example.com/first.png","https://example.com/second.png"],"params":{"prompt":"prompt","model":"model"},"_resourceMeta":{"items":[{"width":1024,"height":768}]}}`,
			Position: struct {
				X string `json:"positionX"`
				Y string `json:"positionY"`
			}{X: "12", Y: "34"},
			Measured: struct {
				Width  string `json:"width"`
				Height string `json:"height"`
			}{Width: "640", Height: "360"},
		},
		{
			NodeKey: "failed-video",
			Name:    "失败视频",
			Data:    `{"type":"video","url":[],"taskInfo":{"status":3,"failedReason":"生成失败"}}`,
			Position: struct {
				X string `json:"positionX"`
				Y string `json:"positionY"`
			}{X: "500", Y: "600"},
		},
		{
			NodeKey: "stale-video",
			Name:    "过期视频",
			Data:    `{"type":"video","url":["https://example.com/video.mp4"],"taskInfo":{"status":2},"isStale":true,"_resourceMeta":{"items":[{"width":1920,"height":1080,"durationSec":5.2506}]}}`,
			Position: struct {
				X string `json:"positionX"`
				Y string `json:"positionY"`
			}{X: "900", Y: "1200"},
			Measured: struct {
				Width  string `json:"width"`
				Height string `json:"height"`
			}{Width: "640", Height: "360"},
		},
	}
	detail.ConnectionList = []libTVRawConnection{
		{ConnectionID: "valid", Source: "image-1", Target: "stale-video"},
		{ConnectionID: "dangling", Source: "image-1", Target: "failed-video"},
	}

	result, err := adaptLibTVDetail(detail)
	if err != nil {
		t.Fatalf("adaptLibTVDetail() error = %v", err)
	}
	if result.ImportedNodeCount != 3 || result.ImportedConnectionCount != 2 {
		t.Fatalf("counts = (%d, %d), want (3, 2)", result.ImportedNodeCount, result.ImportedConnectionCount)
	}
	if len(result.SkippedNodes) != 0 || len(result.SkippedConnections) != 0 {
		t.Fatalf("unexpected skipped items: nodes=%#v connections=%#v", result.SkippedNodes, result.SkippedConnections)
	}
	if result.PlaceholderNodeCount != 1 || result.ReusedFailedNodeCount != 0 {
		t.Fatalf("failure handling counts = (placeholder=%d, reused=%d), want (1, 0)", result.PlaceholderNodeCount, result.ReusedFailedNodeCount)
	}
	if result.BatchCreatedAt.IsZero() {
		t.Fatal("batch created time must not be zero")
	}
	if got := result.Nodes[0]; got.Content != "https://example.com/first.png" || got.X != 12 || got.Y != 34 || got.Width != 640 || got.Height != 360 {
		t.Fatalf("mapped image = %#v", got)
	}
	if got := result.Nodes[0]; got.Prompt != "prompt" || got.Model != "model" || got.NaturalWidth != 1024 || got.NaturalHeight != 768 {
		t.Fatalf("mapped image metadata = %#v", got)
	}
	if got := result.Nodes[1]; got.DurationMs != 0 || got.MimeType != "video/mp4" || got.Status != "error" || got.ErrorDetails != "生成失败" {
		t.Fatalf("mapped video metadata = %#v", got)
	}
	if got := result.Nodes[0].Metadata.Provider; got != "libtv" {
		t.Fatalf("metadata provider = %q, want libtv", got)
	}
	if len(result.Warnings) != 3 {
		t.Fatalf("warnings = %#v", result.Warnings)
	}
}

func TestAdaptLibTVDetailKeepsFailedNodeWithHistoricalMedia(t *testing.T) {
	detail := &libTVDetail{NodeList: []libTVRawNode{{
		NodeKey: "failed-image",
		Data:    `{"type":"image","url":["https://example.com/history.png"],"taskInfo":{"status":3,"failedReason":"本次生成失败"}}`,
		Position: struct {
			X string `json:"positionX"`
			Y string `json:"positionY"`
		}{X: "10", Y: "20"},
	}}}

	result, err := adaptLibTVDetail(detail)
	if err != nil {
		t.Fatalf("adaptLibTVDetail() error = %v", err)
	}
	if len(result.Nodes) != 1 || result.Nodes[0].Content != "https://example.com/history.png" {
		t.Fatalf("historical media node = %#v", result.Nodes)
	}
	if result.Nodes[0].Status != "success" || result.ReusedFailedNodeCount != 1 {
		t.Fatalf("failure reuse = node=%#v count=%d", result.Nodes[0], result.ReusedFailedNodeCount)
	}
}

func TestAdaptLibTVDetailConvertsMaterialStyleToImage(t *testing.T) {
	detail := &libTVDetail{NodeList: []libTVRawNode{{
		NodeKey: "style-1",
		Name:    "风格素材",
		Data:    `{"type":"material-style","coverUrl":"https://example.com/style.png","styleAssetUuid":"asset-1","styleVersionUuid":"version-1","styleName":"电影感"}`,
		Position: struct {
			X string `json:"positionX"`
			Y string `json:"positionY"`
		}{X: "1", Y: "2"},
	}}}

	result, err := adaptLibTVDetail(detail)
	if err != nil {
		t.Fatalf("adaptLibTVDetail() error = %v", err)
	}
	if len(result.Nodes) != 1 {
		t.Fatalf("nodes = %#v", result.Nodes)
	}
	node := result.Nodes[0]
	if node.Type != "image" || node.Content != "https://example.com/style.png" || result.ConvertedSpecialCount != 1 {
		t.Fatalf("converted style node = %#v count=%d", node, result.ConvertedSpecialCount)
	}
	if node.Metadata.StyleAssetUUID != "asset-1" || node.Metadata.StyleVersionUUID != "version-1" || node.Metadata.StyleName != "电影感" {
		t.Fatalf("style metadata = %#v", node.Metadata)
	}
}

func TestAdaptLibTVDetailGeneratesDistinctBatchIDs(t *testing.T) {
	detail := &libTVDetail{}
	detail.ProjectMeta.UUID = "project-uuid"
	detail.NodeList = []libTVRawNode{{
		NodeKey: "image-1",
		Data:    `{"type":"image","url":["https://example.com/image.png"]}`,
		Position: struct {
			X string `json:"positionX"`
			Y string `json:"positionY"`
		}{X: "0", Y: "0"},
	}}

	first, err := adaptLibTVDetail(detail)
	if err != nil {
		t.Fatalf("first adaptLibTVDetail() error = %v", err)
	}
	second, err := adaptLibTVDetail(detail)
	if err != nil {
		t.Fatalf("second adaptLibTVDetail() error = %v", err)
	}
	if first.BatchID == second.BatchID {
		t.Fatalf("batch IDs are not unique: %q", first.BatchID)
	}
	if !strings.HasPrefix(first.Nodes[0].ID, "libtv-"+first.BatchID+"-") {
		t.Fatalf("node ID %q does not contain batch ID %q", first.Nodes[0].ID, first.BatchID)
	}
}

func TestAdaptLibTVDetailRejectsCanvasWithoutImportableNodes(t *testing.T) {
	detail := &libTVDetail{NodeList: []libTVRawNode{{
		NodeKey: "unsupported",
		Data:    `{"type":"text","url":[]}`,
	}}}

	_, err := adaptLibTVDetail(detail)
	assertLibTVAppError(t, err, http.StatusBadRequest, "没有可导入的有效节点")
}

func TestAdaptLibTVDetailKeepsReportListsNonNilAndResourceIndex(t *testing.T) {
	detail := &libTVDetail{}
	detail.ProjectMeta.UUID = "project-uuid"
	detail.NodeList = []libTVRawNode{{
		NodeKey: "image-1",
		Data:    `{"type":"image","url":["http://example.com/rejected.png","https://example.com/selected.png"],"_resourceMeta":{"items":[{"width":100,"height":100},{"width":200,"height":300}]}}`,
		Position: struct {
			X string `json:"positionX"`
			Y string `json:"positionY"`
		}{X: "10", Y: "20"},
		Measured: struct {
			Width  string `json:"width"`
			Height string `json:"height"`
		}{Width: "200", Height: "300"},
	}}

	result, err := adaptLibTVDetail(detail)
	if err != nil {
		t.Fatalf("adaptLibTVDetail() error = %v", err)
	}
	if result.SkippedNodes == nil || result.SkippedConnections == nil || result.Warnings == nil {
		t.Fatalf("report slices must not be nil: %#v", result)
	}
	if got := result.Nodes[0]; got.Content != "https://example.com/selected.png" || got.NaturalWidth != 200 || got.NaturalHeight != 300 {
		t.Fatalf("selected media metadata = %#v", got)
	}
}

func TestLibTVDetailFromMCPStructuredContentAndLegacyEnvelope(t *testing.T) {
	structured, _ := json.Marshal(map[string]any{
		"structuredContent": map[string]any{
			"project": map[string]any{"id": "292a69d540774a9ab9872d8337c9fd0b", "name": "MCP 画布"},
			"nodes": []any{
				map[string]any{
					"id":     "n1",
					"title":  "图片",
					"x":      10,
					"y":      20,
					"width":  100,
					"height": 80,
					"type":   "image",
					"url":    []any{"https://example.com/a.png"},
				},
			},
			"connections": []any{
				map[string]any{"id": "c1", "from": "n1", "to": "n1"},
			},
		},
	})
	detail, err := libTVDetailFromMCPResult(structured, "292a69d540774a9ab9872d8337c9fd0b")
	if err != nil {
		t.Fatalf("structured content error = %v", err)
	}
	result, err := adaptLibTVDetail(detail)
	if err != nil {
		t.Fatalf("adapt structured detail error = %v", err)
	}
	if result.ImportedNodeCount != 1 || result.ImportedConnectionCount != 1 || result.Nodes[0].Content != "https://example.com/a.png" {
		t.Fatalf("structured import = %#v", result)
	}

	envelope, _ := json.Marshal(map[string]any{
		"content": []any{
			map[string]any{"type": "text", "text": `{"code":0,"data":{"projectMeta":{"uuid":"292a69d540774a9ab9872d8337c9fd0b","name":"旧接口","effective":{"canRead":true,"canCopy":true}},"nodeList":[{"nodeKey":"image-1","name":"图","data":"{\"type\":\"image\",\"url\":[\"https://example.com/b.png\"]}","position":{"positionX":"1","positionY":"2"}}],"connectionList":[]}}`},
		},
	})
	legacy, err := libTVDetailFromMCPResult(envelope, "292a69d540774a9ab9872d8337c9fd0b")
	if err != nil {
		t.Fatalf("legacy envelope error = %v", err)
	}
	legacyResult, err := adaptLibTVDetail(legacy)
	if err != nil || legacyResult.ProjectName != "旧接口" || legacyResult.Nodes[0].Content != "https://example.com/b.png" {
		t.Fatalf("legacy import = %#v err=%v", legacyResult, err)
	}
}

func TestLibTVDetailFromMCPRejectsUncopyableProject(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{
		"structuredContent": map[string]any{
			"projectMeta": map[string]any{"uuid": "292a69d540774a9ab9872d8337c9fd0b", "effective": map[string]any{"canRead": true, "canCopy": false}},
			"nodeList":    []any{},
		},
	})
	detail, err := libTVDetailFromMCPResult(raw, "292a69d540774a9ab9872d8337c9fd0b")
	if err != nil {
		t.Fatal(err)
	}
	if !detail.copyChecked || detail.copyAllowed {
		t.Fatalf("copy flags = checked=%v allowed=%v", detail.copyChecked, detail.copyAllowed)
	}
}

func TestLibTVProjectArgumentKeysPreferSchema(t *testing.T) {
	keys := libTVProjectArgumentKeys(map[string]any{
		"type":       "object",
		"properties": map[string]any{"uuid": map[string]any{"type": "string"}, "verbose": map[string]any{"type": "boolean"}},
		"required":   []any{"uuid"},
	})
	if len(keys) != 1 || keys[0] != "uuid" {
		t.Fatalf("keys = %#v", keys)
	}
}
