/// Renderable capability boundary.
pub trait Renderable {
    fn render(&self) -> String;
}

/// Stable identifier alias.
pub type WidgetId = u64;

/// Public build version constant.
pub const BUILD_VERSION: &str = "1.0.0";

pub(crate) const WORKSPACE_ONLY: &str = "workspace";

static INTERNAL_CACHE: &str = "local";

pub struct Widget;

impl Widget {
    pub fn new() -> Self {
        Self
    }
}

impl Renderable for Widget {
    fn render(&self) -> String {
        String::from("widget")
    }
}

#[macro_export]
macro_rules! widget_name {
    () => {
        "widget"
    };
}
