from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    google_client_id: str = ""
    google_client_secret: str = ""
    gmail_accounts: str = ""

    microsoft_client_id: str = ""
    microsoft_client_secret: str = ""
    microsoft_tenant_id: str = "common"
    outlook_accounts: str = ""

    imap_host: str = ""
    imap_port: int = 993
    imap_username: str = ""
    imap_password: str = ""
    imap_use_ssl: bool = True

    # SMTP (for IMAP accounts — defaults to IMAP credentials if unset)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_ssl: bool = False  # False = STARTTLS (port 587), True = implicit SSL (port 465)

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-haiku-4-5-20251001"

    sync_interval_seconds: int = 300
    app_port: int = 8000
    secret_key: str = "change-me"

    jwt_secret: str = ""

    class Config:
        env_file = "../.env"
        extra = "ignore"

    @property
    def gmail_account_list(self) -> list[str]:
        return [a.strip() for a in self.gmail_accounts.split(",") if a.strip()]

    @property
    def outlook_account_list(self) -> list[str]:
        return [a.strip() for a in self.outlook_accounts.split(",") if a.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
