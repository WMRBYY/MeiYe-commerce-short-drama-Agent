import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseContributors } from "../src/pages/welcome/contributors-parse";

const identityAvatar = (path: string) => path;

test("welcome contributors do not reuse a historical contact roster", () => {
    const readme = readFileSync(resolve(import.meta.dir, "../../README.md"), "utf8");
    const people = parseContributors(readme, identityAvatar);

    expect(people).toEqual([]);
});

test("welcome contributors still parse markdown pipe tables", () => {
    const markdown = `## 贡献者与团队

| 头像 | 昵称 | 邮箱 | 签名 |
| --- | --- | --- | --- |
| <img src="assets/user-example.jpg" alt="Example"> | Example<br>项目发起者 · 微信：example-id | founder@example.com | 把故事搬上银幕 |
| <img src="assets/user-ken.jpg" alt="ken"> | ken | ken@example.com | 走自己的路 |

## 下一章
`;
    expect(parseContributors(markdown, identityAvatar)).toEqual([
        {
            name: "Example",
            avatar: "assets/user-example.jpg",
            signature: "把故事搬上银幕",
            email: "founder@example.com",
            wechat: "example-id",
            isFounder: true,
        },
        {
            name: "ken",
            avatar: "assets/user-ken.jpg",
            signature: "走自己的路",
            email: "ken@example.com",
            wechat: undefined,
            isFounder: false,
        },
    ]);
});
