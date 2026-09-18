// モジュール「vscode」には、VS Code 拡張 API が含まれています
// モジュールをインポートし、以下のコード内でエイリアス vscode を使用して参照します。
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// 一時ファイルの接頭辞と拡張子（起動時の掃除にも使用する）
const TEMP_FILE_PREFIX = 'vscode-extension-temp';
const TEMP_FILE_SUFFIX = '.jsh';
// 掃除の対象とする経過時間（ミリ秒）
const TEMP_FILE_EXPIRE_MS = 24 * 60 * 60 * 1000;


// このメソッドは、拡張機能がアクティブ化されたときに呼び出されます
// 拡張機能は、コマンドが初めて実行されたときにアクティブ化されます。
export function activate(context: vscode.ExtensionContext) {

	const is_windows = process.platform==='win32'

	// 標準入力の文字コード（Windowsのコンソールは MS932、それ以外は UTF-8 を前提とする）
	const inputCharset = is_windows ? 'MS932' : 'UTF-8';

	// 前回までに残った一時ファイルを掃除する
	cleanUpTempFiles();

	// 「JavaCodeSelectionRunner.RunCode」で実行される処理
	let disposable = vscode.commands.registerCommand('JavaCodeSelectionRunner.RunCode', function () {
		
		// テキストエディタが開かれているかどうかの判定
		if(typeof vscode.window.activeTextEditor == 'undefined' ){
			vscode.window.showErrorMessage('File not opened.');
			return;
		}
		
		// 開かれているテキストの言語設定がJavaになっているかどうかの確認
		if (vscode.window.activeTextEditor.document.languageId !== 'java') {
			vscode.window.showErrorMessage('This is not a Java file.');
			return;
		}
		

		// 実行用のJshellスクリプトを作成する
		
		// 便利メソッドの追加
		let text = ''; 
		text = text + 'String input() { ' + os.EOL;
		text = text + '    System.out.print("入力してEnterを押してください > ");' + os.EOL;
		text = text + '    Scanner in = new Scanner(System.in, "' + inputCharset + '"); ' + os.EOL;
		text = text + '    return in.nextLine(); ' + os.EOL;
		text = text + '} ' + os.EOL;
		
		text = text + 'char inputToChar() { ' + os.EOL;
		text = text + '    return input().charAt(0); ' + os.EOL;
		text = text + '} ' + os.EOL;
		
		text = text + 'int inputToInt() { ' + os.EOL;
		text = text + '    return Integer.parseInt(input()); ' + os.EOL;
		text = text + '} ' + os.EOL;
		
		text = text + 'double inputToDouble() { ' + os.EOL;
		text = text + '    return Double.parseDouble(input()); ' + os.EOL;
		text = text + '} ' + os.EOL;
		
		text = text + 'long inputToLong() { ' + os.EOL;
		text = text + '    return Long.parseLong(input()); ' + os.EOL;
		text = text + '} ' + os.EOL;

		text = text + 'float inputToFloat() { ' + os.EOL;
		text = text + '    return Float.parseFloat(input()); ' + os.EOL;
		text = text + '} ' + os.EOL;

		text = text + 'short inputToShort() { ' + os.EOL;
		text = text + '    return Short.parseShort(input()); ' + os.EOL;
		text = text + '} ' + os.EOL;

		text = text + 'int makeRandomValue(int start, int end) { ' + os.EOL;
		text = text + '    java.util.Random rand = new java.util.Random(); ' + os.EOL;
		text = text + '    return (rand.nextInt(end - start + 1) + start); ' + os.EOL;
		text = text + '} ' + os.EOL;

		// コード実行前の固定メッセージを追加
		text = text + 'System.out.println("[JavaCodeSelectionRunner]------------------start-----------------");' + os.EOL;
		
		// 選択範囲を取得する
		let cur_selection = vscode.window.activeTextEditor.selection; 
		//取得した選択範囲のテキストを追加する（選択されていない場合は全て）
		if(cur_selection.isEmpty){
			// ファイル全体の場合
			let inputText = replaceFullWidthSpace(vscode.window.activeTextEditor.document.getText());
			// 入力内容がmainメソッドを含むクラス定義になっている場合はクラス名を抜き出す
			let className = checkJavaClassWithMain(inputText);
			// 入力内容を追記
			text = text + inputText + os.EOL;
			// mainメソッドを含むクラスが定義されている場合は呼び出し処理を追記する
			if(className){
				 text = text + className + '.main(new String[]{});' + os.EOL;
			}
		}else{
			// 選択されたエリアのみの場合
			text = text + replaceFullWidthSpace(vscode.window.activeTextEditor.document.getText(cur_selection)) + os.EOL;
		}
		
		// コード実行前の固定メッセージを追加
		text = text + 'System.out.println("");' + os.EOL;
		text = text + 'System.out.println("[JavaCodeSelectionRunner]-------------------end------------------");' + os.EOL;
		text = text + 'System.out.println("[JavaCodeSelectionRunner]Press Enter to exit.");' + os.EOL;
		text = text + 'Scanner in = new Scanner(System.in, "' + inputCharset + '"); ' + os.EOL;
		text = text + 'return in.nextLine(); ' + os.EOL;
		text = text + '/ex' + os.EOL;
		
		// 一時ファイルのパスを生成
		let temp_jshell_file = path.join(os.tmpdir(), TEMP_FILE_PREFIX + Math.random().toString(36).slice(-8) + TEMP_FILE_SUFFIX);
		
		// 一時ファイルに出力（出力後にJshellで実行）
		fs.writeFile(temp_jshell_file, text, (err) =>{
		
			// 書き出しに失敗した場合は実行しない
			if(err){
				vscode.window.showErrorMessage('Failed to create a temporary file. : ' + err.message);
				return;
			}
		
			let terminalType = '';
			let jdkType = '';
			let jshell = '';
			if(is_windows){
				terminalType = 'cmd.exe';
				jdkType = 'jre_win';
				jshell = 'jshell.exe';
			} else {
				terminalType = 'bash';
				jdkType = 'jre_linux';
				jshell = 'jshell';
			}
		
			// JavaHomeのパス
			let javaHomePath = vscode.workspace.getConfiguration('JavaCodeSelectionRunner').get('java_home', '');
			if(javaHomePath == '' ){
				// 同梱しているJavaの配置元
				let bundledJdkPath = path.join(__dirname, jdkType);
				if (!fs.existsSync(bundledJdkPath)){
					// 同梱しているJavaが無い場合は設定が必要である旨を通知する
					vscode.window.showErrorMessage(
						'Java for this platform is not bundled. Please set "JavaCodeSelectionRunner.java_home" in the settings.'
					);
					return;
				}
				vscode.window.showInformationMessage('It runs on Java that is maintained internally.');
				javaHomePath = path.join(os.tmpdir(), jdkType);
				if (!fs.existsSync(javaHomePath)){
					try{
						let fsex = require('fs-extra');
						fsex.copySync(bundledJdkPath, javaHomePath );
						chmodFolder(javaHomePath, '755');
					}catch(e){
						vscode.window.showErrorMessage('Failed to prepare the bundled Java. : ' + String(e));
						return;
					}
				}
			}
			
			// Jshellのパス
			let jshellCommand = quotePath(path.join(javaHomePath, 'bin', jshell));
			
			// ターミナル上で実行
			let terminal = vscode.window.createTerminal('JavaCodeSelectionRunner', terminalType);
			terminal.sendText(jshellCommand + ' ' + '-J-Dfile.encoding=utf8 --execution local' + ' ' + quotePath(temp_jshell_file) + ' && exit' );
			terminal.show();
			
		});
	});
	
	context.subscriptions.push(disposable);
}

