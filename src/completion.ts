// 入力補完（JShell の解析API の呼び出し）に関する処理をまとめたモジュールです。
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { resolveJavaHome, getJavaCommandPath } from './javaHome';

// 補完ヘルパー（Javaソース。単一ファイルソースコードランチャーで実行する）
const HELPER_SOURCE_NAME = 'CompletionHelper.java';

// ヘルパーの応答を待つ上限（ミリ秒）
const RESPONSE_TIMEOUT_MS = 5000;


// 補完機能をVS Codeへ登録します。
export function registerCompletion(context: vscode.ExtensionContext) {

	const helper = new CompletionHelper();
	context.subscriptions.push({ dispose: () => helper.dispose() });

	const provider = vscode.languages.registerCompletionItemProvider(
		'java',
		{
			async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {

				// 設定で無効化されている場合は何も返さない
				if (!vscode.workspace.getConfiguration('JavaCodeSelectionRunner').get('enable_completion', true)) {
					return undefined;
				}

				// カーソル位置までのコードを解析対象とする
				const offset = document.offsetAt(position);
				const code = document.getText().slice(0, offset);

				const result = await helper.complete(code, offset);
				if (typeof result === 'undefined') {
					return undefined;
				}

				// アンカー位置から現在位置までが、候補で置き換えられる範囲になる
				const replaceStart = document.positionAt(Math.min(Math.max(result.anchor, 0), offset));
				const replaceRange = new vscode.Range(replaceStart, position);

				return result.suggestions.map((suggestion) => {
					const item = new vscode.CompletionItem(suggestion, guessCompletionKind(suggestion));
					item.range = replaceRange;
					return item;
				});
			}
		},
		'.' // 「.」を入力した時点でも候補を出す
	);

	context.subscriptions.push(provider);
}


// 候補の文字列から、表示に使う種類を推測します。
function guessCompletionKind(suggestion: string): vscode.CompletionItemKind {
	if (suggestion.endsWith('(')) {
		return vscode.CompletionItemKind.Method;
	}
	if (/^[A-Z]/.test(suggestion)) {
		return vscode.CompletionItemKind.Class;
	}
	return vscode.CompletionItemKind.Field;
}


// 補完ヘルパーのプロセスを管理し、要求と応答をやり取りします。
class CompletionHelper {

	private helperProcess: cp.ChildProcessWithoutNullStreams | undefined;
	private pendingBuffer = '';
	private pendingResolve: ((line: string) => void) | undefined;
	private requestQueue: Promise<unknown> = Promise.resolve();
	private isUnavailable = false;

	// 補完候補を取得します。取得できない場合は undefined を返します。
	complete(code: string, cursor: number): Promise<{ anchor: number, suggestions: string[] } | undefined> {
		// 要求が重ならないよう、直列に処理する
		const next = this.requestQueue.then(() => this.completeInternal(code, cursor));
		this.requestQueue = next.catch(() => undefined);
		return next;
	}

	private async completeInternal(code: string, cursor: number) {
		const helperProcess = this.ensureProcess();
		if (typeof helperProcess === 'undefined') {
			return undefined;
		}

		try {
			const encodedCode = Buffer.from(code, 'utf8').toString('base64');
			const response = await this.sendRequest(helperProcess, 'COMPLETE ' + cursor + ' ' + encodedCode);
			return parseResponse(response);
		} catch (e) {
			// 応答が得られない場合はプロセスを作り直す（次回の補完で復帰させる）
			this.stopProcess();
			return undefined;
		}
	}

	// ヘルパーへ1行送り、1行の応答を待ちます。
	private sendRequest(helperProcess: cp.ChildProcessWithoutNullStreams, request: string): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingResolve = undefined;
				reject(new Error('The completion helper did not respond.'));
			}, RESPONSE_TIMEOUT_MS);

			this.pendingResolve = (line: string) => {
				clearTimeout(timer);
				resolve(line);
			};

			helperProcess.stdin.write(request + '\n', 'utf8');
		});
	}

	// ヘルパープロセスを起動します（起動済みならそれを返します）。
	private ensureProcess(): cp.ChildProcessWithoutNullStreams | undefined {
		if (typeof this.helperProcess !== 'undefined') {
			return this.helperProcess;
		}
		if (this.isUnavailable) {
			return undefined;
		}

		// __dirname はバンドル後の dist ディレクトリを指す
		const helperSourcePath = path.join(__dirname, 'tools', HELPER_SOURCE_NAME);
		if (!fs.existsSync(helperSourcePath)) {
			this.isUnavailable = true;
			return undefined;
		}

		const javaHomePath = resolveJavaHome();
		if (typeof javaHomePath === 'undefined') {
			// Java が使えない場合は補完を諦める（エラーメッセージは resolveJavaHome 側で表示済み）
			this.isUnavailable = true;
			return undefined;
		}

		try {
			// 単一ファイルソースコードランチャー（java <ファイル名>.java）で実行する
			const helperProcess = cp.spawn(
				getJavaCommandPath(javaHomePath, 'java'),
				['--add-modules', 'jdk.jshell', '-Dfile.encoding=UTF-8', helperSourcePath],
				{ windowsHide: true }
			);

			helperProcess.stdout.setEncoding('utf8');
			helperProcess.stdout.on('data', (chunk: string) => this.receive(chunk));
			helperProcess.on('exit', () => { this.helperProcess = undefined; });
			helperProcess.on('error', () => { this.helperProcess = undefined; });

			this.helperProcess = helperProcess;
			return helperProcess;

		} catch (e) {
			this.isUnavailable = true;
			return undefined;
		}
	}

	// ヘルパーからの出力を1行単位に組み立てます。
	private receive(chunk: string) {
		this.pendingBuffer += chunk;
		let newLineIndex = this.pendingBuffer.indexOf('\n');
		while (newLineIndex >= 0) {
			const line = this.pendingBuffer.slice(0, newLineIndex).replace(/\r$/, '');
			this.pendingBuffer = this.pendingBuffer.slice(newLineIndex + 1);

			const resolvePending = this.pendingResolve;
			this.pendingResolve = undefined;
			if (typeof resolvePending !== 'undefined') {
				resolvePending(line);
			}

			newLineIndex = this.pendingBuffer.indexOf('\n');
		}
	}

	private stopProcess() {
		if (typeof this.helperProcess !== 'undefined') {
			try {
				this.helperProcess.stdin.write('QUIT\n');
				this.helperProcess.kill();
			} catch (e) {
				// 終了処理の失敗は無視する
			}
			this.helperProcess = undefined;
		}
		this.pendingBuffer = '';
		this.pendingResolve = undefined;
	}

	dispose() {
		this.stopProcess();
	}
}


// ヘルパーからの応答を解釈します。
function parseResponse(response: string): { anchor: number, suggestions: string[] } | undefined {
	if (!response.startsWith('OK ')) {
		// ERR などの応答は候補なしとして扱う
		return undefined;
	}
	const parts = response.split(' ');
	const anchor = Number(parts[1]);
	if (!Number.isFinite(anchor)) {
		return undefined;
	}
	const suggestions = parts.slice(2)
		.filter((part) => part !== '')
		.map((part) => Buffer.from(part, 'base64').toString('utf8'));

	return { anchor, suggestions };
}
