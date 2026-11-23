package app

import (
	"encoding/json"
	"testing"
)

func TestAgentConversationDocumentIsAccountScopedAndRevisionGuarded(t *testing.T) {
	s, _, canvasID := cloudAgentProfileFixture(t)
	body := json.RawMessage(`{"version":1,"activeId":"chat-1","conversations":[{"id":"chat-1"}],"deletedIds":[]}`)
	created, err := s.SaveCloudAgentConversationDocument("user", canvasID, 0, body)
	if err != nil || created.Revision != 1 {
		t.Fatalf("first save failed: %#v %v", created, err)
	}
	read, err := s.CloudAgentConversationDocument("user", canvasID)
	if err != nil || read.Revision != 1 || string(read.Document) != string(body) {
		t.Fatalf("same account could not read saved conversation: %#v %v", read, err)
	}
	if _, err := s.CloudAgentConversationDocument("other", canvasID); err == nil {
		t.Fatal("another account read the conversation")
	}
	if _, err := s.SaveCloudAgentConversationDocument("other", canvasID, 0, body); err == nil {
		t.Fatal("another account wrote the conversation")
	}
	if _, err := s.SaveCloudAgentConversationDocument("user", canvasID, 0, body); err == nil {
		t.Fatal("stale revision replaced a saved conversation")
	}
	updated, err := s.SaveCloudAgentConversationDocument("user", canvasID, 1, body)
	if err != nil || updated.Revision != 2 {
		t.Fatalf("current revision could not update: %#v %v", updated, err)
	}
}
