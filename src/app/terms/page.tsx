export default function TermsPage() {
  return (
    <main className="legal-page">
      <a className="legal-page__back" href="/">← ĐiĐâu</a>
      <span className="eyebrow">Terms</span>
      <h1>Điều khoản sử dụng</h1>
      <p>
        ĐiĐâu hiện là sản phẩm personal-first. Thông tin địa điểm, giờ mở cửa,
        rating và giá có thể thay đổi; hãy kiểm tra lại trước khi di chuyển hoặc
        thanh toán.
      </p>

      <h2>Ảnh người dùng tải lên</h2>
      <p>
        Bạn chỉ nên tải ảnh mà bạn có quyền sử dụng. Không tải nội dung vi phạm
        quyền riêng tư, bản quyền hoặc pháp luật.
      </p>

      <h2>Google Maps Platform</h2>
      <p>
        Một số ảnh và dữ liệu live có thể được cung cấp bởi Google Maps
        Platform. Nội dung đó vẫn thuộc phạm vi điều khoản và attribution của
        Google, không trở thành dữ liệu sở hữu của ĐiĐâu.
      </p>
      <p>
        Khi sử dụng các phần có Google Maps Platform Content, bạn đồng ý với{" "}
        <a
          href="https://cloud.google.com/maps-platform/terms"
          target="_blank"
          rel="noreferrer"
        >
          Google Maps Platform Terms of Service
        </a>
        .
      </p>

      <h2>Không đảm bảo dữ liệu tuyệt đối</h2>
      <p>
        Recommendation chỉ là hỗ trợ ra quyết định dựa trên dữ liệu cá nhân,
        khoảng cách và nguồn bên thứ ba. Người dùng vẫn tự quyết định địa điểm
        phù hợp.
      </p>
    </main>
  );
}
