package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"yingce/backend/internal/repository"
)

func TestAgentHandoffWaitsForRemovalAndHonorsCancellation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "handoff")
	t.Setenv(agentHandoffGateEnv, path)
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	s := &Service{}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.WaitForAgentHandoff(ctx) }()
	select {
	case err := <-done:
		t.Fatalf("admitted while gate exists: %v", err)
	case <-time.After(150 * time.Millisecond):
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled admission: %v", err)
	}
	go func() { done <- s.WaitForAgentHandoff(context.Background()) }()
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("removing the gate did not resume admission")
	}
	t.Setenv(agentHandoffGateEnv, "")
	if err := s.WaitForAgentHandoff(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestAgentHandoffBlocksRecoveryAndAllRunnerEntrypoints(t *testing.T) {
	path := filepath.Join(t.TempDir(), "handoff")
	t.Setenv(agentHandoffGateEnv, path)
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := &Service{repo: repository.New(nil), piRunners: map[string]context.CancelFunc{"existing": cancel}}
	// The nil database also proves recovery did not read or mutate stored runs.
	s.recoverCloudAgentPiRunners()
	s.startCloudAgentPi("user", "new")
	s.resumeCloudAgentPi("user", "existing")
	s.startApprovedCloudAgentMediaWaiter("user", "run", "task")
	s.startCloudAgentMediaBatchRunner("user", "run")
	if len(s.piRunners) != 1 || len(s.piRunnerRestarts) != 0 || len(s.approvedMediaWaiters) != 0 {
		t.Fatal("gate admitted an Agent runner")
	}
	if ctx.Err() != nil {
		t.Fatal("gate cancelled an already running session")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	s.resumeCloudAgentPi("user", "existing")
	if _, exists := s.piRunnerRestarts["existing"]; !exists {
		t.Fatal("runner admission did not resume after handoff")
	}
}
