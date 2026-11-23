package emailidentity

import "testing"

func TestCanonicalMailbox(t *testing.T) {
	for input, want := range map[string]string{
		" test-user-37f490@example.invalid ":       "test-user-86ca2a@example.invalid",
		"test-user-e88b22@example.invalid":    "test-user-86ca2a@example.invalid",
		"A.B+x@example.com":       "a.b+x@example.com",
		"a.b+x@gmail.example.com": "a.b+x@gmail.example.com",
		"a.b+x@sub.gmail.com":     "a.b+x@sub.gmail.com",
		"":                        "",
	} {
		if got := Canonical(input); got != want {
			t.Errorf("Canonical(%q)=%q want %q", input, got, want)
		}
	}
}
