package app

import (
	_ "embed"
	"encoding/json"
	"net/url"
	"strings"
)

//go:embed bria_api_catalog.json
var briaAPICatalogJSON []byte

type briaAPIOperation struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Family     string   `json:"family"`
	Capability string   `json:"capability"`
	Protocol   string   `json:"protocol"`
	Required   []string `json:"required"`
	Docs       string   `json:"docs"`
}

func briaAPICatalog() ([]briaAPIOperation, error) {
	var items []briaAPIOperation
	if err := json.Unmarshal(briaAPICatalogJSON, &items); err != nil {
		return nil, err
	}
	return items, nil
}

func validateBriaBaseURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	return err == nil && parsed.Scheme == "https" && strings.EqualFold(parsed.Host, "engine.prod.bria-api.com") && (parsed.Path == "" || parsed.Path == "/") && parsed.RawQuery == "" && parsed.Fragment == "" && parsed.User == nil
}

func briaCatalogOperation(id string) (briaAPIOperation, bool) {
	items, err := briaAPICatalog()
	if err != nil {
		return briaAPIOperation{}, false
	}
	for _, item := range items {
		if item.ID == id {
			return item, true
		}
	}
	return briaAPIOperation{}, false
}
