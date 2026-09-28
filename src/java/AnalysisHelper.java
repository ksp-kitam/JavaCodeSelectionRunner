// JavaCode Selection Runner の解析ヘルパー
//
// JShell の解析API（jdk.jshell）を使って、入力補完の候補とコードのエラーを返す常駐プロセスです。
// VS Code 拡張機能から標準入出力で呼び出されます。
//
// プロトコル（1行1リクエスト・1行1レスポンス）
//   要求: COMPLETE <カーソル位置> <Base64(UTF-8のコード)> <Base64(事前に読み込むコード)>
//   応答: OK <アンカー位置> <Base64の候補1> <Base64の候補2> ...
//         （事前に読み込むコードは省略可。v1.3.0 以前の形式との互換のため）
//   要求: CHECK <Base64(事前に読み込むコード)> <Base64(チェックするコード)>
//   応答: OK <Base64のエラー1> <Base64のエラー2> ...
//         （エラー1件は「開始位置<TAB>終了位置<TAB>E または W<TAB>メッセージ」）
//   失敗: ERR <Base64のエラーメッセージ>
//   要求: PING            応答: PONG
//   要求: QUIT            応答: なし（終了）
//
// Base64 を使うのは、改行や空白を含むコードを1行で安全にやり取りするためです。

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import jdk.jshell.DeclarationSnippet;
import jdk.jshell.Diag;
import jdk.jshell.JShell;
import jdk.jshell.Snippet;
import jdk.jshell.SnippetEvent;
import jdk.jshell.SourceCodeAnalysis;
import jdk.jshell.SourceCodeAnalysis.Completeness;
import jdk.jshell.SourceCodeAnalysis.CompletionInfo;
import jdk.jshell.SourceCodeAnalysis.Suggestion;
import jdk.jshell.spi.ExecutionControl;
import jdk.jshell.spi.ExecutionControlProvider;
import jdk.jshell.spi.ExecutionEnv;

public class AnalysisHelper {

	// jshell コマンドが起動時に読み込む import（DEFAULT スタートアップと同じもの）
	// 実行時と同じ条件でチェックしないと、Scanner などが「見つからない」と誤判定されるため
	private static final String[] DEFAULT_IMPORTS = {
		"import java.io.*;",
		"import java.math.*;",
		"import java.net.*;",
		"import java.nio.file.*;",
		"import java.util.*;",
		"import java.util.concurrent.*;",
		"import java.util.function.*;",
		"import java.util.prefs.*;",
		"import java.util.regex.*;",
		"import java.util.stream.*;",
	};

	// エラーメッセージの言語
	private static final Locale MESSAGE_LOCALE = Locale.JAPANESE;

	// JShell が補うラッパークラスの位置情報（利用者には意味がないため取り除く）
	private static final Pattern WRAPPER_LOCATION = Pattern.compile("(?m)^\\s*(場所|location):\\s*(クラス|class)\\s*$\\R?");

	// 未解決の参照（例: "method bar(int)"）から名前を取り出すためのパターン
	private static final Pattern UNRESOLVED_NAME = Pattern.compile("^(\\S+)\\s+([\\w$]+)");

	// 補完用のJShell。カーソルより前の宣言を登録した状態で保持し、内容が変わらない間は使い回す
	// （入力のたびに登録し直すと、大きなファイルで補完が遅くなるため）
	private static JShell completionShell;
	// completionShell に登録済みの内容（事前に読み込むコードと、カーソルより前のスニペット）
	private static String completionShellKey;
	// スニペットの切り出し専用のJShell（analyzeCompletion は登録内容に依存しないため共用する）
	private static JShell splitterShell;

	public static void main(String[] args) throws Exception {

		// 入出力は UTF-8 に固定する
		BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
		PrintStream writer = new PrintStream(System.out, true, StandardCharsets.UTF_8);

		String line;
		while ((line = reader.readLine()) != null) {

			if (line.equals("QUIT")) {
				break;
			}
			if (line.equals("PING")) {
				writer.println("PONG");
				continue;
			}

			try {
				if (line.startsWith("COMPLETE ")) {
					String[] parts = line.split(" ", 4);
					int cursor = Integer.parseInt(parts[1]);
					String code = decode(parts[2]);
					String prelude = parts.length > 3 ? decode(parts[3]) : "";
					writer.println(complete(code, cursor, prelude));

				} else if (line.startsWith("CHECK ")) {
					String[] parts = line.split(" ", 3);
					String prelude = decode(parts[1]);
					String code = decode(parts[2]);
					writer.println(check(prelude, code));

				} else {
					writer.println("ERR " + encode("Unknown command."));
				}

			} catch (Exception e) {
				writer.println("ERR " + encode(String.valueOf(e)));
			}
		}

		if (completionShell != null) {
			completionShell.close();
		}
		if (splitterShell != null) {
			splitterShell.close();
		}
	}


