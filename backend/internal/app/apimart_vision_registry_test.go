package app

import "testing"

func TestAPIMartVisionPackagesRegisteredAtStartup(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"apimart-gemini-vision", "apimart-claude-vision", "apimart-qwen-vision"} {
		t.Run(id, func(t *testing.T) {
			if err := validateGenerationInterfaceWithRegistry(center.registrySnapshot(), "text", id); err != nil {
				t.Fatalf("startup registry does not support %s: %v", id, err)
			}
		})
	}
}
