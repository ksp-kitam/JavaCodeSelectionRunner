// コード整形（google-java-format の呼び出し）に関する処理をまとめたモジュールです。
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as cp from 'child_process';
import { resolveJavaHome, getJavaCommandPath } from './javaHome';

// 同梱している整形ツール（Apache License 2.0）
const FORMATTER_JAR_NAME = 'google-java-format-1.36.1-all-deps.jar';

// 整形用の一時ファイル
const TEMP_FILE_PREFIX = 'vscode-extension-format';
const TEMP_FILE_SUFFIX = '.java';

// JDK16以降で google-java-format を動かすために必要なオプション
// （jarのマニフェストにも Add-Exports が指定されているが、明示的に付与しておく）
const ADD_EXPORTS_OPTIONS = [
	'--add-exports=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED',
	'--add-exports=jdk.compiler/com.sun.tools.javac.code=ALL-UNNAMED',
	'--add-exports=jdk.compiler/com.sun.tools.javac.file=ALL-UNNAMED',
	'--add-exports=jdk.compiler/com.sun.tools.javac.parser=ALL-UNNAMED',
	'--add-exports=jdk.compiler/com.sun.tools.javac.tree=ALL-UNNAMED',
	'--add-exports=jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED'
];

// 標準出力の上限（大きなファイルでも切れないように余裕を持たせる）
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;


// 整形機能をVS Codeへ登録します。
export function registerFormatter(context: vscode.ExtensionContext) {

	// ファイル全体の整形
	const documentProvider = vscode.languages.registerDocumentFormattingEditProvider('java', {
		provideDocumentFormattingEdits(document: vscode.TextDocument) {
			return formatDocument(document, []);
		}
	});

	// 選択範囲の整形
	const rangeProvider = vscode.languages.registerDocumentRangeFormattingEditProvider('java', {
		provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range) {
			const offset = document.offsetAt(range.start);
			const length = document.offsetAt(range.end) - offset;
			// 範囲指定の整形では、ファイル全体を渡したうえで対象範囲のみを整形する
			return formatDocument(document, ['--offset', String(offset), '--length', String(length)]);
		}
	});

	context.subscriptions.push(documentProvider, rangeProvider);
}


// ドキュメントを整形し、置き換え用の編集内容を返します。
async function formatDocument(
	document: vscode.TextDocument,
	extraArguments: string[]
): Promise<vscode.TextEdit[]> {

	// 整形ツールの所在を確認する
	// __dirname はバンドル後の dist ディレクトリを指す
	const formatterJarPath = path.join(__dirname, 'tools', FORMATTER_JAR_NAME);
	if (!fs.existsSync(formatterJarPath)) {
		vscode.window.showErrorMessage('The formatter is not bundled. : ' + FORMATTER_JAR_NAME);
		return [];
	}

	// 使用するJavaを決定する
	const javaHomePath = resolveJavaHome();
	if (typeof javaHomePath === 'undefined') {
		// エラーメッセージは resolveJavaHome の中で表示済み
		return [];
	}

	// 整形対象を一時ファイルへ書き出す
	const sourceText = document.getText();
	const tempFilePath = path.join(
		os.tmpdir(),
		TEMP_FILE_PREFIX + Math.random().toString(36).slice(-8) + TEMP_FILE_SUFFIX
	);
	try {
		fs.writeFileSync(tempFilePath, sourceText, 'utf8');
	} catch (e) {
		vscode.window.showErrorMessage('Failed to create a temporary file. : ' + String(e));
		return [];
	}

	try {
		const formattedText = await runFormatter(
			getJavaCommandPath(javaHomePath, 'java'),
			formatterJarPath,
			extraArguments,
			tempFilePath
		);

		// 整形結果に変化が無い場合は編集を行わない
		if (formattedText === sourceText) {
			return [];
		}

		// ファイル全体を整形結果で置き換える
		const wholeRange = new vscode.Range(
			document.positionAt(0),
			document.positionAt(sourceText.length)
		);
		return [vscode.TextEdit.replace(wholeRange, formattedText)];

	} catch (e) {
		vscode.window.showErrorMessage('Failed to format the Java code. : ' + String(e));
		return [];

	} finally {
		// 一時ファイルを削除する
		try {
			fs.unlinkSync(tempFilePath);
		} catch (e) {
			// 削除に失敗しても処理は継続する
		}
	}
}


// google-java-format を実行し、整形後のソースコードを返します。
function runFormatter(
	javaCommandPath: string,
	formatterJarPath: string,
	extraArguments: string[],
	targetFilePath: string
): Promise<string> {

	const args = [
		...ADD_EXPORTS_OPTIONS,
		'-Dfile.encoding=UTF-8',
		'-jar',
		formatterJarPath,
		...extraArguments,
		targetFilePath
	];

	return new Promise<string>((resolve, reject) => {
		cp.execFile(
			javaCommandPath,
			args,
			{ encoding: 'buffer', windowsHide: true, maxBuffer: MAX_OUTPUT_BYTES },
			(error, stdout, stderr) => {
				if (error) {
					// 整形ツールは構文エラーなどを標準エラー出力へ出力する
					const message = stderr.toString('utf8').trim();
					reject(new Error(message === '' ? String(error) : message));
					return;
				}
				resolve(stdout.toString('utf8'));
			}
		);
	});
}
