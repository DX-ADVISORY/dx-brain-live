# Chuyên môn theo ngành

Lớp giao diện này bổ sung danh mục 9 ngành và 9 nhu cầu, ưu tiên pháp lý và M&A. Không thay ảnh nguồn, số KPI, mô hình 3D, tác vụ máy nguồn hoặc nhịp cloud.

Theo yêu cầu thu gọn chữ, `brain-expertise-3d.js` bổ sung hai cụm quỹ đạo chuyên môn và ngành nghề vào cùng scene Three.js hiện có. Các nút sáng, đường dẫn và hạt chuyển động là minh họa chuyên môn, không phải topology hạ tầng hoặc lượng tri thức đã nạp. Chỉ các nhãn phía trước được hiện để hạn chế chồng chữ. Các nút/ngành kết nối cùng bộ chọn hiện có; bảng diễn giải nằm trong mục chi tiết đóng sẵn.

Chế độ mặc định “Chuyên môn 3D” mở rộng vùng não, giữ bốn số kho chính và thu gọn nhật ký kỹ thuật. Nút “Hệ thống” trả lại các vùng chức năng, nguồn, nhật ký và bốn mốc. Hình học não và dữ liệu gốc không bị viết lại. Nút giảm chuyển động tiếp tục dừng chuyển động của lớp mới.

`cloud-status.js` tải `expertise-v1.js` qua hook hiện có. Trình xuất máy nguồn cần tiếp tục giữ `dx-cloud-status-hook`, đồng thời pull các tệp module trước khi xuất bản. `index.html` không cần thêm hook khác.

- `expertise-v1.js`: giao diện, liên kết thanh kỹ năng và kiểm tra bản tổng hợp mỗi 5 phút khi trang mở.
- `expertise-v1.css`: định dạng giới hạn trong module.
- `expertise-model.js`: đếm theo khâu, nhãn và ngày UTC+7; thiếu độ phủ trả `null`.
- `status/expertise_public_v1.json`: danh mục và nhật ký tổng hợp được phép công khai.

Ảnh kỹ năng trong JSON được đối chiếu với `#snap` của trang khi tải. Chỉ nhận ảnh trang mới hơn hoặc bằng mốc JSON, đủ các nhóm quen thuộc và tổng khớp. Nguồn này vẫn là ảnh xuất, không được gọi là kho đã đếm lại hoặc số trực tiếp.

Danh mục đầu việc là phạm vi tư vấn đề xuất, chưa phải bằng chứng kinh nghiệm hoặc tư cách hành nghề. Ngành và chuyên môn là hai bộ nhãn riêng. Không suy điểm năng lực từ số lượng kỹ năng.

Nhật ký ban đầu rỗng. Chỉ hiển thị tiến triển khi trình xuất tin cậy đã đối chiếu biên nhận của từng khâu, gạn dữ liệu và xuất độ phủ ngày. Các khâu gồm thu thập, duyệt tri thức, ghi bộ nhớ, truy xuất đạt và áp dụng vào đầu ra được duyệt. Không cộng các khâu thành một tổng năng lực. Cờ JSON không thay kiểm chứng biên nhận tại nguồn.

Sự kiện dùng `resource_key`, `version` và `stage` để khử trùng. Pháp luật và nội dung pháp lý trong M&A cần kiểm nguồn có thẩm quyền, hiệu lực, chuyển tiếp và phạm vi áp dụng. Bản công khai chỉ chứa tổng hợp đã được phép, không đưa dữ liệu khách hàng hoặc mã biên nhận nội bộ nhạy cảm lên trang.

Chưa có collector hoặc bước ghi bộ nhớ mới được tạo bởi module. Poll giao diện chỉ đọc tệp công khai; nó không thu hoạch hội thoại, không đọc máy nguồn và không tạo tiến triển học hỏi.

Kiểm tra:

```bash
node tests/cloud_status.test.js
node tests/expertise_model.test.js
node tests/expertise_view.test.js
node --check cloud-status.js
node --check expertise-v1.js
node --check expertise-model.js
```
