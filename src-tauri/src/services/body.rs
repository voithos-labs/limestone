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
                None => {
                    let mut range = tag.hash..tag.name.end;
                    if body[range.end..].starts_with(' ') {
                        range.end += 1;
                    } else if range.start > 0 && body[..range.start].ends_with(' ') {
                        range.start -= 1;
                    }
                    edits.push((range, ""));
                }
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
    fn tag_remove_eats_one_space() {
        assert_eq!(rewrite_tags("a #old b", "old", None).unwrap(), "a b");
        assert_eq!(rewrite_tags("a #old", "old", None).unwrap(), "a");
        assert_eq!(rewrite_tags("#old", "old", None).unwrap(), "");
        assert_eq!(rewrite_tags("(#old)", "old", None).unwrap(), "()");
    }

    #[test]
    fn fence_needs_matching_close() {
        let body = "````\n```\n#inside\n````\n#out";
        assert_eq!(scan_tags(body), vec!["out"]);
        let tilde = "~~~\n#inside\n```\n#still\n~~~\n#out";
        assert_eq!(scan_tags(tilde), vec!["out"]);
    }
}
