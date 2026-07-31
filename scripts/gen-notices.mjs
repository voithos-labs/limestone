// ── GENERATE NOTICES ─────────────────────────────────────────────────────────────────
/*

Neat and cool script to generate notices file for o-s licenses

To run:

npm run notices

=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~

And she forgot the stars, the moon, and sun,
	And she forgot the blue above the trees,
And she forgot the dells where waters run,
	And she forgot the chilly autumn breeze
She had no knowledge when the day was done,
	And the new morn she saw not: but in peace
Hung over her sweet Basil evermore,
And moisten'd it with tears unto the core.

- Keats :: Isabella, or the Pot of Basil

=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~=~

*/

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'THIRD-PARTY-NOTICES.txt');
const OUT_JSON = join(ROOT, 'static', 'third-party-notices.json');

const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)/i;
const COPYRIGHT_LINE = /^\s*(copyright\b|©)/i;

function isCopyrightLine(line) {
	const t = line.trim();
	if (t.length > 300) return false;
	if (COPYRIGHT_LINE.test(t)) return /\b\d{4}\b/.test(t) || /\(c\)|©/i.test(t);
	return /^\(c\)\s+\d{4}\b/i.test(t);
}
const PREFERENCE = [
	'MIT',
	'MIT-0',
	'ISC',
	'0BSD',
	'BSD-2-Clause',
	'BSD-3-Clause',
	'Zlib',
	'Unlicense',
	'CC0-1.0',
	'BSL-1.0',
	'Apache-2.0',
	'Unicode-3.0',
	'MPL-2.0',
	'CDLA-Permissive-2.0'
];

const bodies = new Map();
const bodyLicenses = new Map();

