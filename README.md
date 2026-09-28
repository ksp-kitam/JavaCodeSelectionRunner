# JavaCode Selection Runner

Javaコード内の選択した箇所を実行させる事ができる拡張機能です

Jshellを利用しています。

## ■設定

本拡張機能は内部的に保持しているJavaで動作します。

内部的に保持しているJavaには最低限のモジュールしか含まれていません。

* 内部的に保持しているJavaの情報

	* Javaの種類：OpenJDK

	* バージョン：21

	* 含まれるモジュール：java.base、java.compiler、java.logging、java.xml、java.prefs、jdk.internal.jvmstat、jdk.attach、jdk.internal.opt、jdk.zipfs、jdk.compiler、jdk.internal.ed、jdk.internal.le、jdk.jdwp.agent、jdk.jdi、jdk.jshell

* 対応プラットフォーム

	* 内部的に保持しているJavaは **Windows用のみ** です。

	* **Windows以外（Linux / macOS）で利用する場合は、下記の java_home の設定が必須です。**
	  設定がない場合は「Java for this platform is not bundled.」というエラーを表示して処理を中断します。

変更を行う場合はVScodeの設定画面を開いて下記の通り設定を行ってください。

* 設定箇所：拡張機能 >> JavaCodeSelectionRunner >> Java home

* 設定値：＜Javaのインストールディレクトリ＞

設定ファイル（settings.json）を直接編集する場合は下記の内容を追加してください。

* JavaCodeSelectionRunner.java_home: "＜Javaのインストールディレクトリ＞"

## ■入力補完

Javaコードの入力中に候補を表示します。

例えば `System.` と入力すると `out` や `err` が候補として表示されます。

* 補完には本拡張機能が内部的に保持しているJavaを使用します（JShellの解析機能を利用しています）。

* 初回の補完時にヘルパープロセスを起動するため、最初の1回だけ数秒かかります。以降は常駐したプロセスが応答します。

* 補完を使わない場合は、設定で無効にできます。

	* 設定箇所：拡張機能 >> JavaCodeSelectionRunner >> Enable completion

	* settings.json：`JavaCodeSelectionRunner.enable_completion: false`

### 補完の範囲について

JShellの解析機能を利用しているため、候補が出る範囲には次の制限があります。

* カーソルより前に書いたクラスや変数の宣言も候補に反映されます（v1.3.1）。

	例えば `class Test { void ssssss() { } }` と `Test test = new Test();` を書いた後に `test.` と入力すると、`ssssss()` が候補に出ます。

* `input()` などの「利用出来るメソッド」も候補に出ます。

* 宣言の登録ではコードを実行しません（コンパイルのみ）。

* クラス定義の内部（メソッドの中など）では、候補が出ないことがあります。その場合はカーソル行の内容だけを元に候補を求めます。

## ■エラーの表示

Javaコードの入力中に、コンパイルエラーの箇所へ赤い波線を表示します。

波線にマウスを重ねると、エラーの内容が日本語で表示されます（「問題」パネルにも一覧が表示されます）。

```java
Test test = new Test(1111);   // ← 「不適合な型: intをjava.lang.Stringに変換できません」
```

* 入力が止まってから約0.5秒後に、ファイル全体をチェックします。

* チェックはコンパイルだけを行い、**コードは実行しません**（入力待ちや無限ループがあっても問題ありません）。

* 実行時と同じ条件でチェックします。`Scanner` や `List` などの import の省略、上記「利用出来るメソッド」の `input()` なども、エラーにはなりません。

* エラーのある宣言を後の行で使っている場合、後の行にはエラーを表示しません（原因の宣言側だけに表示します）。

* チェックには本拡張機能が内部的に保持しているJavaを使用します。Windows以外では java_home の設定が必要です。

* エラー表示を使わない場合は、設定で無効にできます。

	* 設定箇所：拡張機能 >> JavaCodeSelectionRunner >> Enable diagnostics

	* settings.json：`JavaCodeSelectionRunner.enable_diagnostics: false`

## ■コードの整形

Javaコードを google-java-format で整形できます。

* ファイル全体を整形する

	右クリックメニューより「ドキュメントのフォーマット」を選択してください（既定のキー割り当ては Shift+Alt+F）。

* 選択範囲だけを整形する

	整形したい箇所を選択して、右クリックメニューより「選択範囲のフォーマット」を選択してください（既定のキー割り当ては Ctrl+K Ctrl+F）。

整形のスタイルは Google Java Style（インデント2スペース）です。

整形にも本拡張機能が内部的に保持しているJavaを使用します。Windows以外では java_home の設定が必要です。

## ■使い方

Javaファイルを開いて、実行したい箇所を選択して右クリックメニューより「Javaコードを実行」を選択してください。

## ■利用出来るメソッド

拡張機能で下記のメソッドが提供されています。

Javaコードの実行時に下記のメソッドが利用できます。

* String input() 

	Scannerクラスのオブジェクトを作成しnextLine()を呼び出して入力された内容を取得します。
	
	取得した値はString型で返却されます。

* char inputToChar()

	Scannerクラスのオブジェクトを作成しnextLine()を呼び出して入力された内容を取得します。
	
	取得した値はchar型で返却されます。
	
	String.charAt(0)で入力内容の１文字目が返却されます。
	
* int inputToInt()

	Scannerクラスのオブジェクトを作成しnextLine()を呼び出して入力された内容を取得します。
	
	取得した値はint型で返却されます。
	
	入力内容がInteger.parseInt()で変換出来ない場合はエラーとなります。
	
* double inputToDouble()

	Scannerクラスのオブジェクトを作成しnextLine()を呼び出して入力された内容を取得します。
	
	取得した値はdouble型で返却されます。
	
	入力内容がDouble.parseDouble()で変換出来ない場合はエラーとなります。
	
* long inputToLong() 

	Scannerクラスのオブジェクトを作成しnextLine()を呼び出して入力された内容を取得します。
	
	取得した値はlong型で返却されます。
	
	入力内容がLong.parseLong()で変換出来ない場合はエラーとなります。
	
* float inputToFloat()

	Scannerクラスのオブジェクトを作成しnextLine()を呼び出して入力された内容を取得します。
	
	取得した値はfloat型で返却されます。
	
	入力内容がFloat.parseFloat()で変換出来ない場合はエラーとなります。
	
* int makeRandomValue(int start, int end)

	start から end までの範囲（両端を含む）の整数の乱数を返します。
	
	java.util.Random の nextInt() を利用しています。
	
* short inputToShort() 

	Scannerクラスのオブジェクトを作成しnextLine()を呼び出して入力された内容を取得します。
	
	取得した値はshort型で返却されます。
	
	入力内容がShort.parseShort()で変換出来ない場合はエラーとなります。
	
