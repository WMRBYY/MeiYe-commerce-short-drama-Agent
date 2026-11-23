package app

import (
	"context"
	"os"
	"strings"
	"time"
)

const agentHandoffGateEnv = "CANVAS_AGENT_HANDOFF_GATE_FILE"

// A new instance waits behind this operator-owned file while the previous
// instance finishes its Agent sessions. It is not a cross-instance lease.
func agentHandoffGateClosed() bool {
	path := strings.TrimSpace(os.Getenv(agentHandoffGateEnv))
	if path == "" {
		return false
	}
	_, err := os.Stat(path)
	// Permission or mount errors must not accidentally admit a second owner.
	return !os.IsNotExist(err)
}

// WaitForAgentHandoff holds Agent HTTP requests before they can mutate durable
// runs. Removing the file opens admission without restarting this instance.
func (s *Service) WaitForAgentHandoff(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !agentHandoffGateClosed() {
		return nil
	}
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if !agentHandoffGateClosed() {
				return ctx.Err()
			}
		}
	}
}
