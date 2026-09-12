# Nitro Checker — Cluster Edition

Standalone Node.js script. Không cần bot framework — chạy thẳng `node app.js`.  
Dùng `cluster` để fork N process theo số CPU, mỗi process chạy 300 concurrent slot song song.

---

## Cấu trúc thư mục

```
/
├── app.js               ← entry point, toàn bộ logic
├── .env                 ← config token / channel / status
├── proxies.txt          ← danh sách proxy, mỗi dòng ip:port
├── codes.json           ← valid codes lưu lại (tự sinh khi có hit)
├── material-data.json   ← không dùng trong runtime
└── util/
    ├── gateway.js       ← WebSocket Gateway — chỉ để set presence bot
    └── logger.js        ← logger đơn giản có timestamp
```

---

## Cài đặt

```bash
npm install
```

Dependencies: `dotenv`, `undici`, `ws` — xem `package.json`.

---

## Cấu hình `.env`

```env
# Token bot Discord
DISCORD_TOKEN=

# Channel nhận code hợp lệ (ping owner + link)
CHANNEL_ID=

# Channel nhận invalid codes (gộp batch mỗi 3s)
CHANNEL_INVALID_ID=

# User ID để ping khi có hit
OWNER_ID=

# Trạng thái bot: ONLINE / IDLE / DND / OFFLINE
STATUS=IDLE

# Tên activity hiển thị
STATUS_NAME=Nitro Generator by dzaycrazy

# Loại activity: PLAYING / STREAMING / LISTENING / WATCHING / COMPETING
STATUS_ACTIVITY=WATCHING
```

`CHANNEL_INVALID_ID` và `STATUS_*` là tùy chọn — bỏ trống vẫn chạy được.

---

## Hằng số trong `app.js`

Chỉnh ở đầu file nếu cần, không cần đụng vào logic bên dưới.

| Hằng số | Mặc định | Mô tả |
|---|---|---|
| `CODE_LENGTH` | `16` | Độ dài code generate |
| `WORKERS_PER_PROC` | `300` | Số slot concurrent mỗi process |
| `REQ_TIMEOUT` | `800` | Timeout request (ms) |
| `PROXY_MAX_FAIL` | `10` | Số lần fail tối đa trước khi skip proxy |
| `STATS_INTERVAL` | `5000` | Chu kỳ in stats ra console (ms) |
| `SHOW_INVALID` | `true` | Gửi invalid codes vào `CHANNEL_INVALID_ID` |

---

## Chạy

```bash
node app.js
```

Bot tự tính số CPU và fork đúng số process. Không cần chỉ định tay.

Để chạy nền (Linux):

```bash
nohup node app.js > output.log 2>&1 &
```

Hoặc dùng PM2:

```bash
pm2 start app.js --name nitro
pm2 logs nitro
```

---

## Proxy

Đặt vào `proxies.txt`, mỗi dòng một proxy, format `ip:port`:

```
1.2.3.4:8080
5.6.7.8:3128
```

Mỗi worker process tự shuffle (LCG seed theo index) rồi slice ra một phần riêng — các process không tranh proxy với nhau.  
Proxy fail hơn `PROXY_MAX_FAIL` lần trong session → bị skip. Khi hết sạch proxy tốt → reset toàn bộ fail count, quay lại từ đầu.

File đi kèm có sẵn **130,000+ proxy** — có thể thay bằng list mới bất cứ lúc nào, không cần restart.

---

## Cách hoạt động

```
Primary
  ├─ fork Worker[0]  (proxy slice 0)
  ├─ fork Worker[1]  (proxy slice 1)
  ├─ ...
  └─ fork Worker[N-1]  (proxy slice N-1)

Mỗi Worker chạy 300 slot song song:
  gen code → GET discord.com/api/v9/entitlements/gift-codes/<code>
    200  → HIT   → báo primary → ping Discord + lưu codes.json
    404  → invalid
    429  → đợi 400–1000ms random → tiếp
    lỗi  → markFail proxy → tiếp
  └─ setImmediate(runSlot)  ← loop ngay lập tức
```

**Tổng concurrent** = số CPU × 300. Ví dụ máy 4 core = 1200 request bay cùng lúc.

Stats in ra console mỗi 5s:
```
📊 Check: 1,240,000 | ✅ Found: 0 | ⚡ 4,200/s (avg 3,800/s) | ⏱ 326s
```

---

## Khi tìm được code

Primary nhận message từ worker, đồng thời:

1. In ra console có màu nền xanh lá
2. Gửi Discord vào `CHANNEL_ID`: ping `@OWNER_ID` + link `discord.gift/<code>`
3. Append vào `codes.json` (tạo tự động)

---

## Lưu ý

- Worker chết vì bất kỳ lý do gì → Primary tự restart ngay, không cần can thiệp.
- `SIGINT` / `SIGTERM` bị bắt và bỏ qua — dùng `kill -9 <pid>` hoặc `pm2 stop` để dừng thật sự.
- `codes.json` ghi đè toàn bộ mỗi lần có hit mới — không append từng dòng. Xóa file không ảnh hưởng runtime.
- `util/gateway.js` chỉ connect Gateway để set presence, `intents = 0` — bot không nhận bất kỳ event Discord nào.
- Không có lệnh Discord, không có UI — thuần CLI.

---

*dzaycrazy — Nitro Checker Cluster Edition*
