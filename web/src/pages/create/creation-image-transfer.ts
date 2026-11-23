export const CREATION_IMAGE_ASSET_DND_TYPE = "application/x-yingce-image-asset";

const imageExtension = /\.(?:png|jpe?g|webp|gif|avif|bmp)$/i;

export function readCreationImageTransfer(transfer: DataTransfer) {
    const files = [...transfer.files];
    for (const item of transfer.items) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file && !files.some((existing) => existing === file || (existing.name === file.name && existing.size === file.size))) files.push(file);
    }
    const images = files.filter((file) => file.type.startsWith("image/") || (!file.type && imageExtension.test(file.name)));
    const assetId = transfer.getData(CREATION_IMAGE_ASSET_DND_TYPE).trim();
    const uriList = transfer.getData("text/uri-list").split(/\r?\n/).find((line) => line && !line.startsWith("#"))?.trim() || "";
    const html = transfer.getData("text/html");
    const htmlImage = html ? new DOMParser().parseFromString(html, "text/html").querySelector("img")?.getAttribute("src") || "" : "";
    const plain = transfer.getData("text/plain").trim();
    const url = [htmlImage, uriList, plain].find((candidate) => {
        try {
            return new URL(candidate).protocol === "https:";
        } catch {
            return false;
        }
    }) || "";
    return { files: images, assetId, url };
}

export function mightContainCreationImage(transfer: DataTransfer) {
    return [...transfer.types].some((type) => type === "Files" || type === CREATION_IMAGE_ASSET_DND_TYPE || type === "text/uri-list" || type === "text/html");
}

export function normalizeTransferredImage(file: File) {
    if (file.type) return file;
    const extension = file.name.toLowerCase().split(".").pop();
    const mimeType = extension === "jpg" || extension === "jpeg" ? "image/jpeg"
        : extension === "png" ? "image/png"
        : extension === "webp" ? "image/webp"
        : extension === "gif" ? "image/gif"
        : extension === "avif" ? "image/avif"
        : extension === "bmp" ? "image/bmp" : "";
    return mimeType ? new File([file], file.name, { type: mimeType, lastModified: file.lastModified }) : file;
}