// このメソッドは、拡張機能が非アクティブ化されたときに呼び出されます。
export function deactivate() {}

// パスを二重引用符で囲みます（空白を含むパスに対応するため）。
function quotePath(targetPath: string) {
	return '"' + targetPath + '"';
}

// 一時ディレクトリに残っている、本拡張機能が作成した古い一時ファイルを削除します。
function cleanUpTempFiles() {
	try{
		const tempDir = os.tmpdir();
		const now = Date.now();
		for (const name of fs.readdirSync(tempDir)) {
			if (!name.startsWith(TEMP_FILE_PREFIX) || !name.endsWith(TEMP_FILE_SUFFIX)) {
				continue;
			}
			const target = path.join(tempDir, name);
			try{
				const stat = fs.statSync(target);
				if (stat.isFile() && (now - stat.mtimeMs) > TEMP_FILE_EXPIRE_MS) {
					fs.unlinkSync(target);
				}
			}catch(e){
				// 個々のファイルの削除失敗は無視する（他の処理に影響させない）
			}
		}
	}catch(e){
		// 一時ディレクトリを参照できない場合も処理を継続する
	}
}

// フォルダのパーミッションを変更します。
function chmodFolder(dirPath: string, mode: string) {
	const items = fs.readdirSync(dirPath);
	for (const item of items) {
		const target = path.join(dirPath, item);
		if (fs.lstatSync(target).isDirectory()) {
			chmodFolder(target, mode)
		} else {
			// 実行前に権限付与が完了している必要があるため同期版を使用する
			fs.chmodSync(target, mode);
		}
	}
	fs.chmodSync(dirPath, mode);
}


