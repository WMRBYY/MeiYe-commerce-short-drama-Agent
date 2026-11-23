package app

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func canvasFixture(t *testing.T, width, height int) []byte {
	t.Helper()
	src := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			src.Set(x, y, color.RGBA{uint8(x % 255), uint8(y % 255), 77, 255})
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, src); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestGeneratedImageCanvasRatiosPreserveContent(t *testing.T) {
	source := canvasFixture(t, 120, 180)
	for _, tc := range []struct {
		canvas string
		w, h   int
	}{{"9:16", 120, 213}, {"16:9", 320, 180}, {"1:1", 180, 180}, {"3:4", 135, 180}, {"1024x1824", 120, 214}} {
		t.Run(tc.canvas, func(t *testing.T) {
			out, mime, err := fitGeneratedImageCanvas(source, "image/png", tc.canvas)
			if err != nil || mime != "image/png" {
				t.Fatalf("fit: %s %v", mime, err)
			}
			img, _, err := image.Decode(bytes.NewReader(out))
			if err != nil {
				t.Fatal(err)
			}
			if img.Bounds().Dx() != tc.w || img.Bounds().Dy() != tc.h {
				t.Fatalf("size=%v want %dx%d", img.Bounds(), tc.w, tc.h)
			}
			src, _, _ := image.Decode(bytes.NewReader(source))
			x, y := (tc.w-120)/2, (tc.h-180)/2
			for sy := 0; sy < 180; sy++ {
				for sx := 0; sx < 120; sx++ {
					if color.NRGBAModel.Convert(img.At(x+sx, y+sy)) != color.NRGBAModel.Convert(src.At(sx, sy)) {
						t.Fatalf("source content changed at %d,%d", sx, sy)
					}
				}
			}
			again, _, err := fitGeneratedImageCanvas(out, mime, tc.canvas)
			if err != nil || !bytes.Equal(again, out) {
				t.Fatal("save retry changed canvas again")
			}
		})
	}
}

func TestGeneratedImageCanvasBothPersistencePaths(t *testing.T) {
	for _, mode := range []string{"inline", "checkpoint"} {
		t.Run(mode, func(t *testing.T) {
			s, db := newMediaRecoveryTestService(t)
			task := seedMediaTask(t, db, providerConfig{})
			task.InputJSON = `{"mode":"image","metadata":{"workbench":{"kind":"image","parameters":{"size":"1024x1536","canvasSize":"9:16"}}}}`
			var result map[string]interface{}
			var err error
			source := canvasFixture(t, 120, 180)
			if mode == "inline" {
				result, err = s.persistGeneratedTaskMediaResult(task, map[string]interface{}{"mode": "image", "images": []interface{}{map[string]interface{}{"dataUrl": dataURL("image/png", source), "width": 120, "height": 180}}})
			} else {
				name, e := s.stageInlineMedia(source)
				if e != nil {
					t.Fatal(e)
				}
				resource, _, e := s.storeTaskMediaFile(task, 0, s.mediaTempPath(name), "image/png", "image", nil)
				err = e
				if resource != nil {
					result = map[string]interface{}{"width": resource.Width, "height": resource.Height}
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			if mode == "inline" {
				result = result["images"].([]interface{})[0].(map[string]interface{})
			}
			if intValue(result["width"]) != 120 || intValue(result["height"]) != 213 {
				t.Fatalf("wrong saved dimensions: %+v", result)
			}
		})
	}
}
