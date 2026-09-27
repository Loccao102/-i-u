export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <a className="legal-page__back" href="/">← ĐiĐâu</a>
      <span className="eyebrow">Privacy</span>
      <h1>Quyền riêng tư</h1>
      <p>
        ĐiĐâu là ứng dụng personal-first. Hồ sơ hiện tại được nhận diện bằng
        cookie ẩn danh HttpOnly; token thô không được lưu trong cơ sở dữ liệu.
      </p>

      <h2>Vị trí</h2>
      <p>
        GPS hiện tại chỉ được dùng khi bạn chủ động cho phép, để tính khoảng
        cách, thời tiết và tìm địa điểm. ĐiĐâu không lưu vị trí GPS hiện tại
        xuống Supabase.
      </p>

      <h2>Ảnh của bạn</h2>
      <p>
        Ảnh bạn tải lên được lưu trong private Supabase Storage và chỉ được
        phục vụ bằng URL ký có thời hạn cho đúng hồ sơ ẩn danh hiện tại.
      </p>

      <h2>Google Maps Platform</h2>
      <p>
        Khi Google Places được cấu hình, ĐiĐâu có thể gửi tên, địa chỉ và tọa
        độ của địa điểm đã lưu tới Google để tìm Place ID và tải thông tin/ảnh
        trực tiếp. ĐiĐâu chỉ lưu Place ID; nội dung Places và ảnh Google không
        được lưu bền vững.
      </p>
      <p>
        Việc sử dụng nội dung Google Maps Platform chịu sự điều chỉnh của{" "}
        <a
          href="https://policies.google.com/privacy"
          target="_blank"
          rel="noreferrer"
        >
          Chính sách quyền riêng tư của Google
        </a>
        .
      </p>

      <h2>Dữ liệu cá nhân</h2>
      <p>
        Saved, rating, visit, collection, active plan và ảnh tải lên được scope
        theo anonymous owner key ở server. Client không nhận Supabase secret key.
      </p>
    </main>
  );
}
