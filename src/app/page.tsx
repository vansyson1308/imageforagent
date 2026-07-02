export default function Home() {
  const sections = [
    { title: "1. Nhập kịch bản", hint: "Google Sheet hoặc dán từ Clipboard" },
    { title: "2. Bảng phân cảnh", hint: "Chỉnh sửa từng frame, kéo thả thứ tự" },
    { title: "3. Tài sản & Generate", hint: "Mascot / Style / Watermark + tạo ảnh" },
    { title: "4. Preview", hint: "Xem trước dạng slideshow" },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <header className="mb-8 flex items-center gap-3">
        <div className="btn-gradient h-9 w-9 rounded-xl" />
        <div>
          <h1 className="text-xl font-bold">Storyboard Studio</h1>
          <p className="text-sm text-muted">
            Chuỗi ảnh storyboard với mascot nhất quán cho video animation
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-6">
        {sections.map((s) => (
          <section
            key={s.title}
            className="rounded-card border border-line bg-card p-6"
          >
            <h2 className="font-semibold">{s.title}</h2>
            <p className="mt-1 text-sm text-muted">{s.hint}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
