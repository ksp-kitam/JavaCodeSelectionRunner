// コード整形（google-java-format の呼び出し）に関する処理をまとめたモジュールです。
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { resolveJavaHome, getJavaCommandPath } from './javaHome';

// 同梱している整形ツール（Apache License 2.0）
const FORMATTER_JAR_NAME = 'google-java-format-1.36.1-all-deps.jar';

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

// 整形処理の待ち時間の上限（ミリ秒）
const FORMAT_TIMEOUT_MS = 30000;


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
			if (length <= 0) {
				return [];
			}
			// 範囲指定の整形では、ファイル全体を渡したうえで対象範囲のみを整形する
			// （--offset / --length は 0 起点の文字位置と文字数。整形結果はファイル全文が返る）
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

	const sourceText = document.getText();

	try {
		const formattedText = await runFormatter(
			getJavaCommandPath(javaHomePath, 'java'),
			formatterJarPath,
			extraArguments,
			sourceText
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
	}
}


// google-java-format を実行し、整形後のソースコードを返します。
// 対象のコードは標準入力で渡し、結果を標準出力から受け取ります（一時ファイルを作りません）。
function runFormatter(
	javaCommandPath: string,
	formatterJarPath: string,
	extraArguments: string[],
	sourceText: string
): Promise<string> {

	const args = [
		...ADD_EXPORTS_OPTIONS,
		'-Dfile.encoding=UTF-8',
		'-jar',
		formatterJarPath,
		...extraArguments,
		'-' // 標準入力から読み込み、標準出力へ出力する
	];

	return new Promise<string>((resolve, reject) => {

		const formatterProcess = cp.spawn(javaCommandPath, args, { windowsHide: true });

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let isSettled = false;

		const settle = (action: () => void) => {
			if (isSettled) {
				return;
			}
			isSettled = true;
			clearTimeout(timer);
			action();
		};

		const timer = setTimeout(() => {
			settle(() => {
				formatterProcess.kill();
				reject(new Error('The formatter did not respond.'));
			});
		}, FORMAT_TIMEOUT_MS);

		formatterProcess.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
		// 標準エラー出力も読み捨てずに受け取る（読まないとパイプが詰まって処理が止まるため）
		formatterProcess.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

		formatterProcess.on('error', (error) => {
			settle(() => reject(error));
		});

		formatterProcess.on('close', (code) => {
			settle(() => {
				if (code === 0) {
					resolve(Buffer.concat(stdoutChunks).toString('utf8'));
					return;
				}
				// 整形ツールは構文エラーなどを標準エラー出力へ出力する
				const message = Buffer.concat(stderrChunks).toString('utf8').trim();
				reject(new Error(message === '' ? 'exit code ' + code : message));
			});
		});

		// 標準入力の書き込み失敗（相手プロセスの異常終了など）を捕捉する
		formatterProcess.stdin.on('error', (error) => {
			settle(() => reject(error));
		});
		formatterProcess.stdin.end(sourceText, 'utf8');
	});
}
