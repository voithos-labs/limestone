pub mod asset_commands;
pub mod bulk_ops_commands;
pub mod db_commands;
pub mod document_commands;
pub mod history_commands;
pub mod settings_commands;
pub mod source_commands;
pub mod watch_commands;

// tauri command error type

#[derive(Debug, serde::Serialize)]
pub struct OpError {
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

impl OpError {
    pub(crate) fn new(kind: &str) -> Self {
        Self {
            kind: kind.to_string(),
            name: None,
        }
    }

    pub(crate) fn named(kind: &str, name: &str) -> Self {
        Self {
            kind: kind.to_string(),
            name: Some(name.to_string()),
        }
    }

    pub(crate) fn io(e: &std::io::Error) -> Self {
        Self::new(&crate::services::bulk_ops::classify_io(e))
    }
}

pub(crate) fn to_trash(path: &std::path::Path) -> Result<(), OpError> {
    trash::delete(path).map_err(|e| match e {
        trash::Error::CouldNotAccess { .. } => OpError::new("permission"),
        trash::Error::Os { code, .. } if code == 32 => OpError::new("locked"),
        _ => OpError::new("other"),
    })
}

impl From<std::io::Error> for OpError {
    fn from(e: std::io::Error) -> Self {
        Self::io(&e)
    }
}

impl From<sqlx::Error> for OpError {
    fn from(_: sqlx::Error) -> Self {
        Self::new("other")
    }
}

impl From<String> for OpError {
    fn from(_: String) -> Self {
        Self::new("other")
    }
}
