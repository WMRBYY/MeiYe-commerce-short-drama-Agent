package app

import (
	"errors"
	"io"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// SaveVideoPoster caches the browser's display poster locally. Production tail
// frames remain separate resources managed by the drama pipeline.
func (s *Service) SaveVideoPoster(userID, resourceID string, body io.Reader) error {
	if strings.TrimSpace(userID) == "" {
		return Unauthorized("请先登录")
	}
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return NotFound("视频不存在或不可访问")
	}
	if err != nil {
		return err
	}
	if resource.Kind != "video" || resource.Status != model.ResourceStatusReady {
		return BadAuthRequest("只能为已就绪的视频保存封面")
	}
	if body == nil {
		return BadAuthRequest("缺少视频封面")
	}
	data, err := io.ReadAll(io.LimitReader(body, (2<<20)+1))
	if err != nil {
		return err
	}
	if len(data) == 0 || len(data) > 2<<20 {
		return BadAuthRequest("视频封面须为 2 MB 以内的图片")
	}
	encoded, mimeType, width, height, err := buildThumbnail(data, "")
	if err != nil {
		return BadAuthRequest("视频封面不是可识别的图片")
	}
	path, err := s.resourceThumbnailPath(resource.ID, mimeType)
	if err != nil {
		return err
	}
	if err = writeFileAtomic(path, encoded); err != nil {
		return err
	}
	return s.markResourceThumbnail(resource, model.ThumbnailStatusReady, mimeType, int64(len(encoded)), width, height)
}
