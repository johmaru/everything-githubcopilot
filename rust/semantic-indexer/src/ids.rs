use std::collections::HashMap;

use crate::model::SymbolRecord;

pub(crate) fn sort_symbols(symbols: &mut [SymbolRecord]) {
    symbols.sort_by(|left, right| {
        left.file_path
            .cmp(&right.file_path)
            .then(left.range.start.byte.cmp(&right.range.start.byte))
            .then(left.name.cmp(&right.name))
    });
}

pub(crate) fn assign_stable_ids(symbols: &mut [SymbolRecord]) {
    let mut occurrences: HashMap<(crate::model::Language, String, &'static str, String), usize> =
        HashMap::new();

    for symbol in symbols {
        let key = (
            symbol.language,
            symbol.file_path.clone(),
            symbol.kind.as_str(),
            symbol.name.clone(),
        );

        let occurrence = occurrences.entry(key.clone()).or_insert(0usize);
        let stable_symbol_id = format!(
            "{}:{}:{}:{}:{}",
            key.0.as_str(),
            key.1,
            key.2,
            key.3,
            *occurrence
        );
        *occurrence += 1;

        symbol.stable_symbol_id = stable_symbol_id.clone();
        symbol.chunk_id = format!("{stable_symbol_id}:chunk:0");
    }
}

#[cfg(test)]
mod tests {
    use crate::model::{Language, Position, Range, SymbolKind, SymbolRecord};

    use super::assign_stable_ids;

    fn record(name: &str, byte: usize) -> SymbolRecord {
        SymbolRecord {
            language: Language::Rust,
            file_path: String::from("src/lib.rs"),
            kind: SymbolKind::Function,
            name: name.to_string(),
            stable_symbol_id: String::new(),
            chunk_id: String::new(),
            range: Range {
                start: Position {
                    line: 1,
                    column: 1,
                    byte,
                },
                end: Position {
                    line: 1,
                    column: 2,
                    byte: byte + 1,
                },
            },
            signature: None,
            doc_comment: None,
            source_text: String::new(),
            is_exported: false,
            export_kind: None,
            has_doc_comment: false,
        }
    }

    #[test]
    fn assign_stable_ids_handles_duplicate_names() {
        let mut symbols = vec![
            record("as_str", 10),
            record("other", 20),
            record("as_str", 30),
        ];
        assign_stable_ids(&mut symbols);

        assert_ne!(symbols[0].stable_symbol_id, symbols[2].stable_symbol_id);
        assert!(symbols[0].stable_symbol_id.ends_with(":0"));
        assert!(symbols[2].stable_symbol_id.ends_with(":1"));
    }
}
