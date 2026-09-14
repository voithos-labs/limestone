import { parse } from 'acorn';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'build/_app/immutable';
const LOOKBEHIND = /\(\?<[=!]/;
const CSS_FEATURES = [
	[/@container\b/, 'container query'],
	[/\d(?:cqw|cqh|cqi|cqb|cqmin|cqmax)\b/, 'container unit'],
	[/color-mix\(/, 'color-mix outside @supports']
];

function list(dir, ext) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
		d.isDirectory() ? list(join(dir, d.name), ext) : d.name.endsWith(ext) ? [join(dir, d.name)] : []
	);
}

function withoutSupportsBlocks(css) {
	let out = '';
	let i = 0;
	while (i < css.length) {
		const at = css.indexOf('@supports', i);
		if (at === -1) return out + css.slice(i);
		out += css.slice(i, at);
		let j = css.indexOf('{', at);
		let depth = 0;
		for (; j < css.length; j++) {
			if (css[j] === '{') depth++;
			else if (css[j] === '}' && --depth === 0) break;
		}
		i = j + 1;
	}
	return out;
}

function walk(node, visit) {
	visit(node);
	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const v of value) if (v && typeof v.type === 'string') walk(v, visit);
		} else if (value && typeof value.type === 'string') {
			walk(value, visit);
		}
	}
}

const failures = [];
for (const file of list(DIR, '.css')) {
	const css = withoutSupportsBlocks(readFileSync(file, 'utf8'));
	for (const [pattern, what] of CSS_FEATURES) {
		const m = pattern.exec(css);
		if (m) failures.push(`${file}: ${what} near "${css.slice(m.index, m.index + 40)}"`);
	}
}
for (const file of list(DIR, '.js')) {
	const src = readFileSync(file, 'utf8');
	let ast;
	try {
		ast = parse(src, { ecmaVersion: 2022, sourceType: 'module', locations: true });
	} catch (e) {
		failures.push(`${file}: ${e.message}`);
		continue;
	}
	const at = (node, what) => `${file}:${node.loc.start.line}:${node.loc.start.column} ${what}`;
	walk(ast, (n) => {
		if (n.type === 'StaticBlock') failures.push(at(n, 'class static block'));
		else if (
			n.type === 'BinaryExpression' &&
			n.operator === 'in' &&
			n.left.type === 'PrivateIdentifier'
		)
			failures.push(at(n, 'private `in` check'));
		else if (n.type === 'Literal' && n.regex && LOOKBEHIND.test(n.regex.pattern))
			failures.push(at(n, 'regex lookbehind'));
	});
}

if (failures.length) {
	console.error(`bundle uses syntax unsupported by the oldest targeted WebKit (Safari 15):`);
	for (const f of failures.slice(0, 20)) console.error(`  ${f}`);
	if (failures.length > 20) console.error(`  ...and ${failures.length - 20} more`);
	process.exit(1);
}
console.log(`bundle compat ok`);
