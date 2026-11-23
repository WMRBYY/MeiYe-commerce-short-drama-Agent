// 后台请求明细的「参考素材」：列出生成任务实际带上的参考视频 / 图片 / 音频，编号与提示词里的 @视频N、@图片N、@音频N
// 一致（按类型分别从 1 开始，与上游收到的顺序相同），供管理员核对提示词引用的到底是哪一张素材。

package app

import (
	"encoding/json"
	"fmt"
	"strings"

	"yingce/backend/internal/model"
)

// adminAPICallLogReferenceLimit 是一个任务最多列出的参考素材数。
const adminAPICallLogReferenceLimit = 40

// taskInputReference 是任务输入里的一件参考素材（平台资源或外链）。
type taskInputReference struct {
	Kind       string
	ResourceID string
	URL        string
	Role       string
	Name       string
}

var taskReferenceKindLabels = map[string]string{"image": "图片", "video": "视频", "audio": "音频"}

// taskInputReferences 按 referenceVideos / referenceImages / referenceAudios 读取任务输入的参考素材，
// 同类素材保持提交顺序；三个字段都没有时回退到 workbench.references。
func taskInputReferences(raw string) []taskInputReference {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var input map[string]any
	if json.Unmarshal([]byte(raw), &input) != nil {
		return nil
	}
	out := []taskInputReference{}
	for _, field := range []struct{ name, kind string }{{"referenceVideos", "video"}, {"referenceImages", "image"}, {"referenceAudios", "audio"}} {
		items, _ := input[field.name].([]any)
		for _, item := range items {
			if ref, ok := taskInputReferenceFrom(item, field.kind); ok {
				out = append(out, ref)
			}
		}
	}
	if len(out) == 0 {
		workbench, _ := input["workbench"].(map[string]any)
		items, _ := workbench["references"].([]any)
		for _, item := range items {
			entry, _ := item.(map[string]any)
			kind := strings.ToLower(strings.TrimSpace(stringValue(entry["kind"])))
			if taskReferenceKindLabels[kind] == "" {
				continue
			}
			if ref, ok := taskInputReferenceFrom(item, kind); ok {
				out = append(out, ref)
			}
		}
		// 与上游一致：视频、图片、音频分别编号，这里按类型排好，编号顺序不变。
		sorted := make([]taskInputReference, 0, len(out))
		for _, kind := range []string{"video", "image", "audio"} {
			for _, ref := range out {
				if ref.Kind == kind {
					sorted = append(sorted, ref)
				}
			}
		}
		out = sorted
	}
	if len(out) > adminAPICallLogReferenceLimit {
		out = out[:adminAPICallLogReferenceLimit]
	}
	return out
}

func taskInputReferenceFrom(item any, kind string) (taskInputReference, bool) {
	ref := taskInputReference{Kind: kind}
	switch value := item.(type) {
	case string:
		ref.URL = strings.TrimSpace(value)
	case map[string]any:
		ref.ResourceID = strings.TrimSpace(stringValue(value["resourceId"]))
		ref.URL = strings.TrimSpace(stringValue(value["url"]))
		ref.Role = strings.TrimSpace(stringValue(value["role"]))
		ref.Name = strings.TrimSpace(stringValue(value["name"]))
		if ref.Name == "" {
			ref.Name = strings.TrimSpace(stringValue(value["label"]))
		}
	default:
		return ref, false
	}
	if ref.ResourceID == "" {
		ref.ResourceID = canvasResourceID(ref.URL)
	}
	if ref.ResourceID == "" && !strings.HasPrefix(ref.URL, "https://") && !strings.HasPrefix(ref.URL, "http://") {
		return ref, false
	}
	return ref, true
}

// adminAPICallLogReferenceItems 生成详情里的参考素材列表。平台资源走带归属校验的 /media?ref=N，外链原样返回；
// 用途文字来自通用任务素材名称与角色。
func (s *Service) adminAPICallLogReferenceItems(logID string, task *model.Task) []model.ApiCallLogReferenceItem {
	refs := taskInputReferences(task.InputJSON)
	if len(refs) == 0 {
		return nil
	}
	notes := map[string]string{}
	counts := map[string]int{}
	items := make([]model.ApiCallLogReferenceItem, 0, len(refs))
	for index, ref := range refs {
		counts[ref.Kind]++
		item := model.ApiCallLogReferenceItem{Kind: ref.Kind, Role: ref.Role, Label: fmt.Sprintf("%s%d", taskReferenceKindLabels[ref.Kind], counts[ref.Kind])}
		if ref.ResourceID != "" {
			item.URL = fmt.Sprintf("/api/admin/api-logs/%s/media?ref=%d", logID, index)
		} else {
			item.URL = ref.URL
		}
		item.Note = notes[ref.ResourceID]
		if item.Note == "" {
			item.Note = taskReferenceRoleNote(ref)
		}
		items = append(items, item)
	}
	return items
}

func taskReferenceRoleNote(ref taskInputReference) string {
	role := map[string]string{"first_frame": "首帧", "last_frame": "尾帧", "reference_voice": "参考音色"}[ref.Role]
	switch {
	case ref.Name != "" && role != "":
		return role + "：" + ref.Name
	case ref.Name != "":
		return ref.Name
	default:
		return role
	}
}


// 旧项目里元素参考图 / 参考帧的类别（功能已下线，历史请求明细仍按原名显示）。

// adminAPICallLogReferenceResource 读取第 refIndex 件参考素材，校验日志、任务与资源都属于同一用户。
func (s *Service) adminAPICallLogReferenceResource(actor *model.User, logID string, refIndex int) (string, *model.Resource, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return "", nil, err
	}
	log, err := s.repo.APICallLog(strings.TrimSpace(logID))
	if err != nil {
		return "", nil, err
	}
	if log.TaskID == "" {
		return "", nil, BadAuthRequest("该请求没有参考素材")
	}
	task, err := s.repo.Task(log.TaskID)
	if err != nil {
		return "", nil, err
	}
	if task.UserID != log.UserID {
		return "", nil, BadAuthRequest("请求与素材归属不一致")
	}
	refs := taskInputReferences(task.InputJSON)
	if refIndex < 0 || refIndex >= len(refs) || refs[refIndex].ResourceID == "" {
		return "", nil, BadAuthRequest("参考素材不存在")
	}
	resource, err := s.repo.ResourceForUser(log.UserID, refs[refIndex].ResourceID)
	if err != nil {
		return "", nil, err
	}
	return log.UserID, resource, nil
}
