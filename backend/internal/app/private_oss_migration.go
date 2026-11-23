package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"yingce/backend/internal/model"
)

// LocalResourceMigration records the exact locations needed to reverse a
// single-resource cutover. It contains no storage credentials.
type LocalResourceMigration struct {
	ResourceID       string `json:"resourceId"`
	UserID           string `json:"userId"`
	OriginalKey      string `json:"originalKey"`
	OriginalETag     string `json:"originalETag"`
	BackupPath       string `json:"backupPath"`
	SHA256           string `json:"sha256"`
	Size             int64  `json:"size"`
	PlaybackKey      string `json:"playbackKey,omitempty"`
	PlaybackBackup   string `json:"playbackBackup,omitempty"`
	PlaybackSHA256   string `json:"playbackSHA256,omitempty"`
	PlaybackSize     int64  `json:"playbackSize,omitempty"`
	Bucket           string `json:"bucket"`
	Endpoint         string `json:"endpoint"`
	StorageSettingID string `json:"storageSettingId"`
	OSSKey           string `json:"ossKey"`
	ETag             string `json:"etag"`
	State            string `json:"state"`
}

func (s *Service) InspectLocalResourceForPrivateOSS(userID, id string) (*LocalResourceMigration, error) {
	resource, err := s.repo.ResourceForUser(userID, id)
	if err != nil {
		return nil, err
	}
	source, err := s.localMigrationSource(resource)
	if err != nil {
		return nil, err
	}
	hash, size, err := fileSHA256(source)
	if err != nil || size != resource.Size {
		return nil, errors.Join(err, errors.New("本地资源大小校验失败"))
	}
	return &LocalResourceMigration{ResourceID: id, UserID: userID, OriginalKey: resource.ObjectKey, SHA256: hash, Size: size, State: "inspected"}, nil
}

func (s *Service) localMigrationSource(resource *model.Resource) (string, error) {
	if resource == nil || resource.Provider != "local" || resource.Status != model.ResourceStatusReady {
		return "", errors.New("仅允许迁移已就绪的本地资源")
	}
	root := filepath.Join(s.dataDir, "resources")
	file := filepath.Join(root, filepath.FromSlash(resource.ObjectKey))
	rel, err := filepath.Rel(root, file)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", errors.New("本地资源路径越界")
	}
	info, err := os.Lstat(file)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Size() != resource.Size {
		return "", errors.New("本地资源不是大小匹配的普通文件")
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	resolvedFile, err := filepath.EvalSymlinks(file)
	if err != nil {
		return "", err
	}
	resolvedRel, err := filepath.Rel(resolvedRoot, resolvedFile)
	if err != nil || resolvedRel == ".." || strings.HasPrefix(resolvedRel, ".."+string(os.PathSeparator)) {
		return "", errors.New("本地资源真实路径越界")
	}
	return file, nil
}

func fileSHA256(file string) (string, int64, error) {
	reader, err := os.Open(file)
	if err != nil {
		return "", 0, err
	}
	defer reader.Close()
	hash := sha256.New()
	n, err := io.Copy(hash, reader)
	return hex.EncodeToString(hash.Sum(nil)), n, err
}

func copyVerifiedBackup(source, backup, expectedHash string, expectedSize int64) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(backup, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	syncErr := output.Sync()
	closeErr := output.Close()
	if err := errors.Join(copyErr, syncErr, closeErr); err != nil {
		return err
	}
	hash, size, err := fileSHA256(backup)
	if err != nil || hash != expectedHash || size != expectedSize {
		return errors.Join(err, errors.New("独立备份校验失败"))
	}
	return nil
}

func verifiedFileUnder(root, key string) (string, string, int64, error) {
	file := filepath.Join(root, filepath.FromSlash(key))
	rel, err := filepath.Rel(root, file)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", "", 0, errors.New("文件路径越界")
	}
	info, err := os.Lstat(file)
	if err != nil || !info.Mode().IsRegular() {
		return "", "", 0, errors.Join(err, errors.New("文件不是普通文件"))
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", "", 0, err
	}
	resolvedFile, err := filepath.EvalSymlinks(file)
	if err != nil {
		return "", "", 0, err
	}
	resolvedRel, err := filepath.Rel(resolvedRoot, resolvedFile)
	if err != nil || resolvedRel == ".." || strings.HasPrefix(resolvedRel, ".."+string(os.PathSeparator)) {
		return "", "", 0, errors.New("文件真实路径越界")
	}
	hash, size, err := fileSHA256(file)
	return file, hash, size, err
}

