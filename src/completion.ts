// 入力補完（JShell の解析API の呼び出し）に関する処理をまとめたモジュールです。
import * as vscode from 'vscode';
import { AnalysisHelper, encodeBase64, decodeBase64 } from './analysisHelper';

// ヘルパーの応答を待つ上限（ミリ秒）
const RESPONSE_TIMEOUT_MS = 5000;

// 解析対象として送るコードの上限（文字数）
// 大きなファイルでも入力のたびに全文を送らないようにするための制限
const MAX_ANALYZE_LENGTH = 20000;


// 補完機能をVS Codeへ登録します。
export function registerCompletion(context: vscode.ExtensionContext, helper: AnalysisHelper) {

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

				const result = await requestCompletion(helper, code, code.length);
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


// 補完候補を取得します。取得できない場合は undefined を返します。
async function requestCompletion(helper: AnalysisHelper, code: string, cursor: number) {
	const response = await helper.request('complete', 'COMPLETE ' + cursor + ' ' + encodeBase64(code), RESPONSE_TIMEOUT_MS);
	return typeof response === 'undefined' ? undefined : parseResponse(response);
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
		.map((part) => decodeBase64(part));

	return { anchor, suggestions };
}