	// ===== 入力補完 =====

	// 補完候補を求めて応答文字列を組み立てます。
	// カーソルより前の完結したスニペット（クラス・変数の宣言など）を先にJShellへ登録してから、
	// カーソルを含むスニペットについて候補を求める。
	// （登録しないと、ファイル内で定義したクラスのメンバーなどが候補に出ないため）
	private static String complete(String code, int cursor, String prelude) {

		String target = code.substring(0, Math.min(Math.max(cursor, 0), code.length()));

		// カーソルを含むスニペットの開始位置と、それより前のスニペットを求める
		List<String> precedingSources = new ArrayList<>();
		int snippetStart = splitCompleteSnippets(getSplitterShell().sourceCodeAnalysis(), target, precedingSources);

		SourceCodeAnalysis analysis = getCompletionShell(prelude, precedingSources).sourceCodeAnalysis();

		String snippet = target.substring(snippetStart);
		int[] anchor = new int[1];
		List<Suggestion> suggestions = analysis.completionSuggestions(snippet, snippet.length(), anchor);
		// アンカー位置を元のコード上の位置へ戻す
		anchor[0] = anchor[0] + snippetStart;

		// 候補が得られなかった場合は、カーソル行だけを対象にして再度求める
		// （クラス定義の途中など、スニペット全体では解析できない場合の保険）
		if (suggestions.isEmpty()) {
			int lineStart = target.lastIndexOf('\n', Math.max(target.length() - 1, 0)) + 1;
			if (lineStart > snippetStart && lineStart <= target.length()) {
				String lineCode = target.substring(lineStart);
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

	// コードの先頭から完結したスニペットを切り出して sources へ追加し、
	// 最後の（カーソルを含む）スニペットの開始位置を返します。
	// 文法エラー（UNKNOWN）や途中で終わっているスニペットがあれば、そこを最後のスニペットとみなします。
	private static int splitCompleteSnippets(SourceCodeAnalysis analysis, String code, List<String> sources) {
		int position = 0;
		while (position < code.length()) {
			String rest = code.substring(position);
			CompletionInfo info = analysis.analyzeCompletion(rest);
			Completeness completeness = info.completeness();

			// 残りが空白やコメントだけの場合
			if (completeness == Completeness.EMPTY) {
				return code.length();
			}
			// UNKNOWN（文法エラー）も isComplete() は true を返すため、明示的に除く。
			// 後ろに何も続かないスニペットは、入力中のものとして登録しない。
			if (!completeness.isComplete() || completeness == Completeness.UNKNOWN || info.remaining().isBlank()) {
				break;
			}
			int regionLength = rest.length() - info.remaining().length();
			if (regionLength <= 0) {
				break;
			}
			sources.add(info.source());
			position += regionLength;
		}
		return position;
	}

	// 事前に読み込むコードと、カーソルより前のスニペットを登録した補完用のJShellを返します。
	// 前回と同じ内容であれば、前回のJShellをそのまま使います。
	private static JShell getCompletionShell(String prelude, List<String> precedingSources) {
		String key = prelude + '\0' + String.join("\0", precedingSources);
		if (completionShell != null && key.equals(completionShellKey)) {
			return completionShell;
		}

		if (completionShell != null) {
			completionShell.close();
		}
		completionShell = createNoExecutionShell();
		completionShellKey = key;

		loadDefaults(completionShell, prelude);
		for (String source : precedingSources) {
			completionShell.eval(source);
		}
		return completionShell;
	}

	// スニペットの切り出し専用のJShellを返します。
	private static JShell getSplitterShell() {
		if (splitterShell == null) {
			splitterShell = createNoExecutionShell();
		}
		return splitterShell;
	}


	// ===== 共通 =====

	// コードを実行しない（コンパイルだけ行う）JShellを作ります。
	// 入出力も空にし、万一の出力が応答へ混ざらないようにします。
	private static JShell createNoExecutionShell() {
		PrintStream discard = new PrintStream(OutputStream.nullOutputStream());
		return JShell.builder()
				.executionEngine(new NoExecutionProvider(), Map.of())
				.in(new ByteArrayInputStream(new byte[0]))
				.out(discard)
				.err(discard)
				.build();
	}

	// 実行時と同じ import と便利メソッドを読み込みます（ここでのエラーは報告しない）。
	private static void loadDefaults(JShell jshell, String prelude) {
		for (String defaultImport : DEFAULT_IMPORTS) {
			jshell.eval(defaultImport);
		}
		new Checker(jshell, jshell.sourceCodeAnalysis(), prelude).run();
	}


	// ===== エラーチェック =====

	// コードをコンパイルだけ行い、見つかったエラーを応答文字列にして返します。
	// チェックのたびに新しいJShellを作る（前回までの定義が残って判定が変わらないようにするため）。
	private static String check(String prelude, String code) {

		try (JShell jshell = createNoExecutionShell()) {

			SourceCodeAnalysis analysis = jshell.sourceCodeAnalysis();

			// 実行時と同じ import と便利メソッドを読み込む
			loadDefaults(jshell, prelude);

			Checker checker = new Checker(jshell, analysis, code);
			checker.run();

			List<String> encoded = new ArrayList<>();
			for (String problem : checker.problems) {
				encoded.add(encode(problem));
			}
			return "OK" + (encoded.isEmpty() ? "" : " " + String.join(" ", encoded));
		}
	}


	// コードを1スニペットずつ評価して、エラーを集めます。
	private static class Checker {

		private final JShell jshell;
		private final SourceCodeAnalysis analysis;
		private final String code;

		// 見つかったエラー（「開始位置<TAB>終了位置<TAB>種別<TAB>メッセージ」の形式）
		final List<String> problems = new ArrayList<>();

		// エラーのため定義されなかった名前（後続の「見つからない」エラーを抑えるために使う）
		private final Set<String> rejectedNames = new HashSet<>();

		// 定義したスニペットとその開始位置（最後に未解決の参照を確認するために使う）
		private final List<DeclarationSnippet> declarations = new ArrayList<>();
		private final List<Integer> declarationOffsets = new ArrayList<>();

		Checker(JShell jshell, SourceCodeAnalysis analysis, String code) {
			this.jshell = jshell;
			this.analysis = analysis;
			this.code = code;
		}

		void run() {
			int position = 0;
			while (position < code.length()) {
				String rest = code.substring(position);
				CompletionInfo info = analysis.analyzeCompletion(rest);
				Completeness completeness = info.completeness();

				if (completeness == Completeness.EMPTY) {
					break;
				}

				// UNKNOWN（文法エラー）も isComplete() は true を返すため、明示的に除く
				if (completeness.isComplete() && completeness != Completeness.UNKNOWN) {
					// 完結したスニペット（文・宣言など）を1つ評価して次へ進む
					int regionLength = rest.length() - info.remaining().length();
					if (regionLength <= 0) {
						break;
					}
					String source = info.source();
					int offset = position + findSourceOffset(rest.substring(0, regionLength), source);
					evaluate(source, offset, false);
					position += regionLength;
					continue;
				}

				// 文法エラー（UNKNOWN）または途中で終わっている（INCOMPLETE）場合は、
				// 残り全体を評価して最初のエラーを求める
				int firstError = evaluate(rest, position, true);
				if (completeness != Completeness.UNKNOWN || firstError < 0) {
					break;
				}
				// エラーの後ろにある文から再開する（括弧の対応が取れた行の次から）
				int resume = findResumeOffset(rest, firstError);
				if (resume <= 0) {
					break;
				}
				position += resume;
			}

			reportUnresolved();
		}

		// スニペットを評価し、エラーを記録します。最初のエラーの位置（スニペット内）を返します（無ければ -1）。
		// firstOnly が true の場合は、最初のエラー1件だけを記録します。
		private int evaluate(String source, int offset, boolean firstOnly) {
			int firstError = -1;

			for (SnippetEvent event : jshell.eval(source)) {
				// 他のスニペットの状態変化の通知は対象外
				if (event.causeSnippet() != null) {
					continue;
				}
				Snippet snippet = event.snippet();

				for (Diag diag : jshell.diagnostics(snippet).toList()) {
					int start = (int) diag.getStartPosition();
					if (start < 0) {
						start = Math.max((int) diag.getPosition(), 0);
					}
					int end = Math.max((int) diag.getEndPosition(), start);

					if (isCascadeError(diag, offset + start, offset + end)) {
						continue;
					}
					if (firstOnly && firstError >= 0) {
						continue;
					}
					if (diag.isError() && firstError < 0) {
						firstError = start;
					}
					addProblem(offset + start, offset + end, diag.isError(), diag.getMessage(MESSAGE_LOCALE));
				}

				if (snippet instanceof DeclarationSnippet declaration) {
					if (event.status() == Snippet.Status.REJECTED) {
						rejectedNames.add(declaration.name());
					} else {
						// 同じ名前で定義し直された場合は、以降の参照を通常どおりチェックする
						rejectedNames.remove(declaration.name());
						declarations.add(declaration);
						declarationOffsets.add(offset);
					}
				}
			}
			return firstError;
		}

		// エラーのため定義されなかった名前を参照している「見つからない」エラーかどうかを判定します。
		// （Eclipse と同様に、原因となった宣言側のエラーだけを表示するため）
		private boolean isCascadeError(Diag diag, int start, int end) {
			if (!diag.getCode().startsWith("compiler.err.cant.resolve")) {
				return false;
			}
			if (start < 0 || end > code.length() || start >= end) {
				return false;
			}
			return rejectedNames.contains(code.substring(start, end));
		}

		// 最後まで定義されなかった参照（例: 存在しないメソッドの呼び出し）を報告します。
		// JShell はこれらをエラーにせず保留するが、実行すると失敗するため、エラーとして表示する。
		private void reportUnresolved() {
			for (int i = 0; i < declarations.size(); i++) {
				DeclarationSnippet declaration = declarations.get(i);
				Snippet.Status status = jshell.status(declaration);
				if (status != Snippet.Status.RECOVERABLE_DEFINED && status != Snippet.Status.RECOVERABLE_NOT_DEFINED) {
					continue;
				}

				int offset = declarationOffsets.get(i);
				String maskedSource = maskLiteralsAndComments(declaration.source());

				for (String dependency : jshell.unresolvedDependencies(declaration).toList()) {
					Matcher matcher = UNRESOLVED_NAME.matcher(dependency);
					boolean parsed = matcher.find();
					String kind = parsed ? matcher.group(1) : "";
					String name = parsed ? matcher.group(2) : dependency;

					// エラーのため定義されなかった名前は、宣言側でエラーを表示済み
					if (rejectedNames.contains(name)) {
						continue;
					}

					// 参照している箇所を探す（見つからなければスニペットの先頭を示す）
					Matcher usage = Pattern.compile("(?<![\\w$])" + Pattern.quote(name) + "(?![\\w$])").matcher(maskedSource);
					boolean found = usage.find();
					int start = found ? usage.start() : 0;
					int end = found ? usage.end() : Math.min(1, maskedSource.length());

					String symbol = parsed ? translateKind(kind) + " " + dependency.substring(kind.length()).strip() : dependency;
					String message = "シンボルを見つけられません\n  シンボル:   " + symbol;
					addProblem(offset + start, offset + end, true, message);
				}
			}
		}

		private void addProblem(int start, int end, boolean isError, String message) {
			// 末尾の「:」は詳細が続く場合の区切りで、単独では不要なため取り除く
			String cleaned = WRAPPER_LOCATION.matcher(message).replaceAll("").strip().replaceFirst(":$", "");
			problems.add(start + "\t" + end + "\t" + (isError ? "E" : "W") + "\t" + cleaned);
		}
	}

	// analyzeCompletion が返したソースが、切り出した範囲のどこから始まるかを求めます。
	// （末尾のセミコロンが補われている場合があるため、その場合は除いて探す）
	private static int findSourceOffset(String region, String source) {
		int index = region.indexOf(source);
		if (index < 0 && source.endsWith(";")) {
			index = region.indexOf(source.substring(0, source.length() - 1));
		}
		return Math.max(index, 0);
	}

	// 文法エラーの後、チェックを再開する位置を求めます。
	// エラーのある行以降で、波括弧の対応が取れた（深さ0の）行の次の行頭を返します。見つからなければ -1。
	private static int findResumeOffset(String code, int errorPosition) {
		String masked = maskLiteralsAndComments(code);
		int depth = 0;
		for (int i = 0; i < masked.length(); i++) {
			char current = masked.charAt(i);
			if (current == '{') {
				depth++;
			} else if (current == '}') {
				depth--;
			} else if (current == '\n' && i >= errorPosition && depth <= 0) {
				return i + 1;
			}
		}
		return -1;
	}

	// 未解決の参照の種類を日本語にします（javac のメッセージに合わせる）。
	private static String translateKind(String kind) {
		switch (kind) {
			case "method": return "メソッド";
			case "variable": return "変数";
			case "class": return "クラス";
			case "interface": return "インタフェース";
			case "enum": return "列挙型";
			case "record": return "レコード";
			default: return kind;
		}
	}

	// 文字列リテラル・文字リテラル・コメントの中身を空白へ置き換えた文字列を返します。
	// （括弧の対応や名前を探す際に、リテラルやコメント内の文字を誤って拾わないようにするため）
	// 文字数と改行の位置は元のコードと同じに保ちます。
	private static String maskLiteralsAndComments(String code) {
		StringBuilder result = new StringBuilder(code.length());
		// 0: コード / 1: 文字列 / 2: 文字 / 3: テキストブロック / 4: 行コメント / 5: ブロックコメント
		int state = 0;
		for (int i = 0; i < code.length(); i++) {
			char current = code.charAt(i);
			char next = i + 1 < code.length() ? code.charAt(i + 1) : '\0';
			char masked = (current == '\n' || current == '\r') ? current : ' ';

			switch (state) {
				case 0:
					if (code.startsWith("\"\"\"", i)) { state = 3; result.append("   "); i += 2; }
					else if (current == '"') { state = 1; result.append(' '); }
					else if (current == '\'') { state = 2; result.append(' '); }
					else if (current == '/' && next == '/') { state = 4; result.append("  "); i++; }
					else if (current == '/' && next == '*') { state = 5; result.append("  "); i++; }
					else { result.append(current); }
					break;
				case 1:
				case 2:
					// エスケープシーケンスは2文字まとめて伏せる
					if (current == '\\' && i + 1 < code.length()) { result.append(' ').append(next == '\n' ? '\n' : ' '); i++; break; }
					if ((state == 1 && current == '"') || (state == 2 && current == '\'')) { state = 0; }
					// 閉じ忘れの場合、行末でリテラルを終わらせる（javac と同じ扱い）
					if (current == '\n') { state = 0; }
					result.append(masked);
					break;
				case 3:
					if (code.startsWith("\"\"\"", i)) { state = 0; result.append("   "); i += 2; }
					else { result.append(masked); }
					break;
				case 4:
					if (current == '\n') { state = 0; }
					result.append(masked);
					break;
				default:
					if (current == '*' && next == '/') { state = 0; result.append("  "); i++; }
					else { result.append(masked); }
					break;
			}
		}
		return result.toString();
	}

	private static String encode(String value) {
		return Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8));
	}

	private static String decode(String value) {
		return new String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8);
	}


	// ===== コードを実行しない実行エンジン =====
	// エラーチェックではコードをコンパイルするだけで、実行はしない。
	// （入力待ちや無限ループ、ファイル操作などが、編集中に動いてしまうのを防ぐため）

	private static class NoExecutionProvider implements ExecutionControlProvider {
		@Override
		public String name() {
			return "no-execution";
		}

		@Override
		public ExecutionControl generate(ExecutionEnv env, Map<String, String> parameters) {
			return new NoExecutionControl();
		}
	}

	private static class NoExecutionControl implements ExecutionControl {
		@Override public void load(ClassBytecodes[] classes) { }
		@Override public void redefine(ClassBytecodes[] classes) { }
		@Override public String invoke(String className, String methodName) { return ""; }
		@Override public String varValue(String className, String variableName) { return ""; }
		@Override public void addToClasspath(String path) { }
		@Override public void stop() { }
		@Override public Object extensionCommand(String command, Object argument) throws NotImplementedException {
			throw new NotImplementedException("extensionCommand: " + command);
		}
		@Override public void close() { }
	}
}
