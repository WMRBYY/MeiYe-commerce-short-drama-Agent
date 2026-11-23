package model

import "encoding/json"

// EcommerceExecution lives in the existing project draft JSON, not a second
// task/configuration system. Model calls still use the shared task queue.
type EcommerceExecution struct {
	ID                     string                        `json:"id"`
	RequestHash            string                        `json:"requestHash"`
	Kind                   string                        `json:"kind,omitempty"`
	ClientState            json.RawMessage               `json:"clientState,omitempty"`
	PlanningRequest        json.RawMessage               `json:"planningRequest,omitempty"`
	Jobs                   []EcommerceExecutionJob       `json:"jobs,omitempty"`
	Status                 string                        `json:"status"`
	Stage                  string                        `json:"stage,omitempty"`
	StartedAt              string                        `json:"startedAt,omitempty"`
	Error                  string                        `json:"error,omitempty"`
	PlanningTaskID         string                        `json:"planningTaskId,omitempty"`
	InputSignature         string                        `json:"inputSignature"`
	ReferenceImages        []EcommerceExecutionReference `json:"referenceImages"`
	Prompt                 string                        `json:"prompt,omitempty"`
	AutoGenerate           bool                          `json:"autoGenerate"`
	Progressive            bool                          `json:"progressive,omitempty"`
	Model                  string                        `json:"model"`
	LogicalModelID         string                        `json:"logicalModelId,omitempty"`
	ChannelID              string                        `json:"channelId,omitempty"`
	Parameters             map[string]any                `json:"parameters"`
	PlanningModel          string                        `json:"planningModel"`
	PlanningChannelID      string                        `json:"planningChannelId,omitempty"`
	PlanningLogicalModelID string                        `json:"planningLogicalModelId,omitempty"`
}

type EcommerceExecutionReference struct {
	ID         string `json:"id"`
	Name       string `json:"name,omitempty"`
	StorageKey string `json:"storageKey"`
}

type EcommerceExecutionJob struct {
	Key       string          `json:"key"`
	Request   json.RawMessage `json:"request"`
	TaskID    string          `json:"taskId,omitempty"`
	DependsOn string          `json:"dependsOn,omitempty"`
	AnchorAt  string          `json:"anchorAt,omitempty"`
}

func (e *EcommerceExecution) Active() bool {
	return e != nil && (e.Status == "queued" || e.Status == "running")
}
