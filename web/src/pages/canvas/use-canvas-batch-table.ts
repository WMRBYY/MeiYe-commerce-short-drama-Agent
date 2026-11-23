import { translate } from "@/i18n";
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { commerceSnapshot, isCommerceNode } from "@/lib/canvas/commerce-workflow";
import { commerceScreenImageSize } from "@/lib/canvas/commerce-image-size";
import { modelCompatibilityError } from "@/lib/model-selection";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { synchronizeGenerationSpec } from "@/lib/canvas/generation-contract";
import { findAvailableGenerationGroupPosition } from "@/lib/canvas/canvas-generation-layout";
import { MAX_BATCH_REFERENCE_COLUMNS, batchGenerationRows, batchInputColumns, batchPromptForRow, batchReferenceColumns, batchReferenceHandleId, batchTextInputColumns, createInheritedBatchRow, createBatchRowsFromColumns, insertBatchRow, moveBatchReferenceCell, removeLastBatchReferenceColumn, reorderBatchReferenceColumns } from "@/lib/canvas/canvas-batch-table";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { buildGenerationConfig, resetGenerationTaskMetadata } from "@/lib/canvas/canvas-project-generation";
import { reconcileBatchCellConnections } from "@/lib/canvas/canvas-batch-references";
import { patchCanvasBatchTableData, prepareCanvasBatchTableGeneration, type CanvasBatchGenerationTarget } from "@/lib/canvas/canvas-batch-table-state";
import { navigateToSettings } from "@/lib/settings-navigation";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasBatchRow, type CanvasBatchTableData, type CanvasConnection, type CanvasGenerationBatchMode, type CanvasNodeData } from "@/types/canvas";
import type { BatchGenerationSettings } from "@/components/canvas/batch-generation-settings-dialog";
import type { Asset } from "@/stores/use-asset-store";

type Options = {
    readOnly?: boolean;
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    assets: Asset[];
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    enqueueGenerationBatch: (sourceNodeId: string, mode: CanvasGenerationBatchMode, targets: CanvasBatchGenerationTarget[], options?: { concurrency?: number }) => string | undefined;
};

type PendingBatchGen = {
    commerceSnapshot?: string;
    nodeId: string;
    rows: CanvasBatchRow[];
    concurrency: number;
    tableSnapshot: string;
    requestedRowIds?: string[];
};

