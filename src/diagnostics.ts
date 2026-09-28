// エラーチェック（JShell でのコンパイル結果を赤線で表示する）に関する処理をまとめたモジュールです。
// コードはコンパイルするだけで実行しません（実行しない仕組みは解析ヘルパー側で実装している）。
import * as vscode from 'vscode';
import { AnalysisHelper, encodeBase64, decodeBase64 } from './analysisHelper';
import { replaceFullWidthSpace } from './sourceText';

// 入力が止まってからチェックを始めるまでの待ち時間（ミリ秒）
const CHECK_DELAY_MS = 500;

// ヘルパーの応答を待つ上限（ミリ秒）
// 初回はヘルパーの起動（JVMの起動とコンパイル）を含むため、補完より長めにする
const RESPONSE_TIMEOUT_MS = 15000;

// チェック対象とするファイルの上限（文字数）
// 大きなファイルで入力のたびに重い処理が走らないようにするための制限
const MAX_CHECK_LENGTH = 100000;

// 問題パネルに表示する出どころの名前
const DIAGNOSTIC_SOURCE = 'JShell';


// エラーチェック機能をVS Codeへ登録します。
// prelude は実行時にあらかじめ定義される便利メソッドのコードで、チェック前に読み込みます。
export function registerDiagnostics(context: vscode.ExtensionContext, helper: AnalysisHelper, prelude: string) {

	const collection = vscode.languages.createDiagnosticCollection('JavaCodeSelectionRunner');
	context.subscriptions.push(collection);

	// ファイルごとの待ち合わせ用タイマー
	const timers = new Map<string, NodeJS.Timeout>();

	const isEnabled = () => vscode.workspace.getConfiguration('JavaCodeSelectionRunner').get('enable_diagnostics', true);

	// チェックを予約します（待ち時間の間に再度入力があれば、予約し直す）。
	const schedule = (document: vscode.TextDocument, delay: number) => {
		// 比較表示（git の差分など）で開かれたものは対象外とし、編集中のファイルだけをチェックする
		if (document.languageId !== 'java' || (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled')) {
			return;
		}
		const key = document.uri.toString();
		const timer = timers.get(key);
		if (typeof timer !== 'undefined') {
			clearTimeout(timer);
		}
		timers.set(key, setTimeout(() => {
			timers.delete(key);
			checkDocument(helper, prelude, collection, document, isEnabled());
		}, delay));
	};

	// 開いているファイルと、これから開くファイルをチェックする
	vscode.workspace.textDocuments.forEach((document) => schedule(document, 0));
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument((document) => schedule(document, 0)),
		vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document, CHECK_DELAY_MS)),
		vscode.workspace.onDidCloseTextDocument((document) => {
			const key = document.uri.toString();
			const timer = timers.get(key);
			if (typeof timer !== 'undefined') {
				clearTimeout(timer);
				timers.delete(key);
			}
			collection.delete(document.uri);
		}),
		// 設定が変わった場合は、開いているファイルをチェックし直す（無効化された場合は表示を消す）
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('JavaCodeSelectionRunner.enable_diagnostics')) {
				vscode.workspace.textDocuments.forEach((document) => schedule(document, 0));
			}
		}),
		{ dispose: () => timers.forEach((timer) => clearTimeout(timer)) }
	);
}


// 1つのファイルをチェックし、結果を表示します。
async function checkDocument(
	helper: AnalysisHelper,
	prelude: string,
	collection: vscode.DiagnosticCollection,
	document: vscode.TextDocument,
	enabled: boolean
) {
	if (document.isClosed) {
		return;
	}

	const text = document.getText();
	if (!enabled || text.length > MAX_CHECK_LENGTH) {
		collection.delete(document.uri);
		return;
	}

	// 実行時と同じく、コード中の全角スペースを半角へ置き換えてからチェックする
	// （文字数は変わらないため、エラーの位置はそのまま使える）
	const version = document.version;
	const code = replaceFullWidthSpace(text);
	const response = await helper.request(
		'check:' + document.uri.toString(),
		'CHECK ' + encodeBase64(prelude) + ' ' + encodeBase64(code),
		RESPONSE_TIMEOUT_MS
	);

	// 応答が得られなかった場合や、チェック中に内容が変わった場合は表示を更新しない
	if (typeof response === 'undefined' || document.isClosed || document.version !== version) {
		return;
	}

	const problems = parseResponse(response);
	if (typeof problems === 'undefined') {
		return;
	}

	collection.set(document.uri, problems.map((problem) => {
		const range = toRange(document, text, problem.start, problem.end);
		const diagnostic = new vscode.Diagnostic(
			range,
			problem.message,
			problem.isError ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
		);
		diagnostic.source = DIAGNOSTIC_SOURCE;
		return diagnostic;
	}));
}


// エラーの位置（文字の位置）から、赤線を引く範囲を求めます。
function toRange(document: vscode.TextDocument, text: string, start: number, end: number): vscode.Range {
	let rangeStart = Math.min(Math.max(start, 0), text.length);
	let rangeEnd = Math.min(Math.max(end, rangeStart), text.length);

	// 位置だけのエラー（「';'がありません」など）は幅が0になり見えにくいため、1文字分に広げる。
	// 行末の場合は直前の1文字を示す。
	if (rangeStart === rangeEnd) {
		const isLineEnd = rangeEnd >= text.length || text[rangeEnd] === '\n' || text[rangeEnd] === '\r';
		if (!isLineEnd) {
			rangeEnd = rangeEnd + 1;
		} else if (rangeStart > 0 && text[rangeStart - 1] !== '\n') {
			rangeStart = rangeStart - 1;
		}
	}

	return new vscode.Range(document.positionAt(rangeStart), document.positionAt(rangeEnd));
}


// ヘルパーからの応答を解釈します。
function parseResponse(response: string): { start: number, end: number, isError: boolean, message: string }[] | undefined {
	if (response !== 'OK' && !response.startsWith('OK ')) {
		// ERR などの応答は、表示を更新しない
		return undefined;
	}

	const problems: { start: number, end: number, isError: boolean, message: string }[] = [];
	for (const part of response.split(' ').slice(1)) {
		if (part === '') {
			continue;
		}
		// 「開始位置<TAB>終了位置<TAB>E または W<TAB>メッセージ」の形式
		const fields = decodeBase64(part).split('\t');
		const start = Number(fields[0]);
		const end = Number(fields[1]);
		if (fields.length < 4 || !Number.isFinite(start) || !Number.isFinite(end)) {
			continue;
		}
		problems.push({ start, end, isError: fields[2] === 'E', message: fields.slice(3).join('\t') });
	}
	return problems;
}
