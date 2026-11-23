package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func TestEcommerceWorkbenchRepairsOnlyMissingImageCopy(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, tc := range []struct {
		name, existing, reply string
		noText, fail          bool
		calls                 int32
	}{
		{name: "empty", reply: `{"pages":[{"page":3,"copy":"Ready for the desk"}]}`, calls: 1},
		{name: "already complete", existing: "Fits into your day"},
		{name: "text disabled", noText: true},
		{name: "edits an existing page", reply: `{"pages":[{"page":2,"copy":"Replace this"}]}`, calls: 1, fail: true},
		{name: "internal directions", reply: `{"pages":[{"page":3,"copy":"Layout: headline on top"}]}`, calls: 1, fail: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				var request struct {
					Messages []struct{ Content string }
				}
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil || len(request.Messages) != 1 {
					t.Errorf("decode repair request: %v", err)
				} else if prompt := request.Messages[0].Content; !strings.Contains(prompt, `"missingPages":[{"page":3`) || !strings.Contains(prompt, `"language":"en"`) || !strings.Contains(prompt, "Compact by design") {
					t.Errorf("repair was not scoped to missing copy: %s", prompt)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": tc.reply}}}})
			}))
			defer server.Close()

			draft := EcommerceDraft{ImageType: "set", Count: 3, Platform: "amazon", Language: "en", ProductName: "Portable fan", ImageModel: "chosen-model", Ratio: "1:1", Resolution: "2K", NoText: tc.noText}
			plan := model.EcommercePlan{ProductSummary: "Handheld fan with a round head", VisualStrategy: "Soft lighting", ConfirmedFacts: []string{}, UncertainFacts: []string{}, QualityChecks: []string{}}
			first := model.EcommercePlanTask{ID: "image-1", ImageType: "main", Goal: "Show the product", Theme: "Product overview", Composition: "Straight on", MainVisual: "Round head", Fidelity: "Keep the silhouette", Prompt: "Photograph the original fan"}
			second, third := first, first
			second.ID, second.ImageType, second.Copy = "image-2", "secondary", "Compact by design"
			third.ID, third.ImageType, third.Copy = "image-3", "scene", tc.existing
			plan.Images = []model.EcommercePlanTask{first, second, third}
			raw, _ := json.Marshal(plan)
			result := map[string]any{"text": string(raw)}
			input := canvasGenerationInput{
				Config:   providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "director", InterfaceType: "chat-completion"},
				Metadata: map[string]any{"ecommerceAgentAdapter": "workbench-v1", "stage": "planning", "ecommerceDraft": draft},
			}
			err := (&Service{}).validateEcommerceWorkbenchText(context.Background(), "owner", input, result)
			if got := calls.Load(); got != tc.calls {
				t.Fatalf("got %d repair calls, want %d (err=%v)", got, tc.calls, err)
			}
			if tc.fail {
				if !errors.Is(err, errEcommercePlanningCopyMissing) || result["text"] != string(raw) {
					t.Fatalf("invalid repair changed the failed result: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			var got model.EcommercePlan
			if err := json.Unmarshal([]byte(stringValue(result["text"])), &got); err != nil {
				t.Fatal(err)
			}
			wantExisting, wantRepaired := second.Copy, tc.existing
			if tc.noText {
				wantExisting = ""
			} else if tc.calls > 0 {
				wantRepaired = "Ready for the desk"
			}
			if len(got.Images) != 3 || got.Images[0].Copy != "" || got.Images[1].Copy != wantExisting || got.Images[2].Copy != wantRepaired ||
				!strings.Contains(got.Images[2].Prompt, third.Prompt) || got.Images[2].ImageModel != draft.ImageModel {
				t.Fatalf("unexpected completed plan: %+v", got.Images)
			}
		})
	}
}

// Observe the deadline at the real Gemini adapter boundary without sleeping for minutes.
type ecommerceCopyDeadlineAdapter struct {
	protocol.Adapter
	check func(context.Context)
}

func (a ecommerceCopyDeadlineAdapter) BuildCreate(ctx context.Context, request protocol.RequestContext) (protocol.RequestSpec, error) {
	a.check(ctx)
	return a.Adapter.BuildCreate(ctx, request)
}

