package repository

import (
	"fmt"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newAdminUsersTestRepository(t *testing.T) (*Repository, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:admin-users-test-%d?mode=memory&cache=shared", time.Now().UnixNano())), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.CreditAccount{}, &model.PaymentOrder{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	users := []model.User{
		{ID: "u-rich", Username: "phone_f99f6dd17c6dcde06072", DisplayName: "手机用户", Role: model.UserRoleUser, Status: model.UserStatusActive, CreatedAt: now.Add(-3 * time.Hour)},
		{ID: "u-poor", Username: "wx_0228cd8d19f3147e1679e810", DisplayName: "微信用户", Role: model.UserRoleUser, Status: model.UserStatusActive, CreatedAt: now.Add(-2 * time.Hour)},
		{ID: "u-none", Username: "phoneXf99", DisplayName: "无账户", Role: model.UserRoleUser, Status: model.UserStatusActive, CreatedAt: now.Add(-1 * time.Hour)},
	}
	for index := range users {
		if err := db.Create(&users[index]).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, account := range []model.CreditAccount{{UserID: "u-rich", AvailableMicrocredits: 5_000_000}, {UserID: "u-poor", AvailableMicrocredits: 200_000}} {
		if err := db.Create(&account).Error; err != nil {
			t.Fatal(err)
		}
	}
	return New(db), db
}

func adminUserIDs(users []model.User) []string {
	ids := make([]string, 0, len(users))
	for _, user := range users {
		ids = append(ids, user.ID)
	}
	return ids
}

func TestAdminUsersSearchAcceptsPastedAtUsernameAndID(t *testing.T) {
	repo, _ := newAdminUsersTestRepository(t)
	for keyword, want := range map[string]string{"@phone_f99f6dd17c6dcde06072": "u-rich", "  @wx_0228cd8d  ": "u-poor", "u-poor": "u-poor", "微信": "u-poor"} {
		users, total, err := repo.AdminUsers(keyword, "", "", "", "", 20, 0)
		if err != nil {
			t.Fatal(err)
		}
		if total != 1 || len(users) != 1 || users[0].ID != want {
			t.Fatalf("keyword %q got %v total=%d, want %s", keyword, adminUserIDs(users), total, want)
		}
	}
	// "_" 是 LIKE 通配符，转义后 phone_ 不应匹配 phoneX。
	users, _, err := repo.AdminUsers("phone_", "", "", "", "", 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	if got := adminUserIDs(users); len(got) != 1 || got[0] != "u-rich" {
		t.Fatalf("phone_ matched %v", got)
	}
}

func TestAdminUsersSortsByAvailableCredits(t *testing.T) {
	repo, _ := newAdminUsersTestRepository(t)
	cases := map[string][]string{
		"credits_desc": {"u-rich", "u-poor", "u-none"},
		"credits_asc":  {"u-none", "u-poor", "u-rich"},
		"":             {"u-none", "u-poor", "u-rich"},
	}
	for sort, want := range cases {
		users, total, err := repo.AdminUsers("", "", "", "", sort, 20, 0)
		if err != nil {
			t.Fatal(err)
		}
		got := adminUserIDs(users)
		if total != 3 || fmt.Sprint(got) != fmt.Sprint(want) {
			t.Fatalf("sort %q got %v total=%d, want %v", sort, got, total, want)
		}
	}
	users, total, err := repo.AdminUsers("phone", "", "", "", "credits_desc", 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || fmt.Sprint(adminUserIDs(users)) != fmt.Sprint([]string{"u-rich", "u-none"}) {
		t.Fatalf("filtered sort got %v total=%d", adminUserIDs(users), total)
	}
}

func TestAdminPaymentOrdersSearchAcceptsPastedAtUsername(t *testing.T) {
	repo, db := newAdminUsersTestRepository(t)
	order := model.PaymentOrder{ID: "order-1", UserID: "u-rich", MerchantOrderNo: "fc66e7ea2f0001a9bfab", ProviderID: "alipay", Status: "closed", CreatedAt: time.Now().UTC()}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	for _, keyword := range []string{"@phone_f99f6dd17c6dcde06072", "手机用户", "FC66E7EA2F", "u-rich"} {
		var count int64
		if err := repo.paymentOrderQuery(PaymentOrderFilter{Keyword: keyword}).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("keyword %q matched %d orders", keyword, count)
		}
	}
}
