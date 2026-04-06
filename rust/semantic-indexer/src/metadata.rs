use crate::model::{Language, SymbolKind};

pub(crate) fn extract_module_doc_comment(source: &str, language: Language) -> Option<String> {
    match language {
        Language::Typescript | Language::Rust => extract_top_doc_comment(source, language),
        Language::Python => extract_top_python_docstring(source),
    }
}

pub(crate) fn summarize_module_source(source: &str, language: Language) -> String {
    let doc_comment = extract_module_doc_comment(source, language);
    let headline = first_significant_source_line(source, language);

    match (doc_comment, headline) {
        (Some(doc_comment), Some(headline)) if !doc_comment.contains(&headline) => {
            format!("{doc_comment}\n{headline}")
        }
        (Some(doc_comment), _) => doc_comment,
        (None, Some(headline)) => headline,
        (None, None) => String::new(),
    }
}

pub(crate) fn extract_doc_comment(
    language: Language,
    source: &str,
    start_byte: usize,
    node_text: &str,
) -> Option<String> {
    match language {
        Language::Typescript | Language::Rust => {
            extract_leading_doc_comment(source, start_byte, language)
        }
        Language::Python => extract_python_block_docstring(node_text),
    }
}

pub(crate) fn build_signature(source_text: &str, kind: &SymbolKind) -> Option<String> {
    if matches!(kind, SymbolKind::Module) {
        return None;
    }

    source_text
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string())
}

pub(crate) fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn first_significant_source_line(source: &str, language: Language) -> Option<String> {
    let mut in_block_comment = false;
    let mut in_python_docstring: Option<&'static str> = None;

    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if matches!(language, Language::Typescript | Language::Rust) {
            if in_block_comment {
                if trimmed.ends_with("*/") {
                    in_block_comment = false;
                }
                continue;
            }

            if trimmed.starts_with("/*") {
                in_block_comment = !trimmed.ends_with("*/");
                continue;
            }

            if trimmed.starts_with("//") || trimmed == "*/" {
                continue;
            }
        }

        if matches!(language, Language::Python) {
            if let Some(delimiter) = in_python_docstring {
                if trimmed.contains(delimiter) {
                    in_python_docstring = None;
                }
                continue;
            }

            if trimmed.starts_with("#!") || is_python_encoding_comment(trimmed) {
                continue;
            }

            if trimmed.starts_with("\"\"\"") {
                if trimmed.matches("\"\"\"").count() < 2 {
                    in_python_docstring = Some("\"\"\"");
                }
                continue;
            }

            if trimmed.starts_with("'''") {
                if trimmed.matches("'''").count() < 2 {
                    in_python_docstring = Some("'''");
                }
                continue;
            }
        }

        return Some(trimmed.to_string());
    }

    None
}

fn extract_top_doc_comment(source: &str, language: Language) -> Option<String> {
    let mut lines = Vec::new();
    let mut collecting = false;

    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if collecting {
                break;
            }
            continue;
        }

        if is_doc_comment_line(trimmed, language) {
            collecting = true;
            lines.push(trimmed.to_string());
            continue;
        }

        break;
    }

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

fn extract_leading_doc_comment(
    source: &str,
    start_byte: usize,
    language: Language,
) -> Option<String> {
    let prefix = &source[..start_byte.min(source.len())];
    let mut lines = Vec::new();

    for line in prefix.lines().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }

        if is_doc_comment_line(trimmed, language) {
            lines.push(trimmed.to_string());
            continue;
        }

        break;
    }

    if lines.is_empty() {
        None
    } else {
        lines.reverse();
        Some(lines.join("\n"))
    }
}

fn extract_top_python_docstring(source: &str) -> Option<String> {
    extract_quoted_docstring(strip_python_preamble(source))
}

fn extract_python_block_docstring(text: &str) -> Option<String> {
    let mut lines = text.lines();
    let _ = lines.next();
    let body = lines.collect::<Vec<_>>().join("\n");
    extract_quoted_docstring(body.trim_start())
}

fn extract_quoted_docstring(text: &str) -> Option<String> {
    for delimiter in ["\"\"\"", "'''"] {
        if let Some(rest) = text.strip_prefix(delimiter)
            && let Some(end_index) = rest.find(delimiter)
        {
            let end = delimiter.len() + end_index + delimiter.len();
            return Some(text[..end].trim().to_string());
        }
    }

    None
}

fn strip_python_preamble(source: &str) -> &str {
    let mut start = 0;

    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("#!") || is_python_encoding_comment(trimmed) {
            start += line.len() + 1;
            continue;
        }

        break;
    }

    source.get(start..).unwrap_or(source).trim_start()
}

fn is_python_encoding_comment(line: &str) -> bool {
    line.starts_with("# vim:")
        || (line.starts_with('#')
            && line.contains("coding")
            && (line.contains(':') || line.contains('=')))
}

fn is_doc_comment_line(line: &str, language: Language) -> bool {
    match language {
        Language::Typescript => {
            line.starts_with("/**")
                || line.starts_with("///")
                || line.starts_with('*')
                || line.starts_with("*/")
        }
        Language::Rust => {
            line.starts_with("/**")
                || line.starts_with("///")
                || line.starts_with("//!")
                || line.starts_with('*')
                || line.starts_with("*/")
        }
        Language::Python => false,
    }
}
