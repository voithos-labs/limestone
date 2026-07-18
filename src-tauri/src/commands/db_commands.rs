use serde_json::Value;
use sqlx::{Column, Row, TypeInfo, ValueRef};
use tauri::State;

use crate::AppData;

/// Binds serde_json param list onto a sqlx query, saving your hemorrhaging mind instantly
#[macro_export]
macro_rules! bind_json {
    ($query:expr, $params:expr) => {{
        let mut q = $query;
        for val in $params {
            q = match val {
                serde_json::Value::Null => q.bind(None::<String>),
                serde_json::Value::Bool(b) => q.bind(*b),
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        q.bind(i)
                    } else {
                        q.bind(n.as_f64().unwrap_or_default())
                    }
                }
                serde_json::Value::String(s) => q.bind(s.as_str()),
                other => q.bind(other.to_string()),
            };
        }
        q
    }};
}

fn row_to_json(row: &sqlx::sqlite::SqliteRow) -> Result<Value, String> {
    let mut map = serde_json::Map::new();
    for (i, col) in row.columns().iter().enumerate() {
        let raw = row.try_get_raw(i).map_err(|e| e.to_string())?;
        let v = match raw.type_info().name() {
            "NULL" => Value::Null,
            "TEXT" => row
                .try_get::<String, _>(i)
                .map(Value::String)
                .map_err(|e| e.to_string())?,
            "INTEGER" | "BOOLEAN" => row
                .try_get::<i64, _>(i)
                .map(|n| Value::Number(n.into()))
                .map_err(|e| e.to_string())?,
            "REAL" => row
                .try_get::<f64, _>(i)
                .map(|n| {
                    serde_json::Number::from_f64(n)
                        .map(Value::Number)
                        .unwrap_or(Value::Null)
                })
                .map_err(|e| e.to_string())?,
            _ => row
                .try_get::<String, _>(i)
                .map(Value::String)
                .unwrap_or(Value::Null),
        };
        map.insert(col.name().to_string(), v);
    }
    Ok(Value::Object(map))
}

#[tauri::command]
pub async fn sql_select(
    app_data: State<'_, AppData>,
    query: String,
    params: Vec<Value>,
) -> Result<Vec<Value>, String> {
    let q = sqlx::query(&query);
    let q = bind_json!(q, &params);
    let rows = q.fetch_all(&app_data.db).await.map_err(|e| e.to_string())?;
    rows.iter().map(row_to_json).collect()
}

#[tauri::command]
pub async fn sql_execute(
    app_data: State<'_, AppData>,
    query: String,
    params: Vec<Value>,
) -> Result<Value, String> {
    let q = sqlx::query(&query);
    let q = bind_json!(q, &params);
    let result = q.execute(&app_data.db).await.map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "rows_affected": result.rows_affected(),
        "last_insert_rowid": result.last_insert_rowid(),
    }))
}
