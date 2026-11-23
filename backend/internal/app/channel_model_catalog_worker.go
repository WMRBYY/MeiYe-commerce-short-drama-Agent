package app

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

const channelCatalogCheckInterval = 6 * time.Hour

func (s *Service) startChannelModelCatalogWorker() {
	s.runWorkerLoop(func(ctx context.Context) {
		ticker := time.NewTicker(channelCatalogCheckInterval)
		defer ticker.Stop()
		for {
			s.reconcileUpstreamChannelModels(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})
}

func (s *Service) reconcileUpstreamChannelModels(ctx context.Context) {
	channels, err := s.repo.SystemChannels(false)
	if err != nil {
		slog.Warn("upstream model catalog: channel load failed", "error", err)
		return
	}
	for _, channel := range channels {
		if ctx.Err() != nil {
			return
		}
		format := strings.ToLower(strings.TrimSpace(channel.APIFormat))
		if format != "" && format != "openai" && format != "gemini" {
			continue
		}
		if strings.TrimSpace(channel.BaseURL) == "" || strings.TrimSpace(channel.APIKey) == "" {
			continue
		}
		headers, headerErr := ParseOutboundHeadersJSON(channel.HeadersJSON)
		if headerErr != nil {
			slog.Warn("upstream model catalog: invalid channel headers", "channel_id", channel.ID, "error", headerErr)
			continue
		}
		secret, secretErr := s.adminSystemChannel(channel.ID)
		if secretErr != nil {
			slog.Warn("upstream model catalog: channel credentials unavailable", "channel_id", channel.ID, "error", secretErr)
			continue
		}
		requestCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
		catalog, fetchErr := s.fetchChannelModelCatalog(requestCtx, &model.User{ID: "system-catalog-worker"}, ChannelModelsRequest{
			BaseURL: secret.BaseURL, APIKey: secret.APIKey, APIFormat: secret.APIFormat, Headers: headers, ProxyURL: secret.ProxyURL,
		}, false)
		cancel()
		if fetchErr != nil {
			slog.Warn("upstream model catalog: check failed", "channel_id", channel.ID, "error", fetchErr)
			continue
		}
		if len(catalog) == 0 {
			slog.Warn("upstream model catalog: empty response ignored", "channel_id", channel.ID)
			continue
		}
		available := make(map[string]bool, len(catalog))
		for _, item := range catalog {
			available[channelModelCatalogKey(item.ID)] = true
		}
		disabled, reconcileErr := s.repo.ReconcileChannelModelCatalog(channel.ID, available, time.Now())
		if reconcileErr != nil {
			slog.Warn("upstream model catalog: reconciliation failed", "channel_id", channel.ID, "error", reconcileErr)
			continue
		}
		if len(disabled) > 0 {
			s.invalidateRouteCatalog()
			slog.Warn("upstream model catalog: models removed from public catalog", "channel_id", channel.ID, "model_ids", disabled)
		}
	}
}
