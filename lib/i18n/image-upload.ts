import type { Locale } from './messages'

const vi = {
  choose: 'Chọn nhiều ảnh',
  hint: 'Chọn hoặc kéo thả nhiều ảnh vào đây. Có thể chọn thêm và bỏ từng ảnh trước khi tải.',
  detailsLater:
    'Tên ảnh tạm lấy từ tên file. Anh/chị có thể chỉnh tên và mô tả chi tiết sau khi tải lên.',
  remove: 'Bỏ ảnh',
  pending: 'Chờ tải',
  uploading: 'Đang tải',
  compressing: 'Đang nén ảnh',
  compressionHelp:
    'Ảnh trên 4 MB được tự động nén trước khi tải. Nhận ảnh gốc tối đa 50 MB; GIF lớn sẽ thành ảnh tĩnh.',
  compressionError:
    'Không đọc hoặc nén được ảnh này. Vui lòng chọn ảnh khác hoặc giảm kích thước rồi thử lại.',
  compressed: (before: string, after: string) =>
    `Đã nén: ${before} MB → ${after} MB`,
  uploaded: 'Đã tải',
  failed: 'Tải lỗi',
  upload: 'Tải ảnh đã chọn',
  retry: 'Tải tiếp / thử lại ảnh lỗi',
  clear: 'Bỏ ảnh đã tải khỏi danh sách',
  empty: 'Chưa chọn ảnh.',
  invalid: 'Định dạng ảnh không được hỗ trợ.',
  size: 'Ảnh rỗng hoặc vượt quá dung lượng cho phép.',
  limit:
    'Số ảnh đã chọn vượt quá số chỗ còn lại. Hãy tải hoặc bỏ bớt ảnh trước khi chọn thêm.',
  network: 'Không tải được ảnh. Kiểm tra kết nối và thử lại.',
  previewError: 'Không đọc được ảnh xem trước.',
  done: 'Hoàn tất',
  progress: (success: number, total: number) =>
    `Đã tải ${success}/${total} ảnh.`,
  limits: (mb: number, formats: string, slots: number) =>
    `${formats}. Ảnh gửi lên tối đa ${mb} MB sau nén; còn nhận thêm ${slots} ảnh.`
}
const en: typeof vi = {
  choose: 'Choose multiple images',
  hint: 'Choose or drop multiple images here. Add more or remove individual images before uploading.',
  detailsLater:
    'Image names initially use the filenames. Edit names and detailed descriptions after uploading.',
  remove: 'Remove image',
  pending: 'Waiting',
  uploading: 'Uploading',
  compressing: 'Compressing image',
  compressionHelp:
    'Images over 4 MB are compressed before uploading. Originals up to 50 MB are accepted; large GIFs become still images.',
  compressionError:
    'Unable to read or compress this image. Choose another image or resize it and retry.',
  compressed: (before, after) => `Compressed: ${before} MB → ${after} MB`,
  uploaded: 'Uploaded',
  failed: 'Upload failed',
  upload: 'Upload selected images',
  retry: 'Continue / retry failed images',
  clear: 'Clear uploaded images from this list',
  empty: 'No images selected.',
  invalid: 'This image format is not supported.',
  size: 'The image is empty or exceeds the size limit.',
  limit:
    'The selection exceeds the remaining capacity. Upload or remove some images before adding more.',
  network: 'Unable to upload this image. Check the connection and retry.',
  previewError: 'Unable to display an image preview.',
  done: 'Done',
  progress: (success, total) => `Uploaded ${success}/${total} images.`,
  limits: (mb, formats, slots) =>
    `${formats}. Uploads up to ${mb} MB after compression; room for ${slots} more images.`
}
export const imageUploadText = (locale: Locale) => (locale === 'en' ? en : vi)
