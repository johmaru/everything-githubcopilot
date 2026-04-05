use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .unwrap()
        .to_path_buf()
}

fn fixture_paths() -> [PathBuf; 4] {
    let root = repo_root();
    [
        root.join(".opencode").join("index.ts"),
        root.join(".opencode").join("plugins").join("ecc-hooks.ts"),
        root.join(".github")
            .join("skills")
            .join("skill-comply")
            .join("scripts")
            .join("parser.py"),
        root.join("rust")
            .join("semantic-indexer")
            .join("src")
            .join("lib.rs"),
    ]
}

#[test]
fn cli_outputs_json_for_repo_self_fixtures() {
    let root = repo_root();
    let fixtures = fixture_paths();

    let output = Command::new(env!("CARGO_BIN_EXE_semantic-indexer"))
        .arg("--root")
        .arg(&root)
        .arg("--format")
        .arg("json")
        .arg("--file")
        .arg(&fixtures[0])
        .arg("--file")
        .arg(&fixtures[1])
        .arg("--file")
        .arg(&fixtures[2])
        .arg("--file")
        .arg(&fixtures[3])
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "CLI should exit successfully: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let records: Value = serde_json::from_slice(&output.stdout).unwrap();
    let array = records.as_array().unwrap();

    assert!(array
        .iter()
        .any(|record| record["kind"] == "module" && record["file_path"] == ".opencode/index.ts"));
    assert!(array.iter().any(|record| {
        record["file_path"] == ".github/skills/skill-comply/scripts/parser.py"
            && record["language"] == "python"
            && record["kind"] == "class"
    }));
    assert!(array.iter().any(|record| {
        record["file_path"] == "rust/semantic-indexer/src/lib.rs"
            && record["language"] == "rust"
            && record["kind"] == "struct"
    }));
    assert!(array
        .iter()
        .any(|record| record["name"] == "VERSION" && record["is_exported"] == true));
    assert!(array
        .iter()
        .any(|record| record["name"] == "metadata" && record["is_exported"] == true));
    assert!(array
        .iter()
        .any(|record| record["name"] == "ECCHooksPlugin" && record["is_exported"] == true));
    assert!(array
        .iter()
        .all(|record| record["stable_symbol_id"].is_string()));
    assert!(array.iter().all(|record| record["chunk_id"].is_string()));
    assert!(array.iter().all(|record| record["source_text"].is_string()));
    assert!(array.iter().all(|record| record.get("signature").is_some()));
    assert!(array
        .iter()
        .all(|record| record.get("doc_comment").is_some()));
}

#[test]
fn cli_outputs_jsonl_for_repo_self_fixtures() {
    let root = repo_root();
    let fixtures = fixture_paths();

    let output = Command::new(env!("CARGO_BIN_EXE_semantic-indexer"))
        .arg("--root")
        .arg(&root)
        .arg("--format")
        .arg("jsonl")
        .arg("--file")
        .arg(&fixtures[0])
        .arg("--file")
        .arg(&fixtures[1])
        .arg("--file")
        .arg(&fixtures[2])
        .arg("--file")
        .arg(&fixtures[3])
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "CLI should exit successfully: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8(output.stdout).unwrap();
    let lines: Vec<&str> = stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    assert!(!lines.is_empty(), "JSONL should emit at least one line");

    let records: Vec<Value> = lines
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .collect();

    assert!(records
        .iter()
        .any(|record| record["file_path"] == ".opencode/index.ts"));
    assert!(records
        .iter()
        .any(|record| record["file_path"] == ".opencode/plugins/ecc-hooks.ts"));
    assert!(records
        .iter()
        .any(|record| record["file_path"] == ".github/skills/skill-comply/scripts/parser.py"));
    assert!(records
        .iter()
        .any(|record| record["file_path"] == "rust/semantic-indexer/src/lib.rs"));
    assert!(records.iter().all(|record| record["text"].is_string()));
    assert!(records.iter().all(|record| record["language"].is_string()));
    assert!(records
        .iter()
        .all(|record| record["stable_symbol_id"].is_string()));
    assert!(records.iter().all(|record| record["chunk_id"].is_string()));
    assert!(records
        .iter()
        .all(|record| record["source_text"].is_string()));
}

#[test]
fn cli_auto_discovery_keeps_repo_self_hidden_fixture_paths() {
    let root = repo_root();

    let output = Command::new(env!("CARGO_BIN_EXE_semantic-indexer"))
        .arg("--root")
        .arg(&root)
        .arg("--format")
        .arg("json")
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "CLI should exit successfully: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let records: Value = serde_json::from_slice(&output.stdout).unwrap();
    let array = records.as_array().unwrap();
    assert!(array
        .iter()
        .any(|record| record["file_path"] == ".opencode/index.ts"));
    assert!(array
        .iter()
        .any(|record| record["file_path"] == ".opencode/plugins/ecc-hooks.ts"));
    assert!(array
        .iter()
        .any(|record| record["file_path"] == ".github/skills/skill-comply/scripts/parser.py"));
    assert!(array
        .iter()
        .any(|record| record["file_path"] == "rust/semantic-indexer/src/lib.rs"));
    assert!(array.iter().all(|record| {
        !record["file_path"]
            .as_str()
            .unwrap_or_default()
            .starts_with(".github/sessions/")
    }));
}

#[test]
fn cli_rejects_source_files_outside_selected_root() {
    let root = repo_root().join(".opencode");
    let outside_fixture = repo_root()
        .join("rust")
        .join("semantic-indexer")
        .join("tests")
        .join("integration.rs");

    let output = Command::new(env!("CARGO_BIN_EXE_semantic-indexer"))
        .arg("--root")
        .arg(&root)
        .arg("--format")
        .arg("json")
        .arg("--file")
        .arg(&outside_fixture)
        .output()
        .unwrap();

    assert!(
        !output.status.success(),
        "CLI should reject files outside the selected root"
    );
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("outside the selected root"));
}
