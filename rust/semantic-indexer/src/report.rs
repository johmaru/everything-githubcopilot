use std::collections::BTreeMap;

use serde::Serialize;

use crate::model::SymbolRecord;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FileSummary {
    pub file_path: String,
    pub symbol_count: usize,
    pub exported_symbol_count: usize,
    pub doc_comment_count: usize,
    pub kinds: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SummaryReport {
    pub file_count: usize,
    pub symbol_count: usize,
    pub exported_symbol_count: usize,
    pub doc_comment_count: usize,
    pub doc_comment_coverage: f64,
    pub languages: BTreeMap<String, usize>,
    pub kinds: BTreeMap<String, usize>,
    pub top_files: Vec<FileSummary>,
}

pub fn build_summary_report(symbols: &[SymbolRecord]) -> SummaryReport {
    let mut languages = BTreeMap::new();
    let mut kinds = BTreeMap::new();
    let mut files = BTreeMap::<String, FileSummary>::new();
    let mut exported_symbol_count = 0;
    let mut doc_comment_count = 0;

    for symbol in symbols {
        increment_count(&mut languages, symbol.language.as_str());
        increment_count(&mut kinds, symbol.kind.as_str());

        if symbol.is_exported {
            exported_symbol_count += 1;
        }

        if symbol.has_doc_comment {
            doc_comment_count += 1;
        }

        let file_summary = files
            .entry(symbol.file_path.clone())
            .or_insert_with(|| FileSummary {
                file_path: symbol.file_path.clone(),
                symbol_count: 0,
                exported_symbol_count: 0,
                doc_comment_count: 0,
                kinds: BTreeMap::new(),
            });

        file_summary.symbol_count += 1;
        if symbol.is_exported {
            file_summary.exported_symbol_count += 1;
        }
        if symbol.has_doc_comment {
            file_summary.doc_comment_count += 1;
        }
        increment_count(&mut file_summary.kinds, symbol.kind.as_str());
    }

    let symbol_count = symbols.len();
    let file_count = files.len();
    let doc_comment_coverage = if symbol_count == 0 {
        0.0
    } else {
        doc_comment_count as f64 / symbol_count as f64
    };

    let mut top_files = files.into_values().collect::<Vec<_>>();
    top_files.sort_by(|left, right| {
        right
            .symbol_count
            .cmp(&left.symbol_count)
            .then(right.exported_symbol_count.cmp(&left.exported_symbol_count))
            .then(right.doc_comment_count.cmp(&left.doc_comment_count))
            .then(left.file_path.cmp(&right.file_path))
    });
    top_files.truncate(10);

    SummaryReport {
        file_count,
        symbol_count,
        exported_symbol_count,
        doc_comment_count,
        doc_comment_coverage,
        languages,
        kinds,
        top_files,
    }
}

fn increment_count(counts: &mut BTreeMap<String, usize>, key: &str) {
    *counts.entry(key.to_string()).or_insert(0) += 1;
}