func restoreVerifiedFile(root, key, backup, expectedHash string, expectedSize int64) error {
	backupHash, backupSize, err := fileSHA256(backup)
	if err != nil || backupHash != expectedHash || backupSize != expectedSize {
		return errors.Join(err, errors.New("备份校验失败，拒绝回滚"))
	}
	target := filepath.Join(root, filepath.FromSlash(key))
	rel, err := filepath.Rel(root, target)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return errors.New("回滚文件路径越界")
	}
	if _, err := os.Lstat(target); os.IsNotExist(err) {
		if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
			return err
		}
		input, err := os.Open(backup)
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o640)
		if err != nil {
			input.Close()
			return err
		}
		_, copyErr := io.Copy(output, input)
		syncErr := output.Sync()
		closeErr := output.Close()
		input.Close()
		if err := errors.Join(copyErr, syncErr, closeErr); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	_, hash, size, err := verifiedFileUnder(root, key)
	if err != nil || hash != expectedHash || size != expectedSize {
		return errors.Join(err, errors.New("回滚文件校验失败"))
	}
	return nil
}

func writeMigrationManifest(file string, entry LocalResourceMigration) error {
	encoded, err := json.MarshalIndent(entry, "", "  ")
	if err != nil {
		return err
	}
	tmp := file + ".tmp"
	output, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, writeErr := output.Write(append(encoded, '\n'))
	syncErr := output.Sync()
	closeErr := output.Close()
	if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
		return err
	}
	return os.Rename(tmp, file)
}

func SaveLocalResourceMigrationManifest(file string, entry LocalResourceMigration) error {
	return writeMigrationManifest(file, entry)
}