function licenseFilesIn(dir) {
	if (!dir || !existsSync(dir)) return [];
	const out = [];
	for (const name of readdirSync(dir)) {
		if (!LICENSE_FILE.test(name)) continue;
		const full = join(dir, name);
		try {
			if (!statSync(full).isFile()) continue;
			const text = readFileSync(full, 'utf8').trim();
			if (text) out.push({ name, text });
		} catch {}
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

function splitExpression(expr) {
	if (!expr) return [];
	return expr
		.split(/\s+OR\s+|\s*\/\s*|\s+AND\s+/i)
		.map((s) => s.trim().replace(/^\(|\)$/g, ''))
		.filter(Boolean);
}

function pickLicense(expr) {
	const parts = splitExpression(expr);
	if (!parts.length) return null;
	for (const pref of PREFERENCE) {
		if (parts.includes(pref)) return pref;
	}
	return parts[0];
}

function detectSpdx(text) {
	const head = text.slice(0, 4000);
	if (/Apache License\s*\n?\s*Version 2\.0/i.test(head)) return 'Apache-2.0';
	if (/Mozilla Public License Version 2\.0/i.test(head)) return 'MPL-2.0';
	if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(head)) return 'LGPL';
	if (/SIL OPEN FONT LICENSE/i.test(head) || /\bFont Software\b/.test(head)) return 'OFL-1.1';
	if (/Permission is hereby granted, free of charge/i.test(head)) return 'MIT';
	if (/Permission to use, copy, modify, and(\/or)? distribute/i.test(head)) return 'ISC';
	if (/Redistribution and use in source and binary forms/i.test(head)) {
		return /neither the name/i.test(head) ? 'BSD-3-Clause' : 'BSD-2-Clause';
	}
	if (/This software is provided 'as-is'/i.test(head)) return 'Zlib';
	if (/CC0 1\.0/i.test(head)) return 'CC0-1.0';
	if (/This is free and unencumbered software/i.test(head)) return 'Unlicense';
	return null;
}

function registerText(text, fallbackId) {
	const copyrights = [];
	const bodyLines = [];
	for (const line of text.split(/\r?\n/)) {
		if (isCopyrightLine(line)) copyrights.push(line.trim());
		else bodyLines.push(line);
	}
	const body = bodyLines
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	const norm = body.toLowerCase().replace(/\s+/g, ' ');
	const id = `L-${createHash('sha1').update(norm).digest('hex').slice(0, 8)}`;
	if (!bodies.has(id)) bodies.set(id, body);
	const label = detectSpdx(text) || fallbackId;
	if (label) {
		if (!bodyLicenses.has(id)) bodyLicenses.set(id, new Set());
		bodyLicenses.get(id).add(label);
	}
	return { id, copyrights: [...new Set(copyrights)] };
}

const MIT_BODY = `MIT License

Copyright (c) <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

function resolveTexts(item) {
	if (item.files.length) {
		return item.files.map((f) => registerText(f.text, item.chosen));
	}
	if (item.chosen === 'MIT') {
		const reg = registerText(MIT_BODY, 'MIT');
		return [{ id: reg.id, copyrights: item.holders ? [`Copyright (c) ${item.holders}`] : [] }];
	}
	const existing = [...bodyLicenses.entries()].find(([, set]) => set.has(item.chosen))?.[0];
	if (existing) {
		return [{ id: existing, copyrights: item.holders ? [`Copyright (c) ${item.holders}`] : [] }];
	}
	return [];
}

function collectRust() {
	const raw = execFileSync(
		'cargo',
		['metadata', '--manifest-path', 'src-tauri/Cargo.toml', '--format-version', '1'],
		{ cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
	);
	const meta = JSON.parse(raw);
	return meta.packages
		.filter((p) => p.name !== 'limestone')
		.map((p) => ({
			name: p.name,
			version: p.version,
			expression: p.license || null,
			chosen: pickLicense(p.license),
			holders: (p.authors || []).join(', '),
			url: p.repository || p.homepage || null,
			files: licenseFilesIn(dirname(p.manifest_path))
		}))
		.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function collectNpm() {
	const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
	const items = [];
	for (const [path, meta] of Object.entries(lock.packages || {})) {
		if (!path || meta.dev) continue;
		const dir = join(ROOT, path);
		let pkg = {};
		const pj = join(dir, 'package.json');
		if (existsSync(pj)) {
			try {
				pkg = JSON.parse(readFileSync(pj, 'utf8'));
			} catch {}
		}
		let expression = pkg.license ?? meta.license ?? null;
		if (expression && typeof expression === 'object') expression = expression.type;
		if (Array.isArray(expression)) expression = expression.join(' OR ');
		const author =
			typeof pkg.author === 'string' ? pkg.author : (pkg.author && pkg.author.name) || '';
		let url = pkg.repository && (pkg.repository.url || pkg.repository);
		if (typeof url !== 'string') url = null;
		items.push({
			name: pkg.name || path.replace(/^node_modules\//, ''),
			version: pkg.version || meta.version || '',
			expression: expression || null,
			chosen: pickLicense(expression),
			holders: author,
			url: url || pkg.homepage || meta.resolved || null,
			files: licenseFilesIn(dir)
		});
	}
	return items.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function renderItem(item) {
	const refs = item.refs;
	const lines = [`${item.name} ${item.version}`];
	if (item.expression) lines.push(`  License: ${item.expression}`);
	if (item.url)
		lines.push(
			`  Source:  ${String(item.url)
				.replace(/^git\+/, '')
				.replace(/\.git$/, '')}`
		);
	for (const c of item.copyrights) lines.push(`  ${c}`);
	if (refs.length) {
		lines.push(`  Full text: ${refs.map((r) => `[${r.id}]`).join(' ')}`);
	} else {
		lines.push(`  Full text: see the source listed above`);
	}
	return lines.join('\n');
}

function cleanUrl(url) {
	return url
		? String(url)
				.replace(/^git\+/, '')
				.replace(/\.git$/, '')
		: null;
}

function toJson(item, ecosystem) {
	return {
		ecosystem,
		name: item.name,
		version: item.version,
		license: item.expression,
		source: cleanUrl(item.url),
		copyrights: item.copyrights,
		texts: item.refs.map((r) => r.id)
	};
}

function main() {
	const rust = collectRust();
	const npm = collectNpm();
	for (const item of [...rust, ...npm]) {
		item.refs = resolveTexts(item);
		item.copyrights = [...new Set(item.refs.flatMap((r) => r.copyrights))];
	}
	const rustRendered = rust.map(renderItem);
	const npmRendered = npm.map(renderItem);

	const ids = [...bodies.keys()].sort();
	const out = [
		'THIRD-PARTY SOFTWARE NOTICES',
		'',
		'Limestone incorporates the third-party components listed below. Each remains the',
		'property of its respective owners and is used under the license shown with it.',
		'',
		'Each entry names the component, its license, its copyright holders, and a tag',
		'such as [L-1a2b3c4d] pointing to the full license text in the appendix. Tags are',
		'shared because many components ship identical license text. The authoritative',
		'license for a component is the one on its own License line.',
		'',
		'This file is generated. To refresh it, run: npm run notices',
		'',
		`Rust crates:   ${rust.length}`,
		`npm packages:  ${npm.length}`,
		`License texts: ${ids.length}`,
		'',
		'='.repeat(78),
		'RUST CRATES',
		'='.repeat(78),
		'',
		rustRendered.join('\n\n'),
		'',
		'='.repeat(78),
		'NPM PACKAGES',
		'='.repeat(78),
		'',
		npmRendered.join('\n\n'),
		'',
		'='.repeat(78),
		'APPENDIX: FULL LICENSE TEXTS',
		'='.repeat(78),
		'',
		ids
			.map((id) => {
				const labels = [...(bodyLicenses.get(id) || [])].sort().join(', ');
				const head = labels ? `[${id}]  ${labels}` : `[${id}]`;
				return `${'-'.repeat(78)}\n${head}\n${'-'.repeat(78)}\n\n${bodies.get(id)}\n`;
			})
			.join('\n')
	].join('\n');

	writeFileSync(OUT, out + '\n', 'utf8');

	const texts = {};
	for (const id of ids) {
		texts[id] = { labels: [...(bodyLicenses.get(id) || [])].sort(), body: bodies.get(id) };
	}
	writeFileSync(
		OUT_JSON,
		JSON.stringify({
			counts: { rust: rust.length, npm: npm.length, texts: ids.length },
			components: [...rust.map((i) => toJson(i, 'rust')), ...npm.map((i) => toJson(i, 'npm'))],
			texts
		}),
		'utf8'
	);

	console.log(`wrote ${OUT}`);
	console.log(`wrote ${OUT_JSON}`);
	console.log(`  rust crates:   ${rust.length}`);
	console.log(`  npm packages:  ${npm.length}`);
	console.log(`  license texts: ${ids.length}`);
	const bare = [...rust, ...npm].filter((i) => !i.refs.length);
	console.log(
		bare.length
			? `  NO LICENSE TEXT (${bare.length}): ${bare.map((i) => i.name).join(', ')}`
			: '  every component has license text'
	);
}

main();
