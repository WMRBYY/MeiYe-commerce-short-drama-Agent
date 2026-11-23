package main

import (
	"fmt"
	"net"
	"strings"

	"github.com/gin-gonic/gin"
)

// An empty list disables forwarded-header trust. Configure only the Web proxy's
// exact IP addresses (or deliberately scoped CIDRs), never the whole internet.
func configureTrustedProxies(r *gin.Engine, value string) error {
	var proxies []string
	for _, raw := range strings.Split(value, ",") {
		proxy := strings.TrimSpace(raw)
		if proxy == "" {
			continue
		}
		if ip := net.ParseIP(proxy); ip == nil {
			if _, network, err := net.ParseCIDR(proxy); err != nil || network.String() != proxy {
				return fmt.Errorf("invalid CANVAS_TRUSTED_PROXIES address %q", proxy)
			}
		}
		if proxy == "0.0.0.0/0" || proxy == "::/0" {
			return fmt.Errorf("CANVAS_TRUSTED_PROXIES must not trust every address")
		}
		proxies = append(proxies, proxy)
	}
	if err := r.SetTrustedProxies(proxies); err != nil {
		return fmt.Errorf("configure trusted proxies: %w", err)
	}
	return nil
}
