use std::ops::Range;

#[derive(Debug, PartialEq)]
struct WikiLink {
    target: Range<usize>,
}

#[derive(Debug, PartialEq)]
struct Tag {
    hash: usize,
    name: Range<usize>,
}

// lowercase, no trailing slash, as Obsidian reads them; a leading slash is part of the name.
// A tag of only slashes folds to nothing, since "/" alone would be the source root's prop key
pub fn fold_tag(tag: &str) -> String {
    let t = tag.trim_end_matches('/');
    if t.chars().all(|c| c == '/') {
        return String::new();
    }
    t.to_lowercase()
}

pub fn same_tag(a: &str, b: &str) -> bool {
    fold_tag(a) == fold_tag(b)
}

pub fn scan_tags(body: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for span in prose_spans(body) {
        for tag in tags_in(body, span) {
            let name = &body[tag.name];
            if !out.iter().any(|t| same_tag(t, name)) {
                out.push(name.to_string());
            }
        }
    }
    out
}

pub fn tag_mentions(body: &str) -> Vec<String> {
    prose_spans(body)
        .into_iter()
        .flat_map(|span| tags_in(body, span))
        .map(|tag| body[tag.name].to_string())
        .collect()
}

pub fn merge_body_tags(tags: &mut Vec<String>, body: &str) {
    for tag in scan_tags(body) {
        if !tags.iter().any(|t| same_tag(t, &tag)) {
            tags.push(tag);
        }
    }
}

pub fn rewrite_links(body: &str, replacements: &[(String, String)]) -> Option<String> {
    let mut edits: Vec<(Range<usize>, &str)> = Vec::new();
    for span in prose_spans(body) {
        for link in links_in(body, span) {
            let written = normalize_target(&body[link.target.clone()]);
            if let Some((_, new)) = replacements
                .iter()
                .find(|(old, _)| normalize_target(old) == written)
            {
                edits.push((link.target, new));
            }
        }
    }
    apply_edits(body, edits)
}

pub fn rewrite_tags(body: &str, old: &str, new: Option<&str>) -> Option<String> {
    let mut edits: Vec<(Range<usize>, &str)> = Vec::new();
    for span in prose_spans(body) {
        for tag in tags_in(body, span) {
            if !same_tag(&body[tag.name.clone()], old) {
                continue;
            }
            match new {
                Some(new) => edits.push((tag.name, new)),
                None => edits.push((tag.hash..tag.name.start, "")),
            }
        }
    }
    apply_edits(body, edits)
}

fn apply_edits(body: &str, edits: Vec<(Range<usize>, &str)>) -> Option<String> {
    if edits.is_empty() {
        return None;
    }
    let mut out = String::with_capacity(body.len());
    let mut at = 0;
    for (range, text) in edits {
        out.push_str(&body[at..range.start]);
        out.push_str(text);
        at = range.end;
    }
    out.push_str(&body[at..]);
    Some(out)
}

fn normalize_target(target: &str) -> String {
    let t = target.trim().replace('\\', "/");
    let t = t.strip_prefix("./").unwrap_or(&t);
    let t = match t.char_indices().rev().nth(2) {
        Some((i, _)) if t[i..].eq_ignore_ascii_case(".md") => &t[..i],
        _ => t,
    };
    t.to_lowercase()
}

fn prose_spans(body: &str) -> Vec<Range<usize>> {
    let mut spans = Vec::new();
    let mut fence: Option<(u8, usize)> = None;
    let mut at = 0;
    for line in body.split_inclusive('\n') {
        let start = at;
        at += line.len();
        let text = line.trim_end_matches(['\n', '\r']);
        let indented = text.trim_start_matches(' ');
        if text.len() - indented.len() <= 3 {
            if let Some(run) = fence_run(indented) {
                match fence {
                    Some((ch, len)) if run.0 == ch && run.1 >= len && run.2 => {
                        fence = None;
                        continue;
                    }
                    Some(_) => {}
                    None => {
                        fence = Some((run.0, run.1));
                        continue;
                    }
                }
            }
        }
        if fence.is_some() {
            continue;
        }
        code_free_segments(text, start, &mut spans);
    }
    spans
}

