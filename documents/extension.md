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
| バージョン | 1.0.2 |
| リポジトリ | https://github.com/ksp-kitam/JavaCodeSelectionRunner |
| 必要な VS Code | `^1.83.0` |
| 実装ファイル | `src/extension.ts`（186行） |
| バンドル | webpack（`dist/extension.js`） |
| 依存ライブラリ | `fs-extra`、`iconv-lite`（※`iconv-lite` は `extension.ts` からは未使用） |
| 同梱 JRE | `dist/jre_win`（OpenJDK 21 / Windows 用） |

## 3. 提供する機能

### 3.1 コマンド
| コマンドID | タイトル | 登録場所 |
|------------|----------|----------|
| `JavaCodeSelectionRunner.RunCode` | Run JavaCode | エディタの右クリックメニュー（`editor/context`、group `myGroup@1`） |

### 3.2 設定
| 設定キー | 型 | 既定値 | 説明 |
|----------|----|--------|------|
| `JavaCodeSelectionRunner.java_home` | string | `""`（空） | 使用する Java のインストールディレクトリ。空なら同梱 JRE を使う |

### 3.3 言語定義
`contributes.languages` で言語ID `java` に拡張子 `.java` `.jsh`、エイリアス `Java` / `java` を定義している。

## 4. 処理フロー
```text
activate（拡張機能の有効化）
  └─> コマンド JavaCodeSelectionRunner.RunCode を登録
        └─[コマンド実行時]
              ├─ エディタが開かれていない → エラー表示して終了
              ├─ languageId が java でない → エラー表示して終了
              └─> JShell スクリプトを組み立てる
                    ├─ 入力補助メソッド8種を定義（input / inputToChar / inputToInt /
                    │   inputToDouble / inputToLong / inputToFloat / inputToShort / makeRandomValue）
                    ├─ 開始メッセージを追加
                    ├─ 選択範囲のテキストを追加（未選択ならファイル全体）
                    │   └─ ファイル全体のとき、main を持つ public class があれば <クラス名>.main(...) を追記
                    ├─ 終了メッセージと「Enterで終了」の待受を追加
                    └─ /ex（JShell 終了コマンド）を追加
                          └─> 一時ファイル（os.tmpdir()/vscode-extension-temp<乱数8桁>.jsh）へ書き出し
                                └─> Java の所在を決定
                                      ├─ 設定が空 → 同梱 JRE を os.tmpdir() へコピーし chmod 755
                                      └─ 設定あり → その値を使用
                                            └─> ターミナルを生成し jshell を実行して表示
```

## 5. 実装詳細

### 5.1 activate（12〜148行）
| 項目 | 内容 |
|------|------|
| 目的 | コマンドの登録 |
| プラットフォーム判定 | `process.platform === 'win32'` を `is_windows` に保持（14行） |
| 登録コマンド | `JavaCodeSelectionRunner.RunCode`（17行） |
| 後始末 | `context.subscriptions.push(disposable)`（147行） |

### 5.2 事前チェック（19〜29行）
| 条件 | 表示メッセージ |
|------|----------------|
| `vscode.window.activeTextEditor` が undefined | `File not opened.` |
| `document.languageId !== 'java'` | `This is not a Java file.` |

### 5.3 入力補助メソッドの生成（35〜69行）
JShell スクリプトの冒頭に、以下のメソッド定義を文字列として組み立てる。

| メソッド | 実装 |
|----------|------|
| `String input()` | `System.out.print("入力してEnterを押してください > ")` の後、`new Scanner(System.in, "MS932")` の `nextLine()` を返す |
| `char inputToChar()` | `input().charAt(0)` |
| `int inputToInt()` | `Integer.parseInt(input())` |
| `double inputToDouble()` | `Double.parseDouble(input())` |
| `long inputToLong()` | `Long.parseLong(input())` |
| `float inputToFloat()` | `Float.parseFloat(input())` |
| `short inputToShort()` | `Short.parseShort(input())` |
| `int makeRandomValue(int start, int end)` | `java.util.Random` で `start`〜`end`（両端含む）の乱数を返す |

> `makeRandomValue` は README に記載が無い（「課題一覧」参照）。

### 5.4 実行対象コードの組み立て（72〜99行）
| 行 | 内容 |
|----|------|
| 72 | 開始メッセージ `[JavaCodeSelectionRunner]------------------start-----------------` |
| 75〜91 | 選択範囲の判定と本文の追加 |
| 94〜96 | 空行、終了メッセージ、`Press Enter to exit.` |
| 97〜98 | `Scanner` で Enter 待ち（ターミナルが即閉じしないようにするため） |
| 99 | `/ex`（JShell を終了する組み込みコマンド） |

**選択範囲の扱い**

- `selection.isEmpty` が true（未選択）… ファイル全体を対象とする。
  - 全角スペース（`　`）を半角スペースへ置換する。
  - `checkJavaClassWithMain()` で main を持つクラス名を取得し、得られたら `<クラス名>.main(new String[]{});` を追記する。
