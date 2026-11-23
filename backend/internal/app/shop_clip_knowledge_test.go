package app

import (
	"regexp"
	"slices"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
	"yingce/backend/internal/ecommercecatalog"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func newShopClipKnowledgeTestService(t *testing.T) *Service {
	t.Helper()
	db, err := gorm.Open(sqlite.Dialector{DriverName: "sqlite", DSN: "file:" + newID() + "?mode=memory&cache=shared"}, &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}
}

func TestShopClipKnowledgeTaxonomyCoverage(t *testing.T) {
	seen := map[string]bool{}
	sourceIDs := map[string]bool{}
	for _, source := range shopClipKnowledgeBuiltins.Sources {
		if sourceIDs[source.ID] || !regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(source.Commit) || source.License == "" || !strings.Contains(source.LicenseURL, source.Commit) {
			t.Fatalf("source must be unique and pinned: %+v", source)
		}
		sourceIDs[source.ID] = true
	}
	for _, spec := range shopClipKnowledgeBuiltins.Entries {
		if seen[spec.ID] || strings.TrimSpace(spec.Content) == "" {
			t.Fatalf("duplicate or empty knowledge: %s", spec.ID)
		}
		seen[spec.ID] = true
		for _, sourceID := range spec.SourceIDs {
			if !sourceIDs[sourceID] {
				t.Fatalf("missing source %s in %s", sourceID, spec.ID)
			}
		}
		if spec.CategoryID != "" {
			node, ok := ecommercecatalog.Lookup(spec.CategoryID)
			if !ok || (spec.Scope == "category" && node.Depth != 1) || (spec.Scope == "family" && node.Depth < 2) {
				t.Fatalf("strategy references wrong taxonomy node: %+v", spec)
			}
			if _, err := resolveShopClipKnowledge(ShopClipKnowledgeSetting{}, node.ID); err != nil {
				t.Fatalf("default strategy exceeds planner budget: %s: %v", node.ID, err)
			}
		}
	}
	roots, levelTwo, leaves := 0, 0, 0
	for _, node := range ecommercecatalog.All() {
		if node.Depth == 1 {
			roots++
		}
		if node.Depth == 2 {
			levelTwo++
		}
		if node.Children == 0 {
			leaves++
		}
		mapping := shopClipKnowledgeCategory(node, ShopClipKnowledgeSetting{})
		if mapping.StrategyID == "" {
			t.Fatalf("uncovered taxonomy node: %s %s", node.ID, node.Path)
		}
		if _, ok := shopClipKnowledgeSpecByID("category:" + node.RootID); !ok {
			t.Fatalf("missing root strategy for %s", node.ID)
		}
	}
	meta := ecommercecatalog.Metadata()
	if roots != meta.Roots || levelTwo != meta.Level2 || leaves != meta.Leaves {
		t.Fatalf("catalog coverage changed: roots=%d level2=%d leaves=%d metadata=%+v", roots, levelTwo, leaves, meta)
	}
	candidates := (&Service{}).ShopClipKnowledgeCategories()
	wanted := meta.Roots + meta.Level2
	for _, spec := range shopClipKnowledgeBuiltins.Entries {
		if node, ok := ecommercecatalog.Lookup(spec.CategoryID); spec.Scope == "family" && ok && node.Depth > 2 {
			wanted++
		}
	}
	if len(candidates) != wanted {
		t.Fatalf("classifier index must include all roots, level 2 and curated families without duplicates: got %d want %d", len(candidates), wanted)
	}
	indexed := map[string]bool{}
	for _, candidate := range candidates {
		if indexed[candidate.ID] {
			t.Fatalf("duplicate classifier candidate %s", candidate.ID)
		}
		indexed[candidate.ID] = true
		if candidate.Depth > 2 && !seen["family:"+candidate.ID] {
			t.Fatalf("classifier includes an uncurated deep leaf: %+v", candidate)
		}
	}
	for _, spec := range shopClipKnowledgeBuiltins.Entries {
		if spec.Scope == "family" {
			if !indexed[spec.CategoryID] {
				t.Fatalf("specific strategy unreachable by classifier: %s", spec.ID)
			}
			ctx, err := resolveShopClipKnowledge(ShopClipKnowledgeSetting{}, spec.CategoryID)
			if err != nil || !slices.Contains(ctx.MatchedIDs, spec.ID) {
				t.Fatalf("classifier category must retrieve its family strategy: %s, %v", spec.ID, err)
			}
		}
	}
}

func TestShopClipKnowledgeRetrievesOnlyRelevantCategory(t *testing.T) {
	ctx, err := resolveShopClipKnowledge(ShopClipKnowledgeSetting{}, "榨汁机")
	if err != nil {
		t.Fatal(err)
	}
	if ctx.CategoryID != "hg-11-7-29" || !slices.Contains(ctx.MatchedIDs, "category:hg") || !slices.Contains(ctx.MatchedIDs, "family:hg-11-7-29") || !slices.Contains(ctx.MatchedIDs, "subtitle:accuracy") {
		t.Fatalf("incorrect strategy routing: %+v", ctx)
	}
	if slices.Contains(ctx.MatchedIDs, "category:fb") || slices.Contains(ctx.MatchedIDs, "family:el-2-2-7") {
		t.Fatalf("unrelated category leaked into retrieval: %v", ctx.MatchedIDs)
	}
	again, _ := resolveShopClipKnowledge(ShopClipKnowledgeSetting{}, ctx.CategoryID)
	if ctx.Digest != again.Digest || len(ctx.Digest) != 64 {
		t.Fatal("equivalent category has unstable provenance digest")
	}
	unknown, err := resolveShopClipKnowledge(ShopClipKnowledgeSetting{}, "unclassified-xyzzy")
	if err != nil || unknown.CategoryID != "na" || !slices.Contains(unknown.MatchedIDs, "category:na") {
		t.Fatalf("unknown item must have explicit generic fallback: %+v %v", unknown, err)
	}
}

func TestShopClipKnowledgePatchValidationAndBudget(t *testing.T) {
	current := []ShopClipKnowledgeEntry{{ID: "category:fb", Enabled: false}}
	result, err := normalizeShopClipKnowledge(current, []ShopClipKnowledgeEntry{{ID: "family:hg-11-7-29", Enabled: true, Content: "先展示实际加料动作。"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(result) != 2 || result[0].ID != "category:fb" || result[0].Enabled {
		t.Fatal("patch must preserve unrelated disabled entries")
	}
	for _, input := range [][]ShopClipKnowledgeEntry{
		{{ID: "invented", Enabled: true}},
		{{ID: "category:fb", Enabled: true}, {ID: "category:fb", Enabled: false}},
		{{ID: "category:fb", Enabled: true, Content: strings.Repeat("字", 6001)}},
		{{ID: "category:fb", Enabled: true, Content: "null\x00content"}},
		{{ID: "principle:evidence", Enabled: true, Content: strings.Repeat("字", 6000)}, {ID: "pacing:speech", Enabled: true, Content: strings.Repeat("字", 6000)}, {ID: "pacing:opening", Enabled: true, Content: strings.Repeat("字", 6000)}},
	} {
		if _, err := normalizeShopClipKnowledge(nil, input); err == nil {
			t.Fatalf("accepted invalid patch: %s", input[0].ID)
		}
	}
	spec, _ := shopClipKnowledgeSpecByID("category:fb")
	result, err = normalizeShopClipKnowledge(nil, []ShopClipKnowledgeEntry{{ID: spec.ID, Enabled: true, Content: " \n" + spec.Content + "\n "}})
	if err != nil || result[0].Content != "" {
		t.Fatal("default-equivalent content should not create an override")
	}
}

func TestShopClipKnowledgePersistencePermissionsAndInheritance(t *testing.T) {
	svc := newShopClipKnowledgeTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	user := &model.User{ID: "user", Role: model.UserRoleUser}
	for _, actor := range []*model.User{nil, user} {
		if _, err := svc.ShopClipKnowledgeAdmin(actor); err == nil {
			t.Fatal("non-admin read accepted")
		}
		if _, err := svc.UpdateShopClipKnowledge(actor, []ShopClipKnowledgeEntry{{ID: "category:fb", Enabled: false}}); err == nil {
			t.Fatal("non-admin mutation accepted")
		}
		if _, err := svc.ShopClipKnowledgeCategoryList(actor, "", "", 1); err == nil {
			t.Fatal("non-admin category read accepted")
		}
	}
	before, err := svc.ShopClipKnowledgeContext("hg-11-7-29")
	if err != nil {
		t.Fatal(err)
	}
	status, err := svc.UpdateShopClipKnowledge(admin, []ShopClipKnowledgeEntry{{ID: "category:hg", Enabled: true, Content: "先展示用户实际操作，再展示完成状态。"}, {ID: "family:hg-11-7-29", Enabled: false}})
	if err != nil || status.UpdatedAt.IsZero() {
		t.Fatalf("save failed: %+v %v", status, err)
	}
	after, err := svc.ShopClipKnowledgeContext("hg-11-7-29")
	if err != nil {
		t.Fatal(err)
	}
	if before.Digest == after.Digest || !strings.Contains(after.Content, "先展示用户实际操作") || slices.Contains(after.MatchedIDs, "family:hg-11-7-29") {
		t.Fatal("saved controls do not change actual planner retrieval")
	}
	page, err := svc.ShopClipKnowledgeCategoryList(admin, "", "hg-11-7-29", 1)
	if err != nil || len(page.Items) != 1 || page.Items[0].StrategyID != "category:hg" || !page.Items[0].Inherited {
		t.Fatalf("disabled family should inherit enabled root: %+v %v", page, err)
	}
	if _, err := svc.ShopClipKnowledgeCategoryList(admin, "bad-id", "", 1); err == nil {
		t.Fatal("invalid parent accepted")
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: shopClipKnowledgeSettingKey, ValueJSON: "not-json"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ShopClipKnowledgeContext("hg"); err == nil {
		t.Fatal("corrupted storage must not silently use defaults")
	}
}