fn fence_run(line: &str) -> Option<(u8, usize, bool)> {
    let ch = *line.as_bytes().first()?;
    if ch != b'`' && ch != b'~' {
        return None;
    }
    let len = line.bytes().take_while(|&b| b == ch).count();
    if len < 3 {
        return None;
    }
    let rest = &line[len..];
    if ch == b'`' && rest.contains('`') {
        return None;
    }
    Some((ch, len, rest.trim().is_empty()))
}

fn code_free_segments(line: &str, base: usize, out: &mut Vec<Range<usize>>) {
    let bytes = line.as_bytes();
    let mut seg_start = 0;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'`' {
            i += 1;
            continue;
        }
        let run = bytes[i..].iter().take_while(|&&b| b == b'`').count();
        let close = find_backtick_run(bytes, i + run, run);
        match close {
            Some(close) => {
                if i > seg_start {
                    out.push(base + seg_start..base + i);
                }
                i = close + run;
                seg_start = i;
            }
            None => i += run,
        }
    }
    if bytes.len() > seg_start {
        out.push(base + seg_start..base + bytes.len());
    }
}

fn find_backtick_run(bytes: &[u8], from: usize, len: usize) -> Option<usize> {
    let mut i = from;
    while i < bytes.len() {
        if bytes[i] != b'`' {
            i += 1;
            continue;
        }
        let run = bytes[i..].iter().take_while(|&&b| b == b'`').count();
        if run == len {
            return Some(i);
        }
        i += run;
    }
    None
}

fn links_in(body: &str, span: Range<usize>) -> Vec<WikiLink> {
    let text = &body[span.clone()];
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(rel) = text[from..].find("[[") {
        let open = from + rel + 2;
        let Some(close_rel) = text[open..].find("]]") else {
            break;
        };
        let close = open + close_rel;
        let inner = &text[open..close];
        if inner.contains('[') {
            from = open;
            continue;
        }
        let target_end = inner.find(['|', '#']).unwrap_or(inner.len());
        let raw = &inner[..target_end];
        let lead = raw.len() - raw.trim_start().len();
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let start = span.start + open + lead;
            out.push(WikiLink {
                target: start..start + trimmed.len(),
            });
        }
        from = close + 2;
    }
    out
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-' || c == '/'
}

fn tags_in(body: &str, span: Range<usize>) -> Vec<Tag> {
    let text = &body[span.clone()];
    let mut out = Vec::new();
    for (i, c) in text.char_indices() {
        if c != '#' {
            continue;
        }
        let preceded_ok = text[..i]
            .chars()
            .next_back()
            .is_none_or(|p| p.is_whitespace() || p == '(');
        if !preceded_ok {
            continue;
        }
        let name_start = i + 1;
        let name_len = text[name_start..]
            .char_indices()
            .find(|(_, c)| !is_tag_char(*c))
            .map(|(j, _)| j)
            .unwrap_or(text.len() - name_start);
        let name = text[name_start..name_start + name_len].trim_end_matches('/');
        if name.is_empty() || name.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        out.push(Tag {
            hash: span.start + i,
            name: span.start + name_start..span.start + name_start + name.len(),
        });
    }
    out
}

/// index referenced assets
pub fn scan_asset_refs(body: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for span in prose_spans(body) {
        let text = &body[span];
        let mut i = 0;
        while let Some(off) = text[i..].find("![") {
            let start = i + off;
            let after = start + 2;
            let embed = text[after..]
                .starts_with('[')
                .then(|| wiki_embed(&text[after + 1..]).map(|(t, len)| (t, after + 1 + len)))
                .flatten();
            let parsed =
                embed.or_else(|| md_image(&text[after..]).map(|(t, len)| (t, after + len)));
            let Some((target, end)) = parsed else {
                i = after;
                continue;
            };
            if !target.is_empty() && !out.contains(&target) {
                out.push(target);
            }
            i = end;
        }
    }
    out
}

