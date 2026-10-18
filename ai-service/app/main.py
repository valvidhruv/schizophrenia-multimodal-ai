from fastapi import FastAPI

app = FastAPI(
    title="Schizophrenia AI Service",
    description=(
        "Research prototype - not for clinical diagnosis. Clinician review required."
    ),
    version="0.1.0",
)

DISCLAIMER = "Research prototype - not for clinical diagnosis. Clinician review required."


@app.get("/")
def read_root():
    return {
        "service": "ai-service",
        "status": "ok",
        "version": "0.1.0",
        "description": DISCLAIMER,
    }


@app.get("/health")
def read_health():
    return {
        "status": "ok",
        "service": "ai-service",
        "version": "0.1.0",
        "description": DISCLAIMER,
    }
