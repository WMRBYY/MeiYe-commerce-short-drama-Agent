package skills

import (
	"archive/zip"
	"bytes"
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestFetchGitHubSkillSubdirAvoidsRepositoryZip(t *testing.T) {
	const commit = "ee0fb29433d02ccc22e3e6cea9ab4586d49fd42e"
	requests := make([]string, 0, 3)
	client := &http.Client{Transport: githubRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests = append(requests, request.URL.String())
		switch request.URL.String() {
		case "https://api.github.com/repos/nexscope-ai/eCommerce-Skills/commits/main":
			return githubTestResponse(http.StatusOK, `{"sha":"`+commit+`"}`), nil
		case "https://api.github.com/repos/nexscope-ai/eCommerce-Skills/git/trees/" + commit + "?recursive=1":
			return githubTestResponse(http.StatusOK, `{"truncated":false,"tree":[{"path":"etsy-listing-photography","type":"tree","mode":"040000"},{"path":"etsy-listing-photography/SKILL.md","type":"blob","mode":"100644","size":62},{"path":"etsy-listing-photography/references/camera.md","type":"blob","mode":"100644","size":8},{"path":"other-skill/SKILL.md","type":"blob","mode":"100644","size":20}]}`), nil
		case "https://raw.githubusercontent.com/nexscope-ai/eCommerce-Skills/" + commit + "/etsy-listing-photography/SKILL.md":
			return githubTestResponse(http.StatusOK, "---\nname: etsy-listing-photography\ndescription: Etsy photos\n---\n"), nil
		case "https://raw.githubusercontent.com/nexscope-ai/eCommerce-Skills/" + commit + "/etsy-listing-photography/references/camera.md":
			return githubTestResponse(http.StatusOK, "# Camera"), nil
		default:
			t.Fatalf("unexpected GitHub request: %s", request.URL)
			return nil, nil
		}
	})}
	archive, gotCommit, sourceURL, ref, err := fetchGitHubSkillArchiveWithClient(context.Background(), client, githubSkillSpec{Owner: "nexscope-ai", Repo: "eCommerce-Skills", Ref: "main", Subdir: "etsy-listing-photography"})
	if err != nil {
		t.Fatal(err)
	}
	if gotCommit != commit || sourceURL != "https://github.com/nexscope-ai/eCommerce-Skills" || ref != "main" {
		t.Fatalf("source metadata = %q %q %q", gotCommit, sourceURL, ref)
	}
	if archive.Metadata.Name != "etsy-listing-photography" || len(archive.Files) != 2 || string(archive.Files["references/camera.md"]) != "# Camera" || len(requests) != 4 {
		t.Fatalf("archive = %#v, requests = %#v", archive, requests)
	}
}

func TestFetchGitHubSkillSubdirRejectsSymlink(t *testing.T) {
	client := &http.Client{Transport: githubRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if strings.Contains(request.URL.Path, "/git/trees/") {
			return githubTestResponse(http.StatusOK, `{"tree":[{"path":"photo/SKILL.md","type":"blob","mode":"120000","size":10}]}`), nil
		}
		t.Fatalf("unexpected GitHub request: %s", request.URL)
		return nil, nil
	})}
	_, err := fetchGitHubSkillSubdir(context.Background(), client, githubSkillSpec{Owner: "owner", Repo: "repo", Subdir: "photo"}, "abc")
	if err == nil || !strings.Contains(err.Error(), "软链接") {
		t.Fatalf("error = %v, want symlink rejection", err)
	}
}

func TestFetchGitHubSkillRootSkipsLargeExamples(t *testing.T) {
	const commit = "ee0fb29433d02ccc22e3e6cea9ab4586d49fd42e"
	var zipData bytes.Buffer
	writer := zip.NewWriter(&zipData)
	for _, entry := range []struct {
		path string
		data []byte
	}{
		{"ecommerce-image-suite-" + commit + "/SKILL.md", []byte("---\nname: ecommerce-image-suite\ndescription: Product images\n---\n")},
		{"ecommerce-image-suite-" + commit + "/scripts/generate.py", []byte("# script")},
		{"ecommerce-image-suite-" + commit + "/example/large.jpg", bytes.Repeat([]byte("x"), maxSkillPackageBytes+1)},
	} {
		header := &zip.FileHeader{Name: entry.path, Method: zip.Store}
		header.SetMode(0o644)
		file, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write(entry.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	requests := make([]string, 0, 2)
	client := &http.Client{Transport: githubRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests = append(requests, request.URL.String())
		switch request.URL.String() {
		case "https://api.github.com/repos/wzj177/ecommerce-image-suite/commits/main":
			return githubTestResponse(http.StatusOK, `{"sha":"`+commit+`"}`), nil
		case "https://codeload.github.com/wzj177/ecommerce-image-suite/zip/" + commit:
			return githubTestResponse(http.StatusOK, zipData.String()), nil
		default:
			t.Fatalf("unexpected GitHub request: %s", request.URL)
			return nil, nil
		}
	})}
	archive, gotCommit, _, _, err := fetchGitHubSkillArchiveWithClient(context.Background(), client, githubSkillSpec{Owner: "wzj177", Repo: "ecommerce-image-suite", Ref: "main"})
	if err != nil {
		t.Fatal(err)
	}
	if gotCommit != commit || archive.Metadata.Name != "ecommerce-image-suite" || len(archive.Files) != 2 || string(archive.Files["scripts/generate.py"]) != "# script" || len(requests) != 2 {
		t.Fatalf("archive = %#v, requests = %#v", archive, requests)
	}
}