func TestEcommerceWorkbenchCopyRepairBudgetAndErrors(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	adapter, ok := loadOfficialFallbackRegistry().Resolve("gemini-generate-content")
	if !ok {
		t.Fatal("missing Gemini adapter")
	}
	for _, scenario := range []string{"remaining task budget", "long task budget", "bounded fallback", "parent deadline", "parent cancellation", "already expired", "already cancelled", "upstream failure", "upstream rate limited"} {
		t.Run(scenario, func(t *testing.T) {
			parent := context.Background()
			var cancel context.CancelFunc
			switch scenario {
			case "remaining task budget":
				parent, cancel = context.WithTimeout(parent, 8*time.Minute-258*time.Second)
			case "long task budget":
				parent, cancel = context.WithTimeout(parent, 8*time.Minute)
			case "already expired":
				parent, cancel = context.WithDeadline(parent, time.Now().Add(-time.Second))
			case "parent deadline":
				parent, cancel = context.WithTimeout(parent, 250*time.Millisecond)
			default:
				parent, cancel = context.WithCancel(parent)
			}
			defer cancel()
			if scenario == "already cancelled" {
				cancel()
			}

			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.URL.Path != "/v1beta/models/gemini-test:generateContent" || r.Header.Get("x-goog-api-key") != "test-key" {
					t.Errorf("unexpected Gemini repair request: %s", r.URL.Path)
				}
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Errorf("decode Gemini request: %v", err)
				}
				switch scenario {
				case "parent cancellation":
					cancel()
					fallthrough
				case "parent deadline":
					select {
					case <-r.Context().Done():
					case <-time.After(3 * time.Second):
						t.Error("repair ignored task cancellation")
					}
					return
				case "upstream failure":
					http.Error(w, "unavailable", http.StatusServiceUnavailable)
					return
				case "upstream rate limited":
					http.Error(w, "rate limited", http.StatusTooManyRequests)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]any{"text": `{"pages":[{"page":1,"copy":"Ready for the desk"}]}`}}}}}})
			}))
			defer server.Close()

			var checked bool
			registry, err := protocol.NewRegistry(ecommerceCopyDeadlineAdapter{Adapter: adapter, check: func(ctx context.Context) {
				checked = true
				deadline, hasDeadline := ctx.Deadline()
				if !hasDeadline {
					t.Error("copy repair must have a bounded deadline")
				} else if want, ok := parent.Deadline(); ok {
					if !deadline.Equal(want) {
						t.Errorf("repair deadline = %v, want remaining task deadline %v", deadline, want)
					}
				} else if remaining := time.Until(deadline); remaining < providerHTTPTimeout-time.Second || remaining > providerHTTPTimeout {
					t.Errorf("repair budget = %s, want provider default %s", remaining, providerHTTPTimeout)
				}
			}})
			if err != nil {
				t.Fatal(err)
			}
			draft := EcommerceDraft{ImageType: "scene", Count: 1, Platform: "amazon", Language: "en", ProductName: "Portable fan", ImageModel: "chosen-model", Ratio: "1:1", Resolution: "2K"}
			plan := model.EcommercePlan{
				ProductSummary: "Handheld fan", VisualStrategy: "Soft lighting", ConfirmedFacts: []string{}, UncertainFacts: []string{}, QualityChecks: []string{},
				Images: []model.EcommercePlanTask{{ID: "image-1", ImageType: "scene", Goal: "Show the product", Theme: "Product overview", Composition: "Straight on", MainVisual: "Round head", Fidelity: "Keep the silhouette", Prompt: "Photograph the original fan"}},
			}
			raw, err := json.Marshal(plan)
			if err != nil {
				t.Fatal(err)
			}
			result := map[string]any{"text": string(raw)}
			input := canvasGenerationInput{
				Mode:     "text",
				Config:   providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "gemini-test", InterfaceType: "gemini-generate-content"},
				Metadata: map[string]any{"ecommerceAgentAdapter": "workbench-v1", "stage": "planning", "ecommerceDraft": draft},
			}
			err = (&Service{}).validateEcommerceWorkbenchText(withProtocolRegistry(parent, registry), "owner", input, result)
			if scenario == "already expired" || scenario == "already cancelled" {
				if !errors.Is(err, parent.Err()) || checked || calls.Load() != 0 || result["text"] != string(raw) {
					t.Fatalf("finished task must not submit repair: checked=%v, calls=%d, err=%v", checked, calls.Load(), err)
				}
				return
			}
			if !checked || calls.Load() != 1 {
				t.Fatalf("expected one real repair request: deadline checked=%v, calls=%d, err=%v", checked, calls.Load(), err)
			}
			switch scenario {
			case "parent deadline":
				if !errors.Is(err, context.DeadlineExceeded) {
					t.Fatalf("task deadline was hidden: %v", err)
				}
			case "parent cancellation":
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("task cancellation was hidden: %v", err)
				}
			case "upstream failure", "upstream rate limited":
				if !errors.Is(err, errEcommercePlanningCopyMissing) || safeRouteRejection(err) {
					t.Fatalf("repair failure must not authorize resubmitting the completed planning request: %v", err)
				}
			default:
				var repaired model.EcommercePlan
				if err != nil || json.Unmarshal([]byte(stringValue(result["text"])), &repaired) != nil || len(repaired.Images) != 1 || repaired.Images[0].Copy != "Ready for the desk" {
					t.Fatalf("repair failed: result=%v, err=%v", result, err)
				}
			}
			if err != nil && result["text"] != string(raw) {
				t.Fatal("failed repair overwrote the original planning result")
			}
		})
	}
}