// 文字列リテラル・文字リテラルを除いた範囲の全角スペースを半角スペースへ置換します。
// （コード中の全角スペースはJavaの文法上エラーとなるため置換するが、
// 　リテラル内の全角スペースは実行結果が変わってしまうため、そのまま残す）
function replaceFullWidthSpace(code: string) {
	let result = '';
	// normal: コード / string: 文字列リテラル / char: 文字リテラル
	// text: テキストブロック / line: 行コメント / block: ブロックコメント
	let state: 'normal' | 'string' | 'char' | 'text' | 'line' | 'block' = 'normal';

	for (let i = 0; i < code.length; i++) {
		const current = code[i];
		const next = code[i + 1];

		if (state === 'normal') {
			if (code.startsWith('"""', i)) { state = 'text'; result += '"""'; i += 2; continue; }
			if (current === '"') { state = 'string'; result += current; continue; }
			if (current === "'") { state = 'char'; result += current; continue; }
			if (current === '/' && next === '/') { state = 'line'; result += '//'; i++; continue; }
			if (current === '/' && next === '*') { state = 'block'; result += '/*'; i++; continue; }
			result += (current === '　' ? ' ' : current);
			continue;
		}

		if (state === 'string' || state === 'char') {
			// エスケープシーケンスは2文字まとめて通す
			if (current === '\\' && typeof next !== 'undefined') { result += current + next; i++; continue; }
			if ((state === 'string' && current === '"') || (state === 'char' && current === "'")) { state = 'normal'; }
			// リテラル内は置換しない
			result += current;
			continue;
		}

		if (state === 'text') {
			if (code.startsWith('"""', i)) { state = 'normal'; result += '"""'; i += 2; continue; }
			// テキストブロック内も置換しない
			result += current;
			continue;
		}

		if (state === 'line') {
			if (current === '\n') { state = 'normal'; }
			result += (current === '　' ? ' ' : current);
			continue;
		}

		// state === 'block'
		if (current === '*' && next === '/') { state = 'normal'; result += '*/'; i++; continue; }
		result += (current === '　' ? ' ' : current);
	}

	return result;
}


// 文字列リテラル・文字リテラル・コメントの中身を空白へ置き換えた文字列を返します。
// （波括弧の対応を数える際に、リテラルやコメント内の記号を誤って数えないようにするため）
function maskLiteralsAndComments(code: string) {
	let result = '';
	let state: 'normal' | 'string' | 'char' | 'text' | 'line' | 'block' = 'normal';

	for (let i = 0; i < code.length; i++) {
		const current = code[i];
		const next = code[i + 1];
		// 改行は行数・位置を保つためそのまま残す
		const masked = (current === '\n' || current === '\r') ? current : ' ';

		if (state === 'normal') {
			if (code.startsWith('"""', i)) { state = 'text'; result += '   '; i += 2; continue; }
			if (current === '"') { state = 'string'; result += ' '; continue; }
			if (current === "'") { state = 'char'; result += ' '; continue; }
			if (current === '/' && next === '/') { state = 'line'; result += '  '; i++; continue; }
			if (current === '/' && next === '*') { state = 'block'; result += '  '; i++; continue; }
			result += current;
			continue;
		}

		if (state === 'string' || state === 'char') {
			if (current === '\\' && typeof next !== 'undefined') { result += '  '; i++; continue; }
			if ((state === 'string' && current === '"') || (state === 'char' && current === "'")) { state = 'normal'; }
			result += masked;
			continue;
		}

		if (state === 'text') {
			if (code.startsWith('"""', i)) { state = 'normal'; result += '   '; i += 2; continue; }
			result += masked;
			continue;
		}

		if (state === 'line') {
			if (current === '\n') { state = 'normal'; result += current; continue; }
			result += masked;
			continue;
		}

		// state === 'block'
		if (current === '*' && next === '/') { state = 'normal'; result += '  '; i++; continue; }
		result += masked;
	}

	return result;
}


// mainメソッドを持つクラスの名前を返します（見つからない場合は null）。
function checkJavaClassWithMain(code:string) {
	// リテラル・コメントを除いた文字列に対して解析する
	const maskedCode = maskLiteralsAndComments(code);

	// クラス定義の正規表現（クラス名を取得。public 以外の修飾子にも対応する）
	const classPattern = /\bclass\s+(\w+)/g;
	// mainメソッドの正規表現（String[] args / String args[] の両方に対応する）
	const mainPattern = /\bpublic\s+static\s+void\s+main\s*\(\s*(?:final\s+)?String\s*(?:\[\s*\]\s*\w+|\w+\s*\[\s*\])\s*\)/;

	let match;
	while ((match = classPattern.exec(maskedCode)) !== null) {
		const className = match[1]; // クラス名

		// クラス本体の開始位置（クラス名の後に現れる最初の波括弧）
		const bodyStart = maskedCode.indexOf('{', match.index);
		if (bodyStart === -1) {
			continue;
		}

		// 波括弧の対応を数えてクラス本体の終端を求める
		let depth = 0;
		let bodyEnd = -1;
		for (let i = bodyStart; i < maskedCode.length; i++) {
			if (maskedCode[i] === '{') {
				depth++;
			} else if (maskedCode[i] === '}') {
				depth--;
				if (depth === 0) {
					bodyEnd = i;
					break;
				}
			}
		}

		// 終端が見つからない場合（閉じ括弧が不足している場合）は末尾までを本体とみなす
		const classBody = maskedCode.slice(bodyStart, bodyEnd === -1 ? maskedCode.length : bodyEnd);

		if (mainPattern.test(classBody)) {
			return className; // クラス名を返す
		}
	}
	return null; // 該当するクラスがない場合
}
