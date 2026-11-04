const vi = {
  home: 'Trang chủ',
  tree: 'Xem gia phả',
  login: 'Đăng nhập',
  manage: 'Quản lý nội dung',
  heritage: 'Cội nguồn và kết nối',
  discover: 'Câu chuyện dòng họ',
  history: 'Lịch sử dòng họ',
  announcements: 'Thông báo và sự kiện',
  articles: 'Bài viết mới',
  albums: 'Album ảnh mới',
  all: 'Xem tất cả',
  read: 'Đọc tiếp',
  contact: 'Ban liên lạc',
  internal: 'Nội bộ',
  public: 'Công khai',
  empty: 'Nội dung sẽ được cập nhật tại đây.',
  noEvents: 'Chưa có thông báo về sự kiện sắp tới.',
  archive: 'Tin tức dòng họ',
  article: 'Bài viết',
  announcement: 'Thông báo',
  album: 'Album ảnh',
  pinned: 'Nổi bật',
  back: 'Quay lại',
  previous: 'Trang trước',
  next: 'Trang sau',
  draft: 'Bản nháp',
  published: 'Đã đăng / hẹn giờ',
  expired: 'Hết hạn',
  scheduled: 'Hẹn giờ',
  settings: 'Thiết lập trang chủ',
  contents: 'Nội dung',
  trash: 'Thùng rác',
  create: 'Tạo nội dung',
  edit: 'Biên tập',
  preview: 'Xem trước',
  save: 'Lưu thay đổi',
  saved: 'Đã lưu.',
  saving: 'Đang xử lý…',
  error: 'Chưa thực hiện được. Vui lòng thử lại.',
  conflict:
    'Nội dung đã được sửa ở nơi khác. Tải lại trang để nhận bản mới trước khi lưu tiếp.',
  invalid:
    'Thông tin chưa hợp lệ. Kiểm tra tiêu đề, ngày giờ và các trường bắt buộc.',
  permission: 'Chỉ admin và editor đang hoạt động được quản lý nội dung.',
  migration:
    'Chưa tải được khu quản lý. Kiểm tra kết nối và trạng thái migration theo hướng dẫn nâng cấp trong README.',
  unavailable: 'Nội dung đang tạm thời không khả dụng. Vui lòng thử lại sau.',
  title: 'Tiêu đề',
  summary: 'Giới thiệu ngắn',
  body: 'Nội dung',
  kind: 'Loại nội dung',
  category: 'Chuyên mục',
  visibility: 'Người xem',
  status: 'Trạng thái',
  publishAt: 'Thời điểm đăng',
  expiresAt: 'Thời điểm hết hạn',
  eventStart: 'Bắt đầu sự kiện',
  eventEnd: 'Kết thúc sự kiện',
  location: 'Địa điểm',
  scheduleHelp:
    'Giờ Việt Nam (UTC+7), ngày dương lịch. Thông báo cần ngày bắt đầu khi đăng. Để trống thời điểm đăng để đăng ngay khi lưu.',
  publicHelp:
    'Nội dung công khai xem được không cần đăng nhập. Nội bộ chỉ dành cho tài khoản đã được kích hoạt.',
  bodyHelp:
    'Viết theo đoạn, xuống dòng giữa các đoạn. Nội dung được hiển thị dạng văn bản an toàn.',
  moveTrash: 'Chuyển vào thùng rác',
  confirmTrash: 'Xác nhận chuyển vào thùng rác',
  cancel: 'Hủy',
  restore: 'Khôi phục thành bản nháp',
  trashHelp: 'Khôi phục sẽ đưa nội dung về bản nháp; cần đăng lại để hiển thị.',
  images: 'Hình ảnh',
  upload: 'Tải ảnh lên',
  imageHelp:
    'Chọn nhiều ảnh JPG, PNG hoặc WebP. Ảnh lớn tự nén xuống dưới 4 MB trước khi tải. Có thể chỉnh mô tả sau; ảnh có thứ tự nhỏ nhất được dùng làm ảnh đại diện.',
  saveFirst: 'Lưu bản nháp trước để thêm ảnh.',
  alt: 'Mô tả ảnh',
  caption: 'Chú thích',
  position: 'Thứ tự ảnh',
  removeImage: 'Xóa ảnh',
  confirmImage: 'Xác nhận xóa ảnh',
  cover: 'Ảnh bìa trang chủ',
  coverHelp:
    'Ảnh bìa và thông tin bên dưới là công khai. Chọn ảnh rồi bấm “Lưu ảnh bìa trang chủ” cạnh ảnh để áp dụng. “Lưu mô tả ảnh” chỉ cập nhật mô tả, chú thích và thứ tự ảnh.',
  saveHomeSettings: 'Lưu thông tin và ảnh bìa',
  homeSettingsSaved: 'Đã lưu thiết lập trang chủ.',
  saveCover: 'Lưu ảnh bìa trang chủ',
  coverPending: 'Đã chọn ảnh này, chưa lưu lên trang chủ.',
  coverCurrent: 'Ảnh bìa đang được dùng trên trang chủ.',
  noCoverSelected: 'Không dùng ảnh bìa',
  saveImageDetails: 'Lưu mô tả ảnh',
  imageDetailsSaved: 'Đã lưu mô tả và thứ tự ảnh.',
  imageUploaded: 'Đã tải ảnh vào thư viện.',
  subtitle: 'Lời giới thiệu',
  origin: 'Quê quán / nơi phát tích',
  originCurrent: 'Địa chỉ hiện nay',
  originPrevious: 'Địa chỉ cũ (trước sáp nhập)',
  introduction: 'Giới thiệu và lịch sử dòng họ',
  sectionOrder: 'Thứ tự các khu vực',
  up: 'Lên',
  down: 'Xuống',
  updated: 'Cập nhật',
  by: 'Người sửa',
  search: 'Tìm theo tiêu đề',
  filter: 'Lọc',
  every: 'Tất cả',
  noResults: 'Chưa có nội dung phù hợp.',
  historyCategory: 'Lịch sử dòng họ',
  familyCategory: 'Chuyện gia đình',
  activitiesCategory: 'Hoạt động',
  newsCategory: 'Tin tức',
  details: 'Thông tin sự kiện',
  library: 'Những khoảnh khắc cùng nhau',
  noCover: 'Một nơi lưu giữ câu chuyện của dòng họ',
  saveDraft: 'Lưu bản nháp',
  setPublic: 'Nội dung này sẽ được công khai cho mọi người.',
  imageError:
    'Không tải được ảnh. Kiểm tra định dạng, dung lượng, mô tả ảnh và cấu hình Storage.',
  uploadOrigin:
    'Địa chỉ trang và máy chủ tải ảnh không khớp. Tải lại trang từ đúng địa chỉ đang chạy ứng dụng.',
  uploadPermission:
    'Phiên đăng nhập đã hết hạn hoặc tài khoản không có quyền tải ảnh. Đăng nhập lại bằng admin/editor đang hoạt động.',
  uploadSize:
    'Ảnh vượt quá 4 MB. Anh vui lòng giảm dung lượng ảnh rồi tải lại.',
  uploadType:
    'Ảnh chưa được hỗ trợ hoặc không đúng định dạng. Vui lòng chọn ảnh JPG, PNG hoặc WebP.',
  uploadInvalid: 'Thông tin ảnh chưa hợp lệ. Chọn lại ảnh rồi thử tải lên.',
  uploadBucket:
    'Chưa tìm thấy kho ảnh trang chủ. Cần chạy migration trang chủ để tạo bucket home-content.',
  uploadStoragePermission:
    'Supabase từ chối quyền lưu ảnh. Kiểm tra policy Storage home-content trong migration trang chủ và đăng nhập lại.',
  uploadMediaStoragePermission:
    'Supabase từ chối tải file vào kho ảnh chung media-library. Cần kiểm tra policy shared_media_upload và quyền Storage trong migration thư viện ảnh chung.',
  uploadDatabasePermission:
    'Supabase từ chối quyền đọc hoặc lưu thông tin ảnh trong database. Cần kiểm tra quyền bảng và policy RLS của thư viện ảnh; đây không phải lỗi quyền Storage.',
  uploadMediaBucket:
    'Chưa tìm thấy kho ảnh chung media-library. Cần chạy migration 20261015010000_shared_media_library.sql trên Supabase.',
  uploadMediaSchema:
    'Cấu trúc thư viện ảnh chung chưa được cập nhật. Cần chạy migration 20261015010000_shared_media_library.sql trên Supabase.',
  uploadSchema:
    'Cấu trúc dữ liệu ảnh chưa được cập nhật. Cần chạy migration trang chủ trên Supabase.',
  uploadLimit: 'Thư viện này đã có 100 ảnh. Xóa bớt ảnh trước khi tải thêm.',
  uploadNotFound:
    'Nội dung chứa ảnh không còn tồn tại hoặc đã vào thùng rác. Tải lại trang để kiểm tra.',
  uploadSave:
    'Ảnh chưa lưu được thông tin vào thư viện. Vui lòng tải lại trang và thử lại.',
  uploadStorage:
    'Không kết nối hoặc lưu được ảnh vào Supabase Storage. Kiểm tra kết nối rồi thử lại.',
  uploadNetwork:
    'Không kết nối được máy chủ tải ảnh. Kiểm tra mạng và server local rồi thử lại.',
  updatedByHelp:
    'Mã người sửa và thời điểm được ghi tự động; tài khoản đã xóa có thể không còn tên.',
  publicSettings: 'Thông tin công khai',
  openHome: 'Mở trang chủ'
}
const en: typeof vi = {
  home: 'Home',
  tree: 'Family tree',
  login: 'Sign in',
  manage: 'Manage content',
  heritage: 'Roots and connections',
  discover: 'Our family stories',
  history: 'Family history',
  announcements: 'Announcements and events',
  articles: 'Latest stories',
  albums: 'Latest albums',
  all: 'View all',
  read: 'Read more',
  contact: 'Family contacts',
  internal: 'Members only',
  public: 'Public',
  empty: 'New content will appear here.',
  noEvents: 'No upcoming events have been announced.',
  archive: 'Family news',
  article: 'Story',
  announcement: 'Announcement',
  album: 'Photo album',
  pinned: 'Featured',
  back: 'Back',
  previous: 'Previous',
  next: 'Next',
  draft: 'Draft',
  published: 'Published / scheduled',
  expired: 'Expired',
  scheduled: 'Scheduled',
  settings: 'Homepage settings',
  contents: 'Content',
  trash: 'Trash',
  create: 'Create content',
  edit: 'Edit',
  preview: 'Preview',
  save: 'Save changes',
  saved: 'Saved.',
  saving: 'Working…',
  error: 'Unable to complete this action. Please try again.',
  conflict:
    'This content was changed elsewhere. Reload to get the latest version before saving again.',
  invalid: 'Check the title, dates and required fields.',
  permission: 'Only active admins and editors can manage content.',
  migration:
    'Unable to load the editor. Check the connection and migration status using the upgrade instructions in README.',
  unavailable: 'Content is temporarily unavailable. Please try again later.',
  title: 'Title',
  summary: 'Summary',
  body: 'Body',
  kind: 'Content type',
  category: 'Category',
  visibility: 'Audience',
  status: 'Status',
  publishAt: 'Publish at',
  expiresAt: 'Expires at',
  eventStart: 'Event starts',
  eventEnd: 'Event ends',
  location: 'Location',
  scheduleHelp:
    'Vietnam time (UTC+7), Gregorian dates. Published announcements require a start date. Leave publish time empty to publish on save.',
  publicHelp:
    'Public content is visible without signing in. Internal content is limited to active members.',
  bodyHelp:
    'Write in paragraphs separated by line breaks. Content is displayed as safe plain text.',
  moveTrash: 'Move to trash',
  confirmTrash: 'Confirm move to trash',
  cancel: 'Cancel',
  restore: 'Restore as draft',
  trashHelp:
    'Restoring returns content to draft. Publish it again to make it visible.',
  images: 'Images',
  upload: 'Upload image',
  imageHelp:
    'Choose multiple JPG, PNG or WebP images. Large images are compressed below 4 MB before upload. Edit descriptions later; the lowest order number determines the cover.',
  saveFirst: 'Save a draft before adding images.',
  alt: 'Image description',
  caption: 'Caption',
  position: 'Image order',
  removeImage: 'Delete image',
  confirmImage: 'Confirm image deletion',
  cover: 'Homepage cover image',
  coverHelp:
    'The cover and information below are public. Choose an image and click “Save homepage cover” beside it to apply. “Save image details” only updates its description, caption and order.',
  saveHomeSettings: 'Save information and cover',
  homeSettingsSaved: 'Homepage settings saved.',
  saveCover: 'Save homepage cover',
  coverPending: 'Selected, not yet saved to the homepage.',
  coverCurrent: 'Current homepage cover.',
  noCoverSelected: 'Use no cover image',
  saveImageDetails: 'Save image details',
  imageDetailsSaved: 'Image description and order saved.',
  imageUploaded: 'Image uploaded to the library.',
  subtitle: 'Introduction line',
  origin: 'Family origin',
  originCurrent: 'Current address',
  originPrevious: 'Previous address (before administrative merger)',
  introduction: 'Introduction and family history',
  sectionOrder: 'Section order',
  up: 'Up',
  down: 'Down',
  updated: 'Updated',
  by: 'Edited by',
  search: 'Search titles',
  filter: 'Filter',
  every: 'All',
  noResults: 'No matching content yet.',
  historyCategory: 'Family history',
  familyCategory: 'Family stories',
  activitiesCategory: 'Activities',
  newsCategory: 'News',
  details: 'Event details',
  library: 'Moments together',
  noCover: 'A home for our family stories',
  saveDraft: 'Save draft',
  setPublic: 'This content will be visible to everyone.',
  imageError:
    'Unable to upload. Check the image format, size, description and Storage configuration.',
  uploadOrigin:
    'The page and upload server addresses do not match. Reload from the address running this application.',
  uploadPermission:
    'Your session expired or you do not have upload permission. Sign in again as an active admin/editor.',
  uploadSize: 'The image exceeds 4 MB. Reduce its size and try again.',
  uploadType:
    'Unsupported or mismatched image format. Choose a JPG, PNG or WebP image.',
  uploadInvalid: 'Invalid image information. Choose the image again and retry.',
  uploadBucket:
    'The homepage image bucket was not found. Apply the homepage migration to create home-content.',
  uploadStoragePermission:
    'Supabase denied permission to save the image. Check the home-content Storage policy in the homepage migration and sign in again.',
  uploadMediaStoragePermission:
    'Supabase denied the file upload to media-library. Check the shared_media_upload policy and Storage grants in the shared media migration.',
  uploadDatabasePermission:
    'Supabase denied access to the image metadata in the database. Check the library table grants and RLS policies; this is not a Storage permission error.',
  uploadMediaBucket:
    'The media-library bucket is missing. Apply 20261015010000_shared_media_library.sql in Supabase.',
  uploadMediaSchema:
    'The shared media schema is not up to date. Apply 20261015010000_shared_media_library.sql in Supabase.',
  uploadSchema:
    'The image database schema is not up to date. Apply the homepage migration in Supabase.',
  uploadLimit:
    'This library already contains 100 images. Remove some before uploading more.',
  uploadNotFound:
    'The parent content no longer exists or is in the trash. Reload to check.',
  uploadSave: 'Unable to save the image metadata. Reload and try again.',
  uploadStorage:
    'Unable to connect or save to Supabase Storage. Check the connection and try again.',
  uploadNetwork:
    'Unable to reach the upload server. Check your network and local server, then try again.',
  updatedByHelp:
    'Editor ID and timestamp are recorded automatically. Deleted accounts may no longer have a name.',
  publicSettings: 'Public information',
  openHome: 'Open homepage'
}
export function contentText(locale: string) {
  return locale === 'en' ? en : vi
}

