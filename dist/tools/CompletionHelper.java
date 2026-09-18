// JavaCode Selection Runner の入力補完ヘルパー
//
// JShell の解析API（jdk.jshell の SourceCodeAnalysis）を使って補完候補を返す常駐プロセスです。
// VS Code 拡張機能から標準入出力で呼び出されます。
//
// プロトコル（1行1リクエスト・1行1レスポンス）
//   要求: COMPLETE <カーソル位置> <Base64(UTF-8のコード)>
//   応答: OK <アンカー位置> <Base64の候補1> <Base64の候補2> ...
//         ERR <Base64のエラーメッセージ>
//   要求: PING            応答: PONG
//   要求: QUIT            応答: なし（終了）
//
// Base64 を使うのは、改行や空白を含むコードを1行で安全にやり取りするためです。

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import jdk.jshell.JShell;
import jdk.jshell.SourceCodeAnalysis;
import jdk.jshell.SourceCodeAnalysis.Suggestion;

public class CompletionHelper {

	public static void main(String[] args) throws Exception {

		// 入出力は UTF-8 に固定する
		BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
		PrintStream writer = new PrintStream(System.out, true, StandardCharsets.UTF_8);

		// 解析専用のJShellを起動する（コードの実行は行わない）
		// executionEngine に local を指定し、実行用の別プロセスを起動しないようにする
		JShell jshell = JShell.builder().executionEngine("local").build();
		SourceCodeAnalysis analysis = jshell.sourceCodeAnalysis();

		String line;
		while ((line = reader.readLine()) != null) {

			if (line.equals("QUIT")) {
				break;
			}
			if (line.equals("PING")) {
				writer.println("PONG");
				continue;
			}
			if (!line.startsWith("COMPLETE ")) {
				writer.println("ERR " + encode("Unknown command."));
				continue;
			}

			try {
				String[] parts = line.split(" ", 3);
				int cursor = Integer.parseInt(parts[1]);
				String code = decode(parts[2]);

				writer.println(complete(analysis, code, cursor));

			} catch (Exception e) {
				writer.println("ERR " + encode(String.valueOf(e)));
			}
		}

		jshell.close();
	}

	// 補完候補を求めて応答文字列を組み立てます。
	private static String complete(SourceCodeAnalysis analysis, String code, int cursor) {

		int[] anchor = new int[1];
		List<Suggestion> suggestions = analysis.completionSuggestions(code, cursor, anchor);

		// 候補が得られなかった場合は、カーソル行だけを対象にして再度求める
		// （クラス定義の途中など、ファイル全体では解析できない場合の保険）
		if (suggestions.isEmpty()) {
			int lineStart = code.lastIndexOf('\n', Math.max(cursor - 1, 0)) + 1;
			if (lineStart > 0 && lineStart <= cursor) {
				String lineCode = code.substring(lineStart, cursor);
				anchor = new int[1];
				suggestions = analysis.completionSuggestions(lineCode, lineCode.length(), anchor);
				// アンカー位置を元のコード上の位置へ戻す
				anchor[0] = anchor[0] + lineStart;
			}
		}

		// 同じ候補が重複することがあるため、順序を保ったまま重複を除去する
		Set<String> uniqueSuggestions = new LinkedHashSet<>();
		for (Suggestion suggestion : suggestions) {
			uniqueSuggestions.add(suggestion.continuation());
		}

		List<String> encoded = new ArrayList<>();
		for (String suggestion : uniqueSuggestions) {
			encoded.add(encode(suggestion));
		}

		return "OK " + anchor[0] + (encoded.isEmpty() ? "" : " " + String.join(" ", encoded));
	}

	private static String encode(String value) {
		return Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8));
	}

	private static String decode(String value) {
		return new String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8);
	}
}
