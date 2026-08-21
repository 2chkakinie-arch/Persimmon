# Vandal (llytpr-wl.v01nh) — Persimmon

_ultra-fast YouTube frontend. InnerTube + issuer-certified proxy direct-play engine + ♦Ask AI._

Made by Kakinie with llytpr-wl.v01nh TEAM. V1

---

## V7 — 高速化 + 設定・診断 + 新 UI

### ⚡ 高速化（今回の主な変更）

| 領域 | 内容 |
|---|---|
| **初回待ち** | サーバー起動と同時に **プロキシプール / ホーム / visitorData を並行暖機**。最初のリクエストが来る頃には初期化が終わっている |
| **初回待ち** | ホームの内容を `data/runtime-cache.json` にスナップショット保存し、コールドブート直後は 30 分前までの内容で即描画（stale-while-revalidate） |
| **初回待ち** | クライアントもホームを localStorage スナップショット + sessionStorage キャッシュで即描画、裏で最新化 |
| **player 発行** | 直列総当たり → **並列ヘッジ（プロキシレース）** に変更。wave1 は「定番 + direct + issuer プロキシ」を同時発射し、最初に OK が戻った瞬間に確定。最悪 N×timeout が max(1×timeout) に |
| **コメント** | ①watch 応答に commentsToken を同梱 → コメント取得の**トークン発見往復を廃止（約 1/2 のレイテンシ）** ②watch 表示直後にサーバーがコメントを先行取得 ③single-flight で同時リクエストを 1 往復に束ねる |
| **並列束ね** | `TTLCache.wrap` が single-flight 化。同一 API の同時呼び出し（ホバー先読み+視読+warm など）は必ず 1 本の上流往復で全員に分配 |
| **圧縮** | gzip level 1（JSON は圧縮率 ~5% 落ちるだけで CPU 1/3 以下 → 初バイト高速化）。SSE・動画中継は圧縮除外 |
| **プロキシ** | スキャン並列幅 36→48、L2/L3 認定並列幅 2→4・対象 20→24 で **issuer 認定が約 2 倍速く揃う** |

### 🎛️ 設定・診断ページ（`/#/settings`）

- **エンジン設定** — プロキシ運用モード（自動 / プロキシのみ / 直結のみ）、プール維持数、先読み量、コメント先行取得・ホーム常時暖機・認定の ON/OFF、ログレベル
- **プロキシプール** — 生きているプロキシの一覧・遅延・等級（L1/L2/L3）をライブ表示、強制更新・手動認定
- **プロキシレース** — L1 トンネル → L2 googlevideo → L3 発行実測の段階選抜を全員同時に実走して勝者を決定
- **ストリーム取得テスト** — URL 発行 → 直結/ピン経由の初バイト実測 → ホットキャッシュ載せまでの分解タイミング
- **メタ情報取得テスト** — watchNext / コメント（トークン再利用 vs 従来 2 往復の差分表示）/ 検索の実測
- **ライブログ** — サーバー内の超細かいログ（proxy / player / stream / comments / meta / http / engine …）を **SSE でリアルタイム**閲覧。レベル・チャンネルフィルタ、一時停止、クリア

### 🧭 UI (V7)

- ナビゲーションは**既定で閉じたドロワー**（☰ で開閉、状態は記憶）。モバイルはボトムナビ
- テーマは既定で OS 設定に追従（ダーク/ライト）
- `/` または Ctrl+K で検索フォーカス、Esc でドロワーを閉じる
- カード浮遊アニメーション、ブランドグラデーションのアクセント、スケルトン微光

### 🍅 ロゴの差し替え方

**ファイルを上書きするだけ**で、ヘッダー・ファビコン・設定ページのロゴがすべて変わります:

| ファイル | 用途 |
|---|---|
| `public/logo.svg` | ヘッダーのロックアップ（マーク + Vandal ワードマーク） |
| `public/logo-mark.svg` | ファビコン・設定ページのマーク単体 |

SVG 推奨（任意サイズに対応）。PNG を使う場合は `public/index.html` 内の `<img src="/logo.svg">` と `<link rel="icon">` のパスを書き換えてください。

## 実行

```bash
npm install
npm start          # PORT env（既定 3000）
npm run test:api   # ローカルスモークテスト（外部ネット不要）
```

デプロイ: Node の動く環境ならどこでも（`render.yaml` / `vercel.json` 同梱）。
Vercel では SSE がバッファされる場合があります — その場合はログビューアが自動再接続を繰り返すだけで、他機能には影響しません（ポーリング API `/api/diag/logs` も利用可）。

## 環境変数

| 変数 | 意味 |
|---|---|
| `LLYTPR_NO_PROXY=1` | プロキシ完全不使用（デバッグ用） |
| `LLY_PIPED` | 追加 Piped インスタンス（カンマ区切り） |

エンジン設定は `data/config.json` に永続化され、設定ページから実行時に変更できます。
