// ビルド時に、webpack の対象外のファイルを dist へ配置します。
// 対象：解析ヘルパー（入力補完・エラーチェック）のJavaソース
const fs = require('fs');
const path = require('path');

const targets = [
	{ from: path.join(__dirname, '..', 'src', 'java', 'AnalysisHelper.java'),
	  to:   path.join(__dirname, '..', 'dist', 'tools', 'AnalysisHelper.java') }
];

for (const target of targets) {
	fs.mkdirSync(path.dirname(target.to), { recursive: true });
	fs.copyFileSync(target.from, target.to);
	console.log('copied: ' + path.relative(path.join(__dirname, '..'), target.to));
}
