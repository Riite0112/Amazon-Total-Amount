# Amazon Total Amount

Amazon.co.jp の注文履歴ページから、年別の購入合計額をブラウザ内で集計するためのスクリプトです。

## 使い方

### Chrome拡張機能として使う

1. Chrome または Edge で `chrome://extensions` を開く
2. 「デベロッパーモード」をONにする
3. 「パッケージ化されていない拡張機能を読み込む」を押す
4. このリポジトリの `extension` フォルダを選ぶ
5. Amazon.co.jp の注文履歴で対象年を開く
6. 右上の `Amazon Total Amount` パネルから「集計開始」を押す

### Consoleに貼って使う

1. Amazon.co.jp の注文履歴で対象年を開く
2. ブラウザの開発者ツールを開く
3. Console に `src/amazon-annual-total.js` の中身を貼って実行する
4. 画面右上の黒いボックスで合計を確認する

実行後、詳細データは Console の `AmazonAnnualTotal` に入ります。

```js
AmazonAnnualTotal
AmazonAnnualTotal.recommended
AmazonAnnualTotal.cancelled
AmazonAnnualTotal.refunded
```

## 集計モード

- 推奨: キャンセル済み注文を除外し、返金扱いは含める
- 厳しめ: キャンセル済みと返金扱いを除外する
- 全金額あり: 取得できた注文合計をすべて足す

Amazon の「○件の注文」には、キャンセル済み・返金済み・金額を取れない注文が含まれることがあります。そのため、表示件数と集計件数は一致しない場合があります。

## ブックマークレット生成

長いブックマークレットはブラウザのブックマーク編集画面で壊れやすいため、通常は Console 実行を推奨します。

必要な場合は、次のコマンドで `dist/bookmarklet.txt` を生成できます。

```powershell
node tools/build-bookmarklet.mjs
```

## 注意

- 外部サーバーへ注文情報を送信しません
- Amazon.co.jp の表示DOMだけをブラウザ内で読み取ります
- 複数ページを隠し iframe で読むため、Amazon 側の計測ログやページ内JavaScriptのエラーが Console に出る場合があります
- 最後に `console.clear()` してログを掃除しますが、DevTools の Preserve log が有効だと赤いログが残ることがあります
