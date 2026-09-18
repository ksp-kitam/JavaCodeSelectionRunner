# プログラム設計書：JavaCode Selection Runner（src/extension.ts）

## 1. 概要
VS Code 上で開いている Java ファイルの**選択範囲だけを JShell で実行する**拡張機能。

選択範囲（未選択ならファイル全体）を取り出し、入力補助メソッドと開始・終了メッセージを前後に付けた
JShell スクリプト（`.jsh`）を一時ファイルへ書き出し、統合ターミナルで JShell を起動して実行する。

Java 本体は拡張機能に同梱した JRE を使用する。設定で別の Java を指定することもできる。

## 2. 基本情報
| 項目 | 内容 |
|------|------|
| 拡張機能名 | JavaCode Selection Runner（`JavaCodeSelectionRunner`） |
| publisher | ksp-kitam |
| バージョン | 1.0.3 |
| リポジトリ | https://github.com/ksp-kitam/JavaCodeSelectionRunner |
| 必要な VS Code | `^1.83.0` |
| 実装ファイル | `src/extension.ts`（372行） |
| バンドル | webpack（`dist/extension.js`） |
| 依存ライブラリ | `fs-extra` |
| 同梱 JRE | `dist/jre_win`（OpenJDK 21 / **Windows 用のみ**） |
| 最終更新 | 2026-09-18 |

## 3. 提供する機能

### 3.1 コマンド
| コマンドID | タイトル | 有効条件 | 登録場所 |
|------------|----------|----------|----------|
| `JavaCodeSelectionRunner.RunCode` | Run JavaCode | `enablement: resourceLangId == java` | エディタの右クリックメニュー（`editor/context`、`when: resourceLangId == java`、group `myGroup@1`） |

Java ファイル以外では右クリックメニューに表示されず、コマンドパレットからも実行できない。

### 3.2 設定
| 設定キー | 型 | 既定値 | 説明 |
|----------|----|--------|------|
| `JavaCodeSelectionRunner.java_home` | string | `""`（空） | 使用する Java のインストールディレクトリ。空なら同梱 JRE を使う |

> **Windows 以外では同梱 JRE が無いため、本設定が必須。**

### 3.3 言語定義
`contributes.languages` で言語ID `java` に拡張子 `.java` `.jsh`、エイリアス `Java` / `java` を定義している。

## 4. 処理フロー
```text
activate（拡張機能の有効化）
  ├─> cleanUpTempFiles（24時間以上前の一時ファイルを削除）
  └─> コマンド JavaCodeSelectionRunner.RunCode を登録
        └─[コマンド実行時]
              ├─ エディタが開かれていない → エラー表示して終了
              ├─ languageId が java でない → エラー表示して終了
              └─> JShell スクリプトを組み立てる
                    ├─ 入力補助メソッド8種を定義
                    ├─ 開始メッセージを追加
                    ├─ 選択範囲のテキストを追加（未選択ならファイル全体）
                    │   ├─ replaceFullWidthSpace で全角スペースを半角化（リテラル内は除く）
                    │   └─ ファイル全体のとき、main を持つクラスがあれば <クラス名>.main(...) を追記
                    ├─ 終了メッセージと「Enterで終了」の待受を追加
                    └─ /ex（JShell 終了コマンド）を追加
                          └─> 一時ファイルへ書き出し
                                ├─ 書き出し失敗 → エラー表示して終了
                                └─> Java の所在を決定
                                      ├─ 設定あり → その値を使用
                                      └─ 設定が空
                                            ├─ 同梱JREが無い → エラー表示して終了
                                            └─> 同梱JREを一時ディレクトリへコピーし chmod 755
                                                  （失敗時はエラー表示して終了）
                                                  └─> ターミナルを生成し jshell を実行して表示
```

## 5. 実装詳細

### 5.1 activate（17〜176行）
| 項目 | 内容 |
|------|------|
| 目的 | 一時ファイルの掃除とコマンドの登録 |
| プラットフォーム判定 | `process.platform === 'win32'` を `is_windows` に保持（19行） |
| 標準入力の文字コード | `is_windows ? 'MS932' : 'UTF-8'` を `inputCharset` に保持（23行） |
| 起動時処理 | `cleanUpTempFiles()` を呼び出す（26行） |
| 登録コマンド | `JavaCodeSelectionRunner.RunCode`（29行） |
| 後始末 | `context.subscriptions.push(disposable)`（175行） |

### 5.2 事前チェック（31〜41行）
| 条件 | 表示メッセージ |
|------|----------------|
| `vscode.window.activeTextEditor` が undefined | `File not opened.` |
| `document.languageId !== 'java'` | `This is not a Java file.` |

### 5.3 入力補助メソッドの生成（47〜81行）
JShell スクリプトの冒頭に、以下のメソッド定義を文字列として組み立てる。

