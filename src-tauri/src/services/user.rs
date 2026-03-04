use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Deserialize, Serialize)]
pub struct User {
    /// username (online)
    pub username: Option<String>,
    /// uuidv4 user id (online)
    pub id: Option<Uuid>,
    /// locally generated device key (for sync) uuidv4
    pub device_key: Uuid,
}

impl User {
    pub fn initialize() -> Self {
        User {
            username: None,
            id: None,
            device_key: Uuid::new_v4(),
        }
    }
}