export function useCanvasBatchTable({ nodesRef, connectionsRef, assets, setNodes, setConnections, setSelectedNodeIds, enqueueGenerationBatch, readOnly = false }: Options) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);

    const [batchGenDialog, setBatchGenDialog] = useState<{ open: boolean; pending: PendingBatchGen | null }>({ open: false, pending: null });

    const patchTable = useCallback((nodeId: string, patch: Partial<CanvasBatchTableData>) => {
        const next = nodesRef.current.map((node) => {
            if (node.id !== nodeId || node.metadata?.locked) return node;
            return { ...node, metadata: { ...node.metadata, batchTable: patchCanvasBatchTableData(node.metadata?.batchTable, patch) } };
        });
        const edges = reconcileBatchCellConnections(next, connectionsRef.current);
        setNodes(next); setConnections(edges);
    }, [nodesRef, connectionsRef, setNodes, setConnections]);

    const updateRow = useCallback((nodeId: string, rowId: string, patch: Partial<CanvasBatchRow>) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if (!node?.metadata?.batchTable) return;
        patchTable(nodeId, { rows: node.metadata.batchTable.rows.map((row) => row.id === rowId ? { ...row, ...patch } : row) });
    }, [nodesRef, patchTable]);

    const addRow = useCallback((nodeId: string, afterRowId?: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        const inserted = insertBatchRow(table, afterRowId);
        if (!inserted) return;
        patchTable(nodeId, { rows: inserted.rows });
        return inserted.row.id;
    }, [nodesRef, patchTable]);

    const removeRow = useCallback((nodeId: string, rowId: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        patchTable(nodeId, { rows: table.rows.filter((row) => row.id !== rowId) });
    }, [nodesRef, patchTable]);

    const addReferenceColumn = useCallback((nodeId: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        const columns = batchReferenceColumns(table);
        if (columns.length >= MAX_BATCH_REFERENCE_COLUMNS) return message.info(translate("canvasPage.batchTable.maxReferenceColumns", { count: 10 }));
        const nextIndex = columns.length + 1;
        patchTable(nodeId, { referenceColumns: [...columns, { id: `reference-${nanoid()}`, label: translate("canvasPage.batchTable.referenceColumn", { index: nextIndex }) }] });
    }, [message, nodesRef, patchTable]);

    const removeReferenceColumn = useCallback((nodeId: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        const columns = batchReferenceColumns(table);
        const nextTable = removeLastBatchReferenceColumn(table);
        if (!nextTable) return message.info(translate("canvasPage.batchTable.minReferenceColumns"));
        patchTable(nodeId, nextTable);
        const removed = columns.at(-1);
        if (removed) {
            const handleId = batchReferenceHandleId(removed.id);
            setConnections((current) => current.filter((connection) => !(connection.toNodeId === nodeId && connection.toHandleId === handleId)));
        }
    }, [message, nodesRef, patchTable, setConnections]);

    const addTextColumn = useCallback((nodeId: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        const columns = table.textColumns || [];
        if (columns.length >= 4) return message.info(translate("canvasPage.batchTable.maxTextColumns", { count: 4 }));
        patchTable(nodeId, { textColumns: [...columns, { id: `text-${nanoid()}`, label: translate("canvasPage.batchTable.textColumn", { index: columns.length + 1 }) }] });
    }, [message, nodesRef, patchTable]);

    const syncRowsFromConnections = useCallback((nodeId: string, silent = false) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        const table = node?.metadata?.batchTable;
        if (!node || !table) return false;
        // AI 列表模式已经根据用户要求生成了独立行；参考图连线只负责
        // 提供素材，不能在保存/连线刷新时把 N 行重置成“每张图一行”。
        if (table.aiGenerated || table.referenceMode === "cells") return false;
        const nodeById = new Map(nodesRef.current.map((item) => [item.id, item]));
        const columns = batchInputColumns(node, connectionsRef.current).map((column) => column.filter((inputNodeId) => {
            const input = nodeById.get(inputNodeId);
            return input?.type === CanvasNodeType.Image && Boolean(input.metadata?.content || input.metadata?.storageKey);
        }));
        if (!columns.some((column) => column.length)) {
            if (!silent) message.warning(translate("canvasPage.batchTable.connectImagesFirst"));
            return false;
        }
        const rows = createBatchRowsFromColumns(table.operation, columns, table.rows);
        const textColumns = batchTextInputColumns(node, connectionsRef.current).map((column) => column.filter((inputNodeId) => {
            const input = nodeById.get(inputNodeId);
            return input?.type === CanvasNodeType.Text && Boolean(input.metadata?.content || input.metadata?.prompt);
        }));
        const rowsWithText = rows.map((row, index) => ({
            ...row,
            textNodeIds: textColumns.some((column) => column.length) ? textColumns.flatMap((column) => {
                const input = column.length === 1 ? column[0] : column[index];
                return input ? [input] : [];
            }) : row.textNodeIds,
        }));
        if (!rows.length) {
            if (!silent) message.warning(translate("canvasPage.batchTable.tryOnNeedsImages"));
            return false;
        }
        const rowsChanged = JSON.stringify(table.rows) !== JSON.stringify(rowsWithText);
        if (!rowsChanged) return false;
        patchTable(nodeId, { rows: rowsWithText });
        if (!silent) message.success(translate("canvasPage.batchTable.rowsCreated", { count: rows.length }));
        return true;
    }, [connectionsRef, message, nodesRef, patchTable]);

    const fillRowsFromConnections = useCallback((nodeId: string) => {
        syncRowsFromConnections(nodeId);
    }, [syncRowsFromConnections]);

    const reorderReferenceColumns = useCallback((nodeId: string, fromColumnId: string, toColumnId: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        const nextTable = reorderBatchReferenceColumns(table, fromColumnId, toColumnId);
        if (nextTable !== table) patchTable(nodeId, nextTable);
    }, [nodesRef, patchTable]);

    const moveReferenceCell = useCallback((nodeId: string, sourceRowId: string, sourceColumnIndex: number, targetRowId: string, targetColumnIndex: number) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        const nextTable = moveBatchReferenceCell(table, sourceRowId, sourceColumnIndex, targetRowId, targetColumnIndex);
        if (nextTable !== table) patchTable(nodeId, { rows: nextTable.rows });
    }, [nodesRef, patchTable]);

    const executeBatchGeneration = useCallback((pending: PendingBatchGen, settings: BatchGenerationSettings) => {
        const { nodeId, rows, concurrency } = pending;
        const sourceNode = nodesRef.current.find((item) => item.id === nodeId);
        const table = sourceNode?.metadata?.batchTable;
        if (!sourceNode || !table) return;
        if (isCommerceNode(sourceNode) && (readOnly || sourceNode.metadata?.locked || pending.commerceSnapshot !== commerceSnapshot(sourceNode, nodesRef.current, connectionsRef.current))) {
            message.warning("配置或输入素材已变化，请重新确认生成");
            return false;
        }

        const selectableRowIds = new Set(batchGenerationRows(sourceNode, nodesRef.current, pending.requestedRowIds).map((row) => row.id));
        if (JSON.stringify(table) !== pending.tableSnapshot || !rows.every((row) => selectableRowIds.has(row.id))) {
            message.warning(translate("canvasPage.batchTable.stateChanged"));
            return;
        }

        const mergedConfig = { ...effectiveConfig, ...settings };
        if (isCommerceNode(sourceNode)) {
            for (const row of rows) {
                const error = modelCompatibilityError(mergedConfig, mergedConfig.imageModel || mergedConfig.model, { capability: "image", input: { imageCount: row.inputNodeIds.length, textCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 } });
                if (error) { message.error(error); return false; }
            }
        }
        if (!isAiConfigReady(mergedConfig, mergedConfig.imageModel || mergedConfig.model)) {
            message.error(translate("canvasPage.batchTable.modelNotConfigured"));
            return;
        }

        let nextNodes: CanvasNodeData[];
        let nextConnections: CanvasConnection[];
        let targets: CanvasBatchGenerationTarget[];
        if (isCommerceNode(sourceNode)) {
        const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        nextNodes = [...nodesRef.current];
        nextConnections = [...connectionsRef.current];
        const outputByRowId = new Map<string, string>();
        targets = [];
        rows.forEach((row, index) => {
            const existingIndex = !isCommerceNode(sourceNode) && row.outputNodeId ? nextNodes.findIndex((node) => node.id === row.outputNodeId && node.type === CanvasNodeType.Image && !node.metadata?.content && !node.metadata?.storageKey) : -1;
            const prompt = batchPromptForRow(table, row).trim();
            const screen = sourceNode.metadata?.commerceWorkflow?.screens.find((item) => item.id === row.id);
            const profile = isCommerceNode(sourceNode) ? modelCapabilityConfigFor(mergedConfig, mergedConfig.imageModel || mergedConfig.model).image : undefined;
            const size = commerceScreenImageSize(profile, mergedConfig.size, sourceNode, screen, nodesRef.current);
            const metadata = {
                ...(existingIndex >= 0 ? resetGenerationTaskMetadata(nextNodes[existingIndex].metadata) : {}),
                prompt,
                composerContent: [prompt, ...(row.textNodeIds || []).map((textNodeId) => {
                    const textNode = nodesRef.current.find((node) => node.id === textNodeId);
                    return textNode?.metadata?.content || textNode?.metadata?.prompt || "";
                })].filter(Boolean).join("\n\n"),
                model: buildGenerationConfig(mergedConfig, undefined, "image").model,
                size,
                imageResolution: mergedConfig.imageResolution,
                imageParameters: mergedConfig.imageParameters,
                quality: mergedConfig.quality,
                transparentBackground: mergedConfig.transparentBackground,
                count: 1,
                generationMode: "image" as const,
                generationResultPlacement: "replace-node" as const,
                generationType: "edit" as const,
                workflowKind: "final" as const,
                workflowTitle: `${table.operation === "try_on" ? "换装" : "创意"}任务 ${index + 1}`,
                status: "idle" as const,
                batchSourceNodeId: nodeId,
                batchRowId: row.id,
                batchOperation: table.operation,
                batchInputNodeIds: row.inputNodeIds,
                cameraControl: settings.cameraControl,
            };
            const output = existingIndex >= 0
                ? { ...nextNodes[existingIndex], metadata }
                : createCanvasNode(CanvasNodeType.Image, { x: sourceNode.position.x + sourceNode.width + 120 + imageSpec.width / 2, y: sourceNode.position.y + index * (imageSpec.height + 32) + imageSpec.height / 2 }, metadata);
            if (isCommerceNode(sourceNode)) output.metadata = synchronizeGenerationSpec({ ...output, metadata: { ...metadata, generationSpec: undefined } }, metadata).metadata;
            output.title = screen?.title || `${table.operation === "try_on" ? "换装" : "创意"} · ${index + 1}`;
            if (existingIndex >= 0) nextNodes[existingIndex] = output;
            else { output.position = findAvailableGenerationGroupPosition(nextNodes, output.position, output); nextNodes.push(output); }
            nextConnections = nextConnections.filter((connection) => connection.toNodeId !== output.id);
            row.inputNodeIds.filter(Boolean).forEach((inputNodeId) => nextConnections.push({ id: nanoid(), fromNodeId: inputNodeId, toNodeId: output.id }));
            nextConnections.push({ id: nanoid(), fromNodeId: sourceNode.id, toNodeId: output.id, relation: "batch-output", storyboardRowId: row.id });
            outputByRowId.set(row.id, output.id);
            targets.push({ rowId: row.id, nodeId: output.id });
        });
        const sourceIndex = nextNodes.findIndex((node) => node.id === sourceNode.id);
        nextNodes[sourceIndex] = { ...sourceNode, metadata: { ...sourceNode.metadata, batchTable: { ...table, rows: table.rows.map((row) => outputByRowId.has(row.id) ? { ...row, outputNodeId: outputByRowId.get(row.id) } : row) } } };
        } else {
        let prepared: ReturnType<typeof prepareCanvasBatchTableGeneration>;
        try {
            prepared = prepareCanvasBatchTableGeneration({ nodes: nodesRef.current, connections: connectionsRef.current, sourceNodeId: nodeId, rows, config: effectiveConfig, settings, assets });
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("canvasPage.batchTable.snapshotFailed"));
            return;
        }
        ({ nodes: nextNodes, connections: nextConnections, targets } = prepared);
        }
        nodesRef.current = nextNodes;
        connectionsRef.current = nextConnections;
        setNodes(nextNodes);
        setConnections(nextConnections);
        setSelectedNodeIds(new Set(targets.map((target) => target.nodeId)));
        if (enqueueGenerationBatch(nodeId, "batch_image", targets, { concurrency })) { message.success(`${targets.length} 个任务已加入并发队列`); return true; }
        return false;
    }, [assets, connectionsRef, effectiveConfig, enqueueGenerationBatch, isAiConfigReady, message, nodesRef, setConnections, setNodes, setSelectedNodeIds, readOnly]);

    const generateRows = useCallback((nodeId: string, requestedRowIds?: string[]) => {
        const sourceNode = nodesRef.current.find((item) => item.id === nodeId);
        const table = sourceNode?.metadata?.batchTable;
        if (!sourceNode || !table) return;
        if (isCommerceNode(sourceNode) && (readOnly || sourceNode.metadata?.locked)) return;
        const imageConfig = isCommerceNode(sourceNode) ? { ...effectiveConfig, model: sourceNode.metadata?.model || effectiveConfig.imageModel, imageModel: sourceNode.metadata?.model || effectiveConfig.imageModel } : effectiveConfig;
        const imageModel = imageConfig.imageModel || imageConfig.model;
        if (!isAiConfigReady(imageConfig, imageModel)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        const rows = batchGenerationRows(sourceNode, nodesRef.current, requestedRowIds);
        if (!rows.length) return message.info(translate("canvasPage.batchTable.nothingToSubmit"));

        setBatchGenDialog({ open: true, pending: { nodeId, rows, concurrency: table.concurrency, tableSnapshot: JSON.stringify(table), requestedRowIds,
            commerceSnapshot: isCommerceNode(sourceNode) ? commerceSnapshot(sourceNode, nodesRef.current, connectionsRef.current) : undefined } });
    }, [effectiveConfig, isAiConfigReady, message, nodesRef, connectionsRef, readOnly]);

    // The commerce panel confirms both paid stages before calling this entry.
    const generateConfirmedCommerceRows = useCallback((nodeId: string, requestedRowIds?: string[]) => {
        const source = nodesRef.current.find((node) => node.id === nodeId);
        const table = source?.metadata?.batchTable;
        if (!source || !table || !isCommerceNode(source) || readOnly || source.metadata?.locked) return false;
        const rows = batchGenerationRows(source, nodesRef.current, requestedRowIds);
        if (!rows.length) return false;
        const model = source.metadata?.model || effectiveConfig.imageModel || effectiveConfig.model;
        return Boolean(executeBatchGeneration({ nodeId, rows, requestedRowIds, concurrency: table.concurrency,
            tableSnapshot: JSON.stringify(table), commerceSnapshot: commerceSnapshot(source, nodesRef.current, connectionsRef.current) },
        { model, imageModel: model, size: source.metadata?.size || effectiveConfig.size, imageResolution: source.metadata?.imageResolution || effectiveConfig.imageResolution,
            imageParameters: source.metadata?.imageParameters || effectiveConfig.imageParameters, quality: source.metadata?.quality || effectiveConfig.quality,
            count: "1", transparentBackground: effectiveConfig.transparentBackground }));
    }, [nodesRef, connectionsRef, effectiveConfig, executeBatchGeneration, readOnly]);

    const closeBatchGenDialog = useCallback(() => {
        setBatchGenDialog({ open: false, pending: null });
    }, []);

    const confirmBatchGenDialog = useCallback((settings: BatchGenerationSettings) => {
        if (batchGenDialog.pending) {
            executeBatchGeneration(batchGenDialog.pending, settings);
        }
        setBatchGenDialog({ open: false, pending: null });
    }, [batchGenDialog.pending, executeBatchGeneration]);

    const dialogConfig = useMemo(() => {
        const source = nodesRef.current.find((node) => node.id === batchGenDialog.pending?.nodeId);
        return source && isCommerceNode(source) ? { ...effectiveConfig, model: source.metadata?.model || effectiveConfig.imageModel, imageModel: source.metadata?.model || effectiveConfig.imageModel,
            size: source.metadata?.size || effectiveConfig.size, quality: source.metadata?.quality || effectiveConfig.quality } : effectiveConfig;
    }, [effectiveConfig, batchGenDialog.pending, nodesRef]);

    return {
        addReferenceColumn,
        addTextColumn,
        addRow,
        fillRowsFromConnections,
        generateRows,
        generateConfirmedCommerceRows,
        moveReferenceCell,
        patchTable,
        removeReferenceColumn,
        removeRow,
        reorderReferenceColumns,
        syncRowsFromConnections,
        updateRow,
        batchGenDialogOpen: batchGenDialog.open,
        batchGenDialogRowCount: batchGenDialog.pending?.rows.length ?? 0,
        batchGenDialogConcurrency: batchGenDialog.pending?.concurrency ?? 1,
        batchGenDialogConfig: dialogConfig,
        closeBatchGenDialog,
        confirmBatchGenDialog,
    };
}
