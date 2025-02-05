# JavaCode Selection Runner

Javaコード内の選択した箇所を実行させる事ができる拡張機能です

Java9から提供されているJshellを利用しています。

## ■設定

本拡張機能は内部的に保持しているJavaで動作します。

内部的に保持しているJavaには最低限のモジュールしか含まれていません。

* 内部的に保持しているJavaの情報

	* Javaの種類：OpenJDK

	* バージョン：21

	* 含まれるモジュール：java.base、jdk.jshell

変更を行う場合はVScodeの設定画面を開いて下記の通り設定を行ってください。

* 設定箇所：拡張機能 >> JavaSimpleEnvironment >> Java_home

* 設定値：＜Javaのインストールディレクトリ＞

設定ファイル（settings.json）を直接編集する場合は下記の内容を追加してください。

* JavaSimpleEnvironment.java_home: "＜Javaのインストールディレクトリ＞"

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
	
* short inputToShort() 

	Scannerクラスのオブジェクトを作成しnextLine()を呼び出して入力された内容を取得します。
	
	取得した値はshort型で返却されます。
	
	入力内容がShort.parseShort()で変換出来ない場合はエラーとなります。
	