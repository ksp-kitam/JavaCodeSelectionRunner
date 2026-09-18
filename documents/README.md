# 設計書インデックス

`JavaCodeSelectionRunner` の設計書と課題一覧。

- 対象バージョン：1.0.2
- 作成日：2026-09-18

| ファイル | 内容 |
|----------|------|
| [extension.md](extension.md) | `src/extension.ts` のプログラム設計書（概要・処理フロー・実装詳細・エラーハンドリング） |
| [課題一覧.md](%E8%AA%B2%E9%A1%8C%E4%B8%80%E8%A6%A7.md) | 実装課題14件（分類・優先度付き） |

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
  Linux / macOS で使う場合は `JavaCodeSelectionRunner.java_home` の設定が必要。
- 選択範囲が無い場合はファイル全体が対象になり、main を持つ `public class` があれば自動で `main` を呼び出す。
  ただしクラス本体の抽出に制限がある（課題 A-3）。
- 実行は統合ターミナル上で JShell を起動する方式。実行結果の成否は拡張機能側では判定していない。
- 右クリックメニューは**Java 以外のファイルでも表示される**（課題 D-1）。実行時に拡張機能側で弾かれる。