| メソッド | 実装 |
|----------|------|
| `String input()` | `System.out.print("入力してEnterを押してください > ")` の後、`new Scanner(System.in, "<inputCharset>")` の `nextLine()` を返す |
| `char inputToChar()` | `input().charAt(0)` |
| `int inputToInt()` | `Integer.parseInt(input())` |
| `double inputToDouble()` | `Double.parseDouble(input())` |
| `long inputToLong()` | `Long.parseLong(input())` |
| `float inputToFloat()` | `Float.parseFloat(input())` |
| `short inputToShort()` | `Short.parseShort(input())` |
| `int makeRandomValue(int start, int end)` | `java.util.Random` で `start`〜`end`（両端含む）の乱数を返す |

`<inputCharset>` は Windows なら `MS932`、それ以外は `UTF-8`。

### 5.4 実行対象コードの組み立て（84〜111行）
| 行 | 内容 |
|----|------|
| 84 | 開始メッセージ `[JavaCodeSelectionRunner]------------------start-----------------` |
| 87〜103 | 選択範囲の判定と本文の追加 |
| 106〜108 | 空行、終了メッセージ、`Press Enter to exit.` |
| 109〜110 | `Scanner` で Enter 待ち（ターミナルが即閉じしないようにするため） |
| 111 | `/ex`（JShell を終了する組み込みコマンド） |

**選択範囲の扱い**

- `selection.isEmpty` が true（未選択）… ファイル全体を対象とする。
  - `replaceFullWidthSpace()` で全角スペースを半角スペースへ置換する（5.7 参照）。
  - `checkJavaClassWithMain()` で main を持つクラス名を取得し、得られたら `<クラス名>.main(new String[]{});` を追記する。
- false（選択あり）… 選択範囲のテキストのみを対象とし、同様に全角スペースを置換する。

### 5.5 一時ファイルの生成（114〜123行）
| 項目 | 内容 |
|------|------|
| パス | `path.join(os.tmpdir(), TEMP_FILE_PREFIX + Math.random().toString(36).slice(-8) + TEMP_FILE_SUFFIX)` |
| 定数 | `TEMP_FILE_PREFIX = 'vscode-extension-temp'`、`TEMP_FILE_SUFFIX = '.jsh'` |
| 書き出し | `fs.writeFile()`（非同期）。**失敗時は `Failed to create a temporary file.` を表示して中断する** |

### 5.6 Java の所在決定とターミダル実行（125〜170行）

プラットフォーム別の設定：

| 項目 | Windows | それ以外 |
|------|---------|----------|
| ターミナル | `cmd.exe` | `bash` |
| 同梱JREのディレクトリ名 | `jre_win` | `jre_linux` |
| JShell の実行ファイル | `jshell.exe` | `jshell` |

```typescript
let javaHomePath = vscode.workspace.getConfiguration('JavaCodeSelectionRunner').get('java_home', '');
if (javaHomePath == '') {
    let bundledJdkPath = path.join(__dirname, jdkType);
    if (!fs.existsSync(bundledJdkPath)) {
        vscode.window.showErrorMessage(
            'Java for this platform is not bundled. Please set "JavaCodeSelectionRunner.java_home" in the settings.'
        );
        return;
    }
    vscode.window.showInformationMessage('It runs on Java that is maintained internally.');
    javaHomePath = path.join(os.tmpdir(), jdkType);
    if (!fs.existsSync(javaHomePath)) {
        try {
            let fsex = require('fs-extra');
            fsex.copySync(bundledJdkPath, javaHomePath);
            chmodFolder(javaHomePath, '755');
        } catch (e) {
            vscode.window.showErrorMessage('Failed to prepare the bundled Java. : ' + String(e));
            return;
        }
    }
}
let jshellCommand = quotePath(path.join(javaHomePath, 'bin', jshell));
let terminal = vscode.window.createTerminal('JavaCodeSelectionRunner', terminalType);
terminal.sendText(jshellCommand + ' ' + '-J-Dfile.encoding=utf8 --execution local' + ' ' + quotePath(temp_jshell_file) + ' && exit');
terminal.show();
```

| オプション | 意味 |
|------------|------|
| `-J-Dfile.encoding=utf8` | JShell を起動する JVM の既定文字コードを UTF-8 にする |
| `--execution local` | 実行エンジンをローカル（同一JVM）にする。別プロセスを起動しないため起動が速い |
| `&& exit` | JShell 終了後にターミナルを閉じる |

**JShell のパスも一時ファイルのパスも `quotePath()` で二重引用符に囲む**（空白を含むパスに対応するため）。

### 5.7 replaceFullWidthSpace（228〜279行）
| 項目 | 内容 |
|------|------|
| 目的 | コード中の全角スペース（`　`）を半角スペースへ置換する |
| 方式 | 1文字ずつ走査し、現在位置の文脈（コード／文字列リテラル／文字リテラル／テキストブロック／行コメント／ブロックコメント）を判定する |
| 置換する箇所 | コード部分、行コメント、ブロックコメント |
| 置換しない箇所 | **文字列リテラル、文字リテラル、テキストブロック**（実行結果が変わってしまうため） |
| エスケープ | リテラル内の `\` は次の1文字とまとめて通すため、`\"` で誤って閉じたと判定しない |