export function contentUploadErrorText(
  code: unknown,
  locale: string,
  status = 0
) {
  const t = contentText(locale)
  if (status === 413) return t.uploadSize
  if (status === 401) return t.uploadPermission
  const messages: Record<string, string> = {
    origin: t.uploadOrigin,
    permission: t.uploadPermission,
    size: t.uploadSize,
    type: t.uploadType,
    invalid: t.uploadInvalid,
    bucket: t.uploadBucket,
    storagePermission: t.uploadStoragePermission,
    mediaStoragePermission: t.uploadMediaStoragePermission,
    databasePermission: t.uploadDatabasePermission,
    mediaBucket: t.uploadMediaBucket,
    mediaSchema: t.uploadMediaSchema,
    schema: t.uploadSchema,
    limit: t.uploadLimit,
    notFound: t.uploadNotFound,
    save: t.uploadSave,
    upload: t.uploadStorage
  }
  return typeof code === 'string' && Object.hasOwn(messages, code)
    ? messages[code]
    : t.imageError
}
export function categoryText(category: string, locale: string) {
  const t = contentText(locale)
  return (
    (
      {
        history: t.historyCategory,
        family: t.familyCategory,
        activities: t.activitiesCategory,
        news: t.newsCategory
      } as Record<string, string>
    )[category] || t.newsCategory
  )
}
