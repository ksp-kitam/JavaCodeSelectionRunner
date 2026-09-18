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

// 解析対象として送るコードの上限（文字数）
// 大きなファイルでも入力のたびに全文を送らないようにするための制限
const MAX_ANALYZE_LENGTH = 20000;


// 補完機能をVS Codeへ登録します。
export function registerCompletion(context: vscode.ExtensionContext) {

	const helper = new CompletionHelper();
	context.subscriptions.push({ dispose: () => helper.dispose() });

	const provider = vscode.languages.registerCompletionItemProvider(
		'java',
		{
			async provideCompletionItems(
				document: vscode.TextDocument,
				position: vscode.Position,
				token: vscode.CancellationToken
			) {

				// 設定で無効化されている場合は何も返さない
				if (!vscode.workspace.getConfiguration('JavaCodeSelectionRunner').get('enable_completion', true)) {
					return undefined;
				}

				// カーソル位置までのコードを解析対象とする
				const offset = document.offsetAt(position);
				const wholePrefix = document.getText().slice(0, offset);

				// 大きなファイルでは、カーソル手前の一定量だけを送る（行の先頭に合わせて切り出す）
				let analyzeStart = 0;
				if (wholePrefix.length > MAX_ANALYZE_LENGTH) {
					const roughStart = wholePrefix.length - MAX_ANALYZE_LENGTH;
					const lineBreakIndex = wholePrefix.indexOf('\n', roughStart);
					analyzeStart = lineBreakIndex < 0 ? roughStart : lineBreakIndex + 1;
				}
				const code = wholePrefix.slice(analyzeStart);

				if (token.isCancellationRequested) {
					return undefined;
				}

				const result = await helper.complete(code, code.length);
				if (typeof result === 'undefined' || token.isCancellationRequested) {
					return undefined;
				}

				// 切り出した分だけアンカー位置を元の位置へ戻す
				result.anchor = result.anchor + analyzeStart;

				// アンカー位置から現在位置までが、候補で置き換えられる範囲になる。
				// VS Code の仕様では、補完の range は「単一行」かつ「補完要求位置を含む」必要があるため、
				// 開始位置をカーソル行の先頭までに制限する。
				const lineStartOffset = document.offsetAt(position.with(position.line, 0));
				const anchorOffset = Math.min(Math.max(result.anchor, lineStartOffset), offset);
				const replaceRange = new vscode.Range(document.positionAt(anchorOffset), position);

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
	private latestRequestId = 0;
	private isUnavailable = false;
	private hasNotifiedError = false;

	// 補完候補を取得します。取得できない場合は undefined を返します。
	complete(code: string, cursor: number): Promise<{ anchor: number, suggestions: string[] } | undefined> {
		// 要求が重ならないよう、直列に処理する
		const requestId = ++this.latestRequestId;
		const next = this.requestQueue.then(() => this.completeInternal(code, cursor, requestId));
		this.requestQueue = next.catch(() => undefined);
		return next;
	}

	private async completeInternal(code: string, cursor: number, requestId: number) {

		// 入力が続いて新しい要求が来ている場合は、古い要求を送らずに捨てる
		if (requestId !== this.latestRequestId) {
			return undefined;
		}

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

			try {
				helperProcess.stdin.write(request + '\n', 'utf8');
			} catch (e) {
				clearTimeout(timer);
				this.pendingResolve = undefined;
				reject(e instanceof Error ? e : new Error(String(e)));
			}
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

			// 標準エラー出力も受け取る。読まないとパイプが詰まってヘルパーが停止するため。
			// 起動に失敗した場合（コンパイルエラーなど）は最初の1回だけ内容を通知する。
			helperProcess.stderr.setEncoding('utf8');
			helperProcess.stderr.on('data', (chunk: string) => this.receiveError(chunk));

			helperProcess.on('exit', () => { this.helperProcess = undefined; });
			helperProcess.on('error', () => { this.helperProcess = undefined; });

			// 標準入力への書き込み失敗（相手プロセスの異常終了など）で例外が出ないようにする
			helperProcess.stdin.on('error', () => { this.helperProcess = undefined; });

			this.helperProcess = helperProcess;
			return helperProcess;

		} catch (e) {
			this.isUnavailable = true;
			return undefined;
		}
	}

	// ヘルパーの標準エラー出力を受け取ります（起動失敗時のみ1度だけ通知します）。
	private receiveError(chunk: string) {
		if (this.hasNotifiedError) {
			return;
		}
		this.hasNotifiedError = true;
		const message = chunk.trim();
		if (message !== '') {
			vscode.window.showWarningMessage('The completion helper reported an error. : ' + message.split('\n')[0]);
		}
	}


	// ヘルパーからの出力を1行単位に組み立てます。
	private receive(chunk: string) {
		this.pendingBuffer += chunk;
		let newLineIndex = this.pendingBuffer.indexOf('\n');
		while (newLineIndex >= 0) {
			const line = this.pendingBuffer.slice(0, newLineIndex).replace(/\r$/, '');
			this.pendingBuffer = this.pendingBuffer.slice(newLineIndex + 1);

			// 応答以外の出力（JVMの警告など）が混ざっても取り違えないように、
			// プロトコルで定めた書き出しだけを応答として扱う
			if (isProtocolResponse(line)) {
				const resolvePending = this.pendingResolve;
				this.pendingResolve = undefined;
				if (typeof resolvePending !== 'undefined') {
					resolvePending(line);
				}
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


// プロトコルで定めた応答かどうかを判定します。
function isProtocolResponse(line: string): boolean {
	return line.startsWith('OK ') || line === 'OK' || line.startsWith('ERR ') || line === 'PONG';
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
