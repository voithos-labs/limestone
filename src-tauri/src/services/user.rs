use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const USER_VERSION: u32 = 1;

fn user_version() -> u32 {
    USER_VERSION
}

#[derive(Deserialize, Serialize)]
pub struct User {
    #[serde(default = "user_version")]
    pub version: u32,
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
            version: USER_VERSION,
            username: None,
            id: None,
            device_key: Uuid::new_v4(),
        }
    }
}
