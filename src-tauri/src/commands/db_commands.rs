use serde_json::Value;
use sqlx::{Column, Row, TypeInfo, ValueRef};
use tauri::State;

use crate::AppData;

fn bind_params<'q>(
    mut query: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    params: &'q [Value],
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    for val in params {
        query = match val {
            Value::Null => query.bind(None::<String>),
            Value::Bool(b) => query.bind(*b),
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    query.bind(i)
                } else {
                    query.bind(n.as_f64().unwrap_or_default())
                }
            }
            Value::String(s) => query.bind(s.as_str()),
            other => query.bind(other.to_string()),
        };
    }
    query
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
    let q = bind_params(q, &params);
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
    let q = bind_params(q, &params);
    let result = q.execute(&app_data.db).await.map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "rows_affected": result.rows_affected(),
        "last_insert_rowid": result.last_insert_rowid(),
    }))
}
