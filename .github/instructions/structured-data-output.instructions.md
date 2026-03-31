---
applyTo: "**/*"
---
# Structured Data Output Instructions

## Principle

Data types where AI direct generation carries a high risk of corruption or truncation must be handled by **generating a Python script and executing it via terminal**. Never write such data directly to a file.

## Target Data Types

### Structured Data Files
- **JSON / CSV / YAML / TOML** — when exceeding 50 lines or deeply nested
- **XML** — when namespaces are involved or the structure is complex
- **Fixed-length text / EDI formats** — where byte-offset errors are fatal

### Database Related
- **SQL migration files** — have ordering dependencies; incorrect execution risks corrupting production data
- **Bulk INSERT / UPDATE / DELETE statements** — SQL that operates on large datasets
- **Schema definitions** — DDL statements such as CREATE TABLE that alter structure

### Binary and Encoded Data
- **Excel (.xlsx / .xls)** — requires libraries such as openpyxl
- **PDF generation** — requires libraries such as reportlab
- **Base64 encode/decode results** — long outputs risk being truncated mid-stream
- **Compressed files (zip, gzip, etc.)** — cannot be generated directly

### Cryptography and Security
- **Hash generation and verification** — must always go through a library to guarantee correctness
- **Encryption and decryption** — includes key generation and signing operations

## Procedure

1. Create a generation script (e.g. `generate_data.py`)
2. Run the script in the terminal to produce the file
3. Verify the output, then delete or retain the script as appropriate

## Rationale

- AI direct output is prone to mid-file truncation due to context window limits
- Python scripts are easy to validate, re-run, and modify
- Incorrect generation of DB or binary content can cause irreversible damage
