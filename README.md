# Family Tree Single — Gia phả Việt Nam

[Family Tree Single](https://github.com/nghianguyen89/family-tree-single) là ứng dụng quản lý gia phả cho một gia đình. Mỗi bản cài đặt dùng project Supabase riêng cho dữ liệu, tài khoản và ảnh; người triển khai tự quản lý quyền truy cập và sao lưu.

[Xem Demo](https://demo-familytree.vercel.app). Demo dùng dữ liệu hư cấu; không nhập thông tin gia đình thật vào đó.

## Tính năng

- Quản lý thành viên, ảnh đại diện, quan hệ cha mẹ–con và vợ chồng; xem cây, mindmap, thống kê và danh xưng.
- Ghi ngày chính xác, ngày chưa đầy đủ hoặc khoảng năm ước tính; quản lý sự kiện, ngày giỗ và ngày cúng âm/dương lịch.
- Nhánh gia đình bên dâu/rể, thư viện ảnh, bài viết, album và nội dung trang chủ.
- Tạo link thu thập thông tin để người thân gửi hồ sơ; admin/editor duyệt trước khi đưa vào cây.
- Phân quyền tài khoản, xuất nhập gia phả và sao lưu toàn website trên local/máy chủ riêng.
- Giao diện tiếng Việt/tiếng Anh, sáng/tối và hỗ trợ điện thoại.

## Cài đặt local

Cần Git, Node.js từ 20.9 và Bun. Ứng dụng dùng Next.js 16, React 19, TypeScript và Supabase; chạy local vẫn cần kết nối Supabase.

```sh
git clone https://github.com/nghianguyen89/family-tree-single.git
cd family-tree-single
bun install --frozen-lockfile
```

Sao chép `.env.example` thành `.env.local` bằng trình quản lý tệp hoặc terminal; giữ nguyên file đã có nếu đang nâng cấp. Tạo một project Supabase của riêng bạn rồi điền cấu hình:

| Biến                                           | Cách sử dụng                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FAMILY_ID`                                    | Để trống hoặc không khai báo để dùng bản một gia đình.                                                                                                  |
| `SITE_NAME`                                    | Tên website; mặc định `Gia Phả`.                                                                                                                        |
| `APP_URL`                                      | Origin của website: local `http://localhost:3000`, production dùng HTTPS, không thêm đường dẫn.                                                         |
| `NEXT_PUBLIC_SUPABASE_URL`                     | URL project có dạng `https://<project-ref>.supabase.co`; ref gồm 20 chữ thường/chữ số.                                                                  |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Publishable key hoặc legacy anon key của cùng project.                                                                                                  |
| `NEXT_PUBLIC_DISABLE_SSO`                      | Giữ `true` nếu chưa cấu hình Google/Facebook trong Supabase Auth.                                                                                       |
| `SUPABASE_SERVICE_ROLE_KEY`                    | Secret/service-role key phía server; cần cho ảnh và các chức năng dùng admin client.                                                                    |
| `SUPABASE_DB_URL`                              | Kết nối PostgreSQL của cùng project, dùng cho migration trong Dashboard và sao lưu toàn website. Có thể để trống khi khởi tạo thủ công bằng SQL Editor. |

Lấy URL/key và chuỗi kết nối từ Dashboard của đúng project Supabase. Không dùng anon/service-role key làm mật khẩu database. Chuỗi PostgreSQL cần TLS và mật khẩu được mã hóa URL nếu có ký tự đặc biệt. Giữ `.env.local` ngoài Git; secret/service-role key và kết nối database chỉ đặt trên server, không đổi thành tên `NEXT_PUBLIC_*`.

Tên website lấy từ `SITE_NAME`; bản cài mới dùng nhận diện chung có sẵn, không cần tạo cấu hình gia tộc hay logo riêng.

```sh
bun dev
```

Mở `http://localhost:3000`. Dừng bằng `Ctrl+C`; khởi động lại sau khi thay biến môi trường.

## Khởi tạo Supabase và admin đầu tiên

1. Trong Supabase Auth → URL Configuration, đặt Site URL là `http://localhost:3000` và thêm Redirect URL `http://localhost:3000/auth/callback`.
2. Mở `http://localhost:3000/setup`, sao chép **toàn bộ SQL** rồi chạy trong SQL Editor của project vừa tạo. Bundle gồm schema, migration theo thứ tự và lịch sử migration trong một transaction. Nếu lỗi, xử lý lỗi trước khi tiếp tục.
3. Quay lại website, đăng ký tài khoản của người quản trị và xác minh email.
4. Mở [docs/bootstrap-admin.sql](docs/bootstrap-admin.sql), thay email mẫu bằng email vừa xác minh, chạy trong Supabase SQL Editor.
5. Đăng xuất và đăng nhập lại. Tài khoản này đã có quyền admin.

Script bootstrap chỉ cấp admin đầu tiên khi chưa có admin hoạt động; không dùng để duyệt tài khoản tiếp theo. Tài khoản mới mặc định là member chưa hoạt động. Admin duyệt trong **Quản lý người dùng**, cấp vai trò và liên kết hồ sơ phù hợp.

Nếu dùng Google/Facebook, cấu hình provider và callback theo hướng dẫn Supabase Auth trước khi đặt `NEXT_PUBLIC_DISABLE_SSO=false`. Các biến Resend trong `.env.example` là tùy chọn để gửi thông báo của ứng dụng; cấu hình gửi email xác nhận/khôi phục mật khẩu của Supabase Auth được quản lý riêng trong Supabase.

## Sử dụng

- **Thành viên và sơ đồ:** thêm người, gán quan hệ rồi chọn người gốc phù hợp. Dùng khoảng năm khi không nhớ chính xác; không nhập một ngày giả để thay khoảng năm.
- **Sự kiện:** thêm lịch chung và ngày cúng riêng khi lịch cúng không trùng ngày mất.
- **Thu thập thông tin:** admin/editor tạo link theo nhánh, gửi cho người thân và duyệt hồ sơ chờ. Dùng địa chỉ website public để người ở ngoài máy local truy cập được.
- **Nội dung và ảnh:** admin/editor biên tập bài viết, album và trang chủ; kiểm tra phạm vi công khai/nội bộ trước khi đăng.
- **Quyền truy cập:** admin quản trị hệ thống và tài khoản; editor biên soạn; member xem theo quyền. Quyền nhánh gia đình còn phụ thuộc quan hệ và hồ sơ được liên kết.
- **Dữ liệu:** dùng `/dashboard/data` để xuất nhập và sao lưu; đọc kỹ phạm vi và cảnh báo trước khi nhập vì thao tác có thể thay thế dữ liệu.

## Triển khai production

Có thể triển khai trên Vercel hoặc máy chủ Node.js riêng:

1. Tạo repository của bạn từ mã nguồn này và kết nối với nền tảng triển khai. Giữ `bun.lock` và thư mục `patches`.
2. Đặt các biến môi trường của website trong nền tảng triển khai; `.env.local` trên máy không tự được chuyển lên. Giữ `FAMILY_ID` trống, đặt `SITE_NAME`, `APP_URL=https://your-domain.example` và URL/key của project Supabase riêng.
3. Trong Supabase Auth, đặt Site URL thành origin HTTPS đó và thêm `https://your-domain.example/auth/callback` vào Redirect URLs. Giữ URL local nếu còn phát triển trên máy.
4. Dùng lệnh cài đặt `bun install --frozen-lockfile`, build `bun run build`. Máy chủ riêng chạy `bun start` sau build và cần HTTPS qua reverse proxy.
5. Khởi tạo database/admin theo mục trên nếu project mới. Kiểm tra đăng nhập, quyền member, ảnh và nội dung công khai trước khi mời người thân.

Đổi biến môi trường cần build/deploy lại, nhất là tên website, origin và biến public. Deploy code không tự chạy migration Supabase.

## Sao lưu và khôi phục

Xuất JSON/CSV/GEDCOM tại `/dashboard/data` dành cho phạm vi gia phả. Ưu tiên JSON để giữ dữ liệu riêng của ứng dụng; CSV/GEDCOM phục vụ trao đổi và không thay thế bản sao lưu toàn website. Các file này không chứa toàn bộ tài khoản, nội dung trang chủ và file ảnh.

**Sao lưu toàn website** tại cùng trang mặc định tắt, chỉ chạy trên local/máy chủ riêng, không chạy trên Vercel. Cấu hình:

- `WEBSITE_BACKUP_ENABLED=true`.
- `WEBSITE_BACKUP_OPERATOR_ID` là UUID của admin hoạt động được chỉ định vận hành.
- `SUPABASE_DB_URL` và `SUPABASE_SERVICE_ROLE_KEY` đúng project đích.

File `.ftbackup` được mã hóa bằng mật khẩu tối thiểu 12 ký tự và giới hạn 128 MiB. Bản sao lưu gồm các bảng ứng dụng được hỗ trợ, tài khoản Auth (có hash mật khẩu) và ảnh trong các bucket ứng dụng; không thay thế sao lưu hạ tầng, mã nguồn, biến môi trường, cấu hình Auth/provider/email hoặc cấu hình project Supabase. Cất mật khẩu ở nơi an toàn, tách khỏi file; không đưa bản sao lưu chứa dữ liệu gia đình lên repository public.

Khôi phục thay thế dữ liệu website và nhập mật khẩu nguồn, giữ tài khoản admin phục hồi ở đích; tài khoản chỉ có ở đích có thể mất quyền truy cập website. Thao tác yêu cầu schema tương thích, kiểm tra tài khoản trùng, quyền người vận hành và cấu hình bucket. Đọc bản xem trước, xác nhận đúng project và sao lưu đích trước khi thực hiện. Nếu mất kết nối giữa chừng, kiểm tra dữ liệu thực tế trước khi thử lại. Với dữ liệu lớn hơn giới hạn hoặc yêu cầu phục hồi hạ tầng, dùng công cụ sao lưu của Supabase/PostgreSQL và Storage phù hợp.

Các biến `WEBSITE_BACKUP_SOURCE_*` chỉ dùng khi xuất từ một project nguồn ngoài trên máy vận hành; để trống khi dùng bình thường. Không khai báo các secret này bằng tiền tố `NEXT_PUBLIC_`.

## Nâng cấp và xử lý lỗi

Sao lưu trước khi cập nhật. Chọn phiên bản mã nguồn đã kiểm tra, cài đúng lockfile, build lại và kiểm tra migration tại `/dashboard/upgrade`. Chức năng áp dụng migration cần admin hoạt động và `SUPABASE_DB_URL`; nếu chạy SQL thủ công, đối chiếu các file trong [docs/migrations](docs/migrations/) và trạng thái database. Không chạy lại toàn bộ setup trên database đang dùng chỉ để xóa cảnh báo lịch sử.

`PRODUCT_RELEASE_MANIFEST_URL` là tùy chọn; để trống nếu chưa có kênh manifest tin cậy. Khi thiếu manifest, trạng thái phiên bản nguồn có thể hiện chưa xác minh; không có nghĩa database đã thiếu migration.

| Hiện tượng                                  | Kiểm tra                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/missing-db-config` hoặc lỗi cấu hình      | `APP_URL`, URL/key Supabase, `FAMILY_ID` trống; restart/build lại.                        |
| Chuyển tới `/setup`                         | Project có thể chưa khởi tạo bảng; kiểm tra đúng project rồi chạy setup cho database mới. |
| Tài khoản đầu tiên chờ duyệt                | Xác minh email rồi chạy bootstrap admin.                                                  |
| Ảnh không hiển thị/tải lên lỗi              | Server key, quyền tài khoản, bucket và migration trên đúng project.                       |
| Xác nhận email/đăng nhập chuyển sai website | Site URL và Redirect URLs trong Supabase Auth.                                            |
| Migration lỗi `28P01`                       | User/mật khẩu database trong `SUPABASE_DB_URL`, không phải API key.                       |

## Giấy phép và ghi công

Phát hành theo [MIT License](LICENSE); giữ nguyên thông báo bản quyền khi phân phối hoặc sửa đổi. Dự án kế thừa [homielab/giapha-os](https://github.com/homielab/giapha-os), bản quyền © 2026 HomieLab, và được phát triển tiếp tại [nghianguyen89/family-tree-single](https://github.com/nghianguyen89/family-tree-single).