> コード中の全角スペースは Java の文法上エラーとなるため置換が必要だが、
> `System.out.println("氏名　太郎")` のようなリテラル内の全角スペースは保持する。

### 5.8 maskLiteralsAndComments（281〜328行）
| 項目 | 内容 |
|------|------|
| 目的 | 構造解析（波括弧の対応数え）のために、文字列・文字リテラルとコメントの中身を半角スペースへ置き換える |
| 特徴 | 文字数と改行位置を保つため、元の文字数と同じ長さの文字列を返す |
| 用途 | `checkJavaClassWithMain()` から呼び出す |

### 5.9 checkJavaClassWithMain（330〜372行）
| 項目 | 内容 |
|------|------|
| 目的 | 入力コードから、main メソッドを持つクラスの名前を取得する |
| 前処理 | `maskLiteralsAndComments()` でリテラル・コメントを除去した文字列に対して解析する |
| クラス抽出 | `/\bclass\s+(\w+)/g`（`public` 以外の修飾子にも対応） |
| クラス本体の特定 | クラス名の後の最初の `{` から、**波括弧の対応を数えて**対応する `}` までを本体とする |
| main 判定 | `/\bpublic\s+static\s+void\s+main\s*\(\s*(?:final\s+)?String\s*(?:\[\s*\]\s*\w+\|\w+\s*\[\s*\])\s*\)/`<br>（`String[] args` / `String args[]` / `final String[] args` に対応） |
| 戻り値 | 該当クラス名、無ければ `null` |

### 5.10 cleanUpTempFiles（186〜208行）
| 項目 | 内容 |
|------|------|
| 目的 | 過去の実行で残った一時ファイルを削除する |
| 呼び出し | `activate()` の冒頭で1回 |
| 対象 | `os.tmpdir()` 直下で、接頭辞 `vscode-extension-temp` かつ拡張子 `.jsh` のファイル |
| 条件 | 更新時刻が 24 時間（`TEMP_FILE_EXPIRE_MS`）以上前のもの |
| 例外 | 削除に失敗しても無視して継続する（拡張機能の起動を妨げない） |

### 5.11 chmodFolder（210〜223行）
| 項目 | 内容 |
|------|------|
| 目的 | コピーした JRE ディレクトリ配下に実行権限を付与する |
| 処理 | `fs.readdirSync` で再帰的に走査し、`fs.chmodSync()`（同期）で権限を設定する |
| 同期版を使う理由 | 権限付与の完了前に JShell を起動しないようにするため |

### 5.12 quotePath（181〜184行）
パスを二重引用符で囲んで返す。空白を含むパスをコマンドライン引数として渡すために使用する。

### 5.13 deactivate（178行）
処理なし（空実装）。

## 6. 外部依存
| 依存先 | 用途 |
|--------|------|
| VS Code 拡張 API（`vscode`） | コマンド登録、エディタ操作、設定取得、ターミナル生成 |
| `fs` / `path` / `os` | 一時ファイル操作、パス組み立て、プラットフォーム判定、権限設定 |
| `fs-extra` | JRE ディレクトリの再帰コピー |
| 同梱 JRE（`dist/jre_win`） | JShell の実行環境（OpenJDK 21） |

## 7. 出力
- **統合ターミナル**：`JavaCodeSelectionRunner` という名前のターミナルが開き、JShell の実行結果が表示される。
  開始・終了は `[JavaCodeSelectionRunner]` 付きのメッセージで区切られる。
- **一時ファイル**：`os.tmpdir()` に `.jsh` ファイルが生成される。次回以降の起動時に、24時間以上前のものが削除される。
- **同梱JREの展開先**：設定が空の場合、`os.tmpdir()/jre_win`。

## 8. エラーハンドリング
| 事象 | 挙動 |
|------|------|
| エディタが開かれていない | `File not opened.` を表示して中断 |
| Java ファイルでない | `This is not a Java file.` を表示して中断 |
| 一時ファイルの書き出しに失敗 | `Failed to create a temporary file. : <理由>` を表示して中断 |
| 同梱 JRE が無い（Windows 以外） | `Java for this platform is not bundled. Please set "JavaCodeSelectionRunner.java_home" in the settings.` を表示して中断 |
| 同梱 JRE のコピー・権限設定に失敗 | `Failed to prepare the bundled Java. : <理由>` を表示して中断 |
| 一時ファイルの掃除に失敗 | 無視して継続する |

**未対応**：設定された `java_home` の存在確認は行っていない。また、JShell 自体の実行結果（終了コード）は確認しておらず、ターミナルの表示のみで判断する。

## 9. 備考
実装上の課題は [課題一覧.md](%E8%AA%B2%E9%A1%8C%E4%B8%80%E8%A6%A7.md) にまとめている。
