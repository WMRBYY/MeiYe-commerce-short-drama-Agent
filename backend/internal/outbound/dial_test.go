package outbound

import (
	"context"
	"errors"
	"net"
	"testing"
)

func TestDialResolvedAddressesTriesNextValidatedIP(t *testing.T) {
	ips := []net.IP{net.ParseIP("8.8.8.8"), net.ParseIP("1.1.1.1")}
	calls := []string{}
	client, server := net.Pipe()
	defer server.Close()
	connection, err := dialResolvedAddresses(context.Background(), "tcp", "443", ips, func(ctx context.Context, network, address string) (net.Conn, error) {
		calls = append(calls, address)
		if _, ok := ctx.Deadline(); !ok {
			t.Fatal("unbounded dial")
		}
		if len(calls) == 1 {
			return nil, &net.OpError{Op: "dial", Err: context.DeadlineExceeded}
		}
		return client, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if len(calls) != 2 || calls[0] != "8.8.8.8:443" || calls[1] != "1.1.1.1:443" {
		t.Fatalf("unexpected addresses: %v", calls)
	}
}
func TestDialResolvedAddressesHonorsCancellationAndEmptyResult(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := dialResolvedAddresses(ctx, "tcp", "443", []net.IP{net.ParseIP("8.8.8.8")}, func(context.Context, string, string) (net.Conn, error) {
		t.Fatal("dial after cancellation")
		return nil, nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err = dialResolvedAddresses(context.Background(), "tcp", "443", nil, nil); err == nil {
		t.Fatal("empty DNS result accepted")
	}
}
