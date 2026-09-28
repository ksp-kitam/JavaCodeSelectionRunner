// 解析ヘルパー（JShell の解析APIを使う常駐プロセス）の起動と通信をまとめたモジュールです。
// 入力補完（completion.ts）とエラーチェック（diagnostics.ts）が共用します。
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { resolveJavaHome, getJavaCommandPath } from './javaHome';

// 解析ヘルパー（Javaソース。単一ファイルソースコードランチャーで実行する）
const HELPER_SOURCE_NAME = 'AnalysisHelper.java';


// 解析ヘルパーのプロセスを管理し、要求と応答をやり取りします。
export class AnalysisHelper {

	private helperProcess: cp.ChildProcessWithoutNullStreams | undefined;
	private pendingBuffer = '';
	private pendingResolve: ((line: string) => void) | undefined;
	private requestQueue: Promise<unknown> = Promise.resolve();
	private requestCount = 0;
	// 要求の種類（key）ごとの最新の要求番号
	private latestRequestIds = new Map<string, number>();
	private isUnavailable = false;
	private hasNotifiedError = false;

	// ヘルパーへ要求を1行送り、応答を1行受け取ります。
	// 同じ key の新しい要求が後から来た場合や、応答が得られない場合は undefined を返します。
	request(key: string, request: string, timeoutMs: number): Promise<string | undefined> {
		// 要求が重ならないよう、直列に処理する
		const requestId = ++this.requestCount;
		this.latestRequestIds.set(key, requestId);
		const next = this.requestQueue.then(() => this.requestInternal(key, request, timeoutMs, requestId));
		this.requestQueue = next.catch(() => undefined);
		return next;
	}

	private async requestInternal(key: string, request: string, timeoutMs: number, requestId: number) {

		// 入力が続いて同じ種類の新しい要求が来ている場合は、古い要求を送らずに捨てる
		if (requestId !== this.latestRequestIds.get(key)) {
			return undefined;
		}

		const helperProcess = this.ensureProcess();
		if (typeof helperProcess === 'undefined') {
			return undefined;
		}

		try {
			return await this.sendRequest(helperProcess, request, timeoutMs);
		} catch (e) {
			// 応答が得られない場合はプロセスを作り直す（次回の要求で復帰させる）
			this.stopProcess();
			return undefined;
		}
	}

	// ヘルパーへ1行送り、1行の応答を待ちます。
	private sendRequest(helperProcess: cp.ChildProcessWithoutNullStreams, request: string, timeoutMs: number): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingResolve = undefined;
				reject(new Error('The analysis helper did not respond.'));
			}, timeoutMs);

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
			// Java が使えない場合は解析を諦める（エラーメッセージは resolveJavaHome 側で表示済み）
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
			vscode.window.showWarningMessage('The analysis helper reported an error. : ' + message.split('\n')[0]);
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


// 文字列を Base64（UTF-8）へ符号化します。
export function encodeBase64(value: string): string {
	return Buffer.from(value, 'utf8').toString('base64');
}


// Base64（UTF-8）を文字列へ復号します。
export function decodeBase64(value: string): string {
	return Buffer.from(value, 'base64').toString('utf8');
}
