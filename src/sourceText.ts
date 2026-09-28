// 実行用スクリプトの組み立てに使うコードと変換処理をまとめたモジュールです。
// 実行（extension.ts）とエラーチェック（diagnostics.ts）で同じ内容を使い、判定を食い違わせないために共用します。


// 実行時にあらかじめ定義しておく便利メソッドのコードを返します。
// inputCharset は標準入力の文字コード、eol は改行コードです。
export function buildHelperMethods(inputCharset: string, eol: string): string {
	let text = '';
	text = text + 'String input() { ' + eol;
	text = text + '    System.out.print("入力してEnterを押してください > ");' + eol;
	text = text + '    Scanner in = new Scanner(System.in, "' + inputCharset + '"); ' + eol;
	text = text + '    return in.nextLine(); ' + eol;
	text = text + '} ' + eol;
	text = text + 'char inputToChar() { ' + eol;
	text = text + '    return input().charAt(0); ' + eol;
	text = text + '} ' + eol;
	text = text + 'int inputToInt() { ' + eol;
	text = text + '    return Integer.parseInt(input()); ' + eol;
	text = text + '} ' + eol;
	text = text + 'double inputToDouble() { ' + eol;
	text = text + '    return Double.parseDouble(input()); ' + eol;
	text = text + '} ' + eol;
	text = text + 'long inputToLong() { ' + eol;
	text = text + '    return Long.parseLong(input()); ' + eol;
	text = text + '} ' + eol;
	text = text + 'float inputToFloat() { ' + eol;
	text = text + '    return Float.parseFloat(input()); ' + eol;
	text = text + '} ' + eol;
	text = text + 'short inputToShort() { ' + eol;
	text = text + '    return Short.parseShort(input()); ' + eol;
	text = text + '} ' + eol;
	text = text + 'int makeRandomValue(int start, int end) { ' + eol;
	text = text + '    java.util.Random rand = new java.util.Random(); ' + eol;
	text = text + '    return (rand.nextInt(end - start + 1) + start); ' + eol;
	text = text + '} ' + eol;
	return text;
}


// 文字列リテラル・文字リテラルを除いた範囲の全角スペースを半角スペースへ置換します。
// （コード中の全角スペースはJavaの文法上エラーとなるため置換するが、
// 　リテラル内の全角スペースは実行結果が変わってしまうため、そのまま残す）
// 1文字を1文字へ置き換えるため、置換後も文字の位置は変わりません（エラー位置の表示に利用している）。
export function replaceFullWidthSpace(code: string) {
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
