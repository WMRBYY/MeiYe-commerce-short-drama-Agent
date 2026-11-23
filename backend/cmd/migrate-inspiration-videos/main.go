// Command migrate-inspiration-videos imports licensed MP4 files into the
// platform OSS catalog prefix without exposing storage credentials.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"sync"

	"yingce/backend/internal/database"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func main() {
	preflight := flag.Bool("preflight", false, "validate storage and CDN configuration")
	apply := flag.Bool("apply", false, "upload one verified MP4")
	verify := flag.Bool("verify", false, "verify one MP4 through the signed CDN")
	signPut := flag.Bool("sign-put", false, "write short-lived direct OSS upload URLs")
	verifyRemote := flag.Bool("verify-remote", false, "verify previously uploaded MP4s from OSS and CDN")
	digest := flag.String("digest", "", "lowercase SHA-256 of the MP4")
	filePath := flag.String("file", "", "absolute path to the MP4")
	batchManifest := flag.String("batch-manifest", "", "JSON list of digest and file pairs")
	ledgerPath := flag.String("ledger", "", "append-only digest ledger for resumable batch upload")
	workers := flag.Int("workers", 6, "concurrent batch uploads, 1 to 16")
	outputPath := flag.String("output", "", "private JSON output for signed upload URLs")
	flag.Parse()
	if strings.TrimSpace(os.Getenv("CANVAS_BACKEND_DATA_DIR")) == "" || os.Getenv("CANVAS_DATABASE_DRIVER") != "postgres" || os.Getenv("DATABASE_URL") == "" {
		fatal("production database configuration unavailable")
	}
	singleUpload := *batchManifest == "" && *digest != "" && *filePath != ""
	batchUpload := *batchManifest != "" && *digest == "" && *filePath == ""
	if boolCount(*preflight, *apply, *verify, *signPut, *verifyRemote) != 1 || (*apply && !singleUpload && !batchUpload) ||
		((*apply && batchUpload || *verifyRemote) && (*ledgerPath == "" || *workers < 1 || *workers > 16)) ||
		(*verify && *digest == "") || ((*signPut || *verifyRemote) && (*batchManifest == "" || *digest != "" || *filePath != "")) ||
		(*signPut && *outputPath == "") {
		fatal("specify --preflight, --apply with one file or batch manifest and ledger, or --verify with digest")
	}
	db, err := database.Open(database.Config{Driver: "postgres", DSN: os.Getenv("DATABASE_URL"), DataDir: os.Getenv("CANVAS_BACKEND_DATA_DIR")})
	if err != nil {
		fatal("database connection failed")
	}
	conn, err := db.DB()
	if err != nil {
		fatal("database handle unavailable")
	}
	defer conn.Close()
	if err := database.RequireSchemaVersion(db); err != nil {
		fatal("schema version mismatch")
	}
	svc := service.New(repository.New(db), os.Getenv("CANVAS_BACKEND_DATA_DIR"))
	defer svc.Close()
	if *preflight {
		if _, err := svc.InspirationVideoCDNURL(strings.Repeat("0", 64)); err != nil {
			fatal("platform OSS/CDN is not ready")
		}
		fmt.Println("INSPIRATION_VIDEO_CDN_PREFLIGHT=PASS")
		return
	}
	if *verify {
		if err := svc.VerifyInspirationVideoCDN(*digest); err != nil {
			fatal("video CDN Range verification failed")
		}
		fmt.Printf("INSPIRATION_VIDEO_CDN_VERIFIED=%s\n", *digest)
		return
	}
	if *signPut {
		signBatch(svc, *batchManifest, *outputPath)
		return
	}
	if *verifyRemote {
		importBatch(svc, *batchManifest, *ledgerPath, *workers, true)
		return
	}
	if *batchManifest != "" {
		importBatch(svc, *batchManifest, *ledgerPath, *workers, false)
		return
	}
	if err := svc.ImportInspirationVideo(*digest, *filePath); err != nil {
		fatal("video upload or verification failed")
	}
	fmt.Printf("INSPIRATION_VIDEO_IMPORTED=%s\n", *digest)
}

type batchItem struct {
	Digest string `json:"digest"`
	File   string `json:"file"`
}

func readBatch(manifestPath string) []batchItem {
	encoded, err := os.ReadFile(manifestPath)
	if err != nil {
		fatal("batch manifest unavailable")
	}
	var items []batchItem
	if err := json.Unmarshal(encoded, &items); err != nil || len(items) == 0 {
		fatal("batch manifest invalid")
	}
	return items
}

func signBatch(svc *service.Service, manifestPath, outputPath string) {
	items := readBatch(manifestPath)
	type signedItem struct {
		Digest string `json:"digest"`
		URL    string `json:"url"`
	}
	signed := make([]signedItem, 0, len(items))
	for _, item := range items {
		url, err := svc.InspirationVideoPutURL(item.Digest)
		if err != nil {
			fatal("batch upload URL signing failed")
		}
		signed = append(signed, signedItem{Digest: item.Digest, URL: url})
	}
	encoded, err := json.Marshal(signed)
	if err != nil || os.WriteFile(outputPath, encoded, 0600) != nil {
		fatal("batch signed URL file cannot be written")
	}
	fmt.Printf("INSPIRATION_VIDEO_UPLOAD_URLS=%d\n", len(signed))
}

func importBatch(svc *service.Service, manifestPath, ledgerPath string, workers int, verifyOnly bool) {
	items := readBatch(manifestPath)
	completed := make(map[string]bool)
	if file, err := os.Open(ledgerPath); err == nil {
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			completed[strings.TrimSpace(scanner.Text())] = true
		}
		_ = file.Close()
	} else if !os.IsNotExist(err) {
		fatal("batch ledger unavailable")
	}
	ledger, err := os.OpenFile(ledgerPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		fatal("batch ledger cannot be opened")
	}
	defer ledger.Close()
	queue := make(chan batchItem)
	var wg sync.WaitGroup
	var mu sync.Mutex
	succeeded, failed, skipped := 0, 0, 0
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range queue {
				var err error
				if verifyOnly {
					err = svc.VerifyInspirationVideoOrigin(item.Digest)
				} else {
					err = svc.ImportInspirationVideo(item.Digest, item.File)
				}
				if err == nil {
					err = svc.VerifyInspirationVideoCDN(item.Digest)
				}
				mu.Lock()
				if err != nil {
					failed++
					fmt.Fprintf(os.Stderr, "INSPIRATION_VIDEO_FAILED=%s\n", item.Digest)
				} else if _, err := fmt.Fprintln(ledger, item.Digest); err != nil || ledger.Sync() != nil {
					failed++
					fmt.Fprintf(os.Stderr, "INSPIRATION_VIDEO_LEDGER_FAILED=%s\n", item.Digest)
				} else {
					succeeded++
				}
				mu.Unlock()
			}
		}()
	}
	queued := make(map[string]bool)
	for _, item := range items {
		if completed[item.Digest] || queued[item.Digest] {
			skipped++
			continue
		}
		queued[item.Digest] = true
		queue <- item
	}
	close(queue)
	wg.Wait()
	fmt.Printf("INSPIRATION_VIDEO_BATCH imported=%d skipped=%d failed=%d\n", succeeded, skipped, failed)
	if failed != 0 {
		os.Exit(1)
	}
}

func boolCount(values ...bool) int {
	count := 0
	for _, value := range values {
		if value {
			count++
		}
	}
	return count
}

func fatal(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
