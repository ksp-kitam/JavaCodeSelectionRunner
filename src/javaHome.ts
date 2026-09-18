// 実行に使用するJavaの所在を決定するための処理をまとめたモジュールです。
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Windowsかどうかの判定
export const isWindows = process.platform === 'win32';

// 同梱しているJavaのディレクトリ名
const BUNDLED_JDK_DIR = isWindows ? 'jre_win' : 'jre_linux';


// 使用するJavaのホームディレクトリを返します。
// 利用できない場合はエラーメッセージを表示し、undefined を返します。
export function resolveJavaHome(): string | undefined {

	// 設定で指定されている場合はその値を使用する
	const configuredPath = vscode.workspace.getConfiguration('JavaCodeSelectionRunner').get('java_home', '');
	if (configuredPath !== '') {
		return configuredPath;
	}

	// 同梱しているJavaの配置元
	// __dirname はバンドル後の dist ディレクトリを指す
	const bundledJdkPath = path.join(__dirname, BUNDLED_JDK_DIR);
	if (!fs.existsSync(bundledJdkPath)) {
		// 同梱しているJavaが無い場合は設定が必要である旨を通知する
		vscode.window.showErrorMessage(
			'Java for this platform is not bundled. Please set "JavaCodeSelectionRunner.java_home" in the settings.'
		);
		return undefined;
	}

	// 一時ディレクトリへ展開して使用する
	const javaHomePath = path.join(os.tmpdir(), BUNDLED_JDK_DIR);
	if (!fs.existsSync(javaHomePath)) {
		try {
			const fsex = require('fs-extra');
			fsex.copySync(bundledJdkPath, javaHomePath);
			chmodFolder(javaHomePath, '755');
		} catch (e) {
			vscode.window.showErrorMessage('Failed to prepare the bundled Java. : ' + String(e));
			return undefined;
		}
	}
	return javaHomePath;
}


// JavaHomeから実行ファイルのパスを組み立てます。
export function getJavaCommandPath(javaHomePath: string, commandName: string): string {
	return path.join(javaHomePath, 'bin', isWindows ? commandName + '.exe' : commandName);
}


// パスを二重引用符で囲みます（空白を含むパスに対応するため）。
export function quotePath(targetPath: string): string {
	return '"' + targetPath + '"';
}


// フォルダのパーミッションを変更します。
function chmodFolder(dirPath: string, mode: string) {
	const items = fs.readdirSync(dirPath);
	for (const item of items) {
		const target = path.join(dirPath, item);
		if (fs.lstatSync(target).isDirectory()) {
			chmodFolder(target, mode);
		} else {
			// 実行前に権限付与が完了している必要があるため同期版を使用する
			fs.chmodSync(target, mode);
		}
	}
	fs.chmodSync(dirPath, mode);
}
