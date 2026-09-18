# プログラム設計書：コード整形（src/formatter.ts、src/javaHome.ts）

## 1. 概要
Java コードを **google-java-format** で整形する機能。

VS Code の標準の「ドキュメントのフォーマット」「選択範囲のフォーマット」から呼び出される。
整形処理は、拡張機能に同梱した jar を同梱 Java で実行して行う。外部の言語サーバーや別途の JDK は不要。

## 2. 基本情報
| 項目 | 内容 |
|------|------|
| 実装ファイル | `src/formatter.ts`（整形処理）／`src/javaHome.ts`（Javaの所在決定。実行機能と共用） |
| 整形ツール | google-java-format 1.36.1（`dist/tools/google-java-format-1.36.1-all-deps.jar`） |
| ライセンス | Apache License 2.0（`dist/tools/LICENSE-google-java-format.txt`） |
| 整形スタイル | Google Java Style（インデント2スペース） |
| 有効化 | `activationEvents: ["onLanguage:java"]`（Javaファイルを開いた時点で登録される） |

## 3. 提供する機能
| 機能 | VS Code の操作 | 実装 |
|------|----------------|------|
| ファイル全体の整形 | ドキュメントのフォーマット（Shift+Alt+F） | `DocumentFormattingEditProvider` |
| 選択範囲の整形 | 選択範囲のフォーマット（Ctrl+K Ctrl+F） | `DocumentRangeFormattingEditProvider` |

## 4. 処理フロー
```text
VS Code から整形要求
  └─> 整形ツール（jar）の存在確認
        ├─ 無い → エラー表示して終了
        └─> resolveJavaHome()（同梱Javaの展開・設定値の取得）
              ├─ 使用できない → エラー表示して終了（メッセージは resolveJavaHome 側で表示）
              └─> ドキュメント全文を一時ファイル（.java）へ書き出し
                    └─> java を実行して整形
                          ├─ 失敗 → 標準エラー出力の内容をエラー表示して終了
                          └─> 整形結果を取得
                                ├─ 変化なし → 編集を行わない
                                └─> ファイル全体を整形結果で置き換える TextEdit を返す
                                      └─> 一時ファイルを削除（成否によらず実施）
```

## 5. 実装詳細

### 5.1 registerFormatter（formatter.ts）
| 項目 | 内容 |
|------|------|
| 目的 | 2つの整形プロバイダを言語 `java` に対して登録する |
| 登録 | `vscode.languages.registerDocumentFormattingEditProvider` / `registerDocumentRangeFormattingEditProvider` |
| 後始末 | どちらも `context.subscriptions` へ登録する |

選択範囲の整形では、`document.offsetAt()` で範囲を文字オフセットへ変換し、
`--offset` と `--length` を引数に加える。**ファイル全体を渡したうえで、指定範囲のみを整形する**
（google-java-format は構文解析を行うため、常に完全なソースファイルを入力とする必要がある）。

### 5.2 formatDocument（formatter.ts）
| 項目 | 内容 |
|------|------|
| 一時ファイル | `os.tmpdir()/vscode-extension-format<乱数8桁>.java`（UTF-8 で書き出し） |
| 戻り値 | 変化があれば「ファイル全体を置き換える TextEdit 1件」、無ければ空配列 |
| 後始末 | `finally` で一時ファイルを削除する。削除失敗は無視する |

### 5.3 runFormatter（formatter.ts）
実行するコマンド：

```text
<javaHome>/bin/java
  --add-exports=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED
  --add-exports=jdk.compiler/com.sun.tools.javac.code=ALL-UNNAMED
  --add-exports=jdk.compiler/com.sun.tools.javac.file=ALL-UNNAMED
  --add-exports=jdk.compiler/com.sun.tools.javac.parser=ALL-UNNAMED
  --add-exports=jdk.compiler/com.sun.tools.javac.tree=ALL-UNNAMED
  --add-exports=jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED
  -Dfile.encoding=UTF-8
  -jar <dist/tools/google-java-format-1.36.1-all-deps.jar>
  [--offset <開始位置> --length <長さ>]
  <一時ファイル>
```

| 項目 | 内容 |
|------|------|
| 実行方法 | `child_process.execFile`（非同期）。`windowsHide: true` でコンソール画面を出さない |
| 標準出力 | 整形後のソースコード全文（UTF-8 として解釈する） |
| 標準エラー出力 | 構文エラー等。失敗時はこの内容をエラーメッセージとして表示する |
| 出力上限 | 32MB（`maxBuffer`） |

`--add-exports` は JDK16 以降で JDK 内部 API へアクセスするために必要。
jar のマニフェストにも `Add-Exports` が指定されているが、明示的にも付与している。

### 5.4 javaHome.ts（実行機能と共用）
| 関数 | 内容 |
|------|------|
| `isWindows` | `process.platform === 'win32'` |
| `resolveJavaHome()` | 設定 `java_home` があればその値、無ければ同梱Javaを一時ディレクトリへ展開して返す。利用できない場合はエラーメッセージを表示して `undefined` を返す |
| `getJavaCommandPath(javaHome, name)` | `<javaHome>/bin/<name>`（Windows は `.exe` を付与） |
| `quotePath(path)` | パスを二重引用符で囲む |
| `chmodFolder(dir, mode)` | 展開したJavaへ再帰的に権限を付与する（同期） |

> 実行機能（`extension.ts`）と整形機能（`formatter.ts`）で同じ処理を使うため、モジュールへ切り出している。

## 6. エラーハンドリング
| 事象 | 挙動 |
|------|------|
| 整形ツール（jar）が無い | `The formatter is not bundled. : <ファイル名>` を表示して中断 |
| Java が利用できない | `resolveJavaHome()` がエラーを表示して中断 |
| 一時ファイルの書き出しに失敗 | `Failed to create a temporary file. : <理由>` を表示して中断 |
| 整形に失敗（構文エラー等） | `Failed to format the Java code. : <標準エラー出力>` を表示して中断 |
| 一時ファイルの削除に失敗 | 無視して継続する |

いずれの失敗時も**空の編集内容を返す**ため、ドキュメントは変更されない。

## 7. 備考
- 整形のたびに JVM を起動するため、1回あたり1秒前後の待ち時間が発生する。
- 整形スタイルは Google Java Style 固定。AOSP スタイル（インデント4スペース）に切り替える場合は
  `--aosp` を引数に追加する。設定項目として公開するかは今後の検討事項。
- 構文エラーのあるコードは整形できない（google-java-format が解析に失敗するため）。
