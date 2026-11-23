package auth

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type phoneTestHost struct {
	nopHost
	redis *redis.Client
}

func (h phoneTestHost) SettingsEncryptionKey() ([]byte, error) {
	return []byte("isolated-test-hmac-key-only"), nil
}

func (h phoneTestHost) AllowRequest(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	key = "test:rate:" + key
	count, err := h.redis.Incr(ctx, key).Result()
	if err != nil {
		return false, err
	}
	if count == 1 {
		if err := h.redis.Expire(ctx, key, window).Err(); err != nil {
			return false, err
		}
	}
	return count <= int64(limit), nil
}

type phoneTestVerifier struct {
	mu     sync.Mutex
	sends  int
	checks int
}

func (v *phoneTestVerifier) Send(_ context.Context, _, _ string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.sends++
	return nil
}

func (v *phoneTestVerifier) Check(_ context.Context, _, _, code string) (bool, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.checks++
	return code == "123456", nil
}

func newPhoneTestService(t *testing.T) (*Service, *gorm.DB, *miniredis.Miniredis, *phoneTestVerifier) {
	t.Helper()
	t.Setenv("CANVAS_PHONE_AUTH_ENABLED", "true")
	t.Setenv("CANVAS_PHONE_REGISTRATION_ENABLED", "true")
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr(), MaxRetries: -1})
	t.Cleanup(func() { _ = client.Close() })
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "phone.db")+"?_busy_timeout=5000&_journal_mode=WAL"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.UserIdentity{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.LoginLog{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE UNIQUE INDEX idx_users_phone_nonempty ON users(phone) WHERE phone <> ''").Error; err != nil {
		t.Fatal(err)
	}
	admin := model.User{ID: "existing-admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	verifier := &phoneTestVerifier{}
	svc := New(repository.New(db), phoneTestHost{redis: client}, nil)
	svc.SetPhoneAuth(client, verifier)
	return svc, db, mr, verifier
}

func TestPhoneAuthRegistersOrdinaryUserAndConsumesTicket(t *testing.T) {
	svc, db, mr, verifier := newPhoneTestService(t)
	ctx := context.Background()
	phone := "+8613812345678"
	ticket, err := svc.StartPhoneAuth(ctx, phone, "192.0.2.1")
	if err != nil || ticket.RetryAfter != 60 || verifier.sends != 1 {
		t.Fatalf("start: ticket=%+v sends=%d err=%v", ticket, verifier.sends, err)
	}
	if _, err := svc.StartPhoneAuth(ctx, phone, "192.0.2.1"); err == nil || verifier.sends != 1 {
		t.Fatal("60-second cooldown did not prevent a second paid send")
	}
	request := PhoneAuthConfirm{Phone: phone, Ticket: ticket.Ticket, Code: "000000"}
	if _, err := svc.CompletePhoneAuth(ctx, request, "192.0.2.1"); err == nil {
		t.Fatal("wrong code created a session")
	}
	request.Code = "123456"
	result, err := svc.CompletePhoneAuth(ctx, request, "192.0.2.1")
	if err != nil {
		t.Fatal(err)
	}
	if result.User.Role != model.UserRoleUser || result.User.Phone != phone || result.User.PhoneVerifiedAt == nil || result.Session == "" {
		t.Fatalf("incorrect phone registration: %+v", result.User)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", result.User.ID).Error; err != nil || account.AvailableMicrocredits != 0 {
		t.Fatalf("new phone balance=%d err=%v", account.AvailableMicrocredits, err)
	}
	if current, err := svc.CurrentUser(result.Session); err != nil || current.ID != result.User.ID {
		t.Fatalf("session not valid: user=%+v err=%v", current, err)
	}
	if _, err := svc.CompletePhoneAuth(ctx, request, "192.0.2.1"); err == nil {
		t.Fatal("consumed ticket was replayed")
	}
	mr.FastForward(time.Minute)
	second, err := svc.StartPhoneAuth(ctx, phone, "192.0.2.1")
	if err != nil {
		t.Fatal(err)
	}
	result2, err := svc.CompletePhoneAuth(ctx, PhoneAuthConfirm{Phone: phone, Ticket: second.Ticket, Code: "123456"}, "192.0.2.1")
	if err != nil || result2.User.ID != result.User.ID {
		t.Fatalf("existing phone should log in: err=%v", err)
	}
	var ledgerCount int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("user_id = ?", result.User.ID).Count(&ledgerCount).Error; err != nil || ledgerCount != 0 {
		t.Fatalf("phone login awarded credits: ledger=%d err=%v", ledgerCount, err)
	}
	var users int64
	if err := db.Model(&model.User{}).Count(&users).Error; err != nil || users != 2 {
		t.Fatalf("duplicate user created: count=%d err=%v", users, err)
	}
}

func TestPhoneAuthDoesNotTakeOverAdminAndFailsClosed(t *testing.T) {
	svc, db, mr, _ := newPhoneTestService(t)
	phone := "+8613912345678"
	now := time.Now()
	if err := db.Model(&model.User{}).Where("id = ?", "existing-admin").Updates(map[string]any{"phone": phone, "phone_verified_at": now}).Error; err != nil {
		t.Fatal(err)
	}
	ticket, err := svc.StartPhoneAuth(context.Background(), phone, "192.0.2.2")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CompletePhoneAuth(context.Background(), PhoneAuthConfirm{Phone: phone, Ticket: ticket.Ticket, Code: "123456"}, "192.0.2.2"); err == nil {
		t.Fatal("admin account was merged into phone login")
	}
	mr.Close()
	if _, err := svc.StartPhoneAuth(context.Background(), "+8613712345678", "192.0.2.2"); err == nil {
		t.Fatal("Redis outage did not fail closed")
	}
}

func TestPhoneAuthOnlyExplicitBoundAdminCanLogin(t *testing.T) {
	svc, db, mr, _ := newPhoneTestService(t)
	phone := "+8613912345678"
	if err := db.Model(&model.User{}).Where("id = ?", "existing-admin").Update("phone", phone).Error; err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	ticket, err := svc.StartPhoneAuth(ctx, phone, "192.0.2.7")
	if err != nil {
		t.Fatal(err)
	}
	request := PhoneAuthConfirm{Phone: phone, Ticket: ticket.Ticket, Code: "123456"}
	if _, err := svc.CompletePhoneAuth(ctx, request, "192.0.2.7"); err == nil {
		t.Fatal("admin logged in without an explicit server-side allowlist")
	}
	t.Setenv("CANVAS_PHONE_ADMIN_LOGIN_USER_ID", "another-admin")
	mr.FastForward(time.Minute)
	ticket, err = svc.StartPhoneAuth(ctx, phone, "192.0.2.7")
	if err != nil {
		t.Fatal(err)
	}
	request.Ticket = ticket.Ticket
	if _, err := svc.CompletePhoneAuth(ctx, request, "192.0.2.7"); err == nil {
		t.Fatal("admin logged in with a mismatched allowlist")
	}
	t.Setenv("CANVAS_PHONE_ADMIN_LOGIN_USER_ID", "existing-admin")
	mr.FastForward(time.Minute)
	ticket, err = svc.StartPhoneAuth(ctx, phone, "192.0.2.7")
	if err != nil {
		t.Fatal(err)
	}
	request.Ticket = ticket.Ticket
	result, err := svc.CompletePhoneAuth(ctx, request, "192.0.2.7")
	if err != nil || result.User.ID != "existing-admin" || result.User.Role != model.UserRoleAdmin || result.Session == "" {
		t.Fatalf("pre-bound admin SMS login failed: %v", err)
	}
	if result.User.PhoneVerifiedAt == nil {
		t.Fatal("provider-verified admin phone was not marked verified")
	}
	if _, err := svc.CompletePhoneAuth(ctx, request, "192.0.2.7"); err == nil {
		t.Fatal("admin SMS ticket was replayed")
	}
	var count int64
	if err := db.Model(&model.User{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("admin login changed user count: count=%d err=%v", count, err)
	}
}

func TestPhoneAuthRegistrationSwitchIsIndependent(t *testing.T) {
	svc, db, _, _ := newPhoneTestService(t)
	t.Setenv("CANVAS_PHONE_REGISTRATION_ENABLED", "false")
	phone := "+8613612345678"
	ticket, err := svc.StartPhoneAuth(context.Background(), phone, "192.0.2.3")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CompletePhoneAuth(context.Background(), PhoneAuthConfirm{Phone: phone, Ticket: ticket.Ticket, Code: "123456"}, "192.0.2.3"); err == nil {
		t.Fatal("disabled registration created a user")
	}
	if _, err := repository.New(db).UserByPhone(phone); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("phone was registered while switch off: %v", err)
	}
}

func TestPhoneAuthRejectsBruteForceAndRateLimitsSending(t *testing.T) {
	svc, _, _, verifier := newPhoneTestService(t)
	ctx := context.Background()
	phone := "+8613512345678"
	ticket, err := svc.StartPhoneAuth(ctx, phone, "192.0.2.4")
	if err != nil {
		t.Fatal(err)
	}
	for range 5 {
		if _, err := svc.CompletePhoneAuth(ctx, PhoneAuthConfirm{Phone: phone, Ticket: ticket.Ticket, Code: "000000"}, "192.0.2.4"); err == nil {
			t.Fatal("invalid code created a session")
		}
	}
	checks := verifier.checks
	if _, err := svc.CompletePhoneAuth(ctx, PhoneAuthConfirm{Phone: phone, Ticket: ticket.Ticket, Code: "123456"}, "192.0.2.4"); err == nil || verifier.checks != checks {
		t.Fatal("sixth attempt reached provider or created a session")
	}
	for i := range 9 {
		phone := "+861361234" + fmt.Sprintf("%04d", i)
		if _, err := svc.StartPhoneAuth(ctx, phone, "192.0.2.4"); err != nil {
			t.Fatalf("send %d: %v", i+2, err)
		}
	}
	if _, err := svc.StartPhoneAuth(ctx, "+8613712345678", "192.0.2.4"); err == nil || verifier.sends != 10 {
		t.Fatal("IP send quota did not stop the eleventh provider call")
	}
}

func TestPhoneAuthConcurrentTicketCreatesOneAccount(t *testing.T) {
	svc, db, _, _ := newPhoneTestService(t)
	ctx := context.Background()
	phone := "+8613412345678"
	ticket, err := svc.StartPhoneAuth(ctx, phone, "192.0.2.5")
	if err != nil {
		t.Fatal(err)
	}
	const workers = 8
	var wg sync.WaitGroup
	results := make(chan error, workers)
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := svc.CompletePhoneAuth(ctx, PhoneAuthConfirm{Phone: phone, Ticket: ticket.Ticket, Code: "123456"}, "192.0.2.5")
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("concurrent ticket yielded %d sessions, want one", success)
	}
	var users int64
	if err := db.Model(&model.User{}).Count(&users).Error; err != nil || users != 2 {
		t.Fatalf("concurrent ticket yielded %d users: %v", users, err)
	}
}
