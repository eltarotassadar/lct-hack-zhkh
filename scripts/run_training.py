"""Command-line helper for executing the training notebook with Papermill."""

from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path
from typing import Any, Dict, Optional

import papermill as pm
import yaml

DEFAULT_NOTEBOOK = Path("train.ipynb")


def _load_config(path: Optional[Path]) -> Dict[str, Any]:
    if path is None:
        return {}
    with Path(path).open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise ValueError("Config file must contain a mapping at the top level")
    return data


def _merge_args_with_config(args: argparse.Namespace, config: Dict[str, Any]) -> Dict[str, Any]:
    merged: Dict[str, Any] = {}
    merged.update(config)

    cli_overrides = {
        key: value
        for key, value in vars(args).items()
        if key
        not in {
            "config",
        }
        and value is not None
    }

    # Flatten nested config helpers.
    time_range = merged.pop("time_range", {}) or {}
    if "start" in time_range:
        merged.setdefault("start_date", time_range["start"])
    if "end" in time_range:
        merged.setdefault("end_date", time_range["end"])

    outputs = merged.pop("outputs", {}) or {}
    if "model" in outputs:
        merged.setdefault("output_model", outputs["model"])
    if "metrics" in outputs:
        merged.setdefault("metrics_report", outputs["metrics"])
    if "notebook" in outputs:
        merged.setdefault("output_notebook", outputs["notebook"])

    # CLI overrides should take precedence.
    merged.update(cli_overrides)

    return merged


def _resolve_paths(params: Dict[str, Any]) -> Dict[str, Any]:
    resolved = dict(params)

    run_id = resolved.get("run_id")
    if not run_id:
        run_id = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        resolved["run_id"] = run_id

    telemetry_path = resolved.get("telemetry_path")
    weather_path = resolved.get("weather_path")
    if not telemetry_path or not weather_path:
        raise ValueError("Both telemetry_path and weather_path must be provided")
    telemetry_path = Path(telemetry_path)
    weather_path = Path(weather_path)
    if not telemetry_path.exists():
        raise FileNotFoundError(f"Telemetry dataset not found: {telemetry_path}")
    if not weather_path.exists():
        raise FileNotFoundError(f"Weather dataset not found: {weather_path}")
    resolved["telemetry_path"] = telemetry_path
    resolved["weather_path"] = weather_path

    output_model = resolved.get("output_model")
    if not output_model:
        output_model = f"models/catboost_{run_id}.cbm"
    output_model = Path(output_model)
    resolved["output_model"] = output_model

    metrics_report = resolved.get("metrics_report")
    if not metrics_report:
        metrics_report = f"reports/training_metrics_{run_id}.json"
    metrics_report = Path(metrics_report)
    resolved["metrics_report"] = metrics_report

    output_notebook = resolved.get("output_notebook")
    if not output_notebook:
        output_notebook = f"reports/training_run_{run_id}.ipynb"
    output_notebook = Path(output_notebook)
    resolved["output_notebook"] = output_notebook

    # Ensure parent directories exist for outputs.
    output_model.parent.mkdir(parents=True, exist_ok=True)
    metrics_report.parent.mkdir(parents=True, exist_ok=True)
    output_notebook.parent.mkdir(parents=True, exist_ok=True)

    return resolved


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Execute the training notebook with custom parameters via Papermill.",
    )
    parser.add_argument("--config", type=Path, help="YAML file with notebook parameters")
    parser.add_argument("--telemetry-path", dest="telemetry_path", help="Path to telemetry table")
    parser.add_argument("--weather-path", dest="weather_path", help="Path to weather features table")
    parser.add_argument("--run-id", dest="run_id", help="Identifier for the run")
    parser.add_argument(
        "--output-model",
        dest="output_model",
        help="Where to store the trained CatBoost model (defaults to models/catboost_{run_id}.cbm)",
    )
    parser.add_argument(
        "--metrics-report",
        dest="metrics_report",
        help="Where to store metrics summary (defaults to reports/training_metrics_{run_id}.json)",
    )
    parser.add_argument(
        "--output-notebook",
        dest="output_notebook",
        help="Where to save the executed notebook (defaults to reports/training_run_{run_id}.ipynb)",
    )
    parser.add_argument(
        "--start-date",
        dest="start_date",
        help="Optional lower bound for telemetry dates (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--end-date",
        dest="end_date",
        help="Optional upper bound for telemetry dates (YYYY-MM-DD)",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    config = _load_config(getattr(args, "config", None))
    merged_params = _merge_args_with_config(args, config)
    params = _resolve_paths(merged_params)

    notebook_params = {
        "telemetry_path": str(params["telemetry_path"]),
        "weather_path": str(params["weather_path"]),
        "run_id": params["run_id"],
        "output_model_path": str(params["output_model"]),
        "metrics_report_path": str(params["metrics_report"]),
    }

    if params.get("start_date"):
        notebook_params["start_date"] = params["start_date"]
    if params.get("end_date"):
        notebook_params["end_date"] = params["end_date"]

    pm.execute_notebook(
        str(DEFAULT_NOTEBOOK),
        str(params["output_notebook"]),
        parameters=notebook_params,
    )


if __name__ == "__main__":
    main()
