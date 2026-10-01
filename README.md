# 童願文創網路校園

第一階段可操作 MVP，實作「建立園所與帳號 → 班級與課程 → 發布指派 → 學生繳交 → 老師回饋 → 學生查看」的最短學習閉環。

## 啟動

本專案不依賴外部套件；需 Node.js 20 以上。

```powershell
node server.js
```

開啟 `http://localhost:3000`。首次開啟會要求建立最高管理員；不會建立固定示範帳號或共用密碼。

## 目前範圍

- 伺服器端 session、密碼雜湊、角色與園所 scope 驗證
- 最高管理員建立園所與園所管理員；園所管理員建立師生、班級與指派
- 課程草稿、發布版本、單選／簡答／圖片／影片任務結構
- 學生提交、老師評分回饋、學生讀取回饋
- 影片未設定供應商時明確顯示「待設定」

## 開發資料與限制

資料存於 `data/db.json`，僅供本機 MVP 開發。正式部署前必須換成具 migration、備份與交易約束的關聯式資料庫，並串接私有物件儲存與符合規格的影片 adapter。請先複製 `.env.example` 為 `.env` 並設定正式的 `AUTH_SECRET`，再於 HTTPS 下使用。

## 檢查

```powershell
node --check server.js
node --check public/app.js
```
