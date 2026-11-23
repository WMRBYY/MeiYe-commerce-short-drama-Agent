package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func ecommerceSubmittedPrefix(draft EcommerceDraft, plan model.EcommercePlan) int {
	if draft.Execution == nil || !draft.Execution.Progressive || draft.ReferenceMode == "detail" || draft.Count < 1 || len(plan.Images) > draft.Count {
		return 0
	}
	for _, page := range plan.Images {
		if page.TaskID == "" {
			return 0
		}
	}
	return len(plan.Images)
}

func ecommercePlanningResumeAfter(inputJSON string) int {
	var input canvasGenerationInput
	if json.Unmarshal([]byte(inputJSON), &input) != nil {
		return 0
	}
	return intValue(input.Metadata["ecommerceResumeAfter"])
}

func ecommerceResumePlanningPrompt(offset int, draft EcommerceDraft, saved model.EcommercePlan) string {
	var existing strings.Builder
	for index, page := range saved.Images {
		title, _, _ := strings.Cut(page.Copy, "\n")
		fmt.Fprintf(&existing, "第 %d 屏：%s｜%s\n", index+1, ecommerceTruncate(page.Goal, 100), ecommerceTruncate(title, 100))
	}
	return fmt.Sprintf("\n【续做，覆盖前文的张数要求】整套共 %d 屏。只写第 %d 至 %d 屏，images 恰好 %d 项，id 依次为 image-%d 至 image-%d。保留 JSON 顶层分析字段，沿用已保存视觉策略，避免重复前面各屏的标题和卖点。\n已保存的视觉策略：%s\n%s",
		draft.Count, offset+1, draft.Count, draft.Count-offset, offset+1, draft.Count, ecommerceTruncate(saved.VisualStrategy, 600), existing.String())
}

// Read only closed image objects following a complete analysis header.
func streamedEcommercePlan(text string, count int) model.EcommercePlan {
	var plan model.EcommercePlan
	start := strings.IndexByte(text, '{')
	if start < 0 {
		return plan
	}
	decoder := json.NewDecoder(strings.NewReader(text[start:]))
	if _, err := decoder.Token(); err != nil {
		return plan
	}
	header := make(map[string]json.RawMessage)
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			break
		}
		if key != "images" {
			var value json.RawMessage
			if decoder.Decode(&value) != nil {
				break
			}
			header[key.(string)] = value
			continue
		}
		open, err := decoder.Token()
		if err != nil || open != json.Delim('[') {
			break
		}
		raw, _ := json.Marshal(header)
		if json.Unmarshal(raw, &plan) != nil {
			return model.EcommercePlan{}
		}
		for len(plan.Images) < count && decoder.More() {
			var page model.EcommercePlanTask
			if decoder.Decode(&page) != nil || page.ID == "" {
				break
			}
			plan.Images = append(plan.Images, page)
		}
		break
	}
	return plan
}

func (s *Service) advanceStreamedEcommerceImages(project *model.EcommerceProject, draft EcommerceDraft, stored *model.EcommercePlan, task *model.Task) error {
	if ecommercePlanningResumeAfter(task.InputJSON) > 0 {
		return nil
	}
	index := len(stored.Images)
	limit := draft.Count
	if draft.ReferenceMode == "detail" {
		limit = 30
	}
	if index >= limit {
		return nil
	}
	var text strings.Builder
	var after int64
	for {
		deltas, err := s.repo.TaskTextDeltas(project.UserID, task.ID, after, 1000)
		if err != nil {
			return err
		}
		for _, delta := range deltas {
			text.WriteString(delta.Content)
			after = delta.Sequence
		}
		if len(deltas) < 1000 {
			break
		}
	}
	prefix := streamedEcommercePlan(text.String(), index+1)
	if len(prefix.Images) <= index {
		return nil
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return err
	}
	if stringValue(input.Metadata["ecommerceAgentAdapter"]) != "workbench-v1" {
		return nil
	}
	raw, _ := json.Marshal(prefix)
	result := map[string]any{"text": string(raw)}
	if err := s.validateEcommerceWorkbenchPlan(project.UserID, input, result, true); err != nil {
		// Full output can still be validated or repaired when the analysis ends.
		return nil
	}
	if err := json.Unmarshal([]byte(stringValue(result["text"])), &prefix); err != nil {
		return err
	}
	prefix.InputSignature = draft.Execution.InputSignature
	page := &prefix.Images[index]
	if draft.AutoPackage == nil && (page.Ratio == "auto" || page.Ratio == "") {
		page.Ratio = defaultString(stringValue(draft.Execution.Parameters["size"]), draft.Ratio)
	}
	excludeEcommerceExecutionFacts(&prefix)
	copy(prefix.Images[:index], stored.Images)
	_, err := s.submitEcommerceExecutionImage(project, draft, &prefix, index)
	if err != nil && !errors.Is(err, repository.ErrEcommerceRoundConflict) {
		// Image admission failures are retried in the submission stage, where
		// they can be reported separately from a failed analysis.
		slog.Debug("ecommerce streamed image not admitted", "projectId", project.ID, "screen", index+1, "error", err)
	}
	return nil
}
