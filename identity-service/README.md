# 童願共用帳號中心

這是一個可獨立部署的身份服務，提供線上學院與股票獎勵系統共用的園所、使用者、登入 Session 與舊系統 ID 對照。

## 本階段範圍

- 統一角色：`admin`、`school`、`teacher`、`student`
- 以 `username` 作為主要登入帳號，Email 作為可選聯絡欄位
- 相容兩套系統既有 bcrypt 密碼雜湊
- 簽發 `tongyuan-identity` JWT，並以資料庫 Session 支援即時登出
- 保存 `school`、`stock` 舊使用者與園所 ID 對照
- 正式環境強制安全 JWT 密鑰與明確 CORS 白名單

本階段尚未切換任何現有網站的登入 API，也沒有搬移正式帳號。

## 本機啟動

```bash
cp .env.example .env
npm install
npm run db:migrate
npm test
npm start
```

API：

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

登入請求：

```json
{
  "identifier": "teacher-wang",
  "password": "使用者密碼",
  "organizationCode": "TEST2026",
  "targetSystem": "school"
}
```

`targetSystem` 可為 `school` 或 `stock`。回應會在帳號搬移後附上該系統的 `legacy.userId`，供既有網站安全連結原本的個人資料。
