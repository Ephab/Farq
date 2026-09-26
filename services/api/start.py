"""Container entry point: cache the local model when Outlook is configured."""
import os
import uvicorn

if __name__ == "__main__":
    if os.getenv("OUTLOOK_SYNC_ENABLED", "false").lower() == "true" and os.getenv("MICROSOFT_CLIENT_ID"):
        from app.email_classifier import model_directory
        model_directory(download=True)
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, access_log=False)
