export const logicalModelCodePattern = /^[a-z0-9][a-z0-9._-]{1,79}$/;

export function normalizeLogicalModelCode(value: string): string {
    return value
        .normalize("NFKC")
        .trim()
        .toLowerCase()
        .replace(/[\u2010-\u2015\u2212\uFF0D]/g, "-")
        .replace(/\s*-\s*/g, "-")
        .replace(/\s+/g, "-");
}
