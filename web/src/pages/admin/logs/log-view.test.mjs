import assert from "node:assert/strict";
import { test } from "node:test";
import { logStatus } from "./log-view.ts";

test("failed route attempt stays failed when its business task succeeds", () => {
    assert.deepEqual(logStatus({ status: "failed", taskStatus: "succeeded", providerStatus: "" }), { label: "失败", tone: "error" });
    assert.deepEqual(logStatus({ status: "succeeded", taskStatus: "succeeded", providerStatus: "" }), { label: "成功", tone: "success" });
});
