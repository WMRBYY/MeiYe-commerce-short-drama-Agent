import { expect, test } from "bun:test";
import { CREATION_IMAGE_ASSET_DND_TYPE, normalizeTransferredImage, readCreationImageTransfer } from "../src/pages/create/creation-image-transfer";

function transfer(input: { files?: File[]; itemFiles?: File[]; data?: Record<string, string> }) {
    const files = input.files || [];
    const itemFiles = input.itemFiles || [];
    return {
        files,
        items: itemFiles.map((file) => ({ kind: "file", getAsFile: () => file })),
        getData: (type: string) => input.data?.[type] || "",
    } as unknown as DataTransfer;
}

test("Windows file drag keeps readable image files when MIME is missing", () => {
    const file = new File(["image"], "photo.png");
    const parsed = readCreationImageTransfer(transfer({ files: [file] }));
    expect(parsed.files).toEqual([file]);
    expect(normalizeTransferredImage(parsed.files[0]).type).toBe("image/png");
});

test("clipboard item image is accepted without a FileList entry", () => {
    const file = new File(["image"], "pasted.webp", { type: "image/webp" });
    expect(readCreationImageTransfer(transfer({ itemFiles: [file] })).files).toEqual([file]);
});

test("internal asset ID is preferred to a copied external URL", () => {
    const parsed = readCreationImageTransfer(transfer({ data: { [CREATION_IMAGE_ASSET_DND_TYPE]: "asset-123", "text/uri-list": "https://example.com/image.png" } }));
    expect(parsed.assetId).toBe("asset-123");
    expect(parsed.url).toBe("https://example.com/image.png");
});

test("HTTP and local URIs are not imported as web images", () => {
    for (const url of ["http://example.com/image.png", "file:///C:/photo.png", "javascript:alert(1)"]) {
        expect(readCreationImageTransfer(transfer({ data: { "text/uri-list": url } })).url).toBe("");
    }
});