// MigrateLocalResourceToPrivateOSS copies and verifies one local object before
// atomically changing its Resource row. The local original and backup remain.
func (s *Service) MigrateLocalResourceToPrivateOSS(userID, id, backupDir, manifestPath string) (*LocalResourceMigration, error) {
	if userID == "" || id == "" || backupDir == "" || manifestPath == "" {
		return nil, errors.New("必须指定用户、资源、备份目录和清单路径")
	}
	if _, err := os.Stat(manifestPath); err == nil {
		return nil, errors.New("迁移清单已存在，拒绝覆盖")
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	resource, err := s.repo.ResourceForUser(userID, id)
	if err != nil {
		return nil, err
	}
	source, err := s.localMigrationSource(resource)
	if err != nil {
		return nil, err
	}
	setting, err := s.activeOSSSetting()
	if err != nil {
		return nil, err
	}
	if setting.Provider != aliyunOSSProvider || !setting.Delivery.PrivateMediaProxy || setting.CDNBaseURL != "" || setting.StorageLocationID == "" {
		return nil, errors.New("平台私有阿里云 OSS 未经测试并启用")
	}
	hash, size, err := fileSHA256(source)
	if err != nil || size != resource.Size {
		return nil, errors.Join(err, errors.New("本地资源校验失败"))
	}
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		return nil, err
	}
	backup := filepath.Join(backupDir, safeObjectSegment(id)+"-"+hash+".bak")
	if err := copyVerifiedBackup(source, backup, hash, size); err != nil {
		return nil, err
	}
	ext := path.Ext(resource.ObjectKey)
	key := path.Join(setting.PathPrefix, "migrations", safeObjectSegment(id), hash+ext)
	entry := LocalResourceMigration{ResourceID: id, UserID: userID, OriginalKey: resource.ObjectKey, OriginalETag: resource.ETag, BackupPath: backup, SHA256: hash, Size: size, Bucket: setting.Bucket, Endpoint: setting.Endpoint, StorageSettingID: setting.StorageLocationID, OSSKey: key, State: "prepared"}
	if resource.PlaybackStatus == model.PlaybackStatusReady {
		if resource.PlaybackObjectKey == "" {
			return nil, errors.New("历史播放副本键为空，拒绝迁移")
		}
		playbackSource, playbackHash, playbackSize, err := verifiedFileUnder(filepath.Join(s.dataDir, playbackDirName), resource.PlaybackObjectKey)
		if err != nil {
			return nil, fmt.Errorf("历史播放副本不可用：%w", err)
		}
		playbackBackup := filepath.Join(backupDir, safeObjectSegment(id)+"-playback-"+playbackHash+".bak")
		if err := copyVerifiedBackup(playbackSource, playbackBackup, playbackHash, playbackSize); err != nil {
			return nil, err
		}
		entry.PlaybackKey, entry.PlaybackBackup, entry.PlaybackSHA256, entry.PlaybackSize = resource.PlaybackObjectKey, playbackBackup, playbackHash, playbackSize
	}
	if err := writeMigrationManifest(manifestPath, entry); err != nil {
		return nil, err
	}
	reader, err := os.Open(backup)
	if err != nil {
		return &entry, err
	}
	etag, putErr := putOSSObject(s.storageSettingWithRuntimePolicy(setting), key, resource.MimeType, size, reader)
	reader.Close()
	if putErr != nil {
		return &entry, putErr
	}
	entry.ETag = etag
	entry.State = "uploaded"
	if err := writeMigrationManifest(manifestPath, entry); err != nil {
		return &entry, err
	}
	stream, err := getOriginOSSObjectRange(s.storageSettingWithRuntimePolicy(setting), key, "")
	if err != nil {
		return &entry, err
	}
	if stream == nil || stream.Body == nil || stream.StatusCode != http.StatusOK {
		if stream != nil && stream.Body != nil {
			stream.Body.Close()
		}
		return &entry, errors.New("OSS 回读未返回完整对象，数据库未切换")
	}
	remoteHash := sha256.New()
	remoteSize, readErr := io.Copy(remoteHash, stream.Body)
	closeErr := stream.Body.Close()
	if err := errors.Join(readErr, closeErr); err != nil || remoteSize != size || hex.EncodeToString(remoteHash.Sum(nil)) != hash {
		return &entry, errors.Join(err, errors.New("OSS 对象大小或 SHA-256 不匹配，数据库未切换"))
	}
	entry.State = "verified"
	if err := writeMigrationManifest(manifestPath, entry); err != nil {
		return &entry, err
	}
	if currentHash, currentSize, err := fileSHA256(source); err != nil || currentHash != hash || currentSize != size {
		return &entry, errors.Join(err, errors.New("迁移期间本地资源发生变化，数据库未切换"))
	}
	if entry.PlaybackKey != "" {
		_, currentHash, currentSize, err := verifiedFileUnder(filepath.Join(s.dataDir, playbackDirName), entry.PlaybackKey)
		if err != nil || currentHash != entry.PlaybackSHA256 || currentSize != entry.PlaybackSize {
			return &entry, errors.Join(err, errors.New("迁移期间历史播放副本发生变化，数据库未切换"))
		}
	}
	next := *resource
	next.Provider, next.Endpoint, next.Bucket = aliyunOSSProvider, setting.Endpoint, setting.Bucket
	next.StorageSettingID, next.ObjectKey, next.PublicURL, next.ETag = setting.StorageLocationID, key, "", etag
	changed, err := s.repo.CompareAndSwapResourceLocation(userID, id, resource, &next)
	if err != nil || !changed {
		return &entry, errors.Join(err, errors.New("资源状态已变化，数据库未切换"))
	}
	entry.State = "committed"
	if err := writeMigrationManifest(manifestPath, entry); err != nil {
		return &entry, fmt.Errorf("数据库已切换但清单写入失败，请按已验证清单核查：%w", err)
	}
	return &entry, nil
}

// RollbackPrivateOSSMigration restores the original DB location after checking
// both independent backup and retained original. It never deletes the OSS copy.
func (s *Service) RollbackPrivateOSSMigration(entry LocalResourceMigration) error {
	if (entry.State != "committed" && entry.State != "verified") || entry.ResourceID == "" || entry.UserID == "" {
		return errors.New("迁移清单未完成或无效")
	}
	if err := restoreVerifiedFile(filepath.Join(s.dataDir, "resources"), entry.OriginalKey, entry.BackupPath, entry.SHA256, entry.Size); err != nil {
		return err
	}
	if entry.PlaybackKey != "" {
		if err := restoreVerifiedFile(filepath.Join(s.dataDir, playbackDirName), entry.PlaybackKey, entry.PlaybackBackup, entry.PlaybackSHA256, entry.PlaybackSize); err != nil {
			return err
		}
	}
	next := &model.Resource{Provider: "local", ObjectKey: entry.OriginalKey, ETag: entry.OriginalETag}
	previous := &model.Resource{Provider: aliyunOSSProvider, Endpoint: entry.Endpoint, Bucket: entry.Bucket, StorageSettingID: entry.StorageSettingID, ObjectKey: entry.OSSKey, ETag: entry.ETag}
	changed, err := s.repo.CompareAndSwapResourceLocation(entry.UserID, entry.ResourceID, previous, next)
	if err != nil || !changed {
		return errors.Join(err, errors.New("资源位置已变化，拒绝回滚"))
	}
	return nil
}
