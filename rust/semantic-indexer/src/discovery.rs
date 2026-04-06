use std::path::{Path, PathBuf};

use anyhow::Result;
use anyhow::anyhow;
use walkdir::WalkDir;

use crate::model::Language;

pub(crate) fn normalize_path(root: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(root).unwrap_or(path);
    relative.to_string_lossy().replace('\\', "/")
}

pub(crate) fn ensure_file_within_root(root: &Path, file_path: &Path) -> Result<PathBuf> {
    let canonical_path = std::fs::canonicalize(file_path)?;
    if canonical_path.strip_prefix(root).is_err() {
        return Err(anyhow!(
            "refusing to read a source file outside the selected root: {}",
            file_path.display()
        ));
    }

    if !is_supported_extension(&canonical_path) {
        return Err(anyhow!(
            "only .ts, .py, and .rs files are supported: {}",
            file_path.display()
        ));
    }

    Ok(canonical_path)
}

pub(crate) fn language_for_path(path: &Path) -> Result<Language> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("ts") => Ok(Language::Typescript),
        Some("py") => Ok(Language::Python),
        Some("rs") => Ok(Language::Rust),
        _ => Err(anyhow!("unsupported source file: {}", path.display())),
    }
}

pub(crate) fn is_supported_extension(path: &Path) -> bool {
    language_for_path(path).is_ok()
}

pub(crate) fn collect_source_files(root: &Path) -> Result<Vec<PathBuf>> {
    let excluded_dirs = [".git", "node_modules", "target", "dist"];
    let mut files = Vec::new();

    let walker = WalkDir::new(root).into_iter().filter_entry(|entry| {
        if !entry.file_type().is_dir() {
            return true;
        }

        let relative_path = normalize_path(root, entry.path());
        let entry_name = entry.file_name().to_string_lossy();
        if excluded_dirs.contains(&entry_name.as_ref()) {
            return false;
        }

        if relative_path == ".github/sessions" || relative_path.starts_with(".github/sessions/") {
            return false;
        }

        if entry.depth() > 0
            && entry_name.starts_with('.')
            && entry_name != ".opencode"
            && entry_name != ".github"
        {
            return false;
        }

        true
    });

    for entry in walker {
        let entry = entry?;
        if entry.file_type().is_file() && is_supported_extension(entry.path()) {
            files.push(entry.path().to_path_buf());
        }
    }

    files.sort();
    Ok(files)
}
