import { describe, expect, test } from "bun:test";
import { daylightTheme } from "../src/lib/daylight-theme";
import { safeLoginNext } from "../src/stores/use-login-dialog-store";

describe("public login navigation", () => {
    test("keeps internal destinations and rejects unsafe redirects and login loops", () => {
        expect(safeLoginNext("/canvas/abc?mode=image")).toBe("/canvas/abc?mode=image");
        expect(safeLoginNext("/ecommerce?mode=quick")).toBe("/ecommerce?mode=quick");
        for (const value of [null, undefined, "", "https://other.example", "//other.example", "/\\other.example", "/login?next=/", "/register", "/\nother.example"]) expect(safeLoginNext(value)).toBe("/");
    });
    test("new visitor theme follows local daytime boundaries", () => {
        for (const hour of [0, 1, 6, 19, 23]) expect(daylightTheme(hour)).toBe("dark");
        for (const hour of [7, 12, 18]) expect(daylightTheme(hour)).toBe("light");
    });
});