- false（選択あり）… 選択範囲のテキストのみを対象とし、同様に全角スペースを置換する。

### 5.5 一時ファイルの生成（102〜105行）
| 項目 | 内容 |
|------|------|
| パス | `path.join(os.tmpdir(), 'vscode-extension-temp' + Math.random().toString(36).slice(-8) + '.jsh')` |
| 書き出し | `fs.writeFile()`（非同期）。以降の処理はコールバック内で行う |

### 5.6 プラットフォーム別の設定（107〜118行）
| 項目 | Windows | それ以外 |
|------|---------|----------|
| ターミナル | `cmd.exe` | `bash` |
| 同梱JREのディレクトリ名 | `jre_win` | `jre_linux` |
| JShell の実行ファイル | `jshell.exe` | `jshell` |

### 5.7 Java の所在決定（121〜137行）
```typescript
let javaHomePath = vscode.workspace.getConfiguration('JavaCodeSelectionRunner').get('java_home', '');
if (javaHomePath == '') {
    vscode.window.showInformationMessage('It runs on Java that is maintained internally.');
    javaHomePath = path.join(os.tmpdir(), jdkType);
    if (!fs.existsSync(javaHomePath)) {
        let fsex = require('fs-extra');
        fsex.copySync(path.join(__dirname, jdkType), javaHomePath);
        chmodFolder(javaHomePath, '755');
    }
}
let jshellCommand = path.join(javaHomePath, 'bin', jshell);
if (is_windows) { jshellCommand = '"' + jshellCommand + '"'; }
```

- 設定が空の場合、同梱JREを `os.tmpdir()/<jre_win|jre_linux>` へコピーして使う。既にコピー済みならスキップする。
- Windows のみ、JShell のパスを二重引用符で囲む。

### 5.8 ターミナルでの実行（140〜142行）
```typescript
let terminal = vscode.window.createTerminal('JavaCodeSelectionRunner', terminalType);
terminal.sendText(jshellCommand + ' ' + '-J-Dfile.encoding=utf8 --execution local' + ' ' + temp_jshell_file + ' && exit');
terminal.show();
```

| オプション | 意味 |
|------------|------|
| `-J-Dfile.encoding=utf8` | JShell を起動する JVM の既定文字コードを UTF-8 にする |
| `--execution local` | 実行エンジンをローカル（同一JVM）にする。別プロセスを起動しないため起動が速い |
| `&& exit` | JShell 終了後にターミナルを閉じる |

### 5.9 chmodFolder（154〜166行）
| 項目 | 内容 |
|------|------|
| 目的 | コピーした JRE ディレクトリ配下に実行権限を付与する |
| 処理 | `fs.readdirSync` で再帰的に走査し、ファイルには `fsex.chmod(target, mode)`、最後にディレクトリ自身にも適用 |

### 5.10 checkJavaClassWithMain（169〜184行）
| 項目 | 内容 |
|------|------|
| 目的 | 入力コードから、main メソッドを持つ public クラスのクラス名を取得する |
| クラス抽出 | `/\bpublic\s+class\s+(\w+)\s*\{([\s\S]*?)\}/g` |
| main 判定 | `/\bpublic\s+static\s+void\s+main\s*\(\s*String\s*\[\s*\]\s*\w*\)/` |
| 戻り値 | 該当クラス名、無ければ `null` |

### 5.11 deactivate（151行）
処理なし（空実装）。

## 6. 外部依存
| 依存先 | 用途 |
|--------|------|
| VS Code 拡張 API（`vscode`） | コマンド登録、エディタ操作、設定取得、ターミナル生成 |
| `fs` / `path` / `os` | 一時ファイル操作、パス組み立て、プラットフォーム判定 |
| `fs-extra` | JRE ディレクトリの再帰コピーと権限変更 |
| 同梱 JRE（`dist/jre_win`） | JShell の実行環境（OpenJDK 21） |

## 7. 出力
- **統合ターミナル**：`JavaCodeSelectionRunner` という名前のターミナルが開き、JShell の実行結果が表示される。
  開始・終了は `[JavaCodeSelectionRunner]` 付きのメッセージで区切られる。
- **一時ファイル**：`os.tmpdir()` に `.jsh` ファイルが生成される（実行後も残る）。
- **同梱JREの展開先**：設定が空の場合、`os.tmpdir()/jre_win`（または `jre_linux`）。

## 8. エラーハンドリング
- エディタ未オープン、Java ファイル以外の場合はエラーメッセージを表示して中断する。
- **それ以外のエラー処理は実装されていない**。
  - `fs.writeFile` のコールバック引数 `err` を検査していない。
  - `fsex.copySync` が失敗した場合（同梱JREが無い等）の捕捉が無い。
  - 設定された `java_home` の存在確認を行っていない。
  - JShell の実行結果（終了コード）は確認せず、ターミナルの表示のみ。

## 9. 備考
実装上の課題は [課題一覧.md](%E8%AA%B2%E9%A1%8C%E4%B8%80%E8%A6%A7.md) にまとめている。
