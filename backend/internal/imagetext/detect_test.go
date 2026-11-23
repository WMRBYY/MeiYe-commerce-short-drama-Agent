package imagetext

import (
	"context"
	"image"
	"image/color"
	"image/draw"
	"os/exec"
	"testing"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

const tsvHeader = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"

func TestNativePixelLinesAndChineseWordSpacing(t *testing.T) {
	input := tsvHeader + "5\t1\t1\t1\t1\t1\t10\t20\t20\t24\t90\t珍珠\n" +
		"5\t1\t1\t1\t1\t2\t33\t20\t40\t24\t80\t洁面乳\n" +
		"5\t1\t2\t1\t1\t1\t20\t60\t40\t20\t95\tPEARL\n" +
		"5\t1\t2\t1\t1\t2\t65\t62\t80\t18\t95\tCLEANSER\n"
	lines, err := parseTSV(input, 200, 100, 1856)
	if err != nil || len(lines) != 2 {
		t.Fatalf("%+v %v", lines, err)
	}
	if lines[0].Text != "珍珠洁面乳" || lines[0].Box != (Box{X: 10, Y: 1876, Width: 63, Height: 24}) || lines[0].Confidence != 0.84 {
		t.Fatalf("source pixel mapping lost: %+v", lines[0])
	}
	if lines[1].Text != "PEARL CLEANSER" || lines[1].Box.Width != 125 {
		t.Fatalf("English spaces or line bounds lost: %+v", lines[1])
	}
}

func TestOCRRejectsInvalidCoordinatesAndMalformedOutput(t *testing.T) {
	for _, input := range []string{"invented JSON", tsvHeader + "5\t1\t1\t1\t1\t1\t95\t20\t20\t10\t90\ttest\n", tsvHeader + "5\t1\t1\t1\t1\t1\t0\t0\t20\t10\tNaN\ttest\n"} {
		if _, err := parseTSV(input, 100, 100, 0); err == nil {
			t.Fatalf("invalid OCR accepted: %s", input)
		}
	}
}

func TestLongImageWindowsAndDuplicateLines(t *testing.T) {
	tiles := windows(6000)
	if len(tiles) != 4 || tiles[0].Min.Y != 0 || tiles[len(tiles)-1].Max.Y != 6000 {
		t.Fatal(tiles)
	}
	for i := 1; i < len(tiles); i++ {
		if tiles[i].Min.Y >= tiles[i-1].Max.Y {
			t.Fatal("tile boundary has no overlap")
		}
	}
	line := Region{Text: "PEARL CLEANSER", Box: Box{X: 10, Y: 1910, Width: 300, Height: 24}, Confidence: .95}
	partial := Region{Text: "PEARL", Box: Box{X: 10, Y: 1912, Width: 100, Height: 20}, Confidence: .5}
	result := merge([]Region{partial}, []Region{line})
	if len(result) != 1 || result[0].Text != line.Text {
		t.Fatal(result)
	}
}

func TestActualTesseractPixels(t *testing.T) {
	if _, err := exec.LookPath("tesseract"); err != nil {
		t.Skip("tesseract not installed; parser tests still run")
	}
	// Render actual font outlines, not a low-resolution bitmap enlarged into blocks.
	typeface, err := opentype.Parse(goregular.TTF)
	if err != nil {
		t.Fatal(err)
	}
	face, err := opentype.NewFace(typeface, &opentype.FaceOptions{Size: 48, DPI: 72, Hinting: font.HintingFull})
	if err != nil {
		t.Fatal(err)
	}
	defer face.Close()
	source := image.NewRGBA(image.Rect(0, 0, 720, 100))
	draw.Draw(source, source.Bounds(), image.White, image.Point{}, draw.Src)
	d := font.Drawer{Dst: source, Src: image.Black, Face: face, Dot: fixed.P(40, 72)}
	d.DrawString("PEARL CLEANSER")
	regions, err := Detect(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if len(regions) != 1 || regions[0].Text != "PEARL CLEANSER" {
		t.Fatalf("actual OCR did not read fixture: %+v", regions)
	}
	box := regions[0].Box
	for _, point := range []image.Point{{box.X, box.Y}, {box.X + box.Width - 1, box.Y + box.Height - 1}} {
		if !point.In(source.Bounds()) {
			t.Fatal("box outside image")
		}
	}
	// Every dark glyph pixel must remain inside the returned line box.
	for y := 0; y < 100; y++ {
		for x := 0; x < 720; x++ {
			if color.GrayModel.Convert(source.At(x, y)).(color.Gray).Y < 128 && !image.Pt(x, y).In(image.Rect(box.X, box.Y, box.X+box.Width, box.Y+box.Height)) {
				t.Fatalf("glyph outside OCR box at %d,%d: %+v", x, y, box)
			}
		}
	}
}
