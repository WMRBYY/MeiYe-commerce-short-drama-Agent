package canvas

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/kernel"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

type CanvasShareRequest struct {
	ExpiresDays int  `json:"expiresDays"`
	Rotate      bool `json:"rotate"`
}

type CanvasShareStatus struct {
	Enabled   bool       `json:"enabled"`
	Token     string     `json:"token,omitempty"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	CreatedAt *time.Time `json:"createdAt,omitempty"`
}

type PublicCanvasShare struct {
	Project   map[string]any `json:"project"`
	ExpiresAt *time.Time     `json:"expiresAt,omitempty"`
}

var publicCanvasMetadataKeys = map[string]bool{
	"content": true, "textFormat": true, "composerContent": true, "prompt": true, "status": true, "fontSize": true,
	"generationMode": true, "generationType": true, "model": true, "size": true, "quality": true, "transparentBackground": true,
	"count": true, "seconds": true, "vquality": true, "generateAudio": true, "watermark": true,
	"audioVoice": true, "audioFormat": true, "audioSpeed": true, "audioInstructions": true,
	"naturalWidth": true, "naturalHeight": true, "freeResize": true, "isBatchRoot": true,
	"batchRootId": true, "batchChildIds": true, "batchUsesReferenceImages": true, "primaryImageId": true,
	"imageBatchExpanded": true, "mimeType": true, "bytes": true, "durationMs": true, "hasAudio": true, "assetTags": true,
	"workflowKind": true, "workflowTitle": true, "workflowDescription": true, "shotIndex": true,
	"sceneId": true, "characterIds": true, "referenceSetId": true, "referenceAssetNodeIds": true, "assetBindings": true,
	"characterName": true, "characterPrompt": true, "characterAliases": true, "characterView": true, "characterViewNodeIds": true,
	"videoEditOperation": true, "videoCameraMoveId": true, "videoCameraMovePrompt": true,
	"videoStartFrameNodeId": true, "videoEndFrameNodeId": true, "versionOfNodeId": true,
	"versionLabel": true, "versionPrimary": true, "previsSceneId": true, "previsShotId": true,
	"previsPreviewNodeId": true, "previsDepthNodeId": true, "previsDepthVideoNodeId": true, "previsNormalNodeId": true,
	"skillId": true, "skillVersion": true, "skillSnapshot": true, "storyboard": true,
	"storyboardShotDuration": true, "storyboardShotCount": true, "storyboardComposerHeight": true, "frame": true,
}

var publicCanvasForbiddenKeys = map[string]bool{
	"apiKey": true, "storageKey": true, "taskId": true, "taskStatus": true, "taskProgress": true,
	"taskStage": true, "taskCreatedAt": true, "taskUpdatedAt": true,
	"errorDetails": true, "references": true,
}

func (s *Service) CanvasShareStatus(userID string, projectID string) (CanvasShareStatus, error) {
	if _, err := s.repo.CanvasProjectForUser(userID, projectID); err != nil {
		return CanvasShareStatus{}, err
	}
	share, err := s.repo.CanvasShareForProject(userID, projectID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return CanvasShareStatus{Enabled: false}, nil
	}
	if err != nil {
		return CanvasShareStatus{}, err
	}
	return s.canvasShareStatus(share)
}

func (s *Service) CreateCanvasShare(userID string, projectID string, req CanvasShareRequest) (CanvasShareStatus, error) {
	if req.ExpiresDays < 0 || req.ExpiresDays > 365 {
		return CanvasShareStatus{}, kernel.BadAuthRequest("分享有效期必须在 0 到 365 天之间")
	}
	if _, err := s.repo.CanvasProjectForUser(userID, projectID); err != nil {
		return CanvasShareStatus{}, err
	}
	share, err := s.repo.CanvasShareForProject(userID, projectID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		share = &model.CanvasShare{ID: kernel.NewID(), UserID: userID, ProjectID: projectID}
	} else if err != nil {
		return CanvasShareStatus{}, err
	}
	if req.Rotate || strings.TrimSpace(share.TokenCipher) == "" {
		token, tokenErr := newCanvasShareToken()
		if tokenErr != nil {
			return CanvasShareStatus{}, tokenErr
		}
		share.TokenHash = canvasShareTokenHash(token)
		share.TokenCipher, err = s.host.EncryptSecret(token)
		if err != nil {
			return CanvasShareStatus{}, err
		}
	}
	share.Enabled = true
	share.ExpiresAt = nil
	if req.ExpiresDays > 0 {
		expiresAt := time.Now().Add(time.Duration(req.ExpiresDays) * 24 * time.Hour)
		share.ExpiresAt = &expiresAt
	}
	if err := s.repo.Save(share); err != nil {
		return CanvasShareStatus{}, err
	}
	return s.canvasShareStatus(share)
}

func (s *Service) DeleteCanvasShare(userID string, projectID string) error {
	if _, err := s.repo.CanvasProjectForUser(userID, projectID); err != nil {
		return err
	}
	return s.repo.DeleteCanvasShare(userID, projectID)
}

func (s *Service) PublicCanvasShare(token string) (PublicCanvasShare, error) {
	share, project, err := s.sharedCanvasProject(token)
	if err != nil {
		return PublicCanvasShare{}, err
	}
	publicProject, _, err := publicCanvasProject(project, token)
	if err != nil {
		return PublicCanvasShare{}, err
	}
	return PublicCanvasShare{Project: publicProject, ExpiresAt: share.ExpiresAt}, nil
}

func (s *Service) OpenSharedCanvasResource(token string, resourceID string) (*model.Resource, io.ReadCloser, error) {
	stream, err := s.OpenSharedCanvasResourceRange(token, resourceID, "")
	if err != nil {
		return nil, nil, err
	}
	return stream.Resource, stream.Body, nil
}

func (s *Service) OpenSharedCanvasResourceRange(token string, resourceID string, rangeHeader string) (*assets.ResourceStream, error) {
	userID, resource, _, err := s.sharedCanvasResource(token, resourceID)
	if err != nil {
		return nil, err
	}
	return s.host.OpenResourceRange(userID, resource, rangeHeader)
}

func (s *Service) PrepareSharedCanvasResourceDelivery(token string, resourceID string, options assets.AccessOptions, rangeHeader string) (*assets.ResourceDelivery, error) {
	userID, resource, share, err := s.sharedCanvasResource(token, resourceID)
	if err != nil {
		return nil, err
	}
	if share.ExpiresAt != nil {
		options.ExpiresAt = *share.ExpiresAt
	}
	return s.host.PrepareResourceDelivery(userID, resource, options, rangeHeader)
}

func (s *Service) sharedCanvasResource(token string, resourceID string) (string, *model.Resource, *model.CanvasShare, error) {
	share, project, err := s.sharedCanvasProject(token)
	if err != nil {
		return "", nil, nil, err
	}
	_, allowedResources, err := publicCanvasProject(project, token)
	if err != nil {
		return "", nil, nil, err
	}
	if !allowedResources[resourceID] {
		return "", nil, nil, gorm.ErrRecordNotFound
	}
	resource, err := s.repo.ResourceForUser(share.UserID, resourceID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// A share grants access only to resources present in its sanitized canvas.
		// Shared official resources belong to their publisher, not the canvas owner.
		allowed, checkErr := s.repo.PublishedOfficialResource(resourceID)
		if checkErr != nil {
			return "", nil, nil, checkErr
		}
		if !allowed {
			allowed, checkErr = s.repo.RetainedCanvasOfficialResource(share.UserID, project.ID, resourceID)
			if checkErr != nil {
				return "", nil, nil, checkErr
			}
		}
		if !allowed {
			return "", nil, nil, gorm.ErrRecordNotFound
		}
		resource, err = s.repo.Resource(resourceID)
	}
	if err != nil {
		return "", nil, nil, err
	}
	return share.UserID, resource, share, nil
}

func (s *Service) sharedCanvasProject(token string) (*model.CanvasShare, *model.CanvasProject, error) {
	token = strings.TrimSpace(token)
	if len(token) < 32 || len(token) > 128 {
		return nil, nil, gorm.ErrRecordNotFound
	}
	share, err := s.repo.CanvasShareByTokenHash(canvasShareTokenHash(token))
	if err != nil {
		return nil, nil, err
	}
	if share.ExpiresAt != nil && !share.ExpiresAt.After(time.Now()) {
		return nil, nil, gorm.ErrRecordNotFound
	}
	project, err := s.repo.CanvasProjectForUser(share.UserID, share.ProjectID)
	return share, project, err
}

func (s *Service) canvasShareStatus(share *model.CanvasShare) (CanvasShareStatus, error) {
	if share == nil || !share.Enabled || (share.ExpiresAt != nil && !share.ExpiresAt.After(time.Now())) {
		return CanvasShareStatus{Enabled: false}, nil
	}
	token, err := s.host.DecryptSecret(share.TokenCipher)
	if err != nil {
		return CanvasShareStatus{}, err
	}
	createdAt := share.CreatedAt
	return CanvasShareStatus{Enabled: true, Token: token, ExpiresAt: share.ExpiresAt, CreatedAt: &createdAt}, nil
}

func newCanvasShareToken() (string, error) {
	payload := make([]byte, 32)
	if _, err := rand.Read(payload); err != nil {
		return "", fmt.Errorf("生成分享令牌失败：%w", err)
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func canvasShareTokenHash(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return hex.EncodeToString(sum[:])
}

// PublicCanvasOptions 控制画布正文的只读公开投影。
type PublicCanvasOptions struct {
	// ResourceURL 把平台资源 ID 改写为调用方受控的访问地址（分享令牌地址、模版地址等）。
	ResourceURL func(resourceID string) string
	// IncludePreviews 额外公开视频海报和图片缩略图，大画布只读浏览时不必加载全部原件。
	IncludePreviews bool
}

func publicCanvasProject(project *model.CanvasProject, token string) (map[string]any, map[string]bool, error) {
	if project == nil {
		return nil, nil, errors.New("分享画布数据格式无效")
	}
	return PublicCanvasDocument(project.PayloadJSON, project.Title, PublicCanvasOptions{ResourceURL: func(resourceID string) string {
		return sharedCanvasResourceURL(token, resourceID)
	}})
}

// PublicCanvasDocument 把画布正文投影为只读公开结构：只保留白名单字段，平台媒体改写为 options.ResourceURL，
// 并返回投影中出现的资源集合，供媒体接口校验访问范围。
func PublicCanvasDocument(payloadJSON string, fallbackTitle string, options PublicCanvasOptions) (map[string]any, map[string]bool, error) {
	var source map[string]any
	if options.ResourceURL == nil || json.Unmarshal([]byte(payloadJSON), &source) != nil {
		return nil, nil, errors.New("分享画布数据格式无效")
	}
	allowedResources := map[string]bool{}
	result := map[string]any{
		"id":             kernel.StringValue(source["id"]),
		"title":          kernel.DefaultString(kernel.StringValue(source["title"]), fallbackTitle),
		"createdAt":      source["createdAt"],
		"updatedAt":      source["updatedAt"],
		"backgroundMode": source["backgroundMode"],
		"showImageInfo":  source["showImageInfo"],
		"viewport":       scrubPublicCanvasValue(source["viewport"]),
		"connections":    publicCanvasConnections(source["connections"]),
		"chatSessions":   []any{},
		"activeChatId":   nil,
		"previsScenes":   []any{},
	}
	rawNodes, _ := source["nodes"].([]any)
	nodes := make([]any, 0, len(rawNodes))
	for _, rawNode := range rawNodes {
		if node, ok := publicCanvasNode(rawNode, options, allowedResources); ok {
			nodes = append(nodes, node)
		}
	}
	result["nodes"] = nodes
	return result, allowedResources, nil
}

func publicCanvasConnections(value any) []any {
	rawConnections, _ := value.([]any)
	result := make([]any, 0, len(rawConnections))
	for _, raw := range rawConnections {
		connection, _ := raw.(map[string]any)
		if connection == nil {
			continue
		}
		result = append(result, map[string]any{
			"id": connection["id"], "fromNodeId": connection["fromNodeId"], "toNodeId": connection["toNodeId"],
			"fromHandleId": connection["fromHandleId"], "toHandleId": connection["toHandleId"],
		})
	}
	return result
}

func publicCanvasNode(value any, options PublicCanvasOptions, allowedResources map[string]bool) (map[string]any, bool) {
	node, _ := value.(map[string]any)
	if node == nil || kernel.StringValue(node["id"]) == "" || kernel.StringValue(node["type"]) == "" {
		return nil, false
	}
	result := map[string]any{
		"id": node["id"], "type": node["type"], "title": node["title"], "position": scrubPublicCanvasValue(node["position"]),
		"width": node["width"], "height": node["height"], "parentId": node["parentId"],
	}
	metadata, _ := node["metadata"].(map[string]any)
	publicMetadata := map[string]any{}
	for key, value := range metadata {
		if !publicCanvasMetadataKeys[key] {
			continue
		}
		publicMetadata[key] = scrubPublicCanvasValue(value)
	}
	if node["type"] == "frame" && metadata["imageAssembly"] == "vertical" {
		publicMetadata["imageAssembly"] = "vertical"
	}
	nodeType := kernel.StringValue(node["type"])
	if kernel.StringValue(metadata["workflowKind"]) == "character" && (kernel.StringValue(metadata["characterAssetId"]) != "" || kernel.StringValue(metadata["officialAssetId"]) != "") {
		publicMetadata["sharedCharacter"] = true
		for _, key := range []string{"characterVisualStatus", "characterVoiceStatus", "characterVoiceName", "characterVoiceInstructions"} {
			if value, ok := metadata[key].(string); ok {
				publicMetadata[key] = value
			}
		}
		if definition, ok := metadata["characterDefinition"].(map[string]any); ok {
			fields := map[string]any{}
			for _, key := range []string{"role", "aliases", "personality", "appearance", "physique", "clothing", "props", "consistencyPrompt", "multiViewPrompt", "voiceLanguage", "voiceAge", "voiceTimbre"} {
				if value, ok := definition[key]; ok {
					fields[key] = scrubPublicCanvasValue(value)
				}
			}
			publicMetadata["characterDefinition"] = fields
		}
		if id := assets.ResourceID(kernel.StringValue(metadata["characterCoverUrl"])); id != "" {
			allowedResources[id] = true
			publicMetadata["characterCoverUrl"] = options.ResourceURL(id)
		}
		if id := assets.ValidID(kernel.StringValue(metadata["characterVoiceSampleResourceId"])); id != "" {
			allowedResources[id] = true
			publicMetadata["characterVoiceSampleUrl"] = options.ResourceURL(id)
		}
	}
	if resourceID := assets.ResourceID(kernel.StringValue(metadata["storageKey"])); resourceID != "" {
		allowedResources[resourceID] = true
		publicMetadata["content"] = options.ResourceURL(resourceID)
	} else if resourceID := assets.ResourceID(kernel.StringValue(metadata["content"])); resourceID != "" {
		allowedResources[resourceID] = true
		publicMetadata["content"] = options.ResourceURL(resourceID)
	} else if nodeType == "image" || nodeType == "video" || nodeType == "audio" {
		delete(publicMetadata, "content")
	}
	if options.IncludePreviews {
		addPublicCanvasPreviews(nodeType, metadata, publicMetadata, options, allowedResources)
	}
	delete(publicMetadata, "storageKey")
	result["metadata"] = publicMetadata
	return result, true
}

// addPublicCanvasPreviews 公开视频节点的海报和图片节点的缩略图；海报只保留展示所需字段。
func addPublicCanvasPreviews(nodeType string, metadata map[string]any, publicMetadata map[string]any, options PublicCanvasOptions, allowedResources map[string]bool) {
	if preview, _ := metadata["videoPreview"].(map[string]any); preview != nil {
		resourceID := assets.ResourceID(kernel.StringValue(preview["storageKey"]))
		if resourceID == "" {
			resourceID = assets.ResourceID(kernel.StringValue(preview["content"]))
		}
		if resourceID != "" {
			allowedResources[resourceID] = true
			publicPreview := map[string]any{"content": options.ResourceURL(resourceID)}
			for _, key := range []string{"width", "height", "mimeType"} {
				if value, ok := preview[key]; ok {
					publicPreview[key] = value
				}
			}
			publicMetadata["videoPreview"] = publicPreview
		}
	}
	if nodeType == "image" {
		if content := kernel.StringValue(publicMetadata["content"]); strings.HasPrefix(content, "/api/") && !strings.Contains(content, "?") {
			publicMetadata["previewContent"] = content + "?variant=thumbnail"
		}
	}
}

func scrubPublicCanvasValue(value any) any {
	switch item := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(item))
		for key, child := range item {
			if publicCanvasForbiddenKeys[key] {
				continue
			}
			result[key] = scrubPublicCanvasValue(child)
		}
		return result
	case []any:
		result := make([]any, len(item))
		for index, child := range item {
			result[index] = scrubPublicCanvasValue(child)
		}
		return result
	default:
		return value
	}
}

func sharedCanvasResourceURL(token string, resourceID string) string {
	return "/api/public/canvas-shares/" + token + "/resources/" + resourceID + "/file"
}