fn wiki_embed(rest: &str) -> Option<(String, usize)> {
    let close = rest.find("]]")?;
    let inner = &rest[..close];
    if inner.contains('[') {
        return None;
    }
    if rest[close + 2..].starts_with('(') {
        return None;
    }
    let target = inner.split('|').next().unwrap_or("").trim();
    Some((target.to_string(), close + 2))
}

fn alt_end(rest: &str) -> Option<usize> {
    let mut depth = 0usize;
    for (i, c) in rest.char_indices() {
        match c {
            '[' => depth += 1,
            ']' if depth == 0 => return Some(i),
            ']' => depth -= 1,
            '\n' => return None,
            _ => {}
        }
    }
    None
}

fn md_image(rest: &str) -> Option<(String, usize)> {
    let close = alt_end(rest)?;
    let after = close + 1;
    if !rest[after..].starts_with('(') {
        return None;
    }
    let paren = &rest[after + 1..];
    let (dest, len) = if let Some(angled) = paren.strip_prefix('<') {
        let e = angled.find('>')?;
        (&angled[..e], e + 2)
    } else {
        let e = paren
            .find(|c: char| c == ')' || c.is_whitespace())
            .unwrap_or(paren.len());
        (&paren[..e], e)
    };
    let end = paren[len..].find(')')?;
    Some((percent_decode(dest), after + 1 + len + end + 1))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn has_scheme(target: &str) -> bool {
    let Some(colon) = target.find(':') else {
        return false;
    };
    let head = &target[..colon];
    head.starts_with(|c: char| c.is_ascii_alphabetic())
        && head
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
}

pub fn is_asset_path(path: &str) -> bool {
    match path.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !stem.ends_with('/') => {
            !ext.is_empty() && !ext.contains('/') && !ext.eq_ignore_ascii_case("md")
        }
        _ => false,
    }
}

