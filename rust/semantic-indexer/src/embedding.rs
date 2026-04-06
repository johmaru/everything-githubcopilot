use anyhow::Result;

use crate::metadata::collapse_whitespace;
use crate::model::{EmbeddingRecord, SymbolRecord};

pub fn build_embedding_records(symbols: &[SymbolRecord]) -> Result<Vec<EmbeddingRecord>> {
    let mut records = Vec::with_capacity(symbols.len());

    for symbol in symbols {
        let export_fragment = if symbol.is_exported {
            match symbol.export_kind.as_deref() {
                Some(kind) => format!("export={kind}"),
                None => String::from("exported=true"),
            }
        } else {
            String::from("exported=false")
        };

        let signature_fragment = symbol.signature.clone().unwrap_or_default();
        let doc_fragment = symbol.doc_comment.clone().unwrap_or_default();
        let source_fragment = collapse_whitespace(&symbol.source_text);
        let text = format!(
            "language={} file={} kind={} name={} stable_symbol_id={} chunk_id={} {} signature={} doc_comment={} source_text={} lines={}-{}",
            symbol.language.as_str(),
            symbol.file_path,
            symbol.kind.as_str(),
            symbol.name,
            symbol.stable_symbol_id,
            symbol.chunk_id,
            export_fragment,
            signature_fragment,
            doc_fragment,
            source_fragment,
            symbol.range.start.line,
            symbol.range.end.line
        )
        .to_lowercase();

        records.push(EmbeddingRecord {
            language: symbol.language,
            file_path: symbol.file_path.clone(),
            kind: symbol.kind.clone(),
            name: symbol.name.clone(),
            stable_symbol_id: symbol.stable_symbol_id.clone(),
            chunk_id: symbol.chunk_id.clone(),
            signature: symbol.signature.clone(),
            doc_comment: symbol.doc_comment.clone(),
            source_text: symbol.source_text.clone(),
            is_exported: symbol.is_exported,
            has_doc_comment: symbol.has_doc_comment,
            text,
        });
    }

    Ok(records)
}
