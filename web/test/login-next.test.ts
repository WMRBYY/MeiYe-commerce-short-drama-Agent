import { describe, expect, test } from "bun:test";
import { safeLoginNext, useLoginDialogStore } from "../src/stores/use-login-dialog-store";

describe("login return destinations", () => {
    test("rejects external URLs and control characters before browser URL normalization", () => {
        for (const value of ["https://other.example", "//other.example", "/\\other.example", "/\t/other.example", "/\r/other.example", "/\n/other.example", "/\u0000/other.example", "/ /other.example", "/%09/other.example", "/%2fother.example", "/%5cother.example"])
            expect(safeLoginNext(value)).toBe("/");
        const decodedQuery = new URLSearchParams("next=%2F%09%2Fother.example").get("next");
        expect(safeLoginNext(decodedQuery)).toBe("/");
    });

    test("normalizes paths before rejecting recursive authentication routes", () => {
        for (const value of ["/login", "/LOGIN?next=/canvas", "/register#form", "/temporary/../login", "/%6cogin", "/.%2e/register", "/%malformed"])
            expect(safeLoginNext(value)).toBe("/");
    });

    test("preserves local feature destinations, query strings and fragments", () => {
        expect(safeLoginNext("/canvas/project-id?agent=1#draft")).toBe("/canvas/project-id?agent=1#draft");
        expect(safeLoginNext("/ecommerce?mode=quick&product=%E9%A6%99%E6%B0%B4")).toBe("/ecommerce?mode=quick&product=%E9%A6%99%E6%B0%B4");
        expect(safeLoginNext("/assets/../canvas?agent=1")).toBe("/canvas?agent=1");
        expect(safeLoginNext("/canvas?reference=https%3A%2F%2Fassets.example%2Fa.png")).toBe("/canvas?reference=https%3A%2F%2Fassets.example%2Fa.png");
        expect(safeLoginNext(undefined)).toBe("/");
    });

    test("the shared dialog store applies the same destination boundary", () => {
        useLoginDialogStore.getState().show("/\t/other.example");
        expect(useLoginDialogStore.getState().next).toBe("/");
        expect(useLoginDialogStore.getState().open).toBe(true);
        useLoginDialogStore.getState().close();
    });
});
