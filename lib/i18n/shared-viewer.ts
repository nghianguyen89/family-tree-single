export const sharedViewerMessages = {
  vi: {
    title: 'Tài khoản xem chung',
    login: 'Xem gia phả bằng mã chung',
    personal: 'Tài khoản cá nhân',
    description:
      'Nhập mã 8 số do người quản lý gia phả cung cấp. Không cần email.',
    pin: 'Mã xem gia phả (8 số)',
    enter: 'Vào xem gia phả',
    invalidPin: 'Vui lòng nhập đủ 8 chữ số.',
    loginFailed: 'Mã không đúng, tài khoản đã khóa hoặc chưa được thiết lập.',
    unavailable: 'Chưa thể xử lý. Vui lòng thử lại sau.',
    permission: 'Chỉ admin đang hoạt động được quản lý mã xem chung.',
    migration:
      'Cần chạy migration 20261102010000_shared_viewer.sql trước khi thiết lập tài khoản xem chung.',
    setupFailed: 'Chưa hoàn tất thiết lập. Kiểm tra cấu hình Auth và thử lại.',
    sessionsFailed:
      'Tài khoản đang được khóa vì chưa thu hồi được phiên cũ. Vui lòng thử lưu lại.',
    settingsHint:
      'Mọi người dùng cùng mã để xem cây và thành viên, tổng quan, sự kiện, thư viện ảnh và thống kê. Tài khoản này không được chỉnh sửa dữ liệu.',
    newPin: 'Mã mới (8 chữ số)',
    pinHint:
      'Để trống nếu chỉ muốn bật hoặc khóa tài khoản. Không dùng số điện thoại hoặc ngày sinh làm mã.',
    enabled: 'Cho phép đăng nhập xem chung',
    save: 'Lưu thiết lập',
    saved: 'Đã lưu. Khi đổi mã, các phiên xem chung cũ sẽ phải đăng nhập lại.',
    active: 'Đang mở',
    locked: 'Đã khóa',
    notCreated: 'Chưa tạo tài khoản',
    readOnly: 'Chỉ xem gia phả',
    working: 'Đang xử lý…'
  },
  en: {
    title: 'Shared viewing account',
    login: 'View with a shared code',
    personal: 'Personal account',
    description:
      'Enter the 8-digit code from your family administrator. No email needed.',
    pin: 'Family viewing code (8 digits)',
    enter: 'View family tree',
    invalidPin: 'Enter exactly 8 digits.',
    loginFailed:
      'Incorrect code, locked account or shared viewing is not set up.',
    unavailable: 'Unable to process this request. Please try again later.',
    permission: 'Only active admins can manage shared viewing.',
    migration:
      'Apply 20261102010000_shared_viewer.sql before setting up shared viewing.',
    setupFailed: 'Setup is incomplete. Check Auth configuration and try again.',
    sessionsFailed:
      'The account remains locked because old sessions could not be revoked. Please save again.',
    settingsHint:
      'Everyone uses the same code to view the tree and members, overview, events, photo gallery and statistics. This account cannot edit data.',
    newPin: 'New code (8 digits)',
    pinHint:
      'Leave blank to only enable or lock the account. Avoid phone numbers or birth dates as codes.',
    enabled: 'Enable shared viewing',
    save: 'Save settings',
    saved:
      'Saved. Changing the code requires existing shared viewers to sign in again.',
    active: 'Enabled',
    locked: 'Locked',
    notCreated: 'Account not created',
    readOnly: 'Family viewer',
    working: 'Processing…'
  }
} as const
