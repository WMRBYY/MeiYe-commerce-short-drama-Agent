package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"yingce/backend/internal/service"

	"yingce/backend/internal/model"
)

type skillGitHubTransport func(*http.Request) (*http.Response, error)

func (fn skillGitHubTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestGitHubSkillDiscoveryHTTPAndSelectedInstall(t *testing.T) {
	router, db, dataDir := newGitHubSkillHTTPTest(t)
	commit := strings.Repeat("a", 40)
	files := map[string]string{
		"SKILL.md":            "---\nname: screenplay\ndescription: Screenplay writing\n---\n# Write\n",
		"scripts/check.py":    "print('check')\n",
		"references/guide.md": "# Writing guide\n",
	}
	requests := 0
	originalTransport := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = originalTransport })
	http.DefaultTransport = skillGitHubTransport(func(req *http.Request) (*http.Response, error) {
		requests++
		var body string
		switch {
		case req.URL.String() == "https://api.github.com/repos/example/drama-skills":
			body = `{"default_branch":"main"}`
		case req.URL.String() == "https://api.github.com/repos/example/drama-skills/commits/main":
			body = `{"sha":"` + commit + `"}`
		case req.URL.String() == "https://api.github.com/repos/example/drama-skills/git/trees/"+commit+"?recursive=1":
			entries := []map[string]any{{"path": "skills/assets/SKILL.md", "type": "blob", "mode": "100644", "size": 20}}
			for name, content := range files {
				entries = append(entries, map[string]any{"path": "skills/write/" + name, "type": "blob", "mode": "100644", "size": len(content)})
			}
			for index := 0; index < 600; index++ {
				entries = append(entries, map[string]any{"path": fmt.Sprintf("examples/%d.txt", index), "type": "blob", "mode": "100644", "size": 1})
			}
			encoded, err := json.Marshal(map[string]any{"tree": entries, "truncated": false})
			if err != nil {
				t.Fatal(err)
			}
			body = string(encoded)
		case req.URL.Host == "raw.githubusercontent.com":
			prefix := "/example/drama-skills/" + commit + "/skills/write/"
			content, exists := files[strings.TrimPrefix(req.URL.Path, prefix)]
			if !strings.HasPrefix(req.URL.Path, prefix) || !exists {
				t.Fatalf("download outside selected skill: %s", req.URL)
			}
			body = content
		default:
			t.Fatalf("unexpected request (repository ZIP must not be downloaded): %s", req.URL)
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})

	const discover = "/api/skills/discover/github"
	const input = `{"url":"https://github.com/example/drama-skills"}`
	githubSkillHTTPRequest(t, router, "POST", discover, input, false, http.StatusUnauthorized)
	githubSkillHTTPRequest(t, router, "POST", discover, `{`, true, http.StatusBadRequest)
	githubSkillHTTPRequest(t, router, "POST", discover, `{"url":"http://localhost/repo"}`, true, http.StatusBadRequest)
	githubSkillHTTPRequest(t, router, "POST", discover, `{"url":"`+strings.Repeat("x", 33<<10)+`"}`, true, http.StatusBadRequest)
	if requests != 0 {
		t.Fatalf("invalid or anonymous requests reached GitHub: %d", requests)
	}
	var discovery struct {
		Code int                          `json:"code"`
		Data service.SkillGitHubDiscovery `json:"data"`
	}
	if err := json.Unmarshal(githubSkillHTTPRequest(t, router, "POST", discover, input, true, http.StatusOK), &discovery); err != nil {
		t.Fatal(err)
	}
	if discovery.Code != 0 || len(discovery.Data.Skills) != 2 || discovery.Data.SourceCommit != commit || discovery.Data.SourceRef != "main" || discovery.Data.Skills[1].Subdir != "skills/write" {
		t.Fatalf("discovery = %#v", discovery)
	}
	var count int64
	if err := db.Model(&model.Skill{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("discovery created skills: count=%d err=%v", count, err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "skill-packages")); !os.IsNotExist(err) {
		t.Fatalf("discovery wrote package files: %v", err)
	}
	var installed struct {
		Code int `json:"code"`
		Data struct {
			Skill service.SkillItem `json:"skill"`
		} `json:"data"`
	}
	body := `{"url":"https://github.com/example/drama-skills","ref":"main","subdir":"skills/write","tag":"drama","isPrivate":true,"autoUpdate":true}`
	if err := json.Unmarshal(githubSkillHTTPRequest(t, router, "POST", "/api/skills/install/github", body, true, http.StatusOK), &installed); err != nil {
		t.Fatal(err)
	}
	skill := installed.Data.Skill
	if installed.Code != 0 || skill.SourceSubdir != "skills/write" || skill.SourceRef != "main" || skill.SourceCommit != commit || skill.FileCount != 3 || !skill.IsPrivate || !skill.AutoUpdate || skill.Tag != "drama" || skill.OwnerUID != "github-owner" {
		t.Fatalf("installed = %#v", installed)
	}
	for name, content := range files {
		got := githubSkillHTTPRequest(t, router, "GET", "/api/skills/"+skill.SkillID+"/file/raw?path="+name, "", true, http.StatusOK)
		if string(got) != content {
			t.Fatalf("installed file %s differs from source", name)
		}
	}
	commit = strings.Repeat("b", 40)
	files["references/guide.md"] = "# Updated guide\n"
	githubSkillHTTPRequest(t, router, "POST", "/api/skills/"+skill.SkillID+"/sync", "", true, http.StatusOK)
	var saved model.Skill
	if err := db.First(&saved, "id = ?", skill.SkillID).Error; err != nil {
		t.Fatal(err)
	}
	if saved.SourceCommit != commit || saved.SourceSubdir != "skills/write" || saved.FileCount != 3 || !saved.AutoUpdate {
		t.Fatalf("sync lost selected source: %#v", saved)
	}
	got := githubSkillHTTPRequest(t, router, "GET", "/api/skills/"+skill.SkillID+"/file/raw?path=references/guide.md", "", true, http.StatusOK)
	if string(got) != files["references/guide.md"] {
		t.Fatal("sync did not persist updated reference file")
	}
}

func TestGitHubSkillDramaLive(t *testing.T) {
	if os.Getenv("CANVAS_TEST_GITHUB_LIVE") != "1" {
		t.Skip("set CANVAS_TEST_GITHUB_LIVE=1 to verify the public repository in an isolated local database")
	}
	originalTransport := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = originalTransport })
	http.DefaultTransport = skillGitHubTransport(func(req *http.Request) (*http.Response, error) {
		response, err := originalTransport.RoundTrip(req)
		if err != nil {
			t.Logf("public GitHub transport failed: %s: %v", req.URL, err)
		} else if response.StatusCode >= 400 {
			t.Logf("public GitHub returned HTTP %d: %s", response.StatusCode, req.URL)
		}
		return response, err
	})
	router, _, _ := newGitHubSkillHTTPTest(t)
	var discovery struct {
		Data service.SkillGitHubDiscovery `json:"data"`
	}
	if err := json.Unmarshal(githubSkillHTTPRequest(t, router, "POST", "/api/skills/discover/github", `{"url":"https://github.com/zenstory-ai/drama-skills"}`, true, http.StatusOK), &discovery); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, candidate := range discovery.Data.Skills {
		found = found || candidate.Subdir == "skills/short-drama-write"
	}
	if len(discovery.Data.Skills) < 2 || !found {
		t.Fatalf("expected collection with writing skill, got %#v", discovery.Data)
	}
	var result struct {
		Data struct {
			Skill service.SkillItem `json:"skill"`
		} `json:"data"`
	}
	body := `{"url":"https://github.com/zenstory-ai/drama-skills","ref":"main","subdir":"skills/short-drama-write","tag":"drama","isPrivate":true,"autoUpdate":true}`
	if err := json.Unmarshal(githubSkillHTTPRequest(t, router, "POST", "/api/skills/install/github", body, true, http.StatusOK), &result); err != nil {
		t.Fatal(err)
	}
	skill := result.Data.Skill
	if skill.SkillID == "" || skill.SourceSubdir != "skills/short-drama-write" || skill.FileCount < 3 {
		t.Fatalf("invalid installed skill: %#v", skill)
	}
	for _, name := range []string{"SKILL.md", "references/script-craft.md", "scripts/duration_estimate.py"} {
		if len(githubSkillHTTPRequest(t, router, "GET", "/api/skills/"+skill.SkillID+"/file/raw?path="+name, "", true, http.StatusOK)) == 0 {
			t.Fatalf("empty installed file: %s", name)
		}
	}
	t.Logf("live repository commit=%s candidates=%d installed=%s files=%d bytes=%d", skill.SourceCommit, len(discovery.Data.Skills), skill.SkillName, skill.FileCount, skill.TotalBytes)
}
