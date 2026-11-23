package auth

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
)

// NormalizeProfileNickname accepts display text only. Account identifiers stay separate.
func NormalizeProfileNickname(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if !utf8.ValidString(name) || utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 32 {
		return "", kernel.BadAuthRequest("昵称长度须为 1–32 个字符")
	}
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.IsMark(r) || unicode.IsSymbol(r) || r == ' ' || r == '_' || r == '-' || r == '.' || r == '·' {
			continue
		}
		return "", kernel.BadAuthRequest("昵称包含不支持的字符")
	}
	return name, nil
}