pub fn asset_rel_path(target: &str, asset_location: &str) -> Option<String> {
    if has_scheme(target) {
        return None;
    }
    let clean = target.replace('\\', "/");
    let clean = clean
        .strip_prefix("./")
        .or_else(|| clean.strip_prefix('/'))
        .unwrap_or(&clean);
    if !is_asset_path(clean) {
        return None;
    }
    let loc = asset_location.trim_matches('/');
    Some(if clean.contains('/') || loc.is_empty() {
        clean.to_string()
    } else {
        format!("{loc}/{clean}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repl(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(a, b)| (a.to_string(), b.to_string()))
            .collect()
    }

    #[test]
    fn tags_basic() {
        assert_eq!(
            scan_tags("a #one, (#two) #three/nested #1 x#no https://x.com/#frag"),
            vec!["one", "two", "three/nested"]
        );
    }

    #[test]
    fn tags_skip_code_and_headings() {
        let body = "# Heading\n`#code` and ``#more`` #real\n```\n#fenced\n```\n#after";
        assert_eq!(scan_tags(body), vec!["real", "after"]);
    }

    #[test]
    fn tags_dedupe_case_insensitive() {
        assert_eq!(scan_tags("#Foo #foo #FOO"), vec!["Foo"]);
    }

    #[test]
    fn tags_unicode() {
        assert_eq!(scan_tags("#café #日本語"), vec!["café", "日本語"]);
    }

    #[test]
    fn links_rewrite_forms() {
        let body = "[[Old]] [[Old|alias]] [[Old#h]] [[old.md]] [[./Old]] ![[Old]] [[Other]]";
        let out = rewrite_links(body, &repl(&[("Old", "New")])).unwrap();
        assert_eq!(
            out,
            "[[New]] [[New|alias]] [[New#h]] [[New]] [[New]] ![[New]] [[Other]]"
        );
    }

    #[test]
    fn links_rewrite_paths_and_whitespace() {
        let body = "[[ dir/Old ]] [[dir/Old|a]] [[Old]]";
        let out = rewrite_links(body, &repl(&[("dir/Old", "dir/New")])).unwrap();
        assert_eq!(out, "[[ dir/New ]] [[dir/New|a]] [[Old]]");
    }

    #[test]
    fn links_untouched_in_code() {
        let body = "`[[Old]]`\n```\n[[Old]]\n```\n[[Old]]";
        let out = rewrite_links(body, &repl(&[("Old", "New")])).unwrap();
        assert_eq!(out, "`[[Old]]`\n```\n[[Old]]\n```\n[[New]]");
    }

    #[test]
    fn links_no_match_is_none() {
        assert_eq!(rewrite_links("[[A]]", &repl(&[("B", "C")])), None);
        assert_eq!(
            rewrite_links("[[unclosed", &repl(&[("unclosed", "x")])),
            None
        );
    }

    #[test]
    fn links_nested_bracket_declines() {
        assert_eq!(
            rewrite_links("[[a [b]] [[a]]", &repl(&[("a", "z")])).unwrap(),
            "[[a [b]] [[z]]"
        );
    }

    #[test]
    fn tag_rename() {
        let out = rewrite_tags("#old and #Old/sub #older", "old", Some("new")).unwrap();
        assert_eq!(out, "#new and #Old/sub #older");
    }

    #[test]
    fn tag_remove_strips_hash() {
        assert_eq!(rewrite_tags("a #old b", "old", None).unwrap(), "a old b");
        assert_eq!(rewrite_tags("a #Old", "old", None).unwrap(), "a Old");
        assert_eq!(
            rewrite_tags("(#old), #old/sub", "old", None).unwrap(),
            "(old), #old/sub"
        );
        assert_eq!(
            rewrite_tags("`#old` #old", "old", None).unwrap(),
            "`#old` old"
        );
    }

    #[test]
    fn fence_needs_matching_close() {
        let body = "````\n```\n#inside\n````\n#out";
        assert_eq!(scan_tags(body), vec!["out"]);
        let tilde = "~~~\n#inside\n```\n#still\n~~~\n#out";
        assert_eq!(scan_tags(tilde), vec!["out"]);
    }
}

#[cfg(test)]
mod asset_ref_tests {
    use super::*;

    #[test]
    fn scans_both_syntaxes_and_skips_code() {
        let body = "![a](assets/one.png) and ![[two.png|300]]\n```\n![x](code.png)\n```\n`![y](inline.png)`\n![](<with space.png> \"t\") ![](Pasted%20image.png)";
        assert_eq!(
            scan_asset_refs(body),
            vec![
                "assets/one.png",
                "two.png",
                "with space.png",
                "Pasted image.png"
            ]
        );
    }

    #[test]
    fn embed_followed_by_paren_is_a_markdown_image() {
        assert_eq!(
            scan_asset_refs("![[a]](u.png) ![[b.png]]"),
            vec!["u.png", "b.png"]
        );
    }

    #[test]
    fn resolves_like_the_editor() {
        assert_eq!(
            asset_rel_path("cat.png", "assets").as_deref(),
            Some("assets/cat.png")
        );
        assert_eq!(asset_rel_path("cat.png", "").as_deref(), Some("cat.png"));
        assert_eq!(
            asset_rel_path("./sub/cat.png", "assets").as_deref(),
            Some("sub/cat.png")
        );
        assert_eq!(
            asset_rel_path("/sub\\cat.PNG", "assets").as_deref(),
            Some("sub/cat.PNG")
        );
        assert_eq!(asset_rel_path("https://x/cat.png", "assets"), None);
        assert_eq!(asset_rel_path("appasset://abc.png", "assets"), None);
        assert_eq!(asset_rel_path("note.md", "assets"), None);
        assert_eq!(asset_rel_path("note", "assets"), None);
        assert_eq!(
            asset_rel_path("data.csv", "files").as_deref(),
            Some("files/data.csv")
        );
        assert_eq!(
            asset_rel_path("docs/report.pdf", "files").as_deref(),
            Some("docs/report.pdf")
        );
    }
}
