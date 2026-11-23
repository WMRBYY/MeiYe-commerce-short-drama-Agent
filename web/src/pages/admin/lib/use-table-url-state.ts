import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

export type TableUrlState = {
    filter: string;
    role: string;
    status: string;
    /** 用户分组编码；all 表示不过滤。 */
    group: string;
    /** 排序：空为注册时间倒序；credits_desc / credits_asc 按可用积分。 */
    sort: string;
    page: number;
    pageSize: number;
};

function positiveInteger(value: string | null, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function allowedValue(value: string | null, allowed: string[], fallback: string) {
    return value && allowed.includes(value) ? value : fallback;
}

export function useTableUrlState(defaultPageSize = 20) {
    const [searchParams, setSearchParams] = useSearchParams();
    const state = useMemo<TableUrlState>(
        () => ({
            filter: searchParams.get("filter") || "",
            role: allowedValue(searchParams.get("role"), ["all", "admin", "user"], "all"),
            status: allowedValue(searchParams.get("status"), ["all", "active", "disabled"], "all"),
            group: /^[a-z0-9][a-z0-9_-]{0,39}$/.test(searchParams.get("group") || "") ? searchParams.get("group")! : "all",
            sort: allowedValue(searchParams.get("sort"), ["credits_desc", "credits_asc"], ""),
            page: positiveInteger(searchParams.get("page"), 1),
            pageSize: [20, 50, 100].includes(positiveInteger(searchParams.get("pageSize"), defaultPageSize)) ? positiveInteger(searchParams.get("pageSize"), defaultPageSize) : defaultPageSize,
        }),
        [defaultPageSize, searchParams],
    );

    const update = useCallback(
        (patch: Partial<TableUrlState>, replace = false) => {
            const next = new URLSearchParams(searchParams);
            const merged = { ...state, ...patch };
            const defaults: TableUrlState = { filter: "", role: "all", status: "all", group: "all", sort: "", page: 1, pageSize: defaultPageSize };
            (Object.keys(defaults) as Array<keyof TableUrlState>).forEach((key) => {
                const value = merged[key];
                if (value === defaults[key]) next.delete(key);
                else next.set(key, String(value));
            });
            setSearchParams(next, { replace });
        },
        [defaultPageSize, searchParams, setSearchParams, state],
    );

    return { state, update };
}
