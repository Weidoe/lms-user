# 緯豆考試系統 - Node.js 版（學生考試前端）

本專案為原 PHP 版 `exam_system` 的 Node.js 重建版，專注於**學生考試端**的前端體驗，使用 Express.js + MySQL2 + 原生 HTML/CSS/JS（TailwindCSS CDN）。

## 功能列表

| 功能 | 說明 |
|------|------|
| 登入頁 | 帳號密碼驗證（bcryptjs），自動依角色導向 |
| 考試列表 | 顯示可參加考試與已完成考試，首次進入顯示注意事項 Modal |
| 線上作答 | 支援單選、多選、是非、填空題型，倒計時（校正伺服器時間差），進度條 |
| 防作弊機制 | 切換視窗警告（6次上限自動交卷）、截圖偵測、禁用右鍵/F12/開發者工具、自動全螢幕、離頁提示 |
| 自動提交 | 倒計時到零自動交卷 |
| 查看結果 | 題目對錯一覽、每題得分、正確答案顯示、申請覆核連結 |

## 安裝步驟

```bash
cd New
npm install
```

## 設定環境變數

複製 `.env.example` 為 `.env` 並填入正確值：

```bash
copy .env.example .env
```

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=exam_system
DB_PORT=3306
SESSION_SECRET=your-secret-key-change-this
PORT=3000
```

## 啟動

```bash
# 正式環境
npm start

# 開發模式（需安裝 nodemon）
npm run dev
```

開啟瀏覽器前往：http://localhost:3000

## 資料庫

與原 PHP 版共用同一個 `exam_system` MySQL 資料庫，無需另外建立資料表。

主要用到的資料表：

- `users` — 使用者帳號（密碼為 bcrypt hash）
- `exams` — 考試資訊
- `questions` / `options` — 題目與選項
- `exam_participants` — 允許參加考試的學生名單
- `exam_submissions` / `submission_answers` — 作答記錄
- `settings` — 系統設定（`view_exam_record` 開關）
- `visibility_logs` — 切換視窗記錄（選用）

## 頁面路徑

| 路徑 | 說明 |
|------|------|
| `/login.html` | 登入頁 |
| `/index.html` | 考試列表 |
| `/exam.html?id=<考試ID>` | 考試作答 |
| `/result.html?id=<考試ID>` | 查看結果 |

## API 路由

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/auth/login` | 登入 |
| POST | `/api/auth/logout` | 登出 |
| GET  | `/api/auth/me` | 取得目前登入使用者 |
| GET  | `/api/exam/list` | 考試列表 |
| GET  | `/api/exam/settings` | 系統設定 |
| GET  | `/api/exam/:id/questions` | 取得題目 |
| POST | `/api/exam/:id/submit` | 提交答案 |
| GET  | `/api/exam/:id/result` | 查看結果 |
| POST | `/api/exam/:id/visibility` | 記錄切換視窗 |
| GET  | `/api/time` | 取得伺服器時間 |

## 專案結構

```
New/
├── server.js              # Express 主程式
├── package.json
├── .env.example
├── routes/
│   ├── auth.js            # 登入/登出 API
│   └── exam.js            # 考試相關 API
├── middleware/
│   └── auth.js            # 驗證 Middleware
└── public/
    ├── login.html         # 登入頁
    ├── index.html         # 考試列表
    ├── exam.html          # 考試作答
    └── result.html        # 查看結果
```
