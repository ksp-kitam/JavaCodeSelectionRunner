# 設計書インデックス

`JavaCodeSelectionRunner` の設計書と課題一覧。

- 対象バージョン：1.1.0
- 作成日：2026-09-18（同日に課題14件を修正）

| ファイル | 内容 |
|----------|------|
| [extension.md](extension.md) | `src/extension.ts` のプログラム設計書（概要・処理フロー・実装詳細・エラーハンドリング） |
| [formatter.md](formatter.md) | コード整形機能（`src/formatter.ts` / `src/javaHome.ts`）のプログラム設計書 |
| [課題一覧.md](%E8%AA%B2%E9%A1%8C%E4%B8%80%E8%A6%A7.md) | 実装課題14件と対応状況（**全件対応済み**） |
| [機能追加の調査.md](%E6%A9%9F%E8%83%BD%E8%BF%BD%E5%8A%A0%E3%81%AE%E8%AA%BF%E6%9F%BB.md) | シンタックスハイライト／入力補完／コード整形の実現方法と工数の調査 |

## リポジトリ構成

```text
.
├── src/
│   ├── extension.ts        # 拡張機能の本体（186行）
│   └── test/               # テスト（テンプレートのまま）
├── dist/                   # webpack のビルド成果物
│   ├── extension.js
│   └── jre_win/            # 同梱JRE（OpenJDK 21 / Windows用）
├── documents/              # 設計書（本ディレクトリ）
├── package.json            # 拡張機能のマニフェスト
├── README.md / en_README.md
└── how_to_deploy.md        # npm install → npx vsce package
```

## 押さえておきたい点

- **Windows 以外では同梱 Java が使えない**（`dist/jre_linux` が存在しない）。
  Linux / macOS で使う場合は `JavaCodeSelectionRunner.java_home` の設定が必要。設定が無い場合はエラーを表示して中断する。
- 選択範囲が無い場合はファイル全体が対象になり、main を持つクラスがあれば自動で `main` を呼び出す。
- 実行は統合ターミナル上で JShell を起動する方式。実行結果の成否は拡張機能側では判定していない。
- 右クリックメニューは Java ファイルでのみ表示される（`when: resourceLangId == java`）。
