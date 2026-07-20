# 學印 StudySeal ｜ 最酷的網路學院

童願文創出品的多角色補習班學習平台。四種身份（最高權限／園所／老師／學生）各自登入，老師以 YouTube 連結建立課程並設計選擇題／照片題，學生觀看影片並作答，結果即時記錄、老師可查看與修改批閱結果。

本專案包含：
- `backend/`：Node.js + Express + SQLite 的 API 伺服器（含身份驗證、權限控管）
- `frontend/`：純 HTML/CSS/JS 靜態網頁（登入頁 + 主控台，串接 backend 的真實 API）
- `demo/studyseal-demo.html`：**單一檔案的可預覽展示版**，資料邏輯與 API 路徑跟正式後端完全對齊，
  但用瀏覽器端儲存模擬資料庫，不需要架設 Node 伺服器即可直接雙擊打開體驗完整流程（登入、建課程、
  出題、學生作答、老師批閱）。適合快速展示或離線測試，不是正式上線用的版本。


---

## 一、本機執行

### 1. 啟動後端

```bash
cd backend
npm install
cp .env.example .env
# 打開 .env，把 JWT_SECRET 換成一組隨機長字串

npm run seed     # 建立示範資料（園所、老師、學生、課程）
npm start        # 啟動 API，預設 http://localhost:4000
```

啟動成功會看到：`✅ StudySeal API 已啟動：http://localhost:4000`

### 2. 啟動前端

前端是純靜態檔案，用任何靜態伺服器打開即可，例如：

```bash
cd frontend
npx serve .
# 或 python3 -m http.server 5500
```

打開瀏覽器進入 `login.html`，用以下示範帳號登入：

| 身份 | 帳號 | 密碼 | 園所代碼 |
|---|---|---|---|
| 最高權限 | `admin@studyseal.io` | `Admin@2026` | 不需要 |
| 園所 | `owner@bozhi.edu.tw` | `Bozhi#2026` | `BOZI2024` |
| 老師 | `lin.hsiaowei@bozhi.edu.tw` | `Teach#2026` | `BOZI2024` |
| 學生 | `A1042501` | `Study#2026` | `BOZI2024` |

> `frontend/assets/config.js` 裡的 `STUDYSEAL_API_BASE` 預設指向 `http://localhost:4000`，本機測試不用改。

---

## 二、串接 GitHub

```bash
cd studyseal-platform
git init
git add .
git commit -m "Initial commit: 學印 StudySeal 平台"
git branch -M main
git remote add origin https://github.com/<你的帳號>/studyseal-platform.git
git push -u origin main
```

`.gitignore` 已排除 `node_modules/`、`.env`、資料庫檔案，不會被推上去。

---

## 三、部署到 Render

### 後端（Web Service）
1. Render Dashboard → **New +** → **Web Service** → 選你剛推上去的 GitHub repo
2. **Root Directory**：`backend`
3. **Build Command**：`npm install`
4. **Start Command**：`npm start`
5. **Environment Variables**：把 `.env.example` 裡的變數都加進去，`JWT_SECRET` 務必換成隨機字串，`CORS_ORIGIN` 填前端部署後的網址
6. 部署完成後，到 Render 的 **Shell** 分頁執行一次 `npm run seed` 建立示範資料（或串接你自己的資料）

> ⚠️ Render 免費方案的磁碟是「非持久化」的，服務重啟後 SQLite 檔案會被清空。正式上線前建議：
> - 升級 Render 的付費方案並掛載 **Persistent Disk**，把 `DB_PATH` 指到該磁碟路徑；或
> - 改用 Render 提供的 **PostgreSQL** 服務（架構沿用，只需把 `better-sqlite3` 換成 `pg`，SQL 語法需微調）

### 前端（Static Site）
1. Render Dashboard → **New +** → **Static Site** → 選同一個 repo
2. **Root Directory**：`frontend`
3. **Publish Directory**：`.`
4. 部署後，回頭修改 `frontend/assets/config.js`：
   ```js
   window.STUDYSEAL_API_BASE = 'https://你的後端服務.onrender.com';
   ```
   改完 commit + push，Render 會自動重新部署（若已設定自動部署）

---

## 四、API 一覽

| 方法 | 路徑 | 說明 | 權限 |
|---|---|---|---|
| POST | `/api/auth/login` | 登入 | 公開 |
| GET | `/api/auth/me` | 取得目前使用者 | 已登入 |
| GET/POST | `/api/institutions` | 園所列表／建立 | super |
| PATCH | `/api/institutions/:id` | 停用／啟用園所 | super |
| GET/POST | `/api/users?role=teacher\|student` | 老師/學生列表／建立 | institution / teacher |
| PATCH | `/api/users/:id` | 停用／啟用帳號 | institution / teacher / super |
| GET/POST | `/api/courses` | 課程列表／建立 | 依角色 |
| GET/PATCH | `/api/courses/:id` | 課程詳情／編輯 | 依角色 |
| POST | `/api/courses/:id/questions` | 新增題目 | teacher |
| PATCH/DELETE | `/api/courses/questions/:id` | 編輯／刪除題目 | teacher |
| GET/POST | `/api/courses/:id/access` | 查詢／指派學生課程權限 | teacher |
| DELETE | `/api/courses/:id/access/:studentId` | 取消課程權限 | teacher |
| POST | `/api/courses/:id/submit` | 學生提交測驗 | student |
| GET | `/api/courses/:id/attempts` | 查看全班作答狀況 | teacher / institution |
| GET | `/api/courses/attempts/:id` | 單一作答詳情 | teacher / institution |
| PATCH | `/api/courses/attempts/:attemptId/answers/:questionId` | 修改批閱結果 | teacher |

---

## 五、下一步可以做的事

- 把 SQLite 換成 PostgreSQL，因應多園所、大流量場景
- 加上「忘記密碼」信件寄送（可串 Resend / SendGrid）
- 課程封面改成自動抓取 YouTube 縮圖
- 加上檔案上傳（照片題直接上傳圖片，而非貼網址）
- 加上操作紀錄（audit log），方便園所追蹤老師的批閱異動
